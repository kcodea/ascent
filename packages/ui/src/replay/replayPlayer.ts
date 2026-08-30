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
  type CombatFrame, type DragPath, type InspectEvent, type ReplayV2, type RoundMark, type RoundStat, type ShopFrame, type ShopView,
} from '@game/sim';
import { CARD_INDEX } from '@game/content';
import type { CardView } from '../Card';
import { useGame } from '../store';
import { captureRuneLockIn, chosenRuneIndex } from '../runeLockInCapture';
import type { RuneLockInCard } from '../RuneLockIn';
import { synthRunFromShopView } from './synthRun';

/** Shop-frame pacing bounds (before the speed divisor) — salvaged from the killed v1 driver. A FLOOR so a
 *  fast run is still legible beat-by-beat rather than blipping past; a DEFAULT when a delta is missing or
 *  zero; a CAP so one long player pause (AFK, a phone call) doesn't stall the replay. Combat frames are
 *  paced by the arena's own clock, not these. */
export const MIN_STEP_MS = 350;
export const DEFAULT_STEP_MS = 900;
export const MAX_STEP_MS = 5000;
/** 1:1 pacing floor — a rendering-sanity minimum only, NOT a legibility clamp: two buys 100 ms apart replay
 *  100 ms apart. 50 ms keeps React/FX from being asked to render faster than a frame can land. */
export const TRUE_MIN_STEP_MS = 50;
/** How long the terminal "Final" state lingers before the replay closes itself (owner ask 2026-08-19:
 *  leaving the replay should close the overlay automatically — reaching the end IS leaving). */
export const TERMINAL_LINGER_MS = 2500;
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

/** The LIVE pacing rule: literal 1:1, NO idle condensing of any kind (owner ruling 2026-08-19, second pass:
 *  "i dont want any idle gap condensing at all") — each step is exactly the recorded delta, floored only at
 *  the 50 ms rendering-sanity minimum. A five-minute AFK plays back as five minutes at 1× (the speed slider
 *  and the scrub bar are the viewer's tools for it). A missing/zero delta (a scripted or degenerate capture)
 *  falls back to the legibility default rather than machine-gunning frames. `clampStepMs` above is RETIRED
 *  from the live clock; kept for the fixed beats + its tests. */
export function paceStepMs(deltaMs: number | undefined): number {
  if (deltaMs === undefined || !(deltaMs > 0)) return DEFAULT_STEP_MS;
  return Math.max(TRUE_MIN_STEP_MS, deltaMs);
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
/** The recorded round RANGE, set only when the recording doesn't begin at round 1 — see `ReplaySession.partial`. */
let partial: { firstWave: number; lastWave: number } | undefined;
/** Invalidates every pending timer/subscription across start/seek/end — a stale callback checks it and bails. */
let token = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let unsubCombat: (() => void) | null = null;
/** The recording's inspect trail (open/close events of the card-inspect overlay, same clock as the frames).
 *  Playback re-opens the recorded panel at its literal in-step offset — the 1:1 experience includes hovers. */
let inspectTrail: InspectEvent[] = [];
/** Pending in-step inspect timers — cleared alongside the frame timer (a seek/pause must not fire a stale open). */
let inspectTimers: ReturnType<typeof setTimeout>[] = [];

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

/** The PACED cumulative timeline — each frame-to-frame delta run through `paceStepMs`, exactly the
 *  pacing the playback clock uses. This is what the transport bar's geometry maps through (position ⇄ frame
 *  index), NOT the raw `tMs`: raw deltas include idle gaps (a player AFK for five minutes mid-run), which
 *  would compress all actual play into a sliver of the bar — found live 2026-08-19, where a capture with a
 *  31 s setup gap put 61 of 62 frames in the bar's last 0.2%. Bar position ≡ actual watch time. */
let effTimes: number[] = [];
export function replayEffectiveTimes(): readonly number[] {
  return effTimes;
}

/** Build the paced timeline: frame 0 at 0, each later frame at prev + paceStepMs(raw delta). */
export function effectiveTimesOf(times: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < times.length; i++) {
    out.push(i === 0 ? 0 : out[i - 1]! + paceStepMs(times[i]! - times[i - 1]!));
  }
  return out;
}

