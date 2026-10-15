/**
 * VERSUS PHASE 2 — SPECTATING (blueprint 8; owner 2026-10-14: "spectators should be able to change the player they are
 * spectating within a spectator ui"). A spectator watches ONE player's full game screen at a time, rendered by the
 * REAL shop and combat components (Recruit, the board, the hand, the HUD, the opponent block, the clock), fed from the
 * spectator projection (`spectatorView.ts`): both seats' latest views are cached here, so switching between them is
 * instant, with no fetch.
 *
 *  - IN: on a live match (shop onwards) a member with no seat enters the watch screen: the store takes a synthetic run
 *    built from the watched seat's view, and `replaying` is armed, the same render-only mode the replay viewer uses
 *    (every live dispatch is swallowed, the board is inert, nothing persists). A right-click inspect still opens.
 *  - DATA: each seat's keyframe is read from `versus_spectator_frames`; its deltas arrive on the room's broadcast
 *    channel. A sequence gap (or a delta with no base) re-reads the keyframes and asks the players for a fresh one
 *    (`SPECTATE_KEY_EVENT`, coalesced on the player's side into its ordinary deferred publish).
 *  - COMBAT: the watched seat's fight is that seat's own `CombatResult` from the committed round row (rounds are
 *    public), so the arena plays it from that player's side; switching seats in a fight shows it from the other side.
 *  - OUT: the match ending, or Leave, restores the store slice taken on the way in and returns to the room.
 *
 * Renders are coalesced to one per animation frame, and the run object keeps every unchanged field's reference, so a
 * delta re-renders only what it touched. A spectator sends nothing to the players beyond the rare keyframe request.
 */
import { create } from 'zustand';
import type { CombatResult } from '@game/core';
import type { RunState, VersusSeat } from '@game/sim';
import { actionSfx, useGame } from '../store';
import { emitPressCue, type PressCue } from '../pressCue';
import { ghostCardView, holdGhostCard, playableDragPath, releaseGhostHold } from '../replay/replayPlayer';
import type { CursorSample, SpectatorAct } from './spectateTap';
import { applySpectatorMessage, newReceiver, type SpectatorMessage, type SpectatorReceiver, type VersusSpectatorView } from './spectatorView';
import type { VersusMatch, VersusRoundRow } from './versusRemote';

/** The broadcast event a spectator sends when it needs a fresh keyframe (a gap it could not repair from the table). */
export const SPECTATE_KEY_EVENT = 'spectate_key';

export interface SpectateState {
  /** On the watch screen. */
  active: boolean;
  /** Whose screen is shown. */
  seat: VersusSeat;
  /** The spectator chose to step back to the room for this match (no auto re-entry until they press Watch). */
  optedOut: string | null;
}

export const useSpectate = create<SpectateState>(() => ({ active: false, seat: 'p1', optedOut: null }));

interface Io {
  latestFrames(matchId: string): Promise<{ seat: VersusSeat; frame: unknown }[]>;
  requestKey(): void;
  loadRounds(): void;
  /** The two-seat lobby from a seat's side, for a view that carries none (a test bot's). */
  lobbyFor(seat: VersusSeat, run: RunState): RunState['lobby'];
}

let io: Io | null = null;
let matchId: string | null = null;
let rx: Record<VersusSeat, SpectatorReceiver> = { p1: newReceiver(), p2: newReceiver() };
let rounds: Record<number, VersusRoundRow> = {};
let fetching = false;
let lastKeyAsk = 0;
let raf = 0;
let lobbyCache: { key: string; lobby: RunState['lobby'] } | null = null;
let last: { view: VersusSpectatorView; fight: unknown; seat: VersusSeat; run: RunState } | null = null;
/** The store slice replaced on the way in, restored on the way out. */
let snapshot: Partial<ReturnType<typeof useGame.getState>> | null = null;
const SNAPSHOT_KEYS = ['run', 'showTitle', 'heroChoices', 'inspect', 'heroArmed', 'equipArmed', 'replaying', 'titleView'] as const;

export function installSpectateIo(next: Io | null): void { io = next; }

/** The synthetic run for a seat's view (RunState-shaped, render-only; see `synthRunFromShopView`). */
export function spectatorRunOf(view: VersusSpectatorView, seat: VersusSeat, id: string, round: VersusRoundRow | undefined): RunState | null {
  const base = {
    ...view,
    mode: 'versus',
    seed: 0,
    runId: `spectate:${id}:${seat}`,
    pool: {},
    pendingTavern: [],
    rngCursor: 0,
    runDamage: {},
    runProcs: {},
  } as unknown as RunState;
  if (view.phase !== 'combat') return base;
  const fight = round ? ((seat === 'p1' ? round.p1_result : round.p2_result) as CombatResult | null) : null;
  return fight ? { ...base, lastCombat: fight } : null; // the round row is not here yet: hold the previous frame
}

