/**
 * LIVE PINGS, on screen (owner design 2026-10-29; R-PING-01..05).
 *
 *  - THE MENU (`PingMenu`): right-click (a phone: long-press, which `touchInput.ts` turns into the same right-click) on a
 *    shop card, a board minion, a hand card, or a shop button (Tavern Up, Refresh, Freeze, the hero power, End Turn)
 *    opens it. A DOUBLE right-click on a card inspects it (owner 2026-10-29: "remove the magnifying glass ping, change it
 *    so that double right clicking inspects"): the first opens the fan, a second on the same card within
 *    `PING_DOUBLE_MS` closes it at once and opens Inspect. A phone keeps its tap-to-inspect. Where pings are not
 *    available (outside a game, a replay, a spectator who is not a mentor) a card's right-click goes STRAIGHT to Inspect
 *    as before. A left-click away or Escape closes the menu.
 *    CLEARING MY OWN PING (owner 2026-10-29, R-PING-07): a SINGLE right-click (a phone: long-press) on a card or shop
 *    button that carries a ping I placed clears it everywhere instead of opening the fan, for every sender (the player,
 *    a Duos teammate, a mentor). It counts as the first of a double, so a quick second right-click still inspects.
 *    Someone else's ping (or none) opens the fan as before.
 *    THE FAN (owner pick 2026-10-29, the only layout): on a card, the TOP arc is Check, X, Question (left to right) and
 *    the BOTTOM row is Pass (left) and Sell (right). A shop button gets the top arc only (Check, X, Question). The
 *    bubbles pop in with a staggered one-shot.
 *  - THE MARKS (`PingMarks`): a ping SPARKS on its target (the authored `hero-power-spark` FX, one-shot, plus the `pulse`
 *    UI cue), pops in with a short overshoot and settles; it fades out on its own `PING_LIFE_MS` (5 s) after it landed
 *    on this screen, timed locally (owner 2026-10-29: "they should only last 5s if not cleared"). A card's mark lives INSIDE the
 *    card's element, so it rides every hover and FLIP the card makes. It is CLEARED by a left- or right-click on the mark
 *    itself, or when its card moves (dragged, sold, played: owner 2026-10-29), on the sender's and the receiver's screen
 *    alike (a `ping_clear` on the stream). It also goes when its target leaves the screen (the shop closes for the fight). Only pings for the screen on display show (mine, or the watched / teammate's seat).
 *
 * No per-frame work: the marks are DOM nodes with CSS one-shots; the anchor check is `isConnected` plus a query, 4 Hz.
 */
