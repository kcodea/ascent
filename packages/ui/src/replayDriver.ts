import { createRun, createLobbyRun, reduce, type Replay, type RunState } from '@game/sim';
import { useGame } from './store';

/**
 * REPLAY CONTROLLER (Phase 1b/1c) — play a recorded run back through the LIVE game UI, with transport controls.
 *
 * It reconstructs the opening state (`createLobbyRun` + the recorded `servedBoards` for faithful fights), then
 * re-applies the logged actions via `reduce` DIRECTLY — never the live `dispatch`, which is swallowed while
 * `replaying` — so no uploads / saves / rating fire and nothing fights the driver. Shop actions are paced by
 * the player's REAL recorded cadence (`timings[i]`) × speed; combats by the arena's own animation (the loop
 * waits on `combatReplayDone`, bridged from `useCombatReplay`).
 *
 * The UI-facing session state (index / total / playing / speed / round) lives on the store as `replaySession`
 * so overlays react to it; these functions drive it. `startReplay` snapshots the live run and `endReplay`
 * restores it, so watching a replay never disturbs your actual game.
 */

interface Snapshot { run: RunState; replayActions: unknown; replayTimings: unknown; showTitle: boolean }

let token = 0;               // bumped to abort/restart the loop (a new play, a seek, or a stop)
let snapshot: Snapshot | null = null; // the live run stashed before playback, restored on exit
let current: Replay | null = null;
let authorName: string | undefined; // whose run we're watching (for the hero-panel name), carried into the session

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, Math.max(0, ms)));

// Shop-action pacing bounds (before the speed divisor). A FLOOR so a fast / bot-recorded run is still legible
// beat-by-beat rather than blipping past; a DEFAULT when a run predates timing capture; a CAP so one long
// player pause (AFK, a phone call) doesn't stall the replay. Combats are paced by the arena, not these.
const MIN_STEP_MS = 350, DEFAULT_STEP_MS = 900, MAX_STEP_MS = 5000;

/** A run is over the moment it reaches a terminal phase — don't keep pacing trailing/no-op actions after. */
const isTerminal = (run: RunState): boolean => run.phase === 'gameover' || run.phase === 'victory';

function reconstruct(replay: Replay): RunState {
  const run = replay.mode && replay.mode !== 'lobby'
    ? createRun(replay.seed, replay.heroId, replay.mode)
    : createLobbyRun(replay.seed, replay.heroId);
  if (replay.servedBoards) run.servedBoards = { ...replay.servedBoards };
  return run;
}

/** Rebuild the run state to exactly `index` actions applied — instantly, no delays or animation. Used at the
 *  start of the loop and on every seek (re-running is cheap + deterministic). */
function stateAt(replay: Replay, index: number): RunState {
  let run = reconstruct(replay);
  for (let i = 0; i < index && i < replay.actions.length; i++) run = reduce(run, replay.actions[i]!);
  return run;
}

async function runLoop(fromIndex: number): Promise<void> {
  const mine = token;
  const g = useGame;
  const replay = current!;
  g.setState({ run: stateAt(replay, fromIndex), combatReplayDone: false });
  patchSession({ index: fromIndex, ended: false });

  for (let i = fromIndex; i < replay.actions.length; i++) {
    // Honour pause: idle here (cheaply) until resumed or aborted.
    while (token === mine && !(g.getState().replaySession?.playing ?? false)) await sleep(60);
    if (token !== mine) return;
    const speed = g.getState().replaySession?.speed ?? 1;
    if (g.getState().run.phase === 'combat') {
      // Wait for the fight to finish ANIMATING, then a short beat so the result reads before leaving.
      while (token === mine && g.getState().run.phase === 'combat' && !g.getState().combatReplayDone) await sleep(30);
      await sleep(500 / speed);
    } else {
      // Honour the player's REAL recorded gap before this action (floored so it's watchable, capped so a long
      // AFK doesn't stall); fall back to a deliberate default for runs recorded before timing capture landed.
      const recorded = replay.timings?.[i];
      const step = recorded == null ? DEFAULT_STEP_MS : Math.max(MIN_STEP_MS, Math.min(recorded, MAX_STEP_MS));
      await sleep(step / speed);
    }
    if (token !== mine) return;
    const a = replay.actions[i]!;
    const next = reduce(g.getState().run, a);
    g.setState({ run: next, combatReplayDone: a.type === 'faceOmen' ? false : g.getState().combatReplayDone });
    // Snap the bar to full the instant the run ends — a won/lost run can terminate before its last recorded
    // action, and pacing dead no-ops past the end is what made the game "end in the middle of the bar".
    if (isTerminal(next)) { patchSession({ index: replay.actions.length, round: next.wave, playing: false, ended: true }); return; }
    patchSession({ index: i + 1, round: next.wave });
  }
  if (token === mine) patchSession({ playing: false, ended: true }); // reached the end — hold on the final frame, paused
}

/** Merge a partial into the live session (no-op if a replay isn't active). */
function patchSession(p: Partial<NonNullable<ReturnType<typeof getSession>>>): void {
  const s = getSession();
  if (s) useGame.setState({ replaySession: { ...s, ...p } });
}
const getSession = () => useGame.getState().replaySession;

/** Start watching a recorded run. Snapshots the live run first so `endReplay` can restore it. `meta.authorName`
 *  is the recorded player's display name — shown in the hero panel so a spectated run reads as THEIRS, not yours
 *  (omit it when rewatching your own run). */
export function startReplay(replay: Replay, meta?: { authorName?: string }): void {
  const g = useGame;
  const s = g.getState();
  snapshot = { run: s.run, replayActions: s.replayActions, replayTimings: s.replayTimings, showTitle: s.showTitle };
  current = replay;
  authorName = meta?.authorName;
  token++;
  g.setState({
    replaying: true, showTitle: false, inspect: null, heroChoices: null, combatReplayDone: false,
    // Close any launcher overlay (leaderboard / recent-matches / career) so the exit lands cleanly on the title.
    showLeaderboard: false, showRankings: false, showRecentMatches: false, showCareer: false, careerOf: null,
    replaySession: { index: 0, total: replay.actions.length, playing: true, speed: 1, round: 1, authorName },
  });
  void runLoop(0);
}

export function pauseReplay(): void { patchSession({ playing: false }); }
export function resumeReplay(): void { patchSession({ playing: true }); }
export function setReplaySpeed(speed: number): void { patchSession({ speed: Math.max(0.5, Math.min(10, speed)) }); }

/** Jump to a point in the run (by action index) and continue from there. */
export function seekReplay(index: number): void {
  if (!current) return;
  const clamped = Math.max(0, Math.min(index, current.actions.length));
  token++;
  patchSession({ index: clamped });
  void runLoop(clamped);
}

/** Stop the replay and restore the live run exactly as it was before playback. */
export function endReplay(): void {
  token++;
  const g = useGame;
  const snap = snapshot;
  g.setState({
    replaying: false, replaySession: null, combatReplayDone: false,
    ...(snap ? { run: snap.run, replayActions: snap.replayActions as never, replayTimings: snap.replayTimings as never, showTitle: snap.showTitle } : {}),
  });
  snapshot = null;
  current = null;
  authorName = undefined;
}

// DEV console handle — still handy for quick tests: `startReplay(useGame.getState().exportReplay())`.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  Object.assign(window as unknown as Record<string, unknown>, { startReplay, endReplay, seekReplay, setReplaySpeed, pauseReplay, resumeReplay });
}
