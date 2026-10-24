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
 * rAF and touches React when the zone under the pointer changes. Every room card stays mounted for the life of the
 * room (`useRoomCards`, R-VERSUS-ROOM-MOUNTED-01): a move after the drop is that card's transform changing, one slot
 * read per seat change, then a transform-only glide, for my own move, a rollback, and any other member's move
 * arriving over Realtime alike.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { currentUserId } from '../identity';
import { getDragFeel } from '../dragFeel';
import { hideDragCursorVeil, showDragCursorVeil } from '../dragCursorVeil';
import { sfx } from '../sfx';
import { cardFxScale } from '../fx/cardScale';
import { playDef } from '../fx/playDef';
import { playPlateCoalesce } from '../plateCoalesce';
import { playPlateDissolve } from '../plateDissolve';
import { stageHost, toScreen, toStage } from '../stage';
import { TAP_SLOP } from '../touchInput';
import { VersusPlayerCard } from './VersusPlayerCard';
import { canDragSeatCard, memberOf, roomWithSeatMove, seatDropOf, seatZoneAt, seatZoneValid, sellLineOf, type Box, type SeatDragGeo, type SeatZone } from './seatDrag';
import type { SeatServerData } from './versusSeatCard';
import { takeSeat, useVersus } from './versusStore';
import type { VersusMember, VersusRole, VersusRoom } from './versusRemote';
import type { VersusGroupSeat } from '@game/sim';

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
    // The ONE layout pass of the drag: the source, the seats, the hand, and the seat card's own size. The card is
    // found by its member (it lives in the room's card layer, not inside the seat box a seated drag starts on).
    const card = [...arena.querySelectorAll<HTMLElement>('.vsmcard [data-versus-card]')].find((el) => el.dataset.versusCard === userId) ?? src;
    const sr = card.getBoundingClientRect();
    origin = { cx: sr.left + sr.width / 2, cy: sr.top + sr.height / 2, w: sr.width };
    const seats = [...arena.querySelectorAll<HTMLElement>('.vspcard[data-seat]')].map((el) => ({ role: el.dataset.seat as VersusGroupSeat, box: boxOf(el.getBoundingClientRect()) }));
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

/**
 * THE GHOST: the shop's floating `.dragcard`, holding my player card at seat size. MOUNTED FOR THE LIFE OF THE ROOM
 * (R-VERSUS-ROOM-MOUNTED-01): unmounting a whole Card on the drop was the biggest single cost of the drop frame, so
 * when no drag is live it stays in place, transparent (`vsghost-off`), at its last size, and a pick-up or a drop only
 * flips its classes. Only my own card ever drags, so it is always my card.
 */
export function SeatDragGhost({ room, data }: { room: VersusRoom; data: ReadonlyMap<string, SeatServerData> }): JSX.Element | null {
  const drag = useSeatDragStore((s) => s.drag);
  const last = useRef<SeatDragState | null>(null);
  if (drag) last.current = drag;
  const shown = drag ?? last.current;
  const m: VersusMember | null = memberOf(room, shown?.userId ?? currentUserId());
  // What the card draws (not the role), one object while it holds, so a room update never re-renders the ghost's Card.
  const profileKey = m ? JSON.stringify(m.profile ?? {}) : '';
  const face = useMemo(() => (m ? { userId: m.userId, displayName: m.displayName, profile: m.profile } : null), [m?.userId, m?.displayName, profileKey]);
  if (!face) return null;
  const feel = getDragFeel();
  const lit = !!drag && drag.valid && drag.zone !== null && drag.zone !== 'stands';
  const style: CSSProperties & Record<string, string | number | undefined> = {
    width: shown?.w,
    height: shown?.h,
    '--drag-shrink-from': shown?.shrinkFrom ?? 1,
    transform: drag?.snap ? `translate(${drag.snap.x}px, ${drag.snap.y}px) scale(${drag.snap.scale})` : undefined,
    transitionDuration: drag?.snap ? `${feel.snapMs}ms` : undefined,
  };
  return createPortal((
    <div
      ref={(el) => { ghostEl = el; if (el && drag && !drag.snap) writeGhost(); }}
      // `fromhand` only while live: adding it is what replays the grab-shrink on every pick-up.
      className={`dragcard vsdragcard${drag ? ' fromhand' : ' vsghost-off'}${drag?.snap ? ' snap' : ''}${lit ? ' willplay' : ''}`}
      style={style}
      aria-hidden="true"
    >
      <div className="dragtilt">
        <div className="dragshrink">
          <VersusPlayerCard m={face} server={data.get(face.userId)} />
        </div>
      </div>
    </div>
  ), stageHost());
}

