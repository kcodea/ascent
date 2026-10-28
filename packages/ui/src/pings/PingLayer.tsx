/**
 * LIVE PINGS, on screen (owner design 2026-10-29; R-PING-01..05).
 *
 *  - THE MENU (`PingMenu`): right-click (a phone: long-press, which `touchInput.ts` turns into the same right-click) on a
 *    shop card, a board minion, a hand card, or a shop button (Tavern Up, Refresh, Freeze, the hero power, End Turn)
 *    opens it. A card's menu carries INSPECT (owner 2026-10-29: "Right clicking replaces the inspect, so we'll need to add
 *    an inspect option in the ping wheel"); buttons have none. Where pings are not available (outside a game, a replay, a
 *    spectator who is not a mentor) a card's right-click goes STRAIGHT to Inspect as before. A left-click away or Escape
 *    closes it.
 *    THREE LAYOUTS while the owner picks (dev switch `ascent.pingDesign`, `?pingDesign=A|B|C`; default A):
 *      A FAN    (the owner's): the six bubbles pop in, three fanned in an arc ABOVE the card and three BELOW it.
 *      B RING   : Inspect under the pointer, the five pings in a ring around it (right-click, click in place = Inspect).
 *      C STRIP  : a slim labelled column beside the pointer, Inspect first, right under it.
 *  - THE MARKS (`PingMarks`): a ping SPARKS on its target (the authored `hero-power-spark` FX, one-shot, plus the `pulse`
 *    UI cue), pops in with a short overshoot and settles; it stays about 4 s and fades. A card's mark lives INSIDE the
 *    card's element, so it rides every hover and FLIP the card makes. It is CLEARED by a left- or right-click on the mark
 *    itself, or when its card moves (dragged, sold, played: owner 2026-10-29), on the sender's and the receiver's screen
 *    alike. Only pings for the screen on display show (mine, or the watched / teammate's seat).
 *
 * No per-frame work: the marks are DOM nodes with CSS one-shots; the anchor check is `isConnected` plus a query, 4 Hz.
 */
import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { PING_BUTTONS, PING_KINDS, PING_LIFE_MS, type PingButton, type PingKind, type PingTarget, type PingZone } from '@game/versus-cf/pings';
import { dragStore } from '../dragStore';
import { playDef } from '../fx/playDef';
import { Icon } from '../Icon';
import { sfx } from '../sfx';
import { rectToStage, stageHost, stageViewport, toStage, type StageRect } from '../stage';
import { isSelectOption } from '../touchInput';
import { useSpectate } from '../versus/spectate';
import { pingSrc, PING_LOOK } from './pingArt';
import { clearPing, clearPingsOnCard, expirePings, myPingSeat, pingContext, sendPing, usePings, type ShownPing } from './pingRuntime';
import './pings.css';

// ── the layout switch (dev only until the owner picks) ──────────────────────────────────────────────────────────

export type PingDesign = 'A' | 'B' | 'C';
const DESIGN_KEY = 'ascent.pingDesign';
const isDesign = (v: unknown): v is PingDesign => v === 'A' || v === 'B' || v === 'C';
/** The menu layout. A dev build (or the Versus test tools) may switch it; players get the default. */
export function pingDesign(): PingDesign {
  try {
    const devOk = import.meta.env.DEV || localStorage.getItem('ascent.versus') === '1';
    if (!devOk) return 'A';
    const q = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('pingDesign') : null;
    if (isDesign(q)) localStorage.setItem(DESIGN_KEY, q);
    const v = localStorage.getItem(DESIGN_KEY);
    return isDesign(v) ? v : 'A';
  } catch {
    return 'A';
  }
}

// ── the menu ────────────────────────────────────────────────────────────────────────────────────────────────

