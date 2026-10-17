/**
 * VERSUS ROOM: THE SEAT DRAG (owner 2026-10-17, R-VERSUS-DRAG-SEAT-01). The interactive half of `seatDrag.ts`.
 *
 * The shop's drag, on the room's cards: press your own card, move past the shop's drag threshold (a finger needs the
 * tap slop), and the floating `.dragcard` (the shop's drag ghost, its grab-shrink and lift scale from `dragFeel`) rides
 * the pointer under the closed-gauntlet veil, while the source card hides. Over an open seat the ghost lights the
 * shop's play glow (`willplay`) and the seat brightens; a seated card dragged up lights the shop's sell zone. On the
 * drop: a legal seat plays the shop's landing sound and takes it, the stands play the sell sound and move you there,
 * an occupied seat buzzes the deny sound and springs back like an invalid shop drop, and empty air just springs back.
 *
 * PERF (the 160 fps bar): the zones are measured ONCE at pick-up; each move only writes the ghost's transform in a
 * rAF and touches React when the zone under the pointer changes. The card moves after the drop are a FLIP
 * (`useSeatFlip`): one rect read per seat change, then a transform-only animation, for my own move, a rollback, and
 * any other member's move arriving over Realtime alike.
 */
import { useEffect, useLayoutEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { currentUserId } from '../identity';
import { getDragFeel } from '../dragFeel';
import { hideDragCursorVeil, showDragCursorVeil } from '../dragCursorVeil';
import { sfx } from '../sfx';
import { onStageChange, stageHost, toScreen, toStage } from '../stage';
import { TAP_SLOP } from '../touchInput';
import { VersusPlayerCard } from './VersusPlayerCard';
import { canDragSeatCard, memberOf, roomWithSeatMove, seatDropOf, seatZoneAt, seatZoneValid, sellLineOf, type Box, type SeatDragGeo, type SeatZone } from './seatDrag';
import type { SeatServerData } from './versusSeatCard';
import { takeSeat, useVersus } from './versusStore';
import type { VersusMember, VersusRole, VersusRoom } from './versusRemote';
import type { VersusSeat } from '@game/sim';

export interface SeatDragState {
  userId: string;
  from: VersusRole;
  zone: SeatZone;
  valid: boolean;
  /** The ghost's layout size (stage px): the seat card's. */
  w: number;
  h: number;
  /** The sell line (stage px), for a seated card. */
  sellTop: number | null;
  /** The ghost's start size relative to its held size (the grab-shrink), so a small hand card grows smoothly. */
  shrinkFrom: number;
  /** Springing back: the ghost's target transform (stage px). */
  snap: { x: number; y: number; scale: number } | null;
}

export const useSeatDragStore = create<{ drag: SeatDragState | null }>(() => ({ drag: null }));
const setDrag = (drag: SeatDragState | null): void => useSeatDragStore.setState({ drag });
const patchDrag = (p: Partial<SeatDragState>): void => {
  const d = useSeatDragStore.getState().drag;
  if (d) setDrag({ ...d, ...p });
};

/** The room as the UI shows it (the server's room plus my pending move). */
export const liveRoomView = (): VersusRoom | null => { const s = useVersus.getState(); return roomWithSeatMove(s.room, s.seatMove, currentUserId()); };

// ── the FLIP origin a drop hands to the seat card (screen px: centre + width) ─────────────────────────────────────
const flipFrom = new Map<string, { cx: number; cy: number; w: number }>();

const boxOf = (r: DOMRect): Box => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
let ghostEl: HTMLDivElement | null = null;
let ghostPos = { x: 0, y: 0 };
let liveTeardown: (() => void) | null = null;

function writeGhost(): void {
  const d = useSeatDragStore.getState().drag;
  if (!ghostEl || !d || d.snap) return;
  ghostEl.style.transform = `translate(${toStage(ghostPos.x) - d.w / 2}px, ${toStage(ghostPos.y) - d.h / 2}px) scale(${getDragFeel().scale})`;
}

/**
 * Pointer-down on a room card. Starts a drag session for MY card in an open room (`canDragSeatCard`); any other card
 * is left alone (it only hovers). `arena` is the painting box the seats and the hand live in.
 */
export function beginSeatDrag(e: ReactPointerEvent<HTMLElement>, userId: string, arena: HTMLElement | null): void {
  if (!arena || (e.pointerType === 'mouse' && e.button !== 0)) return;
  const st = useVersus.getState();
  const me = currentUserId();
  const room = liveRoomView();
  if (st.seatMove || useSeatDragStore.getState().drag || !canDragSeatCard(room, me, userId)) return;
  const from = memberOf(room, me)!.role;
  const src = e.currentTarget;
  const touch = e.pointerType !== 'mouse';
  const threshold = touch ? Math.max(TAP_SLOP, getDragFeel().threshold) : getDragFeel().threshold;
  const x0 = e.clientX;
  const y0 = e.clientY;
  try { src.setPointerCapture(e.pointerId); } catch { /* unsupported / detached */ }
  liveTeardown?.();
  let geo: SeatDragGeo | null = null;
  let origin: { cx: number; cy: number; w: number } | null = null;
  let raf = 0;
  let snapTimer = 0;

  const activate = (): void => {
    // The ONE layout pass of the drag: the source, the seats, the hand, and the seat card's own size.
    const card = src.querySelector<HTMLElement>('[data-versus-card]') ?? src;
    const sr = card.getBoundingClientRect();
    origin = { cx: sr.left + sr.width / 2, cy: sr.top + sr.height / 2, w: sr.width };
    const seats = [...arena.querySelectorAll<HTMLElement>('.vspcard[data-seat]')].map((el) => ({ role: el.dataset.seat as VersusSeat, box: boxOf(el.getBoundingClientRect()) }));
    const benchEl = arena.querySelector<HTMLElement>('.vsbench');
    const own = seats.find((s) => s.role === from);
    const sellScreen = from !== 'spectator' && own ? sellLineOf(own.box, y0) : null;
    geo = { seats, sellTop: sellScreen, bench: benchEl ? boxOf(benchEl.getBoundingClientRect()) : null };
    const hold = arena.querySelector<HTMLElement>('.vspcard .vspcard-hold');
    const w = hold?.offsetWidth || toStage(sr.width);
    const h = hold?.offsetHeight || toStage(sr.height);
    const held = toScreen(w) * getDragFeel().scale;
    ghostPos = { x: x0, y: y0 };
    showDragCursorVeil();
    sfx.cardTouch();
    setDrag({ userId, from, zone: null, valid: false, w, h, sellTop: sellScreen === null ? null : toStage(sellScreen), shrinkFrom: held > 0 ? Math.min(1.6, Math.max(0.3, sr.width / held)) : 1, snap: null });
  };

  const frame = (): void => {
    raf = 0;
    writeGhost();
    const d = useSeatDragStore.getState().drag;
    if (!d || !geo) return;
    const zone = seatZoneAt(from, ghostPos.x, ghostPos.y, geo);
    if (zone !== d.zone) patchDrag({ zone, valid: seatZoneValid(zone, liveRoomView(), currentUserId()) });
  };

  const onMove = (ev: PointerEvent): void => {
    if (ev.pointerId !== e.pointerId) return;
    if (!geo) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < threshold) return;
      activate();
    }
    ghostPos = { x: ev.clientX, y: ev.clientY };
    if (!raf) raf = requestAnimationFrame(frame);
  };

  const finish = (): void => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    hideDragCursorVeil();
  };

  const teardown = (): void => {
    finish();
    window.clearTimeout(snapTimer);
    setDrag(null);
    if (liveTeardown === teardown) liveTeardown = null;
  };

  /** The shop's invalid drop: the ghost springs back to the card it came from, then the card shows again. */
  const snapBack = (): void => {
    const d = useSeatDragStore.getState().drag;
    if (!d || !origin) { teardown(); return; }
    patchDrag({ zone: null, valid: false, snap: { x: toStage(origin.cx) - d.w / 2, y: toStage(origin.cy) - d.h / 2, scale: origin.w / Math.max(1, toScreen(d.w)) } });
    snapTimer = window.setTimeout(teardown, getDragFeel().snapMs + 40);
  };

  const onUp = (ev: PointerEvent): void => {
    if (ev.pointerId !== e.pointerId) return;
    finish();
    if (!geo) { teardown(); return; } // a click, not a drag
    ghostPos = { x: ev.clientX, y: ev.clientY };
    const me = currentUserId();
    const drop = seatDropOf(seatZoneAt(from, ghostPos.x, ghostPos.y, geo), liveRoomView(), me);
    if (drop.kind === 'take' && me) {
      const d = useSeatDragStore.getState().drag;
      if (drop.role === 'spectator') sfx.sell(); else sfx.play();
      // The card lands from where it was let go: the FLIP starts the seat (or hand) card at the ghost.
      if (d) flipFrom.set(me, { cx: ghostPos.x, cy: ghostPos.y, w: toScreen(d.w) * getDragFeel().scale });
      // The ghost goes and the optimistic move lands in the SAME render (React batches both writes).
      teardown();
      void takeSeat(drop.role);
      return;
    }
    if (drop.kind === 'reject') sfx.deny();
    snapBack();
  };

  const onCancel = (ev: PointerEvent): void => {
    if (ev.pointerId !== e.pointerId) return;
    finish();
    if (!geo) { teardown(); return; }
    snapBack();
  };

  liveTeardown = teardown;
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
}

