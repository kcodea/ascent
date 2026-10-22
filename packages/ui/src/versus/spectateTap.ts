/**
 * VERSUS SPECTATING — the PLAYER's side of the live extras (owner 2026-10-14): what the player just did, and where their
 * hand is. Both run ONLY while someone is in the stands; with nobody watching nothing here listens, times or sends.
 *
 *  - ACTION TAGS: each committed shop action becomes a tiny tag (`{ t, uid, index, drag }`) that rides the next
 *    spectator delta, so the spectator plays the same animation and cue instead of guessing from a diff. A drag-driven
 *    action carries the drag's recorded path (the replay recorder's own trace, `replay/dragTrace.ts`).
 *  - THE CURSOR (built once in `cursorSource.ts`, for this sender and the replay recorder alike, R-REPLAY-STREAM-01):
 *    the pointer ANCHORED to the UI element under it, with game-box (design-space) fractions as the
 *    fallback and the old window fractions for older spectators (`cursorSpace.ts`, R-SPECTATE-CURSOR-01), plus the card
 *    being dragged, on the room's broadcast channel at 20 Hz, coalesced to the latest sample per tick. The
 *    pointer and its target are taken from the move event (no layout read per move); the one anchor rect read happens on
 *    the sample timer, off the render path; a backgrounded or idle tab sends one "hide" and then nothing. Since
 *    2026-10-20 (R-SPECTATE-SMOOTH-01) every message carries the player's clock (`ts`) and up to three points ~16 ms
 *    apart (`tr`), 20 messages a second, so the stands play the hand back at an even pace; a drop says whether it
 *    committed (`de`), and an action hurries the next publish (`ACT_FLUSH_MS`) so its landing is not left waiting.
 *  - THE HOVER: the anchor key IS the hovered target (R-SPECTATE-HOVER-01). It rides the cursor sample, which only goes
 *    when something changed, so a hover costs no extra message.
 *  - THE FIGHT'S BEAT: the beat the player's fight is on (`notePlayerBeat`) rides every spectator keyframe while in
 *    combat (`cb`), so a spectator who joins or comes back mid-fight seeks to it (R-SPECTATE-JOIN-01).
 */
import type { Action, CombatOdds, DragPath, EotRecord, StreamCursorBody, StreamDecision, StreamTrailPoint, VersusSeat } from '@game/sim';
import { dragTraceOf } from '../replay/dragTrace';
import { noteStreamOverlay, noteStreamSkip } from '../replay/streamRecorder';
import { CURSOR_IDLE_MS, CURSOR_POINT_MS, CURSOR_TICK_MS, noteCursorAct, subscribeCursor, wireDecisionOf } from './cursorSource';

// The cursor message itself is built ONCE, in `cursorSource.ts`, for this sender and the replay recorder alike
// (R-REPLAY-STREAM-01). Re-exported so the wire's constants and helpers keep their old home.
export { CURSOR_IDLE_MS, CURSOR_POINT_MS, CURSOR_TICK_MS, wireDecisionOf };

export const SPECTATE_CURSOR_EVENT = 'spectate_cursor';
/** A live-game watcher leaving (its game recounts the stands at once; R-SPECTATE-WATCHERS-01). An older player ignores it. */
export const SPECTATE_BYE_EVENT = 'spectate_bye';

/** One committed action, as the spectator replays it. */
export interface SpectatorAct {
  /** The action, or `endTurn`: the End Turn press (tapped when it is PREPARED, so the stands play its beats in step), or
   *  `skipCombat`: the fight's Skip press (the stands skip their replay with it, R-SPECTATE-SKIP-01). */
  t: Action['type'] | 'endTurn' | 'skipCombat';
  uid?: string;
  index?: number;
  /** An aimed spell's target (the spectator plays its cast FX at the same minion). */
  targetUid?: string;
  /** A drag-driven action: the pointer path the player's card travelled (window fractions, real duration). */
  drag?: DragPath;
  /** `endTurn`: the End-of-Turn batch the player's screen is playing (the replay recorder's record), when any. */
  eot?: Pick<EotRecord, 'batch' | 'lassoFx'>;
  /** When it happened, on the player's clock (the cursor samples' `ts` clock): the stands land it as the drawn hand
   *  gets there (R-SPECTATE-SMOOTH-01). Optional: an older player sends none and the stands land it on arrival. */
  ts?: number;
}

/** One cursor sample: the message `cursorSource.ts` builds (`StreamCursorBody`: window and game-box fractions, the
 *  anchor, the held card and its drop gap `g` (R-SPECTATE-DRAGGAP-01), the aim, `hide`, the player's clock `ts` and
 *  trail `tr` (R-SPECTATE-SMOOTH-01), the drop outcome `de`), plus the seat it is from. */
export type CursorSample = StreamCursorBody & { seat: VersusSeat };

/** An earlier point of a cursor message (`CursorSample.tr`): `[ms before ts, gx, gy, anchor key?, fx?, fy?]`. */
export type TrailPoint = StreamTrailPoint;

