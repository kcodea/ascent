/**
 * LIVE PINGS, on screen (owner design 2026-10-29; R-PING-01..05).
 *
 *  - THE MENU (`PingMenu`): HOLDING the right mouse button for `PING_HOLD_MS` (a phone: long-press, which
 *    `touchInput.ts` turns into a right-click) on a shop card, a board minion, a hand card, or a shop button (Tavern Up,
 *    Refresh, Freeze, the hero power, End Turn) opens it. A QUICK right-click is the target's own right-click, so a card
 *    INSPECTS (owner 2026-10-31, R-PING-09: "i want right click to be inspect ... and a held right click to be ping").
 *    The quick click is decided on RELEASE (`installRightHold`): Windows fires `contextmenu` on release anyway, so a
 *    quick Inspect opens exactly when it always did; where the browser fires it on the PRESS (macOS, Linux) it is held
 *    back and replayed on the release. A phone keeps its tap-to-inspect, and its long-press still opens the fan (with
 *    the older double long-press to inspect). Where pings are not available (outside a game, a replay, a spectator who
 *    is not a mentor) nothing arms the hold, and right-click behaves exactly as before. A left-click away or Escape
 *    closes the menu.
 *    CLEARING MY OWN PING (owner 2026-10-29, R-PING-07): a HOLD (a phone: long-press) on a card or shop button that
 *    carries a ping I placed clears it everywhere instead of opening the fan, for every sender (the player, a Duos
 *    teammate, a mentor). Someone else's ping (or none) opens the fan as before.
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
 *  - UI SPOTS (owner 2026-10-30: "mentors/players should be able to ping discover card options, runes etc as well";
 *    R-PING-08): every other choosable or inspectable thing carries a semantic `data-ping` key (`pingKeys.ts`): the
 *    Discover / hero-power Discover / Choose One / Ancient / Quest Shop / Runeforge options, the equipped runes, the quest
 *    tracker, the second hero power, the Equipment slot, the hero portrait, the lobby rail rows and the Duos teammate
 *    portrait. They take the top arc (Check, X, Question). A quick right-click reaches the spot's OWN right-click (a card
 *    option's Inspect, a rail row's scout pin, the portrait's emotes); a hold pings it. A spot marked `data-ping-own` (the portrait, the
 *    rail rows) keeps its own right-click for the PLAYER on their own screen (no fan there); a teammate or mentor pings
 *    it. On a phone, the player's own hold on a choice option still opens its Inspect (R-TOUCH-TAPSELECT-01); a teammate
 *    or mentor's hold opens the fan, and their tap on an option inspects it (they cannot pick it anyway).
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
import { isSelectOption, lastPointerWasTouch, noteContextTaken, setCardHoldGate, setOptionTapInspectGate } from '../touchInput';
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

/** Elements whose `data-ping` never counts: hover popups, drag ghosts and Inspect copies (not the real UI). */
const SPOT_SKIP = '.cardref, .replay-dragghost, .dragcard, .castprev-layer, .inspect-ov';

/** The UI spot (R-PING-08) at or above `el`: its `data-ping` key and element, or null. */
export function uiSpotOf(el: Element | null | undefined): { k: string; el: HTMLElement } | null {
  const hit = el && typeof el.closest === 'function' ? el.closest<HTMLElement>('[data-ping]') : null;
  const k = hit?.getAttribute('data-ping');
  if (!hit || !k || hit.closest(SPOT_SKIP)) return null;
  return { k, el: hit };
}

/**
 * Does this spot keep its OWN right-click for me here (no fan)? Where I may not ping at all; and for the PLAYER on their
 * own screen: a spot marked `data-ping-own` (the portrait's emotes, a rail row's scout pin), and on a phone a choice
 * option (its hold is its Inspect, R-TOUCH-TAPSELECT-01). Pure; exported for tests.
 */
export function spotYields(spot: { el: Element }, ctx: { role: string } | null, touch: boolean = lastPointerWasTouch()): boolean {
  if (!ctx) return true;
  if (ctx.role !== 'self') return false;
  if (spot.el.hasAttribute('data-ping-own')) return true;
  return touch && isSelectOption(spot.el.querySelector('.card, .runecard') ?? spot.el);
}

const targetKey = (t: PingTarget): string => (t.t === 'card' ? `c:${t.zone}:${t.uid}` : t.t === 'button' ? `b:${t.id}` : `u:${t.k}`);

/**
 * A PHONE long-press on a ping target (a card, a button or a UI spot; `touchInput.ts` fires it as a right-click). Answers
 * true when it was taken here (the fan opened, my ping was cleared, or a double opened `inspect`); false when it belongs
 * to whatever the target does on its own (the second long-press of a double on a spot with no `inspect`, or no pings
 * here at all). A MOUSE never comes here: its hold is `pingHold`, its quick right-click the target's own.
 */