/** Tear down any live seat drag (the room unmounting). */
export function endSeatDrag(): void { liveTeardown?.(); }

/** THE GHOST: the shop's floating `.dragcard`, holding my player card at seat size. */
export function SeatDragGhost({ room, data }: { room: VersusRoom; data: ReadonlyMap<string, SeatServerData> }): JSX.Element | null {
  const drag = useSeatDragStore((s) => s.drag);
  const m: VersusMember | null = drag ? memberOf(room, drag.userId) : null;
  if (!drag || !m) return null;
  const feel = getDragFeel();
  const lit = drag.valid && drag.zone !== null && drag.zone !== 'stands';
  const style: CSSProperties & Record<string, string | number | undefined> = {
    width: drag.w,
    height: drag.h,
    '--drag-shrink-from': drag.shrinkFrom,
    transform: drag.snap ? `translate(${drag.snap.x}px, ${drag.snap.y}px) scale(${drag.snap.scale})` : undefined,
    transitionDuration: drag.snap ? `${feel.snapMs}ms` : undefined,
  };
  return createPortal((
    <div
      ref={(el) => { ghostEl = el; if (el && !drag.snap) writeGhost(); }}
      className={`dragcard fromhand vsdragcard${drag.snap ? ' snap' : ''}${lit ? ' willplay' : ''}`}
      style={style}
      aria-hidden="true"
    >
      <div className="dragtilt">
        <div className="dragshrink">
          <VersusPlayerCard m={m} server={data.get(m.userId)} />
        </div>
      </div>
    </div>
  ), stageHost());
}