export interface PingMenuState {
  /** Stage px of the pointer. */
  x: number;
  y: number;
  /** The target's box in stage px (read once, at open). */
  box: StageRect | null;
  target: PingTarget;
  /** The card's Inspect (cards only). */
  inspect: (() => void) | null;
}
export const usePingMenu = create<{ open: PingMenuState | null }>(() => ({ open: null }));
export const closePingMenu = (): void => { if (usePingMenu.getState().open) usePingMenu.setState({ open: null }); };

const ZONE_OF: Record<string, PingZone> = { tavern: 'shop', warband: 'board', hand: 'hand' };
const ZONE_ATTR: Record<PingZone, string> = { shop: 'tavern', board: 'warband', hand: 'hand' };

/** The play zone a card sits in (shop, board, hand), or null for any other card (Discover, Inspect, Compendium...). */
export function cardZoneOf(el: Element): PingZone | null {
  const z = el.closest('[data-zone]')?.getAttribute('data-zone');
  return z ? ZONE_OF[z] ?? null : null;
}

const boxOf = (el: Element): StageRect | null => {
  try { return rectToStage(el.getBoundingClientRect()); } catch { return null; }
};

/**
 * A card's right-click. Opens the ping menu and answers true, or answers false and the caller inspects at once: no pings
 * here, not a play-zone card, a choice option, or a card being dragged.
 */
export function openCardPingMenu(e: { clientX: number; clientY: number; currentTarget: Element }, uid: string | null | undefined, inspect: () => void): boolean {
  if (!uid || !pingContext()) return false;
  const el = e.currentTarget;
  if (el.closest('.dragcard') || isSelectOption(el)) return false;
  const zone = cardZoneOf(el);
  if (!zone) return false;
  usePingMenu.setState({ open: { x: toStage(e.clientX), y: toStage(e.clientY), box: boxOf(el), target: { t: 'card', uid, zone }, inspect } });
  sfx.tick();
  return true;
}

/** The shop button under a right-click (by its `data-spec`), or null. A disabled button may not receive the event
 *  itself, so the pointer is also tested against the five buttons' boxes (five rect reads, per right-click only). */
export function pingButtonAt(target: EventTarget | null, x: number, y: number): { id: PingButton; el: Element } | null {
  const el = (target as Element | null)?.closest?.('[data-spec]');
  const spec = el?.getAttribute('data-spec');
  if (el && spec && (PING_BUTTONS as readonly string[]).includes(spec)) return { id: spec as PingButton, el };
  if ((target as Element | null)?.closest?.('.card')) return null;
  for (const id of PING_BUTTONS) {
    const b = document.querySelector(`[data-spec="${id}"]`);
    if (!b) continue;
    const r = b.getBoundingClientRect();
    if (r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return { id, el: b };
  }
  return null;
}

/** The painted icon (`inspect` too), or a placeholder glyph when a file is missing. */
const PingIcon = memo(function PingIcon({ kind }: { kind: PingKind | 'inspect' }): JSX.Element {
  const src = pingSrc(kind);
  if (src) return <img className="ping-art" src={src} alt="" draggable={false} decoding="sync" />;
  if (kind === 'inspect') return <Icon name="eye" />;
  return <span className={`ping-glyph pg-${kind}`} aria-hidden="true">{PING_LOOK[kind].glyph}</span>;
});

type Opt = { id: PingKind | 'inspect'; label: string };
const optionsFor = (at: PingMenuState): Opt[] => [
  ...(at.inspect ? [{ id: 'inspect' as const, label: 'Inspect' }] : []),
  ...PING_KINDS.map((k) => ({ id: k, label: PING_LOOK[k].label })),
];

/** Bubble size in the fan and ring (stage px). */
export const PING_BUBBLE = 84;

/**
 * Where each option's CENTRE goes, in stage px, for layouts A and B (C is a flowed column). Pure; exported for tests.
 * A: up to three in an arc above the target's box and the rest in an arc below it. B: the first option (Inspect, on a
 * card) under the pointer, the others on a ring around it (with no Inspect, all of them on the ring).
 */
export function layoutPositions(design: 'A' | 'B', n: number, at: { x: number; y: number; box: StageRect | null }, hasCentre: boolean): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  if (design === 'A') {
    const box = at.box ?? { left: at.x - 60, right: at.x + 60, top: at.y - 80, bottom: at.y + 80, width: 120, height: 160, x: at.x - 60, y: at.y - 80 };
    const cx = box.left + box.width / 2;
    const above = Math.min(3, n);
    const below = n - above;
    const arc = (count: number, baseY: number, dir: -1 | 1): void => {
      const spread = PING_BUBBLE * 1.08;
      for (let i = 0; i < count; i++) {
        const off = i - (count - 1) / 2; // -1, 0, 1
        // The middle bubble sits furthest out: an arc bowing away from the card.
        out.push({ x: cx + off * spread, y: baseY + dir * (PING_BUBBLE * 0.58 + (1 - Math.abs(off)) * PING_BUBBLE * 0.22) });
      }
    };
    arc(above, box.top, -1);
    arc(below, box.bottom, 1);
    return out;
  }
  const ringN = hasCentre ? n - 1 : n;
  if (hasCentre) out.push({ x: at.x, y: at.y });
  const r = PING_BUBBLE * 1.05;
  for (let i = 0; i < ringN; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / ringN;
    out.push({ x: at.x + Math.cos(a) * r, y: at.y + Math.sin(a) * r });
  }
  return out;
}

