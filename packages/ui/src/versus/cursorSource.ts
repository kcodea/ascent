/**
 * THE PLAYER'S CURSOR MESSAGES, BUILT ONCE (owner 2026-10-22: "is our replay as good as spectating is? ... would love to
 * keep them both maintained"; R-REPLAY-STREAM-01).
 *
 * This is the one builder of the hand's cursor messages. Two consumers subscribe to it and get the SAME message object:
 *  - the live spectator sender (`spectateTap.ts`), which adds its seat and broadcasts it while someone watches;
 *  - the replay recorder (`replay/streamRecorder.ts`), which stores it in the replay (`ReplayV2.stream`) while the
 *    run records one.
 * So a replay plays the hand exactly as the stands saw it, and the two can never drift apart.
 *
 * A message (`StreamCursorBody`): the pointer ANCHORED to the UI element under it (a card / minion by `data-uid`, a
 * button / rune / quest by `data-spec`), with game-box (design-space) fractions as the fallback and the old window
 * fractions for older spectators (`cursorSpace.ts`, R-SPECTATE-CURSOR-01); the card in hand and the drop gap its rows
 * open (R-SPECTATE-DRAGGAP-01); the aim line (R-SPECTATE-AIM-01); the player's clock (`ts`) and up to three points
 * ~16 ms apart (`tr`, R-SPECTATE-SMOOTH-01); whether a drop committed (`de`). The anchor key is also the hover
 * (R-SPECTATE-HOVER-01).
 *
 * Cost: nothing at all with no subscriber. With one or more: a passive pointermove listener that writes the newest
 * point into a fixed pool of six point slots (no allocation per move, no layout read), and a 20 Hz timer that builds at
 * most one message per tick (one anchor rect read, shared by the message's points). A still hand builds nothing, however
 * long it rests: the stands keep drawing it where it stopped (owner 2026-10-29, R-SPECTATE-CURSOR-IDLE-01). Only a hand
 * that leaves the game window, or a tab sent to the background, sends one hide.
 */
import type { StreamCursorBody, StreamTrailPoint } from '@game/sim';
import { liveAim } from '../aimState';
import { dragStore } from '../dragStore';
import { encodePoint } from './cursorSpace';

/** The message rate: 20 a second while the hand moves (each carrying up to three points, a 60 Hz path). */
export const CURSOR_TICK_MS = 50;
/** One point per this many ms of pointer motion (the newest move in each slot wins). */
export const CURSOR_POINT_MS = 16;
/** A hand this long without a move. It is NOT hidden any more (R-SPECTATE-CURSOR-IDLE-01): it simply sends nothing
 *  while it rests, and the stands keep it where it stopped. Kept for the tests that wait out a rest. */
export const CURSOR_IDLE_MS = 4000;
/** How long after a drop the rows are still settling (the commit FLIP and the place slide). */
const SETTLE_MS = 450;
/** Point slots kept between ticks (a tick takes at most this many). */
const SLOTS = 6;