/**
 * THE FLIP for every room card (R-VERSUS-DRAG-SEAT-01: "a spectator who takes a seat visibly moves from the hand to
 * the slot for everyone"). When the room's seating changes (my drop, a rollback, a Realtime update from another
 * client, a Join / Spectate press), each card that changed place starts where it was and glides to where it is now:
 * transform + opacity only, through the Web Animations API (compositor), never a per-frame layout read. A card that
 * changed ROLE also scales from its old size (hand card to seat card and back). My own drop starts from the ghost.
 */
export function useSeatFlip(arena: RefObject<HTMLElement>, signature: string): void {
  const prev = useRef(new Map<string, { cx: number; cy: number; w: number; role: string }>());
  // A resize moves every card: the remembered places are stale, so the next change starts from where cards ARE.
  useEffect(() => onStageChange(() => prev.current.clear()), []);
  useLayoutEffect(() => {
    const root = arena.current;
    if (!root) return;
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const roles = new Map(signature.split(',').filter(Boolean).map((p) => { const i = p.lastIndexOf(':'); return [p.slice(0, i), p.slice(i + 1)] as const; }));
    const next = new Map<string, { cx: number; cy: number; w: number; role: string }>();
    for (const el of root.querySelectorAll<HTMLElement>('[data-versus-card]')) {
      const id = el.dataset.versusCard!;
      const r = el.getBoundingClientRect();
      const now = { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, role: roles.get(id) ?? '' };
      next.set(id, now);
      const was = flipFrom.get(id) ?? prev.current.get(id);
      flipFrom.delete(id);
      if (!was || reduce || typeof el.animate !== 'function' || now.w <= 0) continue;
      const moved = 'role' in was ? was.role !== now.role : true;
      const dx = toStage(was.cx - now.cx);
      const dy = toStage(was.cy - now.cy);
      if (!moved && Math.abs(dx) < 2 && Math.abs(dy) < 2) continue;
      const s = moved ? was.w / now.w : 1;
      el.animate(
        [{ transform: `translate(${dx}px, ${dy}px) scale(${s})`, zIndex: 80 }, { transform: 'none', zIndex: 80 }],
        { duration: moved ? 340 : 220, easing: 'cubic-bezier(0.2, 0.85, 0.35, 1)' },
      );
    }
    prev.current = next;
  }, [arena, signature]);
}
