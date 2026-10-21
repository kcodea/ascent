/**
 * VERSUS SPECTATING — the PLAYER's side of the live extras (owner 2026-10-14): what the player just did, and where their
 * hand is. Both run ONLY while someone is in the stands; with nobody watching nothing here listens, times or sends.
 *
 *  - ACTION TAGS: each committed shop action becomes a tiny tag (`{ t, uid, index, drag }`) that rides the next
 *    spectator delta, so the spectator plays the same animation and cue instead of guessing from a diff. A drag-driven
 *    action carries the drag's recorded path (the replay recorder's own trace, `replay/dragTrace.ts`).
 *  - THE CURSOR: the pointer ANCHORED to the UI element under it, with game-box (design-space) fractions as the
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
import type { Action, CombatOdds, DragPath, EotRecord, VersusSeat } from '@game/sim';
import { liveAim } from '../aimState';
import { dragStore } from '../dragStore';
import { DRAG_CAUSES, takeDragTrace } from '../replay/dragTrace';
import { encodePoint, type CursorAnchor } from './cursorSpace';

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

/** One cursor sample. `hide` = the player's tab went to the background or the hand went idle. */
export interface CursorSample {
  seat: VersusSeat;
  /** Window fractions (the original wire form; an older spectator reads only these). */
  x: number;
  y: number;
  /** Game-box (design-space) fractions (`cursorSpace.ts`). Optional: an older sender has none. */
  gx?: number;
  gy?: number;
  /** The UI element under the pointer and the point within it; its key is also the hovered target. Optional. */
  an?: CursorAnchor | null;
  /** The card in the player's hand right now (its uid, the zone it was picked from, its card id), and the drop gap
   *  the player's rows are opening for it (`g`, R-SPECTATE-DRAGGAP-01; optional, an older sender has none). */
  drag?: { uid: string; source: string; cardId: string; g?: WireDecision } | null;
  /** A live AIM LINE on the player's screen (a spell cast, the hero power, Equipment, a Battlecry): where it starts
   *  (window fractions), whether it is on a target, and its effect when not the default. */
  aim?: { x: number; y: number; gx?: number; gy?: number; an?: CursorAnchor | null; on: boolean; def?: string; t?: string } | null;
  hide?: true;
  /** THE PLAYER'S CLOCK (R-SPECTATE-SMOOTH-01): when the pointer was at this point (`performance.now()`, ms). The stands
   *  map it onto their own clock and play the hand back at an even pace, whatever the network did to the messages. */
  ts?: number;
  /** The earlier points of this message, oldest first, ~16 ms apart: `[ms before ts, gx, gy, anchor key?, fx?, fy?]`.
   *  A 60 Hz path at 20 messages a second. */
  tr?: TrailPoint[];
  /** A held card was just let go: `c` = it was played / bought / sold / moved (an action follows, keep it in place until
   *  that lands), `x` = the drop was refused or cancelled (it springs back). Only on the first sample after the drag. */
  de?: 'c' | 'x';
}

/** An earlier point of a cursor message (`CursorSample.tr`). */
export type TrailPoint = [number, number, number] | [number, number, number, string, number, number];

/**
 * The player's live DRAG DECISION as it travels (owner 2026-10-15: "spectating live is also doing that old replay issue
 * where minions dont seem to move until the minion is placed, instead of shifting during the hover over";
 * R-SPECTATE-DRAGGAP-01): the zone under the card and the gap indices the rows open (the replay's ghost-hold fix,
 * `holdGhostCard`, fed live). Short keys, defaults omitted; it changes a few times per drag, and only a change sends.
 */
export interface WireDecision {
  z?: 'tavern' | 'warband' | 'hand' | null;
  gi?: number;
  sg?: number;
  hg?: number;
  ow?: 1;
  cl?: 1;
  mg?: 1;
}

/** The drag decision on the wire (pure; tested). */
export function wireDecisionOf(overZone: WireDecision['z'], d: { gapIndex: number; shopGapIndex: number; handGapIndex: number; overWarband: boolean; collapsedLift: boolean; wouldMagnetize: boolean }): WireDecision {
  return {
    ...(overZone ? { z: overZone } : {}),
    ...(d.gapIndex >= 0 ? { gi: d.gapIndex } : {}),
    ...(d.shopGapIndex >= 0 ? { sg: d.shopGapIndex } : {}),
    ...(d.handGapIndex >= 0 ? { hg: d.handGapIndex } : {}),
    ...(d.overWarband ? { ow: 1 as const } : {}),
    ...(d.collapsedLift ? { cl: 1 as const } : {}),
    ...(d.wouldMagnetize ? { mg: 1 as const } : {}),
  };
}