/** Shift a set of centres so every bubble is inside the stage (one shift for all: the shape is kept). Pure. */
export function clampGroup(pts: { x: number; y: number }[], half: number, vp: { w: number; h: number }): { x: number; y: number }[] {
  if (pts.length === 0) return pts;
  const minX = Math.min(...pts.map((p) => p.x)) - half, maxX = Math.max(...pts.map((p) => p.x)) + half;
  const minY = Math.min(...pts.map((p) => p.y)) - half, maxY = Math.max(...pts.map((p) => p.y)) + half;
  const dx = minX < 4 ? 4 - minX : maxX > vp.w - 4 ? vp.w - 4 - maxX : 0;
  const dy = minY < 4 ? 4 - minY : maxY > vp.h - 4 ? vp.h - 4 - maxY : 0;
  return pts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

function useCloseOnAway(ref: React.RefObject<HTMLElement>): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); closePingMenu(); } };
    // A left-click away closes it (and does nothing else: the press is swallowed so a card under it is not bought).
    const onDown = (e: PointerEvent): void => {
      if (ref.current?.contains(e.target as Node)) return;
      if (e.button === 0) { e.stopPropagation(); e.preventDefault(); }
      closePingMenu();
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    return () => { window.removeEventListener('keydown', onKey, true); document.removeEventListener('pointerdown', onDown, true); };
  }, [ref]);
}

function choose(at: PingMenuState, id: PingKind | 'inspect'): void {
  closePingMenu();
  if (id === 'inspect') { at.inspect?.(); return; }
  if (!sendPing(id, at.target)) sfx.deny(); // its mark plays the spark and the cue when it pops
}

/** Layouts A and B: absolutely placed bubbles, a staggered one-shot pop. */
function BubbleMenu({ at, design }: { at: PingMenuState; design: 'A' | 'B' }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useCloseOnAway(ref);
  const opts = optionsFor(at);
  const pts = clampGroup(layoutPositions(design, opts.length, at, !!at.inspect), PING_BUBBLE / 2, stageViewport());
  return createPortal(
    <div ref={ref} className={`ping-menu ping-bubbles pd-${design}`} role="menu" aria-label="Ping" onContextMenu={(e) => { e.preventDefault(); }}>
      {opts.map((o, i) => (
        <button key={o.id} type="button" role="menuitem" className={`ping-bub${o.id === 'inspect' ? ' ping-inspect' : ''}`}
          aria-label={o.id === 'inspect' ? 'Inspect' : `Ping ${o.label}`}
          style={{ left: `${pts[i]!.x}px`, top: `${pts[i]!.y}px`, '--i': i } as CSSProperties}
          onClick={() => choose(at, o.id)}>
          <span className="ping-bub-in"><PingIcon kind={o.id} /></span>
        </button>
      ))}
    </div>,
    stageHost(),
  );
}

