/**
 * TOUCH HIT SLOP (owner 2026-10-18, R-TOUCH-HITSLOP-01: "a AAA experience, seamless 1:1 from mobile to desktop").
 *
 * On a phone the stage scale is ~0.36, so a 39 px corner button is 14 px on the glass, far under a fingertip. The art
 * cannot grow that much without colliding, so every control instead gets an INVISIBLE hit area of at least
 * `TOUCH_TARGET_PX` (44) screen px: its rect, grown about its centre until both sides reach 44.
 *
 * How a tap resolves (touch only, `data-touch-ui` on; a mouse never reaches any of this):
 *  1. A finger that lands ON an interactive element is untouched. Direct hits always win.
 *  2. A finger that lands on nothing interactive looks for the controls whose grown hit areas contain the point and
 *     takes the NEAREST one (the shortest distance to its real rect), so two neighbouring areas split down the middle
 *     instead of one swallowing the other. Ties go to the higher priority (a button over an info tip), then to the
 *     smaller control. A control covered by something else at its centre (a modal over it) is never a candidate.
 *  3. The gesture is then REPLAYED on that control: the `pointerdown` (so touchInput's tap / long-press runs on it),
 *     the `pointerup` and the `click`, at the control's centre, and the real ones are swallowed. A finger that moves
 *     past the tap slop is a drag or a scroll, so the replay is cancelled with a `pointercancel`.
 *
 * Cards are never slop TARGETS (they are big, and a card's gesture is a drag), but a tap on a card is a direct hit.
 * Hit testing reads rects once per missed tap, never per frame.
 */
import { TAP_SLOP, isTap } from './touchInput';

/** The minimum touch target, screen px (Apple HIG / Material: 44 to 48). */
export const TOUCH_TARGET_PX = 44;

/** What a finger can be retargeted to, and the priority of each kind. */
export const SLOP_TARGETS: ReadonlyArray<readonly [string, number]> = [
  ['button, [role="button"], [role="tab"], [role="switch"], [role="option"], a[href], input, select, textarea, label, .btn, summary', 2],
  ['[data-tip], .gtip', 1],
];
/** A finger on one of these (or inside one) is a direct hit, never retargeted. */
const DIRECT = 'button, [role="button"], [role="tab"], [role="switch"], [role="option"], [role="slider"], a[href], input, select, textarea, label, .btn, summary, .card, [data-zone] .row, [draggable="true"], canvas';

export interface Box { left: number; top: number; right: number; bottom: number }
export interface SlopCandidate<T = unknown> { item: T; rect: Box; priority: number }

/** Pure: a rect grown about its centre so each side is at least `min` px. */
export function inflate(r: Box, min = TOUCH_TARGET_PX): Box {
  const w = r.right - r.left;
  const h = r.bottom - r.top;
  const dx = w < min ? (min - w) / 2 : 0;
  const dy = h < min ? (min - h) / 2 : 0;
  return { left: r.left - dx, top: r.top - dy, right: r.right + dx, bottom: r.bottom + dy };
}

/** Pure: distance from a point to a rect (0 inside). */
export function distToBox(x: number, y: number, r: Box): number {
  const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
  const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
  return Math.hypot(dx, dy);
}

/**
 * Pure: the control a missed tap at (x, y) belongs to, or null. The nearest real rect among the candidates whose grown
 * area contains the point; ties by priority, then by the smaller control.
 */
export function pickSlopTarget<T>(x: number, y: number, cands: ReadonlyArray<SlopCandidate<T>>, min = TOUCH_TARGET_PX): SlopCandidate<T> | null {
  let best: SlopCandidate<T> | null = null;
  let bestD = Infinity;
  let bestArea = Infinity;
  for (const c of cands) {
    const g = inflate(c.rect, min);
    if (x < g.left || x > g.right || y < g.top || y > g.bottom) continue;
    const d = distToBox(x, y, c.rect);
    const area = (c.rect.right - c.rect.left) * (c.rect.bottom - c.rect.top);
    const better = d < bestD - 0.01
      || (Math.abs(d - bestD) <= 0.01 && (best === null || c.priority > best.priority || (c.priority === best.priority && area < bestArea)));
    if (better) { best = c; bestD = d; bestArea = area; }
  }
  return best;
}

/** Is the element (or an ancestor) something a finger acts on directly? The game cursor says so too (CLAUDE.md: the
 *  interactive rule paints the open gauntlet), which catches a React `onClick` on a plain div. */
export function isDirectHit(el: Element | null): boolean {
  if (!el || typeof el.closest !== 'function') return false;
  if (el.closest(DIRECT)) return true;
  try {
    const cur = getComputedStyle(el).cursor;
    return /gauntlet_open|gauntlet_point|\bpointer\b/.test(cur);
  } catch { return false; }
}

