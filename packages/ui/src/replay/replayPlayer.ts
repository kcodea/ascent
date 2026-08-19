/**
 * REPLAY V2 — the playback core (Phase B of docs/replay-v2-handoff.md).
 *
 * State replay: the recording IS the ground truth and this module is a PURE RENDERER over it. It holds the
 * expanded frame list + a cursor + a clock, and renders each frame by feeding the store a synthetic `run`
 * (shop frames, via `synthRunFromShopView`) or a synthetic `lastCombat` (combat frames, which the arena
 * animates verbatim). There is NO `reduce()` and NO `simulate()` anywhere in playback — accuracy is true by
 * construction and old recordings are immune to content drift (§3).
 *
 * The transport chrome (ReplayOverlay) and the round rail import exactly this API surface — the same names
 * the killed v1 driver exported, so the salvaged chrome re-points cleanly.
 */
import type { CombatResult } from '@game/core';
import {
  expandFrames, rollupRounds, roundMarks,
  type CombatFrame, type ReplayV2, type RoundMark, type RoundStat, type ShopFrame, type ShopView,
} from '@game/sim';
import { useGame } from '../store';
import { synthRunFromShopView } from './synthRun';

/** Shop-frame pacing bounds (before the speed divisor) — salvaged from the killed v1 driver. A FLOOR so a
 *  fast run is still legible beat-by-beat rather than blipping past; a DEFAULT when a delta is missing or
 *  zero; a CAP so one long player pause (AFK, a phone call) doesn't stall the replay. Combat frames are
 *  paced by the arena's own clock, not these. */
export const MIN_STEP_MS = 350;
export const DEFAULT_STEP_MS = 900;
export const MAX_STEP_MS = 5000;
/** A short breath after a fight's animation finishes before the next shop frame lands (v1's post-combat beat). */
const POST_COMBAT_BEAT_MS = 500;
/** Safety net: if the arena's done bridge never fires (an FX stall, a hidden tab throttling rAF), the
 *  replay moves on anyway rather than hanging forever on one fight. */
const COMBAT_SAFETY_MS = 120_000;

type Frame = ShopFrame | CombatFrame;

/** Clamp one recorded frame-to-frame delta into a legible step (before the speed divisor). Pure — tested. */
export function clampStepMs(deltaMs: number | undefined): number {
  if (deltaMs === undefined || !(deltaMs > 0)) return DEFAULT_STEP_MS;
  return Math.max(MIN_STEP_MS, Math.min(deltaMs, MAX_STEP_MS));
}

/** Binary search: the index of the frame ACTIVE at `tMs` — the greatest i with frames[i].tMs <= tMs,
 *  clamped to [0, frames.length-1]. O(log n). Pure — tested. */
export function frameIndexAt(frames: readonly { tMs: number }[], tMs: number): number {
  if (frames.length === 0) return 0;
  let lo = 0, hi = frames.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid]!.tMs <= tMs) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans;
}

// ── Module state (one replay at a time; the store's `replaySession` is the reactive projection of this) ────
let frames: Frame[] = [];
let marks: RoundMark[] = [];
let idx = 0;
let speed = 1;
let playing = false;
let authorName: string | undefined;
/** Invalidates every pending timer/subscription across start/seek/end — a stale callback checks it and bails. */
let token = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let unsubCombat: (() => void) | null = null;

/** Every store key the player writes while rendering — snapshotted on start, restored verbatim on exit, so
 *  the viewer's real in-progress run (and whatever screen they came from) survives watching a replay. */
const SNAPSHOT_KEYS = [
  'run', 'showTitle', 'heroChoices', 'inspect', 'heroArmed', 'endTurnAnimating',
  'combatEnemyDeaths', 'combatBuffs', 'combatQuestDelta', 'combatTriggeredQuests', 'combatCompletedQuests',
  'showLeaderboard', 'showRankings', 'showRecentGames', 'showCareer', 'careerOf',
] as const;
type SnapshotKey = (typeof SNAPSHOT_KEYS)[number];
type StoreState = ReturnType<typeof useGame.getState>;
type Snapshot = Pick<StoreState, SnapshotKey>;
let snapshot: Snapshot | null = null;

/** The round rail's index — derived once per `startReplay` (one pass over the frames). Empty when idle. */
export function replayRoundMarks(): RoundMark[] {
  return marks;
}

/** The metrics drawer's per-round fold (§7.4) — `rollupRounds` over the expanded frames, computed ONCE per
 *  `startReplay` and cached here (never per render). Empty when idle. */
let stats: RoundStat[] = [];
export function replayRoundStats(): RoundStat[] {
  return stats;
}

/** Each frame's `tMs`, cached once per `startReplay` — the transport bar maps frame index ⇄ timeline
 *  position through this without re-walking the frames per render. Empty when idle. */