/**
 * The player's live DRAG DECISION as it travels (owner 2026-10-15: "spectating live is also doing that old replay issue
 * where minions dont seem to move until the minion is placed, instead of shifting during the hover over";
 * R-SPECTATE-DRAGGAP-01): the zone under the card and the gap indices the rows open (the replay's ghost-hold fix,
 * `holdGhostCard`, fed live). Short keys, defaults omitted; it changes a few times per drag, and only a change sends.
 */
export type WireDecision = StreamDecision;


/** The actions a spectator replays (everything else is bookkeeping it does not need to see). */
const TAGGED: ReadonlySet<string> = new Set([
  'buy', 'sell', 'play', 'roll', 'freeze', 'upgrade', 'reposition', 'reorderShop', 'reorderHand', 'heroPower',
  'activateEquipment', 'discover', 'chooseOne', 'buyRune', 'pickPower', 'battlecryTarget', 'faceOmen',
]);
const MAX_ACTS = 24;
/** An action goes out at most this long after it happened (the ordinary publish waits for idle time, up to 250 ms; an
 *  action's landing is what the stands are waiting for, R-SPECTATE-SMOOTH-01). */
export const ACT_FLUSH_MS = 40;

let watching = false;
let acts: SpectatorAct[] = [];

/** Record a committed action for the stands (a no-op when nobody watches). */
export function tapAct(action: Action): void {
  if (!TAGGED.has(action.type)) return;
  // Counted even with nobody watching: the replay recorder's drop outcomes read it too (R-REPLAY-STREAM-01).
  noteCursorAct();
  if (!watching) return;
  const a = action as { uid?: unknown; index?: unknown; targetUid?: unknown };
  // The same path the replay recorder attached to this action's frame (R-REPLAY-DRAG-SHARED-01): the recorder reads
  // it first, in the commit, so a plain take here would find nothing in a recorded game.
  const drag = dragTraceOf(action);
  acts.push({
    t: action.type,
    ts: Math.round(performance.now()),
    ...(typeof a.uid === 'string' ? { uid: a.uid } : {}),
    ...(typeof a.index === 'number' ? { index: a.index } : {}),
    ...(typeof a.targetUid === 'string' ? { targetUid: a.targetUid } : {}),
    ...(drag ? { drag } : {}),
  });
  if (acts.length > MAX_ACTS) acts.splice(0, acts.length - MAX_ACTS);
  wake?.();
  hurry();
}

/** The End Turn press, the moment it is PREPARED (its beats start playing on the player's screen): the stands play
 *  the press and the same recorded beats in step, then the fight. `eot` is null for a turn with no End-of-Turn beats. */
export function tapEndTurn(eot: Pick<EotRecord, 'batch' | 'lassoFx'> | null): void {
  if (!watching) return;
  acts.push({ t: 'endTurn', ts: Math.round(performance.now()), ...(eot ? { eot: { batch: eot.batch, ...(eot.lassoFx ? { lassoFx: eot.lassoFx } : {}) } } : {}) });
  if (acts.length > MAX_ACTS) acts.splice(0, acts.length - MAX_ACTS);
  wake?.();
  hurry();
}

/** The fight's SKIP press (owner 2026-10-20: "if a player skips combat the spectator should follow their view back to
 *  shop in real time"; R-SPECTATE-SKIP-01). Skip is a presentation on the player's screen (the fight jumps to its
 *  result, nothing is dispatched), so the stands would never see it: the tag rides the next message and the spectator's
 *  replay skips with it. An older spectator ignores the unknown tag. */
export function tapSkipCombat(): void {
  noteStreamSkip(); // the replay records it too (R-REPLAY-STREAM-01; a no-op when the run records none)
  if (!watching) return;
  acts.push({ t: 'skipCombat' });
  if (acts.length > MAX_ACTS) acts.splice(0, acts.length - MAX_ACTS);
  wake?.();
}

/** Tags waiting for the next publish (the publisher sends them even when nothing visible changed). The fight's odds
 *  arriving count too. */
export const hasPendingActs = (): boolean => acts.length > 0 || oddsDirty || overlayDirty;

// ── the shop overlays' minimize state ──────────────────────────────────────────────────────────────────────

/** WHICH SHOP OVERLAYS THE PLAYER HAS MINIMIZED (owner 2026-10-16: "when a player minimizes the runeforge, the spectator
 *  doesnt see that"; R-SPECTATE-OVERLAY-01). The Discover, the hero-power Discover, the Quest pick and the Runeforge
 *  each have a Peek / minimize toggle that is the player's LOCAL state (Recruit), so it never reached the stands.
 *  A set flag = minimized; an absent flag = open. Kept even with nobody watching (a joiner's keyframe carries it);
 *  sent once on a change and on every keyframe. An older client sends nothing: the stands show the overlay open. */