/** Live match state from the session: enter, keep, or leave the watch screen. Only ever called for a seatless member. */
export function spectateSync(match: VersusMatch | null, allRounds: Record<number, VersusRoundRow>): void {
  rounds = allRounds;
  const live = !!match && (match.phase === 'shop' || match.phase === 'resolving' || match.phase === 'combat');
  if (!match || !live) { if (useSpectate.getState().active) stopSpectating(); return; }
  if (matchId !== match.id) {
    matchId = match.id;
    rx = { p1: newReceiver(), p2: newReceiver() };
    void fetchKeyframes();
  }
  if (useSpectate.getState().optedOut === match.id) return;
  schedule();
}

/** A broadcast frame from a player. */
export function receiveSpectate(payload: unknown): void {
  const msg = payload as SpectatorMessage;
  if (!msg || (msg.seat !== 'p1' && msg.seat !== 'p2') || typeof msg.seq !== 'number') return;
  const { rx: next, needKeyframe } = applySpectatorMessage(rx[msg.seat], msg);
  rx[msg.seat] = next;
  if (needKeyframe) { askForKey(); void fetchKeyframes(); return; }
  if (msg.seat !== useSpectate.getState().seat) return;
  // The watched player's ACTIONS: their screen moves one action at a time, each with the animation and cue the
  // player saw (`playActs`). A message with no actions just renders (coalesced).
  if (msg.acts?.length || queue.length || busy) {
    queue.push({ view: next.view!, acts: msg.acts ?? [] });
    pump();
  } else schedule();
}

// ── the watched player's actions, replayed in order ────────────────────────────────────────────────────────

interface Pending { view: VersusSpectatorView; acts: SpectatorAct[] }
let queue: Pending[] = [];
/** The view on screen while the queue plays (null: the latest received). */
let shownView: VersusSpectatorView | null = null;
let busy: number | null = null;
let ghostKey = 0;
/** A drag flight is at most this long (the player's real drag duration, capped), halved when behind. */
const MAX_FLIGHT_MS = 900;
/** The pause between two queued actions. */
const ACT_GAP_MS = 60;
/** Queued actions past this many are compressed: they land without a flight, so the screen never falls behind. */
const BEHIND = 2;

/** The press cue a button action replays (its own press visual, `pressCue.ts`). */
const PRESS: Partial<Record<string, PressCue>> = { roll: 'refresh', freeze: 'freeze', upgrade: 'upgrade', heroPower: 'heroPower' };

function pump(): void {
  if (busy != null) return;
  const item = queue.shift();
  if (!item) { shownView = null; schedule(); return; }
  const prevRun = useGame.getState().run;
  const behind = queue.length >= BEHIND;
  const flight = behind ? null : item.acts.find((a) => a.drag && playableDragPath(a.drag) && !(a.uid && liveDragShown(a.uid)));
  if (flight?.drag) {
    // The card flies the player's own drag path over the screen as it was, then lands (the replay viewer's ghost).
    const drag = flight.drag;
    const view = ghostCardView(prevRun as never, drag.cardId);
    const durMs = Math.min(drag.durMs, MAX_FLIGHT_MS) / (queue.length ? 2 : 1);
    ghostKey += 1;
    useGame.setState({ replayDragGhost: { ...drag, durMs, key: ghostKey, view } });
    holdGhostCard(prevRun as never, item.view as never, flight.t as never, drag, view);
    busy = window.setTimeout(() => land(item, prevRun), durMs);
    return;
  }
  land(item, prevRun);
}

function land(item: Pending, prevRun: RunState): void {
  releaseGhostHold();
  if (useGame.getState().replayDragGhost) useGame.setState({ replayDragGhost: null });
  shownView = item.view;
  render();
  const nextRun = useGame.getState().run;
  for (const a of item.acts) {
    const cue = PRESS[a.t];
    if (cue) emitPressCue(cue);
    if (a.t !== 'heroPower') { try { actionSfx({ type: a.t, ...(a.uid ? { uid: a.uid } : {}), ...(a.index != null ? { index: a.index } : {}) } as never, prevRun, nextRun); } catch { /* a cue never breaks the view */ } }
  }
  busy = window.setTimeout(() => { busy = null; pump(); }, item.acts.length ? ACT_GAP_MS : 0);
}

/** Drop whatever is queued or flying (a seat switch, Leave): the screen jumps to the latest view. */
function clearQueue(): void {
  if (busy != null) { window.clearTimeout(busy); busy = null; }
  queue = [];
  shownView = null;
  releaseGhostHold();
  if (useGame.getState().replayDragGhost) useGame.setState({ replayDragGhost: null });
}

// ── the watched player's cursor ────────────────────────────────────────────────────────────────────────────

export interface CursorPoint { t: number; x: number; y: number }
/** The live cursor the overlay draws (`SpectatorCursor`): a short buffer of samples, the card in hand, hidden. */
export const cursorFeed: { pts: CursorPoint[]; drag: CursorSample['drag']; hidden: boolean; version: number } = { pts: [], drag: null, hidden: true, version: 0 };
const dragSeen = new Map<string, number>();
const liveDragShown = (uid: string): boolean => performance.now() - (dragSeen.get(uid) ?? -1e9) < 2500;
const cursorListeners = new Set<() => void>();
export function onCursorFeed(fn: () => void): () => void { cursorListeners.add(fn); return () => { cursorListeners.delete(fn); }; }