/** The drop gap on the wire (pure; tested). Short keys, defaults omitted. */
export function wireDecisionOf(overZone: 'tavern' | 'warband' | 'hand' | null | undefined, d: { gapIndex: number; shopGapIndex: number; handGapIndex: number; overWarband: boolean; collapsedLift: boolean; wouldMagnetize: boolean }): NonNullable<NonNullable<StreamCursorBody['drag']>['g']> {
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

type Listener = (body: StreamCursorBody) => void;
const listeners = new Set<Listener>();
let timer: number | null = null;

/** Every committed action the stands would see bumps this: a drag that ends with it moved is a COMMITTED drop. */
let actSerial = 0;
let cx = 0;
let cy = 0;
let lastDragKey = '';
let hidden = false;
let overEl: Element | null = null;
/** The mouse left the game window (R-SPECTATE-CURSOR-IDLE-01): the stands hide the hand until it comes back. */
let outside = false;
/** The pointer's points since the last message: a fixed pool (`SLOTS`), `count` in use, oldest first. */
interface MovePoint { t: number; x: number; y: number; el: Element | null; slot: number }
const pool: MovePoint[] = Array.from({ length: SLOTS }, () => ({ t: 0, x: 0, y: 0, el: null, slot: 0 }));
let count = 0;
/** The card the last message showed in hand, and the action serial when it was picked up. */
let heldUid: string | null = null;
let heldMark = 0;
/** Points stay unanchored until this time: a drop just re-laid the rows out, so the element a point was over may have
 *  moved (an anchor to it would land the stands' hand on its OLD slot, a jump across the board). */
let unanchoredUntil = 0;

/** The mouse left the page (a `pointerout` with nowhere to go). A touch lifting off fires the same, so only a mouse or
 *  pen counts: a finger's last spot stays drawn, as a resting mouse does. */
const onOut = (e: PointerEvent): void => {
  if (e.relatedTarget == null && (e.pointerType === 'mouse' || e.pointerType === 'pen')) outside = true;
};

const onMove = (e: PointerEvent): void => {
  outside = false;
  cx = e.clientX; cy = e.clientY; overEl = e.target as Element | null;
  // The event's own timestamp is on the `performance.now()` clock; a synthetic event may carry 0.
  const t = e.timeStamp > 0 ? e.timeStamp : performance.now();
  const last = count ? pool[count - 1]! : null;
  if (last && t - last.slot < CURSOR_POINT_MS) { last.x = cx; last.y = cy; last.el = overEl; last.t = t; return; }
  if (count === SLOTS) {
    // Full: the oldest slot is recycled to the end (a rotate of six references, no allocation).
    const first = pool.shift()!;
    pool.push(first);
    count -= 1;
  }
  const p = pool[count]!;
  p.t = t; p.x = cx; p.y = cy; p.el = overEl; p.slot = t;
  count += 1;
};

/** Where an aim line starts, as it travels: the element it starts from is the one under that point, if any. */
function aimFrom(x: number, y: number): ReturnType<typeof encodePoint> {
  const target = typeof document !== 'undefined' && document.elementFromPoint ? document.elementFromPoint(x, y) : null;
  return encodePoint(x, y, target);
}
/** The aim start last anchored (re-anchored only when it moves). */
let aimKey: { x: number; y: number; wire: ReturnType<typeof aimFrom> } = { x: NaN, y: NaN, wire: { x: 0, y: 0 } };

function emit(body: StreamCursorBody): void {
  for (const fn of listeners) fn(body);
}

/** One tick: build at most one message, and hand it to every subscriber. */
function tick(): void {
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
  let de: StreamCursorBody['de'];
  if (heldUid && dragNow?.uid !== heldUid) { de = actSerial > heldMark ? 'c' : 'x'; heldUid = null; unanchoredUntil = performance.now() + SETTLE_MS; }
  if (dragNow && dragNow.uid !== heldUid) { heldUid = dragNow.uid; heldMark = actSerial; }
  // A RESTING hand is never hidden (owner 2026-10-29: "can we make it so the a spectated player's mouse doesnt go
  // invisible when it isnt moving?", R-SPECTATE-CURSOR-IDLE-01): it sends nothing and the stands keep drawing it where it
  // stopped, its hover still open. Only a backgrounded tab, or a mouse that left the game window, hides it.
  const gone = !dragNow && !aimNow && !de && outside;
  if (document.visibilityState === 'hidden' || gone) {
    count = 0;
    if (!hidden) {
      hidden = true;
      emit({ x: 0, y: 0, hide: true, ts: Math.round(performance.now()) });
    }
    return;
  }
  if (!count && dragKey === lastDragKey && !hidden && !de) return;
  hidden = false;
  lastDragKey = dragKey;
  // While a card is held or an aim is out, and while the rows settle after a drop, points travel in design space only
  // (the rows under them slide). A sample with no fresh move (a state change only) is never anchored either: its
  // element is the one from the last move, which the action may have moved since.
  const anchored = !dragNow && !aimNow && performance.now() >= unanchoredUntil && count > 0;
  const n = count || 1;
  if (!count) { const p = pool[0]!; p.t = performance.now(); p.x = cx; p.y = cy; p.el = overEl; p.slot = 0; }
  count = 0;
  const rects = new Map<Element, DOMRect>();
  const newest = pool[n - 1]!;
  const at = encodePoint(newest.x, newest.y, newest.el && newest.el.isConnected ? newest.el : null, rects, anchored);
  const tr: StreamTrailPoint[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p = pool[i]!;
    const w = encodePoint(p.x, p.y, p.el && p.el.isConnected ? p.el : null, rects, anchored);
    const back = Math.max(0, Math.round(newest.t - p.t));
    tr.push(w.an ? [back, w.gx ?? 0, w.gy ?? 0, w.an.k, w.an.fx, w.an.fy] : [back, w.gx ?? 0, w.gy ?? 0]);
  }
  emit({ ...at, drag: dragNow, aim: aimNow, ts: Math.round(newest.t), ...(tr.length ? { tr } : {}), ...(de ? { de } : {}) });
}

/** A committed action the stands would see (its drop, if it was dragged, is a COMMITTED drop). Always counted, so the
 *  stream recorder's drops are right with nobody watching. */
export function noteCursorAct(): void {
  actSerial += 1;
}

/**
 * Subscribe to the player's cursor messages. The first subscriber starts the listener and the timer; the last one to
 * leave stops them and resets the builder. A subscriber joining a running source makes the next tick send the current
 * state, as a fresh watch always did (so a spectator joining mid-game sees the hand at once).
 */
export function subscribeCursor(fn: Listener): () => void {
  if (listeners.has(fn)) return () => unsubscribe(fn);
  listeners.add(fn);
  hidden = false;
  lastDragKey = '';
  if (listeners.size === 1 && typeof window !== 'undefined') {
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerout', onOut, { passive: true });
    timer = window.setInterval(tick, CURSOR_TICK_MS);
  }
  return () => unsubscribe(fn);
}

function unsubscribe(fn: Listener): void {
  if (!listeners.delete(fn) || listeners.size > 0) return;
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerout', onOut);
  if (timer != null) window.clearInterval(timer);
  timer = null;
  count = 0;
  heldUid = null;
  unanchoredUntil = 0;
  hidden = false;
  lastDragKey = '';
  overEl = null;
  outside = false;
}

/** For the tests: how many subscribers the source has. */
export const cursorSubscribers = (): number => listeners.size;