/** The room's FX level: over the room (the title is z450, the room z480 inside it), under the drag ghost (z485). */
export const VS_FX_Z = 482;

/** A refused seat move snaps the card back (R-VERSUS-DRAG-SEAT-01). That is a rollback, not a sale or a play, so the
 *  next seating change it causes plays the plain glide with no coins, dust or sound. Set when the optimistic move is
 *  dropped without a new room (the store's failure path), consumed by the next placement (`useRoomCards`). */
let rollbackPending = false;
useVersus.subscribe((s, prev) => { if (prev.seatMove && !s.seatMove && s.room === prev.room) rollbackPending = true; });

interface PlateBox { left: number; top: number; width: number; height: number }
/** Where a room card sits: its top-left in the room's card layer (arena-local stage px) and its scale (1 = the seat
 *  card's size; a hand card is the same element drawn smaller). */
export interface CardPlace { x: number; y: number; s: number }
interface CardSpot { role: string; place: CardPlace | null; cx: number; cy: number; w: number; plate: PlateBox | null }
const isSeat = (role: string): boolean => role === 'p1' || role === 'p2' || role === 'p3' || role === 'p4';
const plateRect = (el: HTMLElement): PlateBox | null => {
  const p = el.querySelector<HTMLElement>('.cardplate');
  if (!p) return null;
  const r = p.getBoundingClientRect();
  return r.width > 0 ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
};

/** THE SALE (owner 2026-10-21, R-VERSUS-ROOM-SELL-01): the shop's sell, then the card forms back in the hand. The
 *  authored `coin` def bursts where the card left its seat (my own drop: where I let go), then the hand card is
 *  conjured in place by the arcane plate coalesce, the same one a generated hand card plays. */
function presentSale(el: HTMLElement, at: { x: number; y: number }, sound: boolean): void {
  if (sound) sfx.sell();
  playDef('coin', { source: at, target: at, cursor: at });
  // Hidden from this frame (the coalesce owns its reveal), formed once the coins have burst.
  el.style.setProperty('opacity', '0', 'important');
  window.setTimeout(() => {
    const r = el.isConnected ? plateRect(el) : null;
    if (r) playPlateCoalesce(r, el, VS_FX_Z); // hides it again until the wireframe resolves, then reveals it
    else el.style.removeProperty('opacity');
  }, 240);
}

/** THE PLAY (owner 2026-10-21, R-VERSUS-ROOM-PLAY-01): a card landing in a seat lands like a minion played to the
 *  board. The glide home is the FLIP; as it settles, the authored `landing-dust` def plays at the card, sized to it
 *  and +50% dense exactly like the shop's own landing (Recruit's `puffOnBoard`), with the shop's play sound. */
function presentLanding(el: HTMLElement, afterMs: number, sound: boolean): void {
  window.setTimeout(() => {
    if (!el.isConnected) return;
    if (sound) sfx.play();
    const r = el.getBoundingClientRect();
    const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    // `over`: the def's own `under` canvas lives inside the board (`.app`), under the title the room sits on.
    playDef('landing-dust', { source: c, target: c }, { scale: cardFxScale(r.width), intensity: 1.5, slot: 'over' });
  }, afterMs);
}

/**
 * THE ROOM'S SLOTS (R-VERSUS-ROOM-MOUNTED-01), read from the layout: the two seat cards' boxes (the open-seat card that
 * always sits in each seat) and one anchor per hand slot (`.vsbslot`, placed by the hand's own CSS), in arena-local
 * stage px. Computed styles, not rects: sub-pixel, and blind to the transforms (the entrance strides the seat boxes
 * in) that a rect would include. A hand card is the seat card scaled by `--vsb-k / --vspcard-k`. Null when nothing is
 * laid out (jsdom), where the cards are simply not placed.
 */