/** Layout C: a slim labelled column, its first row under the pointer. */
function StripMenu({ at }: { at: PingMenuState }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useCloseOnAway(ref);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const vp = stageViewport();
    const first = el.querySelector<HTMLElement>('.ping-opt');
    const fx = first ? first.offsetLeft + 26 : 24;
    const fy = first ? first.offsetTop + first.offsetHeight / 2 : 24;
    setPos({ left: Math.max(4, Math.min(vp.w - el.offsetWidth - 4, at.x - fx)), top: Math.max(4, Math.min(vp.h - el.offsetHeight - 4, at.y - fy)) });
  }, [at]);
  return createPortal(
    <div ref={ref} className="atip ping-menu ping-strip" role="menu" aria-label="Ping"
      style={{ left: `${pos?.left ?? at.x}px`, top: `${pos?.top ?? at.y}px`, visibility: pos ? undefined : 'hidden' }}
      onContextMenu={(e) => { e.preventDefault(); }}>
      {optionsFor(at).map((o, i) => (
        <button key={o.id} type="button" role="menuitem" className={`ping-opt${o.id === 'inspect' ? ' ping-inspect' : ''}`} style={{ '--i': i } as CSSProperties}
          aria-label={o.id === 'inspect' ? 'Inspect' : `Ping ${o.label}`} onClick={() => choose(at, o.id)}>
          <span className="ping-ico"><PingIcon kind={o.id} /></span>
          <span className="ping-lab">{o.label}</span>
        </button>
      ))}
    </div>,
    stageHost(),
  );
}

function PingMenu({ at }: { at: PingMenuState }): JSX.Element {
  const d = pingDesign();
  return d === 'C' ? <StripMenu at={at} /> : <BubbleMenu at={at} design={d} />;
}

// ── the marks ───────────────────────────────────────────────────────────────────────────────────────────────