function rightClickTarget(e: { clientX: number; clientY: number }, target: PingTarget, el: Element, inspect: (() => void) | null): boolean {
  // My own ping on it (R-PING-07) counts even where I could not ping now (a mentor just demoted keeps their own marks).
  const own = myPingOn(target);
  if (!own && !pingContext()) return false;
  const now = Date.now();
  const key = targetKey(target);
  // The SECOND right-click of a double on the same target: the fan goes at once and Inspect opens (a spot with no
  // Inspect of ours: its own right-click runs).
  if (lastCardRightClick && lastCardRightClick.key === key && now - lastCardRightClick.at <= PING_DOUBLE_MS) {
    lastCardRightClick = null;
    closePingMenu();
    if (!inspect) return false;
    inspect();
    return true;
  }
  lastCardRightClick = { key, at: now };
  // A single right-click on a target carrying MY ping clears it (no fan). It still counts as the first of a double, so a
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

/**
 * A card's right-click. A MOUSE right-click that reaches the card is a QUICK one (a hold was taken by `installRightHold`
 * before it got here), so it answers false and the caller inspects (R-PING-09). A phone long-press opens the ping menu
 * and answers true, or answers false and the caller inspects at once: no pings here, a card outside the play zones that
 * is not in a UI spot (R-PING-08), or a card being dragged. `touch` is the input that fired it (a parameter for tests).
 */
export function openCardPingMenu(e: { clientX: number; clientY: number; currentTarget: Element }, uid: string | null | undefined, inspect: () => void, touch: boolean = lastPointerWasTouch()): boolean {
  if (!touch) return false;
  const el = e.currentTarget;
  if (el.closest('.dragcard')) return false;
  const zone = cardZoneOf(el);
  if (zone) return uid && !isSelectOption(el) ? rightClickTarget(e, { t: 'card', uid, zone }, el, inspect) : false;
  // A choice option (a Discover, hero-power Discover, Choose One...): its UI spot.
  const spot = uiSpotOf(el);
  if (!spot) return false;
  const target: PingTarget = { t: 'ui', k: spot.k };
  if (!myPingOn(target) && spotYields(spot, pingContext(), touch)) return false;
  return rightClickTarget(e, target, spot.el, inspect);
}

// ── the mouse hold (owner 2026-10-31, R-PING-09) ──────────────────────────────────────────────────────────────

/**
 * How long the right mouse button must stay down to PING instead of the quick right-click (Inspect). A deliberate
 * quick click is well under 150 ms; the owner tuned the hold to 170 ms (2026-10-31) so a ping feels immediate (the
 * phone long-press is 350 ms).
 */
export const PING_HOLD_MS = 170;

/** The press, the release and the contextmenu never belong to these: they own their right-click outright. */
const HOLD_SKIP = '.ping-menu, .ping-mark, .fdock-stack, .fdock-catch, .dmchat-at, .frmenu-at, .frmenu-catch';

/**
 * The ping target a mouse right-press at `start` (screen px `x`, `y`) would hold on, and the element its fan frames, or
 * null. The same targets a phone long-press reaches: a play-zone card (not a choice option, not a drag ghost), a UI spot
 * that does not keep its own right-click for me here (`spotYields`, mouse), or a shop button. Pure DOM reads; exported
 * for tests.
 */
export function holdTargetAt(start: Element | null, x: number, y: number): { target: PingTarget; el: Element } | null {
  if (!start || typeof start.closest !== 'function' || start.closest(HOLD_SKIP)) return null;
  const card = start.closest('.card');
  if (card) {
    if (card.closest('.dragcard')) return null;
    const zone = cardZoneOf(card);
    if (zone) {
      const uid = card.getAttribute('data-uid');
      return uid && !isSelectOption(card) ? { target: { t: 'card', uid, zone }, el: card } : null;
    }
  }
  // A UI spot (a card option's or anything else's), unless a shop button sits inside it: the innermost wins.
  const spot = uiSpotOf(start);
  const btnEl = card ? null : start.closest('[data-spec]');
  const innerBtn = !!btnEl && (PING_BUTTONS as readonly string[]).includes(btnEl.getAttribute('data-spec') ?? '') && (!spot || spot.el.contains(btnEl));
  if (spot && !innerBtn) {
    const target: PingTarget = { t: 'ui', k: spot.k };
    return myPingOn(target) || !spotYields(spot, pingContext(), false) ? { target, el: spot.el } : null;
  }
  if (card) return null;
  const hit = pingButtonAt(start, x, y);
  return hit ? { target: { t: 'button', id: hit.id }, el: hit.el } : null;
}

/**
 * The HOLD has passed `PING_HOLD_MS` on `start`: clear my own ping there (R-PING-07), or open the fan. Answers true when
 * it was taken (the release's right-click is then swallowed); false leaves the release to the target's own right-click.
 */
export function pingHold(start: Element | null, x: number, y: number): boolean {
  const body = document.body.classList;
  if (body.contains('dragging') || body.contains('aiming')) return false; // there a right-click cancels the drag / aim
  const hit = holdTargetAt(start, x, y);
  if (!hit) return false;
  const own = myPingOn(hit.target);
  if (own) {
    closePingMenu();
    clearPing(own.key);
    return true;
  }
  if (!pingContext()) return false;
  usePingMenu.setState({ open: { x: toStage(x), y: toStage(y), box: boxOf(hit.el), target: hit.target, inspect: null } });
  sfx.tick();
  return true;
}

/** Could a hold do anything here (open a fan, or clear a ping of mine)? Gates the timer: no game, no timer. */
const holdCouldAct = (): boolean => !!pingContext() || usePings.getState().list.some((p) => p.mine);

/**
 * The mouse right-button hold. A press arms ONE timer (no per-frame work; nothing at all where no ping is possible).
 * Released before `PING_HOLD_MS`: a quick right-click, the target's own (Inspect). Held past it: `pingHold`, and the
 * `contextmenu` the release fires (Windows) is swallowed so the card does not also inspect. Where the browser fires
 * `contextmenu` on the PRESS (macOS, Linux), it is held back while the press is undecided and replayed on a quick
 * release. A finger never arms it (`touchInput.ts` owns the long-press). Answers the uninstaller.
 */
export function installRightHold(): () => void {
  let timer = 0;
  let down = false;
  let took = false;
  let swallowUntil = 0;
  let replaying = false;
  let early: { el: Element; x: number; y: number } | null = null; // a press-time contextmenu, held back
  const stop = (): void => { if (timer) { window.clearTimeout(timer); timer = 0; } };
  const onDown = (e: PointerEvent): void => {
    if (e.button !== 2 || e.pointerType === 'touch') return;
    stop();
    down = false; took = false; swallowUntil = 0; early = null;
    const start = e.target as Element | null;
    if (start?.closest?.(HOLD_SKIP) || !holdCouldAct()) return;
    down = true;
    const x = e.clientX, y = e.clientY;
    timer = window.setTimeout(() => {
      timer = 0;
      if (!down) return;
      took = pingHold(start, x, y);
      if (took) early = null;
    }, PING_HOLD_MS);
  };
  const onUp = (e: PointerEvent): void => {
    if (e.button !== 2 || !down) return;
    down = false;
    stop();
    // Held: the release's contextmenu (Windows fires it right after this) is the hold's, not a quick right-click.
    if (took) { took = false; swallowUntil = performance.now() + 500; return; }
    const ev = early;
    early = null;
    if (ev && ev.el.isConnected) {
      replaying = true;
      try { ev.el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, composed: true, button: 2, clientX: ev.x, clientY: ev.y })); }
      finally { replaying = false; }
    }
  };
  const onCancel = (): void => { stop(); down = false; took = false; early = null; };
  const onCtx = (e: MouseEvent): void => {
    if (replaying || lastPointerWasTouch()) return;
    const swallow = (): void => { e.preventDefault(); e.stopImmediatePropagation(); };
    // The press is still undecided (the browser fired contextmenu on the press): decide it on the release.
    if (down && timer) { early = { el: e.target as Element, x: e.clientX, y: e.clientY }; swallow(); return; }
    if (down && took) { swallow(); return; }
    if (swallowUntil && performance.now() <= swallowUntil) { swallowUntil = 0; swallow(); }
  };
  const cap = { capture: true } as const;
  window.addEventListener('pointerdown', onDown, cap);
  window.addEventListener('pointerup', onUp, cap);
  window.addEventListener('pointercancel', onCancel, cap);
  window.addEventListener('blur', onCancel);
  window.addEventListener('contextmenu', onCtx, cap);
  return () => {
    stop();
    window.removeEventListener('pointerdown', onDown, cap);
    window.removeEventListener('pointerup', onUp, cap);
    window.removeEventListener('pointercancel', onCancel, cap);
    window.removeEventListener('blur', onCancel);
    window.removeEventListener('contextmenu', onCtx, cap);
  };
}