/** The actions a spectator replays (everything else is bookkeeping it does not need to see). */
const TAGGED: ReadonlySet<string> = new Set([
  'buy', 'sell', 'play', 'roll', 'freeze', 'upgrade', 'reposition', 'reorderShop', 'reorderHand', 'heroPower',
  'activateEquipment', 'discover', 'chooseOne', 'buyRune', 'pickPower', 'battlecryTarget', 'faceOmen',
]);
const MAX_ACTS = 24;
/** The cursor message rate: 20 a second while the hand moves (each carrying up to three points, a 60 Hz path). */
export const CURSOR_TICK_MS = 50;
/** One point per this many ms of pointer motion (the newest move in each slot wins). */
export const CURSOR_POINT_MS = 16;
/** An action goes out at most this long after it happened (the ordinary publish waits for idle time, up to 250 ms; an
 *  action's landing is what the stands are waiting for, R-SPECTATE-SMOOTH-01). */
export const ACT_FLUSH_MS = 40;
export const CURSOR_IDLE_MS = 4000;

let watching = false;
let acts: SpectatorAct[] = [];

/** Record a committed action for the stands (a no-op when nobody watches). */
export function tapAct(action: Action): void {
  if (!watching || !TAGGED.has(action.type)) return;
  const a = action as { uid?: unknown; index?: unknown; targetUid?: unknown };
  const drag = DRAG_CAUSES.has(action.type) ? takeDragTrace() : null;
  acts.push({
    t: action.type,
    ts: Math.round(performance.now()),
    ...(typeof a.uid === 'string' ? { uid: a.uid } : {}),
    ...(typeof a.index === 'number' ? { index: a.index } : {}),
    ...(typeof a.targetUid === 'string' ? { targetUid: a.targetUid } : {}),
    ...(drag ? { drag } : {}),
  });
  if (acts.length > MAX_ACTS) acts.splice(0, acts.length - MAX_ACTS);
  actSerial += 1;
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
/** Every tagged action bumps this: a drag that ends with it moved is a COMMITTED drop (`de: 'c'`). */
let actSerial = 0;
let seat: VersusSeat | null = null;
let timer: number | null = null;
let cx = 0;
let cy = 0;
let movedAt = 0;
let lastDragKey = '';
let hidden = false;
/** The element the pointer is over (the move event's own target: no hit test). */
let overEl: Element | null = null;
/** The pointer's points since the last message (one per `CURSOR_POINT_MS`, the newest move in each slot). */
interface MovePoint { t: number; x: number; y: number; el: Element | null; slot: number }
let trail: MovePoint[] = [];
/** The card the last message showed in hand, and the action serial when it was picked up. */
let heldUid: string | null = null;
let heldMark = 0;
/** Points stay unanchored until this time: a drop just re-laid the rows out, so the element a point was over may have
 *  moved (an anchor to it would land the stands' hand on its OLD slot, a jump across the board). */
let unanchoredUntil = 0;
/** How long after a drop the rows are still settling (the commit FLIP and the place slide). */
const SETTLE_MS = 450;

const onMove = (e: PointerEvent): void => {
  cx = e.clientX; cy = e.clientY; overEl = e.target as Element | null;
  // The event's own timestamp is on the `performance.now()` clock; a synthetic event may carry 0.
  const t = e.timeStamp > 0 ? e.timeStamp : performance.now();
  movedAt = performance.now();
  const last = trail[trail.length - 1];
  if (last && t - last.slot < CURSOR_POINT_MS) { last.x = cx; last.y = cy; last.el = overEl; last.t = t; }
  else { trail.push({ t, x: cx, y: cy, el: overEl, slot: t }); if (trail.length > 6) trail.shift(); }
};

/** An action happened: the publish goes out within `ACT_FLUSH_MS` instead of waiting for idle time. */
function hurry(): void {
  if (!flush || flushTimer != null) return;
  flushTimer = window.setTimeout(() => { flushTimer = null; flush?.(); }, ACT_FLUSH_MS);
}

/** Where an aim line starts, as it travels: the element it starts from is the one under that point, if any. */
function aimFrom(x: number, y: number): Pick<NonNullable<CursorSample['aim']>, 'x' | 'y' | 'gx' | 'gy' | 'an'> {
  const target = typeof document !== 'undefined' && document.elementFromPoint ? document.elementFromPoint(x, y) : null;
  return encodePoint(x, y, target);
}
/** The aim start last anchored (re-anchored only when it moves). */
let aimKey: { x: number; y: number; wire: ReturnType<typeof aimFrom> } = { x: NaN, y: NaN, wire: { x: 0, y: 0 } };

function tick(): void {
  if (!send || !seat) return;
  const ds = dragStore.get();
  const drag = ds.drag;
  // A refused drop springs back on the player's screen (`snapping`): to the stands it is let go already.
  const dragNow = drag && drag.active && !drag.ghost && !ds.snapping ? { uid: drag.uid, source: drag.source, cardId: drag.view.cardId ?? '', g: wireDecisionOf(ds.overZone, ds.decision) } : null;
  const a = liveAim.current;
  // The aim's start point is re-anchored only when it moves (one hit test then, not per tick).
  if (a && (a.from.x !== aimKey.x || a.from.y !== aimKey.y)) aimKey = { x: a.from.x, y: a.from.y, wire: aimFrom(a.from.x, a.from.y) };
  // The minion the aim is on (the hero power / Battlecry pick, or the spell drag's cast target): the stands snap the
  // line's end to it and light it (R-SPECTATE-AIM-01).
  const aimOn = a ? ds.aimTargetUid ?? ds.decision.castTargetUid ?? null : null;
  const aimNow = a ? { ...aimKey.wire, on: a.onTarget, ...(a.defId ? { def: a.defId } : {}), ...(aimOn ? { t: aimOn } : {}) } : null;
  const dragKey = `${dragNow ? `${dragNow.uid}|${dragNow.source}|${JSON.stringify(dragNow.g)}` : ''}|${aimNow ? `${aimNow.x},${aimNow.y},${aimNow.on},${aimNow.def ?? ''},${aimNow.t ?? ''}` : ''}`;
  // The drop: the card the last message held is gone from the hand. Committed if an action was tagged since it was
  // picked up (the drop's own dispatch), else refused / cancelled.
  let de: CursorSample['de'];
  if (heldUid && dragNow?.uid !== heldUid) { de = actSerial > heldMark ? 'c' : 'x'; heldUid = null; unanchoredUntil = performance.now() + SETTLE_MS; }
  if (dragNow && dragNow.uid !== heldUid) { heldUid = dragNow.uid; heldMark = actSerial; }
  const idle = !dragNow && !aimNow && !de && performance.now() - movedAt > CURSOR_IDLE_MS;
  if (document.visibilityState === 'hidden' || idle) {
    trail = [];
    if (!hidden) {
      hidden = true;
      // An IDLE hand still over a card keeps that card's hover open in the stands (the player is reading it); a
      // backgrounded tab hovers nothing.
      const still = document.visibilityState !== 'hidden' && overEl?.isConnected ? encodePoint(cx, cy, overEl).an : null;
      send(SPECTATE_CURSOR_EVENT, { seat, x: 0, y: 0, hide: true, ts: Math.round(performance.now()), ...(still ? { an: still } : {}) } satisfies CursorSample);
    }
    return;
  }
  if (!trail.length && dragKey === lastDragKey && !hidden && !de) return;
  hidden = false;
  lastDragKey = dragKey;
  // While a card is held or an aim is out, and while the rows settle after a drop, points travel in design space only
  // (the rows under them slide). A sample with no fresh move (a state change only) is never anchored either: its
  // element is the one from the last move, which the action may have moved since.
  const anchored = !dragNow && !aimNow && performance.now() >= unanchoredUntil && trail.length > 0;
  const pts: MovePoint[] = trail.length ? trail : [{ t: performance.now(), x: cx, y: cy, el: overEl, slot: 0 }];
  trail = [];
  const rects = new Map<Element, DOMRect>();
  const newest = pts[pts.length - 1]!;
  const at = encodePoint(newest.x, newest.y, newest.el && newest.el.isConnected ? newest.el : null, rects, anchored);
  const tr: TrailPoint[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i]!;
    const w = encodePoint(p.x, p.y, p.el && p.el.isConnected ? p.el : null, rects, anchored);
    const back = Math.max(0, Math.round(newest.t - p.t));
    tr.push(w.an ? [back, w.gx ?? 0, w.gy ?? 0, w.an.k, w.an.fx, w.an.fy] : [back, w.gx ?? 0, w.gy ?? 0]);
  }
  const sample: CursorSample = { seat, ...at, drag: dragNow, aim: aimNow, ts: Math.round(newest.t), ...(tr.length ? { tr } : {}), ...(de ? { de } : {}) };
  send(SPECTATE_CURSOR_EVENT, sample);
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
    movedAt = performance.now();
    window.addEventListener('pointermove', onMove, { passive: true });
    timer = window.setInterval(tick, CURSOR_TICK_MS);
  } else {
    window.removeEventListener('pointermove', onMove);
    if (timer != null) window.clearInterval(timer);
    timer = null;
    acts = [];
    trail = [];
    heldUid = null;
    unanchoredUntil = 0;
    if (flushTimer != null) window.clearTimeout(flushTimer);
    flushTimer = null;
    odds = null;
    oddsDirty = false;
    overlayDirty = false;
    hidden = false;
    lastDragKey = '';
    overEl = null;
  }
}

/** For the tests. */
export const spectatorTapOn = (): boolean => watching;