/** A cursor sample from a player (only the watched player's is drawn). */
export function receiveSpectatorCursor(payload: unknown): void {
  const c = payload as CursorSample;
  if (!c || c.seat !== useSpectate.getState().seat || !useSpectate.getState().active) return;
  if (c.hide) {
    cursorFeed.hidden = true;
  } else {
    cursorFeed.hidden = false;
    cursorFeed.pts.push({ t: performance.now(), x: c.x, y: c.y });
    if (cursorFeed.pts.length > 12) cursorFeed.pts.splice(0, cursorFeed.pts.length - 12);
    cursorFeed.drag = c.drag ?? null;
    if (c.drag) dragSeen.set(c.drag.uid, performance.now());
  }
  cursorFeed.version += 1;
  for (const fn of cursorListeners) fn();
}

function resetCursor(): void {
  cursorFeed.pts = [];
  cursorFeed.drag = null;
  cursorFeed.hidden = true;
  cursorFeed.version += 1;
  for (const fn of cursorListeners) fn();
}

function askForKey(): void {
  if (Date.now() - lastKeyAsk < 2000) return;
  lastKeyAsk = Date.now();
  io?.requestKey();
}

async function fetchKeyframes(): Promise<void> {
  if (!io || !matchId || fetching) return;
  fetching = true;
  const id = matchId;
  try {
    const rows = await io.latestFrames(id);
    if (id !== matchId) return;
    for (const r of rows) {
      const msg = r.frame as SpectatorMessage;
      if (msg?.kind === 'key') rx[r.seat] = applySpectatorMessage(rx[r.seat], msg).rx;
    }
    schedule();
  } catch { /* retried on the next gap */ } finally { fetching = false; }
}

/** One render per animation frame, whatever the burst. */
function schedule(): void {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; render(); });
}

function render(): void {
  if (!matchId || useSpectate.getState().optedOut === matchId) return;
  const seat = useSpectate.getState().seat;
  const view = shownView ?? rx[seat].view;
  if (!view) return; // nothing to show for this seat yet: the keyframe is on its way
  const round = rounds[view.wave];
  const fight = round ? (seat === 'p1' ? round.p1_result : round.p2_result) : undefined;
  // Same view, same fight: the same run object (a re-render with nothing new does nothing).
  const run = last && last.view === view && last.fight === fight && last.seat === seat ? last.run : spectatorRunOf(view, seat, matchId, round);
  if (run && run !== last?.run && !run.lobby && io) {
    // Rebuilt only when what it reads moves (a round commits, the fight lands or settles), never per shop delta.
    const key = `${seat}|${run.wave}|${run.phase}|${run.combatSettled ? 1 : 0}|${Object.keys(rounds).length}`;
    if (lobbyCache?.key !== key) lobbyCache = { key, lobby: io.lobbyFor(seat, run) };
    run.lobby = lobbyCache.lobby;
  }
  if (run) last = { view, fight, seat, run };
  if (!run) { io?.loadRounds(); return; }
  if (!snapshot) enter();
  const cur = useGame.getState().run;
  if (cur === run) return;
  useGame.setState({ run });
}

function enter(): void {
  const s = useGame.getState();
  const snap: Record<string, unknown> = {};
  for (const k of SNAPSHOT_KEYS) snap[k] = s[k];
  snapshot = snap as typeof snapshot;
  useSpectate.setState({ active: true });
  useGame.setState({ replaying: true, showTitle: false, heroChoices: null, inspect: null, heroArmed: false, equipArmed: false });
}

/** Watch the other player (hotkeys 1 / 2, the spectator bar). Instant: both views are already cached. */
export function watchSeat(seat: VersusSeat): void {
  if (useSpectate.getState().seat === seat) return;
  useGame.setState({ inspect: null });
  clearQueue();
  resetCursor();
  useSpectate.setState({ seat });
  schedule();
}

/** Leave the watch screen for the room (the match keeps running; Watch brings you back). */
export function leaveSpectating(): void {
  useSpectate.setState({ optedOut: matchId });
  stopSpectating();
}

/** Back to watching after Leave. */
export function resumeSpectating(): void {
  useSpectate.setState({ optedOut: null });
  schedule();
}

export function stopSpectating(): void {
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
  clearQueue();
  resetCursor();
  const snap = snapshot;
  snapshot = null;
  last = null;
  useSpectate.setState({ active: false });
  // Back to the room: a spectator always came from it (the Versus title view), whatever the snapshot says.
  if (snap) useGame.setState({ ...snap, inspect: null, replaying: false, showTitle: true, titleView: 'versus' });
}

/** The session ended (the room was left): forget the match. */
export function resetSpectate(): void {
  stopSpectating();
  matchId = null;
  rx = { p1: newReceiver(), p2: newReceiver() };
  rounds = {};
  useSpectate.setState({ seat: 'p1', optedOut: null });
}

/** For the tests: a seat's cached view. */
export const spectatorViewOf = (seat: VersusSeat): VersusSpectatorView | null => rx[seat].view;