export interface RoomGeo { seat: Partial<Record<VersusGroupSeat, CardPlace>> & Record<'p1' | 'p2', CardPlace>; bench: CardPlace[]; step: number; cw: number; ch: number }
export function readRoomGeo(arena: HTMLElement): RoomGeo | null {
  const num = (v: string | null | undefined): number => (v ? parseFloat(v) : NaN);
  const seatOf = (side: VersusGroupSeat): { box: HTMLElement; hold: HTMLElement } | null => {
    const box = arena.querySelector<HTMLElement>(`.vspcard-${side}`);
    const hold = box?.querySelector<HTMLElement>(':scope > .vspcard-hold');
    return box && hold ? { box, hold } : null;
  };
  const p1 = seatOf('p1');
  const p2 = seatOf('p2');
  // VERSUS GROUP (R-VERSUS-GROUP-05): seats 3 and 4 exist only in a group room.
  const p3 = seatOf('p3');
  const p4 = seatOf('p4');
  const bench = arena.querySelector<HTMLElement>('.vsbench');
  if (!p1 || !p2 || !bench) return null;
  const h1 = getComputedStyle(p1.hold);
  const cw = num(h1.width);
  const ch = num(h1.height);
  const bcs = getComputedStyle(bench);
  const bs = num(bcs.getPropertyValue('--vsb-k')) / num(h1.getPropertyValue('--vspcard-k'));
  // The seat card's box: left 50% of the seat, pulled back half its width (`translate: -50% 0`), a plate-lift down.
  const seatPlace = (s: { box: HTMLElement }, hcs: CSSStyleDeclaration): CardPlace => {
    const b = getComputedStyle(s.box);
    return { x: num(b.left) + num(hcs.left) - cw / 2, y: num(b.top) + num(hcs.top), s: 1 };
  };
  const bl = num(bcs.left);
  const bt = num(bcs.top);
  let step = NaN;
  const benchPlaces = [...bench.querySelectorAll<HTMLElement>(':scope > .vsbslot')].map((a): CardPlace => {
    const acs = getComputedStyle(a);
    step = num(acs.width);
    return { x: bl + num(acs.left) - (cw * bs) / 2, y: bt + num(acs.top), s: bs };
  });
  const geo: RoomGeo = {
    seat: {
      p1: seatPlace(p1, h1), p2: seatPlace(p2, getComputedStyle(p2.hold)),
      ...(p3 ? { p3: seatPlace(p3, getComputedStyle(p3.hold)) } : {}),
      ...(p4 ? { p4: seatPlace(p4, getComputedStyle(p4.hold)) } : {}),
    },
    bench: benchPlaces, step, cw, ch,
  };
  const all = [cw, ch, bs, ...Object.values(geo.seat).flatMap((p) => [p.x, p.y]), ...benchPlaces.flatMap((p) => [p.x, p.y])];
  return cw > 0 && ch > 0 && all.every(Number.isFinite) ? geo : null;
}

/** A place as the card's transform (origin top-left, `.vsmcard`). */
export const placeTransform = (p: CardPlace): string => `translate(${p.x}px, ${p.y}px) scale(${p.s})`;
/** The place a computed `matrix(...)` transform draws (a card caught mid-glide). */
export function placeOfMatrix(t: string): CardPlace | null {
  const m = /^matrix\(([^)]+)\)$/.exec(t.trim());
  if (!m) return null;
  const v = m[1]!.split(',').map(Number);
  return v.length === 6 && [v[0], v[4], v[5]].every((n) => Number.isFinite(n)) ? { x: v[4]!, y: v[5]!, s: v[0]! } : null;
}

const GLIDE_EASE = 'cubic-bezier(0.2, 0.85, 0.35, 1)';
// Per card element: the transform last written, its live glide, and its hand pads' pitch (each written only on change).
const written = new WeakMap<HTMLElement, string>();
const glides = new WeakMap<HTMLElement, Animation>();
const pitch = new WeakMap<HTMLElement, string>();

interface FlipFx { first: boolean; rollback: boolean; seen: Set<string> }

/**
 * Place every room card in its slot, and (with `fx`) present what changed. Strictly read, then write, then read the
 * written places (style only: a transform moves nothing in the flow), then animate. Never per frame: once per seating
 * change, and once per resize (`fx` null: re-place only, no FX).
 */