function clearPending(): void {
  if (timer !== null) { clearTimeout(timer); timer = null; }
  if (unsubCombat) { unsubCombat(); unsubCombat = null; }
  for (const t of inspectTimers) clearTimeout(t);
  inspectTimers = [];
}

/** The inspect events that fall STRICTLY inside one shop step (t0, t1) — an event at exactly `t1` coincides
 *  with the next action, whose frame render closes the panel anyway (live, every action closes inspect).
 *  Pure — tested. */
export function inspectEventsBetween(events: readonly InspectEvent[], t0: number, t1: number): InspectEvent[] {
  return events.filter((e) => e.tMs > t0 && e.tMs < t1);
}

/** Index of the latest inspect event at-or-before `tMs`, or -1 when none — the seek rule. The trail records
 *  every close (explicit AND the implicit action-close), so this is always the true panel state at `tMs`,
 *  never a resurrected stale open. Pure — tested. */
export function latestInspectAt(events: readonly InspectEvent[], tMs: number): number {
  let lo = 0, hi = events.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid]!.tMs <= tMs) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans;
}

/** Apply one recorded inspect state to the store — the panel renders the recorded CardView verbatim (no uid
 *  lookup against the frame, so a coalesced/stale target can never miss or crash). */
function applyInspect(view: InspectEvent['inspect']): void {
  useGame.setState({ inspect: view as CardView | null });
}

/** Arm the in-step inspect timers for the shop step from `f.tMs` to `t1`. Offsets are LITERAL (1:1 pacing:
 *  event-time minus frame-time is the real offset), divided by the speed like every other delay. */