/** The element a ping sits on, or null while it is off screen. */
export function pingAnchorOf(target: PingTarget, root: ParentNode = document): HTMLElement | null {
  if (target.t === 'button') return root.querySelector<HTMLElement>(`[data-spec="${target.id}"]`);
  const uid = target.uid.replace(/["\\]/g, '');
  return root.querySelector<HTMLElement>(`[data-zone="${ZONE_ATTR[target.zone]}"] .card[data-uid="${uid}"]`);
}

/** How often a mark checks its card is still where it was (no layout read). */
export const PING_ANCHOR_CHECK_MS = 250;

const caption = (p: ShownPing): string | null => (p.mine ? null : p.role === 'mentor' ? 'Mentor' : p.name ?? null);

/** The spark: the authored hero-power spark FX at the target's centre (one rect read, at the pop). */
function spark(el: HTMLElement): void {
  try {
    const r = el.getBoundingClientRect();
    const c = { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 40) };
    playDef('hero-power-spark', { source: c, target: c });
  } catch { /* FX are best-effort */ }
}

/** One ping on its target. */
const PingMark = memo(function PingMark({ p }: { p: ShownPing }): JSX.Element | null {
  const [el, setEl] = useState<HTMLElement | null>(() => pingAnchorOf(p.target));
  const seen = useRef(false);
  const sparked = useRef(false);
  useEffect(() => {
    if (el && !sparked.current) {
      sparked.current = true;
      // Only a FRESH ping sparks (one that arrives while its target is on screen within its first second).
      if (Date.now() - p.at < 1000) { spark(el); sfx.pulse(); }
    }
    if (el) seen.current = true;
  }, [el, p.at]);
  useEffect(() => {
    const id = window.setInterval(() => {
      const t = p.target;
      if (t.t === 'card') {
        const here = pingAnchorOf(t);
        // It MOVED out of its zone (sold, played, bought) or left the screen once seen: the ping is cleared. Never seen yet
        // = its target is not on this screen yet (a teammate's board I am not looking at), so it waits.
        if (!here && seen.current) { clearPing(p.key); return; }
        setEl((cur) => (cur === here ? cur : here));
      } else {
        setEl((cur) => (cur && cur.isConnected ? cur : pingAnchorOf(t)));
      }
    }, PING_ANCHOR_CHECK_MS);
    return () => window.clearInterval(id);
  }, [p.key]);
  if (!el) return null;
  const cap = caption(p);
  const left = Math.max(0, PING_LIFE_MS - (Date.now() - p.at));
  const dismiss = (e: React.SyntheticEvent): void => { e.preventDefault(); e.stopPropagation(); clearPing(p.key); };
  return createPortal(
    <span className={`ping-mark pm-${p.target.t}${p.mine ? ' mine' : ''} pr-${p.role}`} role="status"
      aria-label={`${cap ? `${cap} pinged` : 'Ping'}: ${PING_LOOK[p.kind].label}. Click to clear.`}
      style={{ '--ping-left': `${left}ms` } as CSSProperties}>
      <span className="ping-pop" onPointerDown={dismiss} onContextMenu={dismiss} onClick={dismiss}>
        <span className="ping-badge"><PingIcon kind={p.kind} /></span>
        {cap && <span className="atip-pill ping-cap">{cap}</span>}
      </span>
    </span>,
    el,
  );
});

/** Every ping for the screen on display. Re-renders only when the list changes. */
function PingMarks(): JSX.Element {
  const list = usePings((s) => s.list);
  const watched = useSpectate((s) => (s.active ? s.seat : null));
  const screen = watched ?? myPingSeat() ?? 'p1';
  // Drop each ping when its life ends (one timer, for the next to go).
  useEffect(() => {
    if (list.length === 0) return;
    const next = Math.min(...list.map((p) => p.at + PING_LIFE_MS));
    const id = window.setTimeout(() => expirePings(), Math.max(16, next - Date.now() + 10));
    return () => window.clearTimeout(id);
  }, [list]);
  return <>{list.filter((p) => p.owner === screen).map((p) => <PingMark key={p.key} p={p} />)}</>;
}

/** The ping menu, the marks, the right-click on the shop buttons, and "a dragged card loses its ping". Mounted once per
 *  run (Game.tsx). */
export function PingLayer(): JSX.Element {
  const open = usePingMenu((s) => s.open);
  useEffect(() => {
    // The shop buttons' right-click (a card's own handler runs first and opens its menu).
    const onCtx = (e: MouseEvent): void => {
      if ((e.target as Element | null)?.closest?.('.card, .ping-menu, .ping-mark')) return;
      if (!pingContext()) return;
      const hit = pingButtonAt(e.target, e.clientX, e.clientY);
      if (!hit) return;
      e.preventDefault();
      usePingMenu.setState({ open: { x: toStage(e.clientX), y: toStage(e.clientY), box: boxOf(hit.el), target: { t: 'button', id: hit.id }, inspect: null } });
      sfx.tick();
    };
    window.addEventListener('contextmenu', onCtx, true);
    // Moving a pinged card (a drag of it) clears its ping.
    let dragUid: string | null = null;
    const offDrag = dragStore.subscribe(() => {
      const uid = dragStore.get().drag?.uid ?? null;
      if (uid === dragUid) return;
      dragUid = uid;
      if (uid) clearPingsOnCard(String(uid));
    });
    return () => { window.removeEventListener('contextmenu', onCtx, true); offDrag(); closePingMenu(); };
  }, []);
  return (
    <>
      <PingMarks />
      {open && <PingMenu key={`${open.x}:${open.y}`} at={open} />}
    </>
  );
}