function placeRoomCards(root: HTMLElement, signature: string, prev: ReadonlyMap<string, CardSpot>, fx: FlipFx | null): Map<string, CardSpot> {
  const reduce = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const entries = signature.split(',').filter(Boolean).map((p) => { const i = p.lastIndexOf(':'); return [p.slice(0, i), p.slice(i + 1)] as const; });
  const roles = new Map(entries);
  const benchIndex = new Map(entries.filter(([, r]) => r === 'spectator').map(([id], i) => [id, i] as const));
  const me = currentUserId();

  // 1. READ: the slots (the commit's one layout), the layer's screen origin, and where a gliding card is right now.
  const geo = readRoomGeo(root);
  const origin = root.getBoundingClientRect();
  const cards = [...root.querySelectorAll<HTMLElement>('.vscards > .vsmcard')].map((el) => {
    const glide = glides.get(el);
    return {
      el,
      id: el.dataset.vsm ?? '',
      hold: el.querySelector<HTMLElement>('[data-versus-card]'),
      pads: el.querySelector<HTMLElement>('.vsbpads'),
      live: glide && glide.playState === 'running' ? placeOfMatrix(getComputedStyle(el).transform) : null,
      place: null as CardPlace | null,
      from: null as CardPlace | null,
      ms: 0,
    };
  });
  const slotOf = (id: string): CardPlace | null => {
    if (!geo) return null;
    const r = roles.get(id);
    if (r === 'p1' || r === 'p2' || r === 'p3' || r === 'p4') return geo.seat[r] ?? null;
    const i = benchIndex.get(id);
    return i === undefined ? null : geo.bench[i] ?? null;
  };

  // 2. WRITE: each card to its slot (a transform), the hand pads' pitch, and which cards glide there.
  for (const c of cards) {
    c.place = slotOf(c.id);
    const last = prev.get(c.id);
    const role = roles.get(c.id) ?? '';
    const moved = !!last && last.role !== role;
    const dropped = fx ? flipFrom.get(c.id) : undefined;
    const sold = moved && !!fx && !fx.rollback && isSeat(last!.role) && role === 'spectator';
    if (c.place && geo && fx && last && !sold && !reduce) {
      // Glide from where it was: my drop = where I let go (the ghost's centre and size); a card already gliding = where
      // it is now; otherwise its last slot. A card that did not change seat and barely moved stays put.
      let from: CardPlace | null = c.live ?? last.place;
      if (dropped) {
        const s = toStage(dropped.w) / geo.cw;
        from = { x: toStage(dropped.cx - origin.left) - (s * geo.cw) / 2, y: toStage(dropped.cy - origin.top) - (s * geo.ch) / 2, s };
      }
      if (from && (moved || Math.abs(from.x - c.place.x) >= 2 || Math.abs(from.y - c.place.y) >= 2 || Math.abs(from.s - c.place.s) > 1e-3)) {
        c.from = from;
        c.ms = moved ? 300 : 220;
      }
    }
    if (c.from || !fx) { glides.get(c.el)?.cancel(); glides.delete(c.el); }
    if (!c.place) continue;
    const t = placeTransform(c.place);
    if (written.get(c.el) !== t) { c.el.style.transform = t; written.set(c.el, t); }
    if (c.pads && role === 'spectator' && geo && Number.isFinite(geo.step)) {
      const v = `${geo.step / c.place.s}px`;
      if (pitch.get(c.pads) !== v) { c.pads.style.setProperty('--vsb-stepl', v); pitch.set(c.pads, v); }
    }
  }

  // 3. READ the written places (style only; nothing reflows) for the FX anchors and the next change's origin.
  const next = new Map<string, CardSpot>();
  const now = cards.map((c) => {
    const r = c.hold?.getBoundingClientRect();
    const spot: CardSpot = { role: roles.get(c.id) ?? '', place: c.place, cx: r ? r.left + r.width / 2 : 0, cy: r ? r.top + r.height / 2 : 0, w: r?.width ?? 0, plate: c.hold ? plateRect(c.hold) : null };
    next.set(c.id, spot);
    return spot;
  });

  // 4. ANIMATE + PRESENT: transform-only glides (compositor), then the shop's FX (owner 2026-10-21).
  cards.forEach((c, k) => {
    const spot = now[k]!;
    if (c.from && c.place && typeof c.el.animate === 'function') {
      glides.set(c.el, c.el.animate(
        [{ transform: placeTransform(c.from), zIndex: 80 }, { transform: placeTransform(c.place), zIndex: 80 }],
        { duration: c.ms, easing: GLIDE_EASE },
      ));
    }
    if (!fx || !c.hold) return;
    const dropped = flipFrom.get(c.id);
    flipFrom.delete(c.id);
    const last = prev.get(c.id);
    const animated = !reduce && typeof c.el.animate === 'function' && spot.w > 0;
    if (!fx.seen.has(c.id)) {
      fx.seen.add(c.id);
      // A new arrival (never the room's first paint: the entrance owns that). Formed in place, like a conjured card.
      if (!fx.first && animated && spot.plate) playPlateCoalesce(spot.plate, c.hold, VS_FX_Z);
      return;
    }
    const was = dropped ?? last;
    if (!was || !animated) return;
    const wasRole = last?.role ?? spot.role;
    const moved = wasRole !== spot.role;
    // My own drop played its sound on release; a press, a rollback and anyone else's move are heard here.
    const sound = !(dropped && c.id === me);
    if (moved && !fx.rollback && isSeat(wasRole) && spot.role === 'spectator') {
      // Sold back to the stands: the coins where the card left (my drop: where I let go), then it forms in hand.
      presentSale(c.hold, { x: was.cx, y: was.cy }, sound);
      return;
    }
    if (moved && !fx.rollback && isSeat(spot.role)) presentLanding(c.hold, (c.ms || 300) - 40, sound && wasRole === 'spectator');
  });

  // Someone left: their card burns off where it last stood (the hand card's backplate exit, `plateDissolve`).
  if (fx && !fx.first && !reduce) {
    for (const [id, spot] of prev) if (!next.has(id) && !roles.has(id) && spot.plate) playPlateDissolve(spot.plate, undefined, VS_FX_Z);
  }
  return next;
}

