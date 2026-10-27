/**
 * LIVE REPLAY (perf tool, owner ask 2026-10-27): play a RECORDED game back through the real game screen, with the
 * player's own actions at the player's own pace, so a choppy late game can be reproduced, measured with the Perf
 * HUD, and re-measured after a fix. It is not the replay viewer: that draws recorded snapshots and runs none of the
 * live game's work. This runs the real thing: the reducer, the store's commit steps, the shop, End of Turn, the
 * fights, the FX.
 *
 *   ?livereplay=<run_telemetry id>&perf=1        start it at boot (speed: &lrspeed=2 halves the player's gaps)
 *   window.__liveReplay.stop() / .status()       from the console
 *
 * How it stays the same game: the run is rebuilt from the recorded seed + hero + set, the recorded lobby (its 7
 * opponent seats) is put back, and those seats' recorded runs are fetched from the shared pool, so every shop and
 * every fight comes out exactly as recorded (verified headlessly on game 405: 15 waves, 996 actions, 0 differences).
 * It is only exact on the build the game was played on (the row's `patch`), and it checks itself: every shop that
 * opens is compared with the recorded one, and a refused action that the recording says changed something stops the
 * replay with the difference printed, rather than playing on as a different game.
 *
 * Fights: End Combat is pressed at the player's own moment; a fight still playing then gets Skip, as the player did.
 * What it does not reproduce: drags (it dispatches the drop's action, so no drag animation), hovers, and the
 * autosave (the run is flagged `sandbox`, which is what keeps it from saving or uploading anything).
 */
import {
  createLobbyRun, restoreLobbySeatRecordings, resetLobbyDrivers,
  type Action, type BoardSnapshot, type RunState,
} from '@game/sim';
import { useGame } from './store';
import { supabaseClient } from './remoteBoards';
import { buildLiveReplaySchedule, liveFireAt, shopDifferences, type LiveReplayStep, type RecordedFrame } from './liveReplaySchedule';

/** Everything needed to rebuild and play one recorded game. */
export interface LiveReplayBundle {
  rowId: number;
  patch: string | null;
  seed: number;
  heroId: string;
  setId: string | null;
  actions: Action[];
  frames: RecordedFrame[];
  /** The recorded lobby (frame 0's), seats included. */
  lobby: unknown;
  /** Each recorded seat's run, in seat order. */
  seatRuns: BoardSnapshot[][];
}

export interface LiveReplayStatus {
  state: 'idle' | 'loading' | 'running' | 'done' | 'stopped' | 'diverged' | 'error';
  rowId: number | null;
  step: number;
  steps: number;
  wave: number;
  message: string;
}

let status: LiveReplayStatus = { state: 'idle', rowId: null, step: 0, steps: 0, wave: 0, message: '' };
let stopRequested = false;
const log = (msg: string): void => { console.info(`[live replay] ${msg}`); };
const setStatus = (patch: Partial<LiveReplayStatus>): void => { status = { ...status, ...patch }; };

/** Fetch a recorded game and its 7 opponents' runs from the server (read-only). */
export async function fetchLiveReplayBundle(rowId: number): Promise<LiveReplayBundle> {
  const c = supabaseClient();
  if (!c) throw new Error('no backend configured');
  const res = await c.from('run_telemetry').select('id, patch, set_id, replay').eq('id', rowId).limit(1);
  const row = res.data?.[0] as { id: number; patch: string | null; set_id: string | null; replay: { seed: number; heroId: string; mode?: string; actions: Action[]; v2?: { frames: RecordedFrame[] & { view?: { lobby?: unknown } }[] } } } | undefined;
  if (res.error || !row) throw new Error(`game ${rowId} not found (${res.error?.message ?? 'no row'})`);
  const rep = row.replay;
  if (rep.mode !== 'lobby') throw new Error(`game ${rowId} is a ${rep.mode ?? 'non-lobby'} game; only lobby games are supported`);
  const frames = (rep.v2?.frames ?? []) as (RecordedFrame & { view?: { lobby?: { seats?: { kind: string; runKey?: string }[]; setId?: string } } })[];
  const lobby = frames[0]?.view?.lobby;
  if (!lobby?.seats) throw new Error(`game ${rowId} has no recorded lobby (no v2 replay)`);
  const seatRuns: BoardSnapshot[][] = [];
  for (const seat of lobby.seats) {
    if (seat.kind !== 'snapshot' || !seat.runKey) continue;
    const [author, heroId, seed] = seat.runKey.split('|');
    const b = await c.from('boards').select('snapshot, wave').eq('author', author!).eq('hero_id', heroId!).eq('seed', Number(seed)).order('wave', { ascending: true }).limit(200);
    if (b.error) throw new Error(`seat ${seat.runKey}: ${b.error.message}`);
    seatRuns.push((b.data ?? []).map((r) => (r as { snapshot: BoardSnapshot }).snapshot));
  }
  return {
    rowId, patch: row.patch, seed: rep.seed, heroId: rep.heroId, setId: lobby.setId ?? row.set_id,
    actions: rep.actions, frames, lobby, seatRuns,
  };
}