/** The live candidates near (x, y): visible, enabled, not covered at their centre. One rect read per element. */
export function gatherCandidates(x: number, y: number, min = TOUCH_TARGET_PX): SlopCandidate<HTMLElement>[] {
  const out: SlopCandidate<HTMLElement>[] = [];
  const seen = new Set<Element>();
  for (const [sel, priority] of SLOP_TARGETS) {
    document.querySelectorAll<HTMLElement>(sel).forEach((el) => {
      if (seen.has(el)) return;
      seen.add(el);
      if (el.closest('.card') || (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      // A cheap reject first: only controls whose grown area can reach the point.
      const g = inflate(r, min);
      if (x < g.left || x > g.right || y < g.top || y > g.bottom) return;
      const cx = (r.left + r.right) / 2;
      const cy = (r.top + r.bottom) / 2;
      const top = document.elementFromPoint(cx, cy);
      if (!top || (top !== el && !el.contains(top))) return; // covered (a modal, a tip) or pointer-events: none
      out.push({ item: el, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, priority });
    });
  }
  return out;
}

/** The control a missed tap at (x, y) on `target` should go to, or null (a direct hit, or nothing near). */
export function resolveTouchTarget(target: Element | null, x: number, y: number): HTMLElement | null {
  if (isDirectHit(target)) return null;
  return pickSlopTarget(x, y, gatherCandidates(x, y))?.item ?? null;
}

const SYNTH = '__slopSynthetic';
let installed = false;
/**
 * Install the slop on `window` (capture). Must be installed BEFORE touchInput's listeners so the replayed events are
 * what touchInput sees. `enabled()` is read per press (the touch UI can switch off on a rotation to a big tablet).
 */
export function installTouchSlop(enabled: () => boolean): () => void {
  if (installed || typeof window === 'undefined') return () => {};
  installed = true;
  let retarget: HTMLElement | null = null;
  let pid = 0;
  let x0 = 0;
  let y0 = 0;
  let cancelled = false;
  let eatClick = false;
  const mark = <E extends Event>(e: E): E => { (e as unknown as Record<string, unknown>)[SYNTH] = true; return e; };
  const isSynth = (e: Event): boolean => !!(e as unknown as Record<string, unknown>)[SYNTH];
  const centre = (el: HTMLElement): { x: number; y: number } => {
    const r = el.getBoundingClientRect();
    return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
  };
  const replay = (type: string, el: HTMLElement, src: PointerEvent): void => {
    const c = centre(el);
    el.dispatchEvent(mark(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, pointerType: 'touch', pointerId: src.pointerId, isPrimary: true,
      button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerdown' ? 1 : 0, clientX: c.x, clientY: c.y, width: src.width, height: src.height,
    })));
  };
  const swallow = (e: Event): void => { e.stopImmediatePropagation(); if (e.cancelable) e.preventDefault(); };

  const onDown = (e: PointerEvent): void => {
    if (isSynth(e) || e.pointerType !== 'touch' || e.isPrimary === false || !enabled()) { retarget = null; return; }
    retarget = null; eatClick = false; cancelled = false;
    const el = resolveTouchTarget(e.target as Element | null, e.clientX, e.clientY);
    if (!el) return;
    retarget = el; pid = e.pointerId; x0 = e.clientX; y0 = e.clientY;
    swallow(e);
    replay('pointerdown', el, e);
  };
  const onMove = (e: PointerEvent): void => {
    if (!retarget || isSynth(e) || e.pointerId !== pid || cancelled) return;
    if (!isTap(x0, y0, e.clientX, e.clientY, TAP_SLOP)) {
      // A drag or a scroll, not a tap: the replayed press is cancelled and the real gesture carries on.
      cancelled = true;
      replay('pointercancel', retarget, e);
    }
  };
  const onUp = (e: PointerEvent): void => {
    if (!retarget || isSynth(e) || e.pointerId !== pid) return;
    const el = retarget;
    if (cancelled) { retarget = null; return; }
    swallow(e);
    replay('pointerup', el, e);
    eatClick = true;
    // The browser's click follows the pointerup; it is swallowed and replayed on the control (onClick).
    window.setTimeout(() => { if (eatClick && retarget === el) { eatClick = false; retarget = null; if (el.isConnected) el.click(); } }, 350);
  };
  const onClick = (e: MouseEvent): void => {
    if (!eatClick || !retarget || isSynth(e)) return;
    const el = retarget;
    eatClick = false;
    retarget = null;
    swallow(e);
    if (el.isConnected) {
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) el.focus();
      el.click();
    }
  };
  const onCancel = (e: PointerEvent): void => {
    if (!retarget || isSynth(e) || e.pointerId !== pid) return;
    if (!cancelled) replay('pointercancel', retarget, e);
    retarget = null;
  };
  // QA hook (touch devices only): where a tap at (x, y) lands, slop included. The mobile audit measures each control's
  // effective target with it.
  (window as unknown as { __ascentTouchResolve?: unknown }).__ascentTouchResolve = (x: number, y: number): Element | null => {
    const t = document.elementFromPoint(x, y);
    return (enabled() ? resolveTouchTarget(t, x, y) : null) ?? t;
  };
  const cap = { capture: true } as const;
  window.addEventListener('pointerdown', onDown, cap);
  window.addEventListener('pointermove', onMove, { capture: true, passive: true });
  window.addEventListener('pointerup', onUp, cap);
  window.addEventListener('pointercancel', onCancel, cap);
  window.addEventListener('click', onClick, cap);
  return () => {
    window.removeEventListener('pointerdown', onDown, cap);
    window.removeEventListener('pointermove', onMove, cap);
    window.removeEventListener('pointerup', onUp, cap);
    window.removeEventListener('pointercancel', onCancel, cap);
    window.removeEventListener('click', onClick, cap);
    delete (window as unknown as { __ascentTouchResolve?: unknown }).__ascentTouchResolve;
    installed = false;
  };
}