/** Does the play-zone card under `el` carry MY ping (R-PING-07)? */
function hasMyPingOnCard(el: Element): boolean {
  const zone = cardZoneOf(el);
  const uid = el.closest('.card[data-uid]')?.getAttribute('data-uid');
  return !!zone && !!uid && !!myPingOn({ t: 'card', uid, zone });
}

/** A PHONE's two long-presses on the same card within this long are a double: Inspect (a mouse inspects on a quick
 *  right-click instead, R-PING-09). */
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
  // The fan, not the card's hover reveal (a held mouse press never reaches the card's own handler, which hid it before):
  // one body class while it is open, `pings.css` hides `.cardref` under it.
  useEffect(() => {
    document.body.classList.add('ping-open');
    return () => document.body.classList.remove('ping-open');
  }, []);
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
  if (target.t === 'ui') {
    // The key passed the wire rule (no quotes or backslashes), so it is safe inside the attribute selector.
    for (const el of Array.from(root.querySelectorAll<HTMLElement>(`[data-ping="${target.k}"]`))) if (!el.closest(SPOT_SKIP)) return el;
    return null;
  }
  const uid = target.uid.replace(/["\\]/g, '');
  return root.querySelector<HTMLElement>(`[data-zone="${ZONE_ATTR[target.zone]}"] .card[data-uid="${uid}"]`);
}

/** How often a mark checks its card is still where it was (no layout read). */
export const PING_ANCHOR_CHECK_MS = 250;

/** A spot may ask for its mark on its left edge, smaller (`data-ping-at="left"`: a thin rail row, where a mark on the top
 *  edge would cover the row above), or just smaller (`small`: a rune or quest badge; `tiny`: the hero portrait, which
 *  the HUD draws scaled up). */
const spotSide = (el: HTMLElement): string => {
  const at = el.getAttribute('data-ping-at');
  return at === 'left' ? ' pm-left' : at === 'small' ? ' pm-small' : at === 'tiny' ? ' pm-tiny' : '';
};

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
        // The shop's buttons left the screen (the fight began), or a UI spot did (the Discover closed, the option was
        // taken, the next offer opened under a new key): the ping on it is done.
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
    <span className={`ping-mark pm-${p.target.t}${p.mine ? ' mine' : ''} pr-${p.role}${spotSide(el)}`} role="status"
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
    // The mouse hold (R-PING-09). Installed FIRST: its capture listener must see a held press's contextmenu before
    // anything below, and swallow it.
    const offHold = installRightHold();
    // A PHONE long-press on a shop button or a UI spot (a card's own handler runs first and opens its menu). A mouse
    // right-click that gets here is a quick one, the target's own (its hold went through `installRightHold`).
    const onCtx = (e: MouseEvent): void => {
      if (!lastPointerWasTouch()) return;
      const t = e.target as Element | null;
      // The Friends dock, its friend menu and a pinned chat window own their right-click (they can sit over the shop buttons).
      if (t?.closest?.('.ping-menu, .ping-mark, .fdock-stack, .fdock-catch, .dmchat-at, .frmenu-at, .frmenu-catch')) return;
      const body = document.body.classList;
      if (body.contains('dragging') || body.contains('aiming')) return; // there a right-click cancels the drag / aim
      // A UI SPOT (R-PING-08) that is not a card (a card's own handler takes it, `openCardPingMenu`), unless a shop
      // button sits inside it: the innermost wins.
      const spot = t?.closest?.('.card') ? null : uiSpotOf(t);
      const btnEl = t?.closest?.('[data-spec]');
      const innerBtn = !!btnEl && (PING_BUTTONS as readonly string[]).includes(btnEl.getAttribute('data-spec') ?? '') && (!spot || spot.el.contains(btnEl));
      if (spot && !innerBtn) {
        const target: PingTarget = { t: 'ui', k: spot.k };
        if (!myPingOn(target) && spotYields(spot, pingContext())) return;
        // Taken: the spot's own right-click (a scout pin, the emotes, a rune's phone Inspect) does not also run.
        if (rightClickTarget(e, target, spot.el, null)) { e.preventDefault(); e.stopPropagation(); noteContextTaken(); }
        return;
      }
      if (t?.closest?.('.card')) return;
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
    // On the watch screen a tap on a choice option inspects it (a teammate or mentor cannot pick it, and their hold
    // there opens the fan, R-PING-08).
    setOptionTapInspectGate(() => useSpectate.getState().active);
    // Moving a pinged card (a drag of it) clears its ping.
    let dragUid: string | null = null;
    const offDrag = dragStore.subscribe(() => {
      const uid = dragStore.get().drag?.uid ?? null;
      if (uid === dragUid) return;
      dragUid = uid;
      if (uid) clearPingsOnCard(String(uid));
    });
    return () => { offHold(); window.removeEventListener('contextmenu', onCtx, true); setCardHoldGate(null); setOptionTapInspectGate(null); offDrag(); closePingMenu(); };
  }, []);
  return (
    <>
      <PingMarks />
      {open && <PingMenu key={`${open.x}:${open.y}`} at={open} />}
    </>
  );
}