let frameTimes: number[] = [];
export function replayFrameTimes(): readonly number[] {
  return frameTimes;
}

function clearPending(): void {
  if (timer !== null) { clearTimeout(timer); timer = null; }
  if (unsubCombat) { unsubCombat(); unsubCombat = null; }
}

function patchSession(patch: Partial<NonNullable<StoreState['replaySession']>>): void {
  const s = useGame.getState().replaySession;
  if (!s) return;
  useGame.setState({ replaySession: { ...s, ...patch } });
}

/** The store slices a frame render must reset — combat bridges and interaction chrome the previous frame
 *  (or the viewer's own pre-replay screen) may have left populated. `combatSettled` itself is run state and
 *  comes from the frame's recorded view. */
function frameResets(): Partial<StoreState> {
  return {
    heroArmed: false,
    endTurnAnimating: false,
    inspect: null,
    combatEnemyDeaths: 0,
    combatBuffs: null,
    combatQuestDelta: null,
    combatTriggeredQuests: {},
    combatCompletedQuests: [],
    combatReplayDone: false,
  };
}

/** The most recent shop view at or before frame `i` (a combat frame renders inside the world of the shop
 *  turn that produced it), falling back forward for a pathological recording that opens on a combat. */
function nearestShopView(i: number): ShopView | null {
  for (let j = i; j >= 0; j--) {
    const f = frames[j];
    if (f && f.kind === 'shop') return f.view;
  }
  for (let j = i + 1; j < frames.length; j++) {
    const f = frames[j];
    if (f && f.kind === 'shop') return f.view;
  }
  return null;
}

/** Render frame `i` into the store. Shop frame → synthetic recruit run; combat frame → the surrounding shop
 *  world flipped to `phase: 'combat'` with the recorded fight as `lastCombat` (the arena animates it verbatim). */
function renderFrame(i: number): void {
  const f = frames[i];
  if (!f) return;
  if (f.kind === 'shop') {
    useGame.setState({
      run: synthRunFromShopView(f.view),
      ...frameResets(),
      replaySession: { index: i, total: frames.length, playing, speed, round: f.wave, authorName },
    });
  } else {
    const view = nearestShopView(i);
    if (!view) return; // a replay with no shop frame at all — nothing renderable
    const base = synthRunFromShopView(view);
    useGame.setState({
      // The CombatFrame IS a `lastCombat` (a recorded CombatResult plus identity fields the arena ignores).
      // `combatSettled: false` so the arena treats it as a fight to play, not one already resolved.
      run: { ...base, phase: 'combat', wave: f.wave, combatSettled: false, lastCombat: f as unknown as CombatResult },
      ...frameResets(),
      replaySession: { index: i, total: frames.length, playing, speed, round: f.wave, authorName },
    });
  }
}

function finish(): void {
  clearPending();
  playing = false;
  // Terminal snap: the bar reads full + "Final", and the loop stops.
  patchSession({ index: frames.length, playing: false, ended: true });
}

function advance(myToken: number): void {
  if (myToken !== token) return;
  if (idx >= frames.length - 1) { finish(); return; }
  idx += 1;
  renderFrame(idx);
  scheduleNext(myToken);
}

/** Arm the delay (or the arena-done wait) that advances past the CURRENT frame. */
function scheduleNext(myToken: number): void {
  clearPending();
  if (!playing || myToken !== token) return;
  const f = frames[idx];
  if (!f) return;
  if (f.kind === 'combat') {
    // A combat frame advances on the ARENA's done signal: Recruit bridges `replay.done` into the store's
    // `combatReplayDone` while `replaying` (the same bridge v1 used), and we advance one post-combat beat
    // after it fires — with a safety timeout so one stalled fight can't hang the whole replay.
    const onDone = (): void => {
      clearPending();
      timer = setTimeout(() => advance(myToken), POST_COMBAT_BEAT_MS / speed);
    };
    if (useGame.getState().combatReplayDone) { onDone(); return; }
    unsubCombat = useGame.subscribe((st) => { if (st.combatReplayDone && myToken === token) onDone(); });
    timer = setTimeout(() => { if (myToken === token) { clearPending(); advance(myToken); } }, COMBAT_SAFETY_MS);
  } else {
    const next = frames[idx + 1];
    if (!next) {
      // The LAST frame: let it display for one default beat before the terminal snap, so reaching (or
      // seeking to) the end shows the final world rather than instantly flipping the bar to "Final".
      timer = setTimeout(() => { if (myToken === token) finish(); }, DEFAULT_STEP_MS / speed);
      return;
    }
    timer = setTimeout(() => advance(myToken), clampStepMs(next.tMs - f.tMs) / speed);
  }
}