function scheduleInspects(myToken: number, t0: number, t1: number): void {
  for (const ev of inspectEventsBetween(inspectTrail, t0, t1)) {
    const at = Math.max(0, ev.tMs - t0) / speed;
    inspectTimers.push(setTimeout(() => { if (myToken === token) applyInspect(ev.inspect); }, at));
  }
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
    replayDragGhost: null,
    // A scrub away from a rune purchase must not leave the ceremony hanging on screen. The frame that ARMS
    // one re-adds it after this spread.
    runeLockInCue: null,
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
/**
 * Measure the forge row and arm the ceremony for a recorded `buyRune`, if we can tell which rune it was.
 *
 * Silent no-op when anything is missing — an old recording without `causeIndex` whose purchase was a
 * DUPLICATE (so the owned-rune diff is ambiguous), a forge row that is not on screen because the viewer
 * scrubbed rather than played into it. A missing flourish is a fair trade for never crowning the wrong rune.
 */
function armReplayRuneLockIn(f: ShopFrame): RuneLockInCard[] | null {
  const prev = useGame.getState().run;
  const offer = prev.runeforgeOffer;
  if (!offer?.length) return null;
  const idx = chosenRuneIndex(f.causeIndex, offer, prev.ownedRunes, f.view.ownedRunes);
  if (idx < 0) return null;
  return captureRuneLockIn(offer, prev.runeforgeDiscounts, idx);
}

function renderFrame(i: number): void {
  stepElapsedSourceMs = 0; // a rendered frame starts a fresh step for the ledger
  stepArmedAtReal = null;
  if (frames[i]?.kind === 'combat') combatShownAtReal = performance.now();
  ghostLandPending = false; // any render supersedes an in-flight ghost (frameResets clears the layer too)
  const f = frames[i];
  if (!f) return;
  if (f.kind === 'shop') {
    // THE RUNE LOCK-IN CEREMONY (owner ask 2026-08-30: it "doesnt appear to play during the replays which it
    // absolutely should"). It is measured HERE, and nowhere else, because this is the last instant at which
    // it CAN be: the forge row on screen belongs to the previous frame, and the `setState` below replaces it
    // with a view whose `runeforgeOffer` is gone. One line later there is nothing left to measure.
    //
    // Live play cannot share this hook — there the click handler owns the moment, because only it knows
    // which element was clicked. Both paths converge on `captureRuneLockIn`, so they produce one ceremony.
    // Measured BEFORE the setState below (the row it measures is about to be replaced), applied INSIDE it —
    // one render, and it lands after `frameResets()` so the reset that clears a stale ceremony cannot clear
    // the one we just armed.
    const lockInCue = f.cause === 'buyRune' ? armReplayRuneLockIn(f) : null;
    useGame.setState({
      run: synthRunFromShopView(f.view),
      ...frameResets(),
      ...(lockInCue ? { runeLockInCue: lockInCue } : {}),
      replaySession: { index: i, total: frames.length, playing, speed, round: f.wave, authorName, partial },
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
      replaySession: { index: i, total: frames.length, playing, speed, round: f.wave, authorName, partial },
    });
  }
}

function finish(): void {
  clearPending();
  playing = false;
  // Terminal snap: the bar reads full + "Final" — then the replay CLOSES ITSELF after a short linger
  // (owner ask 2026-08-19: leaving the replay should close the overlay automatically; reaching the end is
  // the common way out, and requiring a ✕ click after "Final" read as the overlay being stuck). A seek
  // during the linger bumps `token`, so the pending close is cancelled and the viewer can scrub back.
  patchSession({ index: frames.length, playing: false, ended: true });
  const myToken = token;
  timer = setTimeout(() => { if (myToken === token) endReplay(); }, TERMINAL_LINGER_MS);
}

/** A recorded drag path playback can actually ghost: at least two points and a real duration. A malformed
 *  path (0/1 points, non-positive duration) skips the ghost and the frame lands normally. Pure — tested. */
export function playableDragPath(d: DragPath | undefined): DragPath | null {
  if (!d || !Array.isArray(d.pts) || d.pts.length < 2 || !(d.durMs > 0)) return null;
  return d;
}

/** The CardView the drag ghost renders — the REAL card plate, looked up in the PREVIOUS frame's recorded
 *  view so the ghost carries the stats/golden state the card actually had when the player grabbed it (owner
 *  report 2026-08-19: the first ghost was a tiny generic tile, "not what the card actually looks like").
 *  Falls back to the printed base card when the id isn't found (edge of coalescing / a consumed offer). */
function ghostCardView(prevView: ShopView | null, cardId: string): CardView | undefined {
  const def = CARD_INDEX[cardId];
  if (!def) return undefined;
  const base: CardView = {
    name: def.name, cardId: def.id, tribe: def.tribe, tribe2: def.tribe2,
    attack: def.attack, health: def.health, keywords: [...def.keywords], text: def.text,
    goldenText: def.goldenText, tier: def.tier, spell: def.spell, cost: def.cost,
    baseAttack: def.attack, baseHealth: def.health,
  };
  if (!prevView) return base;
  const offer = prevView.shop?.find((o) => o?.cardId === cardId);
  if (offer) {
    return { ...base, attack: def.attack + (offer.atk ?? 0), health: def.health + (offer.hp ?? 0), golden: offer.golden };
  }
  const inst = prevView.hand?.find((c) => c.cardId === cardId) ?? prevView.board?.find((c) => c.cardId === cardId);
  if (inst) {
    return { ...base, attack: inst.attack, health: inst.health, golden: inst.golden, keywords: [...inst.keywords] };
  }
  return base;
}

/** Monotonic key so back-to-back ghosts retrigger the layer's animation. */
let ghostKey = 0;

// THE STEP-PROGRESS LEDGER (owner report 2026-08-19: "the speed mod definitely breaks"). The clock used to
// re-arm the CURRENT step from zero on every speed change and every pause/resume. Under literal 1:1 pacing a
// step can be a 30-second think, so dragging the slider through five notches re-armed the full think five
// times and playback appeared frozen. The ledger tracks how much of the current step's SOURCE time has
// actually elapsed, so a re-arm continues from where it was.
let stepElapsedSourceMs = 0;
let stepArmedAtReal: number | null = null;
let speedAtArm = 1;
/** Bank the source-time progress of the in-flight step (call before any clearPending re-arm). */
function markStepProgress(): void {
  if (stepArmedAtReal !== null) {
    stepElapsedSourceMs += Math.max(0, performance.now() - stepArmedAtReal) * speedAtArm;
    stepArmedAtReal = null;
  }
}
/** When the CURRENT combat frame's arena started (real clock). The recorded fight-to-settle gap is honored
 *  on top of it (owner report 2026-08-19: "ending combat seems a bit fast" was accurate - playback advanced
 *  500ms after the arena finished, discarding the recorded watch/settle time). */
let combatShownAtReal = 0;
/** True while a ghost is flying and its frame has NOT landed yet — a pause mid-ghost lands the frame
 *  immediately (the ghost dissolves with it), so the paused world is never stuck one frame behind. */
let ghostLandPending = false;

function advance(myToken: number): void {
  if (myToken !== token) return;
  if (idx >= frames.length - 1) { finish(); return; }
  const nf = frames[idx + 1];
  const drag = nf && nf.kind === 'shop' ? playableDragPath(nf.drag) : null;
  if (drag) {
    // DRAG GHOST (owner ask 2026-08-19, "1:1 hands"): the clock has advanced INTO a frame produced by a
    // drag. Instead of the result snapping in, replay the hand first — a ghost of the card flies the
    // recorded path over the REAL recorded drag duration (÷ speed), over the PREVIOUS frame's world, and the
    // frame lands when the ghost does. The step's own delta already elapsed to get here; the ghost's durMs
    // is the literal 1:1 addition (the live drag took exactly that long between the two states too). Seeks
    // never come through `advance`, so they skip ghosts entirely.
    const prevView = frames[idx]?.kind === 'shop' ? (frames[idx] as ShopFrame).view : null;
    idx += 1;
    ghostKey += 1;
    ghostLandPending = true;
    useGame.setState({ replayDragGhost: { ...drag, durMs: drag.durMs / speed, key: ghostKey, view: ghostCardView(prevView, drag.cardId) } });
    timer = setTimeout(() => {
      if (myToken !== token) return;
      ghostLandPending = false;
      renderFrame(idx); // frameResets clears the ghost in the same set
      scheduleNext(myToken);
    }, drag.durMs / speed);
    return;
  }
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
      // Honor the RECORDED fight-to-settle gap, not just a fixed beat: the live player watched this fight
      // (and its summary) for recordedGap ms; the viewer's arena may play faster or slower (their own
      // combat-speed setting drives it), so wait out whatever of the recorded gap remains, floored at the
      // old post-combat beat so a slower arena never yields a negative pause.
      const nextF = frames[idx + 1];
      const recordedGap = nextF ? Math.max(0, nextF.tMs - f.tMs) : 0;
      const elapsedSource = Math.max(0, performance.now() - combatShownAtReal) * speed;
      const waitMs = Math.max(POST_COMBAT_BEAT_MS, recordedGap - elapsedSource) / speed;
      timer = setTimeout(() => advance(myToken), waitMs);
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
    // Recorded hovers replay at their literal in-step offsets (the panel closes with the next frame's
    // render, exactly as the live action closed it). Combat steps schedule none — inspect is a recruit-only
    // surface, so no trail event can fall inside a fight.
    // A step INTO a drag frame is armed SHORT by the drag's duration - the recorded delta CONTAINS the
    // drag (the player was dragging during that gap), and the ghost flight plays that remainder; step +
    // flight = the literal recorded delta, never delta-plus-durMs twice over. The ledger offset keeps a
    // resumed/re-armed step from re-firing hovers that already showed.
    const stepDrag = next.kind === 'shop' ? playableDragPath(next.drag) : null;
    const paced = paceStepMs(next.tMs - f.tMs);
    const total = Math.max(0, paced - (stepDrag ? Math.min(stepDrag.durMs, paced) : 0));
    const remaining = Math.max(0, total - stepElapsedSourceMs);
    scheduleInspects(myToken, f.tMs + stepElapsedSourceMs, next.tMs);
    stepArmedAtReal = performance.now();
    speedAtArm = speed;
    patchSession({ stepEndsAtReal: performance.now() + remaining / speed });
    timer = setTimeout(() => advance(myToken), remaining / speed);
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
  effTimes = effectiveTimesOf(frameTimes);
  inspectTrail = replay.inspectTrail ?? []; // absent on recordings made before the trail existed
  idx = 0;
  speed = 1;
  playing = true;
  token += 1;
  authorName = meta?.authorName ?? replay.author;
  // A recording that doesn't reach back to round 1 advertises its RANGE, so the rail can say what it has
  // instead of letting the viewer infer that rounds were dropped. Derived from the marks rather than trusted
  // from the payload — a recording from before `firstRecordedWave` existed still labels correctly.
  const firstWave = marks[0]?.wave ?? 1;
  const lastWave = marks[marks.length - 1]?.wave ?? firstWave;
  partial = firstWave > 1 || replay.partial === true ? { firstWave, lastWave } : undefined;
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
  markStepProgress(); // bank the in-flight step so resume continues it rather than restarting it
  clearPending();
  patchSession({ stepEndsAtReal: null }); // the bar holds while paused
  // Pausing mid-ghost lands the ghost's frame NOW (and dissolves the ghost) — otherwise the paused world
  // would sit one frame behind the transport position and resume would skip the landing entirely.
  if (ghostLandPending) renderFrame(idx);
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
  markStepProgress(); // bank at the OLD speed first - the ledger converts real elapsed to source elapsed
  speed = Math.max(0.5, Math.min(5, v)); // owner ruling 2026-08-19: the replay speed range is 0.5–5×
  patchSession({ speed });
  // Re-arm the current step at the new speed (a full step, not the remainder — a simplification that costs
  // at most one step of drift, invisible against the clamped pacing). A speed change mid-ghost lands the
  // ghost's frame first — `scheduleNext` arms the NEXT step, so the landing must not be skipped.
  if (ghostLandPending) renderFrame(idx);
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
  // The panel state AT the seek target: the latest trail event at-or-before it (the trail records every
  // close, incl. the implicit action-close, so this can never resurrect a stale open). `renderFrame` already
  // nulled the panel; only a live open needs applying. When the combat-skip advanced `idx` PAST the target,
  // the frame boundary itself is the target — where the invariant says closed.
  const seekTarget = Math.max(tMs, frames[idx]?.tMs ?? tMs);
  const ei = latestInspectAt(inspectTrail, seekTarget);
  if (ei >= 0 && inspectTrail[ei]!.inspect) applyInspect(inspectTrail[ei]!.inspect);
  patchSession({ ended: false }); // seeking rewinds out of the terminal state
  if (playing) scheduleNext(token);
}

/** Seek straight to a frame INDEX — the transport bar's path (it maps a bar fraction through the CLAMPED
 *  timeline to an index, so the raw-tMs search would undo the clamping). Same combat-scrub rule + epoch
 *  bump as `seekReplay`; the round rail keeps `seekReplay` (its marks carry exact frame times). */
export function seekReplayIndex(i: number, opts?: { atTMs?: number }): void {
  if (!snapshot || frames.length === 0) return;
  token += 1;
  clearPending();
  let k = Math.max(0, Math.min(frames.length - 1, Math.round(i)));
  if (frames[k]?.kind === 'combat') {
    let j = k + 1;
    while (j < frames.length && frames[j]?.kind === 'combat') j += 1;
    if (j < frames.length) k = j;
  }
  idx = k;
  useGame.setState((st) => ({ replaySeekEpoch: st.replaySeekEpoch + 1 }));
  renderFrame(idx);
  // A bar scrub can target a moment MID-step — a point after the landed frame where the recorded player had
  // an inspect panel open (found live 2026-08-19: scrubbing into an open window snapped it closed, because
  // this path only lands on frame boundaries, where the panel is always closed). Apply the trail at the
  // REAL target time when the caller has one; the frame's own boundary time otherwise (a rail click), where
  // the latest event is a close and this stays a no-op.
  const at = opts?.atTMs ?? frames[k]!.tMs;
  const ei = latestInspectAt(inspectTrail, at);
  if (ei >= 0 && inspectTrail[ei]!.inspect) applyInspect(inspectTrail[ei]!.inspect);
  patchSession({ ended: false });
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
  effTimes = [];
  inspectTrail = [];
  partial = undefined;
  playing = false;
  ghostLandPending = false;
  useGame.setState({
    ...restore,
    replaying: false,
    replaySession: null,
    replayDragGhost: null, // the ghost layer unmounts with the replay — never outlives it
    combatReplayDone: false,
    replaySeekEpoch: 0, // back to the idle epoch — also remounts Recruit onto the restored run
  });
}

// DEV convenience: watch any ReplayV2 from the console (`__startReplay(replayObject)`), matching the killed
// driver's window handle. Stripped from production builds.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __startReplay?: typeof startReplay }).__startReplay = startReplay;
}