import { memo, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { PING_BUTTONS, PING_FADE_MS, PING_LIFE_MS, type PingButton, type PingKind, type PingTarget, type PingZone } from '@game/versus-cf/pings';
import { dragStore } from '../dragStore';
import { playDef } from '../fx/playDef';
import { sfx } from '../sfx';
import { rectToStage, stageHost, stageViewport, toStage, type StageRect } from '../stage';
import { isSelectOption, setCardHoldGate } from '../touchInput';
import { useSpectate } from '../versus/spectate';
import { pingSrc, PING_LOOK } from './pingArt';
import { clearMyPingOn, clearPing, clearPingsOnCard, expirePings, forgetPing, myPingOn, myPingSeat, pingContext, sendPing, usePings, type ShownPing } from './pingRuntime';
import './pings.css';

// ── the menu ────────────────────────────────────────────────────────────────────────────────────────────────

export interface PingMenuState {
  /** Stage px of the pointer. */
  x: number;
  y: number;
  /** The target's box in stage px (read once, at open). */
  box: StageRect | null;
  target: PingTarget;
  /** The card's Inspect (cards only; a double right-click opens it). */
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
  if (!uid) return false;
  const el = e.currentTarget;
  if (el.closest('.dragcard') || isSelectOption(el)) return false;
  const zone = cardZoneOf(el);
  if (!zone) return false;
  const target: PingTarget = { t: 'card', uid, zone };
  // My own ping on it (R-PING-07) counts even where I could not ping now (a mentor just demoted keeps their own marks).
  const own = myPingOn(target);
  if (!own && !pingContext()) return false;
  const now = Date.now();
  const key = `${zone}:${uid}`;
  // The SECOND right-click of a double on the same card: the fan goes at once and Inspect opens.
  if (lastCardRightClick && lastCardRightClick.key === key && now - lastCardRightClick.at <= PING_DOUBLE_MS) {
    lastCardRightClick = null;
    closePingMenu();
    inspect();
    return true;
  }
  lastCardRightClick = { key, at: now };
  // A single right-click on a card carrying MY ping clears it (no fan). It still counts as the first of a double, so a
  // second right-click within PING_DOUBLE_MS inspects as always.
  if (own) {
    closePingMenu();
    clearPing(own.key);
    return true;
  }
  usePingMenu.setState({ open: { x: toStage(e.clientX), y: toStage(e.clientY), box: boxOf(el), target, inspect } });
  sfx.tick();
  return true;
}

/** Does the play-zone card under `el` carry MY ping (R-PING-07)? */
function hasMyPingOnCard(el: Element): boolean {
  const zone = cardZoneOf(el);
  const uid = el.closest('.card[data-uid]')?.getAttribute('data-uid');
  return !!zone && !!uid && !!myPingOn({ t: 'card', uid, zone });
}

/** Two right-clicks on the same card within this long are a double right-click: Inspect. */
export const PING_DOUBLE_MS = 350;
/** The last right-click that opened a card's fan (kept apart from the menu, which a right press closes first). */
let lastCardRightClick: { key: string; at: number } | null = null;
/** For the tests. */
export function resetPingDoubleForTests(): void { lastCardRightClick = null; }

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

/** The painted icon, or a placeholder glyph when a file is missing. */
const PingIcon = memo(function PingIcon({ kind }: { kind: PingKind }): JSX.Element {
  const src = pingSrc(kind);
  if (src) return <img className="ping-art" src={src} alt="" draggable={false} decoding="sync" />;
  return <span className={`ping-glyph pg-${kind}`} aria-hidden="true">{PING_LOOK[kind].glyph}</span>;
});

type OptId = PingKind;
/** The fan's slots (owner pick 2026-10-29). Top arc, left to right; bottom arc, left to right. */
export const PING_FAN_TOP: readonly OptId[] = ['check', 'x', 'question'];
export const PING_FAN_BOTTOM: readonly OptId[] = ['pass', 'sell'];

/** The menu's two arcs: a card gets both; a shop button (no Inspect) the top arc only. Pure; exported for tests. */
export function fanOptions(isCard: boolean): { top: OptId[]; bottom: OptId[] } {
  return { top: [...PING_FAN_TOP], bottom: isCard ? [...PING_FAN_BOTTOM] : [] };
}

const labelOf = (id: OptId): string => PING_LOOK[id].label;

/** Bubble size in the fan (stage px). */
export const PING_BUBBLE = 84;

/**
 * Where each bubble's CENTRE goes, in stage px: `top` in an arc above the target's box, `bottom` in an arc below it,
 * each left to right, the middle one bowing furthest out. Pure; exported for tests.
 */
export function fanPositions(counts: { top: number; bottom: number }, at: { x: number; y: number; box: StageRect | null }): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const box = at.box ?? { left: at.x - 60, right: at.x + 60, top: at.y - 80, bottom: at.y + 80, width: 120, height: 160, x: at.x - 60, y: at.y - 80 };
  const cx = box.left + box.width / 2;
  const arc = (count: number, baseY: number, dir: -1 | 1): void => {
    const spread = PING_BUBBLE * 1.08;
    for (let i = 0; i < count; i++) {
      const off = i - (count - 1) / 2; // -1, 0, 1
      out.push({ x: cx + off * spread, y: baseY + dir * (PING_BUBBLE * 0.58 + (1 - Math.abs(off)) * PING_BUBBLE * 0.22) });
    }
  };
  arc(counts.top, box.top, -1);
  arc(counts.bottom, box.bottom, 1);
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

function choose(at: PingMenuState, id: PingKind): void {
  closePingMenu();
  if (!sendPing(id, at.target)) sfx.deny(); // its mark plays the spark and the cue when it pops
}

/** The fan: absolutely placed bubbles, a staggered one-shot pop. */
function PingMenu({ at }: { at: PingMenuState }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useCloseOnAway(ref);
  const { top, bottom } = fanOptions(at.target.t === 'card');
  const opts = [...top, ...bottom];
  const pts = clampGroup(fanPositions({ top: top.length, bottom: bottom.length }, at), PING_BUBBLE / 2, stageViewport());
  return createPortal(
    <div ref={ref} className="ping-menu ping-bubbles" role="menu" aria-label="Ping" onContextMenu={(e) => { e.preventDefault(); }}>
      {opts.map((id, i) => (
        <button key={id} type="button" role="menuitem" className={`ping-bub ${i < top.length ? 'pf-top' : 'pf-bottom'}`}
          aria-label={`Ping ${labelOf(id)}`}
          style={{ left: `${pts[i]!.x}px`, top: `${pts[i]!.y}px`, '--i': i } as CSSProperties}
          onClick={() => choose(at, id)}>
          <span className="ping-bub-in"><PingIcon kind={id} /></span>
        </button>
      ))}
    </div>,
    stageHost(),
  );
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
        if (!here && seen.current) { forgetPing(p.key); return; }
        setEl((cur) => (cur === here ? cur : here));
      } else {
        const here = el && el.isConnected ? el : pingAnchorOf(t);
        // The shop's buttons left the screen (the fight began): the ping on them is done.
        if (!here && seen.current) { forgetPing(p.key); return; }
        setEl((cur) => (cur === here ? cur : here));
      }
    }, PING_ANCHOR_CHECK_MS);
    return () => window.clearInterval(id);
  }, [p.key, el]);
  if (!el) return null;
  const cap = caption(p);
  const dismiss = (e: React.SyntheticEvent): void => { e.preventDefault(); e.stopPropagation(); clearPing(p.key); };
  return createPortal(
    <span className={`ping-mark pm-${p.target.t}${p.mine ? ' mine' : ''} pr-${p.role}`} role="status"
      aria-label={`${cap ? `${cap} pinged` : 'Ping'}: ${PING_LOOK[p.kind].label}. Click to clear.`}
      style={{ '--ping-fade-at': `${Math.max(0, PING_LIFE_MS - PING_FADE_MS - (Date.now() - p.at))}ms`, '--ping-fade': `${PING_FADE_MS}ms` } as CSSProperties}>
      {/* Cleared on the CLICK (or right-click), never on the press: removed at the press, the release's click would land
          on the card under it and inspect or buy it. The press itself is kept from reaching the card. */}
      <span className="ping-pop" onPointerDown={(e) => { e.stopPropagation(); }} onContextMenu={dismiss} onClick={dismiss}>
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
  // Each ping goes when its life ends: one timer, for the next one due (no per-frame work).
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
      // The Friends dock, its friend menu and a pinned chat window own their right-click (they can sit over the shop buttons).
      if ((e.target as Element | null)?.closest?.('.card, .ping-menu, .ping-mark, .fdock-stack, .fdock-catch, .dmchat-at, .frmenu-at, .frmenu-catch')) return;
      // (The button hit test only runs while a ping could be opened or cleared here: no rect reads otherwise.)
      if (!pingContext() && !usePings.getState().list.some((p) => p.mine && p.target.t === 'button')) return;
      const hit = pingButtonAt(e.target, e.clientX, e.clientY);
      if (!hit) return;
      // A single right-click on a button carrying MY ping clears it, no fan (R-PING-07).
      if (clearMyPingOn({ t: 'button', id: hit.id })) { e.preventDefault(); closePingMenu(); return; }
      if (!pingContext()) return;
      e.preventDefault();
      usePingMenu.setState({ open: { x: toStage(e.clientX), y: toStage(e.clientY), box: boxOf(hit.el), target: { t: 'button', id: hit.id }, inspect: null } });
      sfx.tick();
    };
    window.addEventListener('contextmenu', onCtx, true);
    // A phone's hold on a play-zone card opens the menu while pings are available (else a card hold does nothing).
    // (A hold on a card carrying MY ping clears it, R-PING-07: that fires too, even where I could not ping now.)
    setCardHoldGate((el) => !!cardZoneOf(el) && !el.closest('.dragcard') && (!!pingContext() || hasMyPingOnCard(el)));
    // Moving a pinged card (a drag of it) clears its ping.
    let dragUid: string | null = null;
    const offDrag = dragStore.subscribe(() => {
      const uid = dragStore.get().drag?.uid ?? null;
      if (uid === dragUid) return;
      dragUid = uid;
      if (uid) clearPingsOnCard(String(uid));
    });
    return () => { window.removeEventListener('contextmenu', onCtx, true); setCardHoldGate(null); offDrag(); closePingMenu(); };
  }, []);
  return (
    <>
      <PingMarks />
      {open && <PingMenu key={`${open.x}:${open.y}`} at={open} />}
    </>
  );
}