export interface WireOverlay { d?: 1; p?: 1; q?: 1; f?: 1 }
let overlayWire: WireOverlay = {};
let overlayDirty = false;
/** The player's overlays changed (Recruit, on any toggle or a new offer resetting one). */
export function tapOverlay(min: { discover: boolean; power: boolean; quest: boolean; forge: boolean }): void {
  const next: WireOverlay = { ...(min.discover ? { d: 1 } : {}), ...(min.power ? { p: 1 } : {}), ...(min.quest ? { q: 1 } : {}), ...(min.forge ? { f: 1 } : {}) };
  if (JSON.stringify(next) === JSON.stringify(overlayWire)) return;
  overlayWire = next;
  noteStreamOverlay(min); // the replay records it too (R-REPLAY-STREAM-01; a no-op when the run records none)
  if (!watching) return;
  overlayDirty = true;
  wake?.();
}
/** The overlay state for the next spectator message: once after a change, and on every keyframe. */
export function takeOverlay(keyframe: boolean): WireOverlay | null {
  const fresh = overlayDirty;
  overlayDirty = false;
  return fresh || keyframe ? overlayWire : null;
}

// ── the fight's odds ───────────────────────────────────────────────────────────────────────────────────────

/** THE FIGHT'S ODDS for the stands (owner 2026-10-16: "allow spectators to view the combat summary in combat so they can
 *  see the chance to win/lose etc."; R-SPECTATE-LOCAL-01). The player's deferred probe computes them once (Recruit); the
 *  result rides the next spectator message (`od`) and every keyframe while that fight is on, so the spectator's Summary
 *  shows the player's exact numbers without running a probe of its own. A few numbers, once per fight. */
export interface WireOdds { w: number; o: CombatOdds }
let odds: WireOdds | null = null;
let oddsDirty = false;
/** The player's probe finished for the fight of `wave`. A no-op with nobody watching (nothing kept, nothing sent). */
export function tapOdds(wave: number, o: CombatOdds): void {
  if (!watching) return;
  odds = { w: wave, o };
  oddsDirty = true;
  wake?.();
}
/** The odds for the next spectator message: new ones once, and on every keyframe while the run is in that fight. */
export function takeOdds(run: { phase: string; wave: number }, keyframe: boolean): WireOdds | null {
  const fresh = oddsDirty;
  oddsDirty = false;
  if (!odds || run.phase !== 'combat' || odds.w !== run.wave) return null;
  return fresh || keyframe ? odds : null;
}

/** Take the tags gathered since the last spectator message. */
export function takeActs(): SpectatorAct[] {
  const out = acts;
  acts = [];
  return out;
}

// ── the cursor ─────────────────────────────────────────────────────────────────────────────────────────────

let send: ((event: string, payload: unknown) => void) | null = null;
/** The publisher's own schedule: a tag asks for a publish (an End Turn press changes nothing visible by itself). */
let wake: (() => void) | null = null;
/** The publisher's flush (send what is pending now), for an action the stands are waiting on. */
let flush: (() => void) | null = null;
let flushTimer: number | null = null;
let seat: VersusSeat | null = null;
/** The cursor subscription while someone watches (`cursorSource.ts` builds the message; this adds the seat and sends). */
let unsubCursor: (() => void) | null = null;
const sendCursor = (body: StreamCursorBody): void => {
  if (send && seat) send(SPECTATE_CURSOR_EVENT, { seat, ...body } satisfies CursorSample);
};

/** An action happened: the publish goes out within `ACT_FLUSH_MS` instead of waiting for idle time. */
function hurry(): void {
  if (!flush || flushTimer != null) return;
  flushTimer = window.setTimeout(() => { flushTimer = null; flush?.(); }, ACT_FLUSH_MS);
}

// ── the fight's beat ───────────────────────────────────────────────────────────────────────────────────────

/** The beat the player's own fight is on (Recruit notes it per beat; a plain write, nothing sent from here). */
let playerBeat: { w: number; b: number } | null = null;
export function notePlayerBeat(wave: number, beat: number): void {
  if (playerBeat && playerBeat.w === wave && playerBeat.b === beat) return;
  playerBeat = { w: wave, b: beat };
}
/** The player's fight position for a spectator message (`cb`), when the run is in that fight. */
export function combatBeatFor(run: { phase: string; wave: number }): { w: number; b: number } | null {
  return run.phase === 'combat' && playerBeat && playerBeat.w === run.wave ? playerBeat : null;
}

/**
 * Turn the live extras on (someone is watching this player) or off. Idempotent; called whenever the stands change.
 */
export function setSpectatorTap(on: boolean, mySeat: VersusSeat | null, sender: ((event: string, payload: unknown) => void) | null, publish?: () => void, publishNow?: () => void): void {
  const want = on && !!mySeat && !!sender;
  send = sender;
  wake = want ? publish ?? null : null;
  flush = want ? publishNow ?? null : null;
  seat = mySeat;
  if (want === watching) return;
  watching = want;
  if (want) {
    unsubCursor = subscribeCursor(sendCursor);
  } else {
    unsubCursor?.();
    unsubCursor = null;
    acts = [];
    if (flushTimer != null) window.clearTimeout(flushTimer);
    flushTimer = null;
    odds = null;
    oddsDirty = false;
    overlayDirty = false;
  }
}

/** For the tests. */
export const spectatorTapOn = (): boolean => watching;