/** Rebuild the recorded game's opening state: same seed, hero and set, the recorded lobby, its seats' runs. */
export function rebuildLiveReplayRun(b: LiveReplayBundle): RunState {
  restoreLobbySeatRecordings({ v: 1, runs: b.seatRuns, hybrids: [] });
  const fresh = createLobbyRun(b.seed, b.heroId, {}, 'lobby', undefined, (b.setId ?? undefined) as Parameters<typeof createLobbyRun>[5]);
  const lobby = structuredClone(b.lobby) as NonNullable<RunState['lobby']>;
  resetLobbyDrivers(lobby.seats);
  return { ...fresh, lobby };
}

// ── The driver ──────────────────────────────────────────────────────────────────────────────────────────────────

/** How much longer than the player's fight a live fight may run before the replay treats it as a Skip. */
const SKIP_GRACE_MS = 1500;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, Math.max(0, ms)));

/** Poll `ok` every frame-ish until true; throws after `timeoutMs` so a stuck replay reports instead of hanging. */
async function waitFor(what: string, ok: () => boolean, timeoutMs = 120_000): Promise<void> {
  const start = performance.now();
  while (!ok()) {
    if (stopRequested) throw new Error('stopped');
    if (performance.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

const endButton = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>('button[data-spec="endturn"]');
const gameOver = (r: RunState): boolean => r.phase === 'gameover' || r.phase === 'victory';
/** The shop is ready for the next action: no End of Turn or held transaction in flight. */
const shopIdle = (): boolean => {
  const s = useGame.getState();
  return s.run.phase === 'recruit' && !s.presentationTx && !s.endTurnAnimating && !s.showTitle;
};

function checkShop(step: LiveReplayStep & { kind: 'endCombat' }): string[] {
  const view = step.shop?.view;
  if (!view) return [];
  const r = useGame.getState().run;
  return shopDifferences(view, { shop: r.shop, hand: r.hand, board: r.board, embers: r.embers, tier: r.tier });
}

async function drive(steps: LiveReplayStep[], speed: number): Promise<void> {
  // The clock starts when the opening shop is actually on screen, not when the run was created.
  await waitFor('the game screen', () => shopIdle() && !!endButton());
  let anchorRec = 0;
  let anchorLive = performance.now();
  let combatRec = 0;
  let combatLive = 0;
  let firedAt = anchorLive;
  let refusedQuiet = 0;
  let skips = 0;
  for (let i = 0; i < steps.length; i++) {
    if (stopRequested) throw new Error('stopped');
    const step = steps[i]!;
    setStatus({ step: i + 1, wave: useGame.getState().run.wave });
    if (step.kind === 'action') {
      await waitFor(`the shop (before ${step.action.type})`, shopIdle);
      await sleep(liveFireAt(step.tMs, anchorRec, anchorLive, firedAt, speed) - performance.now());
      await waitFor(`the shop (before ${step.action.type})`, shopIdle);
      const before = useGame.getState().run;
      useGame.getState().dispatch(step.action);
      firedAt = performance.now();
      if (useGame.getState().run === before) {
        // The recording has a frame for it, so it changed something when the player did it: a refusal now means the
        // game has drifted. Without a frame it was a no-op for the player too.
        if (step.tMs !== null) throw new Error(`diverged: step ${i + 1} (${JSON.stringify(step.action)}) was refused at wave ${before.wave}`);
        refusedQuiet++;
      }
    } else if (step.kind === 'endTurn') {
      await waitFor('the shop (before End Turn)', shopIdle);
      await sleep(liveFireAt(step.tMs, anchorRec, anchorLive, firedAt, speed) - performance.now());
      await waitFor('the End Turn button', () => {
        const b = endButton();
        return shopIdle() && !!b && !b.disabled && !b.classList.contains('ready') && !b.classList.contains('skip');
      });
      endButton()!.click();
      firedAt = performance.now();
      await waitFor('the fight to start', () => useGame.getState().run.phase === 'combat' || gameOver(useGame.getState().run));
      combatLive = performance.now();
      combatRec = step.tMs ?? 0;
    } else {
      // End Combat at the player's own moment (the recorded time from End Turn to the next shop; fights are never
      // sped up by `speed`). If the fight is still playing then, plus a grace for a slower machine, the player had
      // pressed Skip: press it too, then End Combat once the fight has wrapped up.
      const ready = (): boolean => endButton()?.classList.contains('ready') === true || gameOver(useGame.getState().run);
      if (step.tMs !== null) {
        const dueAt = combatLive + Math.max(0, step.tMs - combatRec) + SKIP_GRACE_MS;
        await waitFor('End Combat or the player\'s moment', () => ready() || performance.now() >= dueAt);
        const sk = endButton();
        if (!ready() && sk?.classList.contains('skip')) { sk.click(); skips++; }
      }
      await waitFor('End Combat to become available', ready);
      if (step.tMs !== null) await sleep(combatLive + Math.max(0, step.tMs - combatRec) - performance.now());
      const b = endButton();
      if (b?.classList.contains('ready')) b.click();
      firedAt = performance.now();
      await waitFor('the next shop', () => {
        const s = useGame.getState();
        return gameOver(s.run) || (s.run.phase === 'recruit' && !s.presentationTx);
      });
      if (gameOver(useGame.getState().run)) break;
      const diffs = checkShop(step);
      if (diffs.length) throw new Error(`diverged at wave ${useGame.getState().run.wave}: ${diffs.join('; ')}`);
      anchorLive = performance.now();
      anchorRec = step.tMs ?? anchorRec;
      log(`wave ${useGame.getState().run.wave} shop matches the recording`);
    }
  }
  if (skips) log(`pressed Skip in ${skips} fight(s), as the player did`);
  if (refusedQuiet) log(`${refusedQuiet} action(s) changed nothing (they changed nothing for the player either)`);
}

/** Load, rebuild and play a recorded game. Resolves when it finishes, stops or drifts; see `status()`. */
export async function startLiveReplay(rowId: number, opts: { speed?: number } = {}): Promise<LiveReplayStatus> {
  if (status.state === 'running' || status.state === 'loading') return status;
  stopRequested = false;
  const speed = opts.speed && opts.speed > 0 ? opts.speed : 1;
  setStatus({ state: 'loading', rowId, step: 0, steps: 0, wave: 0, message: '' });
  try {
    const bundle = await fetchLiveReplayBundle(rowId);
    const build = `${__APP_VERSION__}+${__BUILD_SHA__}`;
    if (bundle.patch && bundle.patch !== build) {
      log(`game ${rowId} was played on ${bundle.patch}; this is ${build}. It will stop at the first difference if the game data changed since.`);
    }
    const steps = buildLiveReplaySchedule(bundle.actions, bundle.frames);
    useGame.getState().startLiveReplay(rebuildLiveReplayRun(bundle));
    setStatus({ state: 'running', steps: steps.length, message: `${bundle.actions.length} recorded actions, speed ${speed}x` });
    log(`playing game ${rowId}: ${status.message}`);
    await drive(steps, speed);
    setStatus({ state: 'done', message: `finished at wave ${useGame.getState().run.wave}` });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setStatus({ state: msg === 'stopped' ? 'stopped' : msg.startsWith('diverged') ? 'diverged' : 'error', message: msg });
  }
  useGame.setState({ liveReplay: false });
  log(`${status.state}: ${status.message}`);
  return status;
}

export function stopLiveReplay(): void { stopRequested = true; }
export function liveReplayStatus(): LiveReplayStatus { return status; }

/** Boot hook: `?livereplay=<id>` (optionally `&lrspeed=<n>`) starts a replay once the app is up. */
export function maybeStartLiveReplayFromUrl(): void {
  if (typeof window === 'undefined') return;
  (window as unknown as { __liveReplay: unknown }).__liveReplay = { start: startLiveReplay, stop: stopLiveReplay, status: liveReplayStatus };
  const q = new URLSearchParams(window.location.search);
  const id = Number(q.get('livereplay'));
  if (!Number.isFinite(id) || id <= 0) return;
  const speed = Number(q.get('lrspeed'));
  void startLiveReplay(id, { speed: Number.isFinite(speed) && speed > 0 ? speed : 1 });
}