/**
 * Start playing a recorded run. Snapshots the pre-replay store slice (restored verbatim by `endReplay`),
 * flips the store into replay mode (input guards arm on `replaying`), renders frame 0 and starts the clock.
 * `expandFrames` runs ONCE here — delta frames become full views up front, so every later render and seek
 * is a plain array index.
 */
export function startReplay(replay: ReplayV2, meta?: { authorName?: string }): void {
  const expanded = expandFrames(replay.frames);
  if (expanded.length === 0) return;
  if (snapshot) endReplay(); // a replay is already running — exit it cleanly first (restores its snapshot)
  const s = useGame.getState();
  const snap = {} as Record<SnapshotKey, unknown>;
  for (const k of SNAPSHOT_KEYS) snap[k] = s[k];
  snapshot = snap as unknown as Snapshot;
  frames = expanded;
  marks = roundMarks(expanded);
  stats = rollupRounds(expanded);
  frameTimes = expanded.map((f) => f.tMs);
  idx = 0;
  speed = 1;
  playing = true;
  token += 1;
  authorName = meta?.authorName ?? replay.author;
  useGame.setState({
    replaying: true,
    combatReplayDone: false,
    // Close every launcher overlay so exiting the replay lands back where the viewer came from (the
    // snapshot restores the flags), and nothing floats above the playback.
    showTitle: false, heroChoices: null, inspect: null,
    showLeaderboard: false, showRankings: false, showRecentGames: false, showCareer: false, careerOf: null,
    // Bump the seek epoch on ENTRY too: rewatching your OWN run keeps the same seed+hero mount key, so
    // without this the recruit FX refs would diff the live run's sequence counters against frame 0's and
    // fire a stale burst.
    replaySeekEpoch: s.replaySeekEpoch + 1,
  });
  renderFrame(0);
  scheduleNext(token);
}

export function pauseReplay(): void {
  if (!snapshot) return;
  playing = false;
  clearPending();
  patchSession({ playing: false });
}

export function resumeReplay(): void {
  if (!snapshot || playing) return;
  const session = useGame.getState().replaySession;
  if (session?.ended) return; // finished — seek somewhere to rewind, exit to leave
  playing = true;
  patchSession({ playing: true });
  scheduleNext(token);
}

export function setReplaySpeed(v: number): void {
  if (!snapshot) return;
  speed = Math.max(0.5, Math.min(10, v));
  patchSession({ speed });
  // Re-arm the current step at the new speed (a full step, not the remainder — a simplification that costs
  // at most one step of drift, invisible against the clamped pacing).
  if (playing) scheduleNext(token);
}

/**
 * Jump to the frame active at `tMs` (binary search — O(log n), always exactly correct: §6). Scrubbing into
 * COMBAT territory renders the fight's END state — the next shop frame's world — because a scrub is asking
 * "where was the game at time T", not "replay this fight" (the final combat, with no shop frame after it,
 * starts from the top instead so the ending stays watchable). The round rail always targets shop-opening
 * frames, so rail clicks never hit this branch.
 *
 * Every seek bumps `replaySeekEpoch`, which remounts the recruit tree (Game.tsx folds it into the mount
 * key) — the FX layer's sequence-diff refs re-init at the target frame, so a jump across 30 frames can't
 * fire 30 stale buy/weld effects. Ordinary frame stepping keeps its FX; only seeks suppress.
 */
export function seekReplay(tMs: number): void {
  if (!snapshot) return;
  token += 1; // cancel any in-flight step/arena wait
  clearPending();
  let i = frameIndexAt(frames, tMs);
  if (frames[i]?.kind === 'combat') {
    let j = i + 1;
    while (j < frames.length && frames[j]?.kind === 'combat') j += 1;
    if (j < frames.length) i = j; // the next shop frame = the fight's resolved world
  }
  idx = i;
  useGame.setState((st) => ({ replaySeekEpoch: st.replaySeekEpoch + 1 }));
  renderFrame(idx);
  patchSession({ ended: false }); // seeking rewinds out of the terminal state
  if (playing) scheduleNext(token);
}

/** Exit the replay and restore the snapshotted store slice — the viewer's real in-progress run, screen
 *  flags and combat bridges all return exactly as they were before `startReplay`. */
export function endReplay(): void {
  if (!snapshot) return;
  token += 1;
  clearPending();
  const restore = snapshot;
  snapshot = null;
  frames = [];
  marks = [];
  stats = [];
  frameTimes = [];
  playing = false;
  useGame.setState({
    ...restore,
    replaying: false,
    replaySession: null,
    combatReplayDone: false,
    replaySeekEpoch: 0, // back to the idle epoch — also remounts Recruit onto the restored run
  });
}

// DEV convenience: watch any ReplayV2 from the console (`__startReplay(replayObject)`), matching the killed
// driver's window handle. Stripped from production builds.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __startReplay?: typeof startReplay }).__startReplay = startReplay;
}