/**
 * ONE CARD ELEMENT PER MEMBER (owner 2026-10-21, R-VERSUS-ROOM-MOUNTED-01; the follow-up #2196 named). Every room
 * card lives in the room's card layer (`.vscards`) for as long as its member is in the room, and is placed by a
 * transform: a move between a seat and the hand, or along the hand, changes that transform and nothing else. No
 * unmount, no mount, no layout of a card. The slots are read once per seating change (and once per resize), never
 * per frame.
 *
 * What each change PRESENTS (owner 2026-10-21, R-VERSUS-ROOM-SELL-01 / -PLAY-01 / -ARRIVE-01), on every client:
 *  - hand to seat: the card glides from the hand (or from where my drop let go) and lands with the shop's landing
 *    dust and play sound;
 *  - seat to hand: the shop's sale (the coins), then the card forms back in the hand (the plate coalesce);
 *  - someone new: their card forms in place (the coalesce); someone leaving: their card burns off (the dissolve);
 *  - a refused move just glides back, silent.
 * My own drop already played its sound on release, so its presentation is silent here.
 */
export function useRoomCards(arena: RefObject<HTMLElement>, signature: string): void {
  const prev = useRef(new Map<string, CardSpot>());
  // Everyone this room view has already shown, so a resize never replays an arrival.
  const known = useRef<Set<string> | null>(null);
  const sig = useRef(signature);
  sig.current = signature;
  // A resize (the stage, the card size) moves every slot: re-place every card where it now belongs, no FX.
  useEffect(() => {
    const root = arena.current;
    if (!root || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => { prev.current = placeRoomCards(root, sig.current, prev.current, null); });
    ro.observe(root);
    const hold = root.querySelector('.vspcard-p1 > .vspcard-hold');
    if (hold) ro.observe(hold);
    return () => ro.disconnect();
  }, [arena]);
  useLayoutEffect(() => {
    const root = arena.current;
    if (!root) return;
    const rollback = rollbackPending;
    rollbackPending = false;
    const first = known.current === null;
    const seen = known.current ?? new Set<string>();
    prev.current = placeRoomCards(root, signature, prev.current, { first, rollback, seen });
    const ids = new Set(signature.split(',').filter(Boolean).map((p) => p.slice(0, p.lastIndexOf(':'))));
    for (const id of [...seen]) if (!ids.has(id)) seen.delete(id);
    known.current = seen;
  }, [arena, signature]);
}
