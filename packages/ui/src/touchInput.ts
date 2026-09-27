/**
 * TOUCH: tap reaches everything hover reaches (owner ask 2026-09-26: "no hover-only information anywhere critical").
 *
 * The game's information surfaces are hover-driven: CSS `:hover` tips (the hero-power tip on the hero panel, the
 * shop-button tips, the Gold pill, quest badges, `data-tip` bubbles) and React `onPointerEnter` previews (the Hunch
 * spell, the Ancients meter, quest / rune rewards, the lobby scout). On a finger those either never open or close
 * the instant the finger lifts. One global controller gives touch the semantics of a mouse that stays where you
 * tapped:
 *
 *  - TAP = HOVER. A touch tap (released without moving past the drag slop) marks the tapped element and every
 *    ancestor with `.tt-on`; styles.css mirrors each hover-reveal rule on `.tt-on`, so its tip opens. It stays
 *    open until the next touch lands somewhere else (TAP-AWAY closes), exactly like a parked cursor.
 *  - PREVIEWS STAY OPEN. After a tap the browser fires `pointerout` / `pointerleave` at once (a touch pointer
 *    ceases to exist on release), which closed every `onPointerLeave` preview before it could be read. Those two
 *    events are held back for a tap; when the next touch lands elsewhere, a `pointerout` is replayed on the old
 *    target with the new one as `relatedTarget`, so React's enter/leave runs exactly as a moving mouse would.
 *  - DRAGS ARE UNTOUCHED: a touch that moves past the slop is a drag, and none of the above applies to it.
 *
 * Cards open the full Inspect overlay on a tap instead (see Card.tsx, `touchTapInspect`), which reads better on a
 * phone than the desktop hover reveal and closes on a tap on its backdrop.
 *
 * Nothing here runs for a mouse or a pen: every handler returns on `pointerType !== 'touch'`.
 */

/** px a touch may travel and still count as a tap (screen px, a physical distance). Matches the drag threshold's
 *  intent: a finger wobbles more than a mouse. */
export const TAP_SLOP = 10;

let lastType = 'mouse';
let downX = 0;
let downY = 0;
let moved = false;
let tapTarget: Element | null = null;   // the element the last tap left "hovered"
let lastTapWasTap = false;
const SYNTHETIC = '__ttSynthetic';

/** Was the most recent pointer a finger? */
export function lastPointerWasTouch(): boolean { return lastType === 'touch'; }
/** Was the most recent pointer a finger that tapped (did not drag)? Valid from pointerup through the click. */
export function lastTouchWasTap(): boolean { return lastType === 'touch' && lastTapWasTap; }

let chainLeaf: Element | null = null;   // the tapped element whose ancestor chain wears .tt-on
function clearChain(): void {
  chainLeaf = null;
  document.querySelectorAll('.tt-on').forEach((el) => el.classList.remove('tt-on'));
}
function markChain(el: Element | null): void {
  clearChain();
  chainLeaf = el;
  for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) n.classList.add('tt-on');
}

/**
 * Should this click open the card Inspect overlay? Only for a finger TAP on a card in the shop, warband, hand or
 * combat, and never while a targeting gesture (hero power, Equipment, targeted Battlecry, spell cast) or a drag
 * is live — there a tap is the pick. Mouse users keep right-click inspect and the hover reveal.
 */
export function tapInspectAllowed(el: Element): boolean {
  if (!lastTouchWasTap()) return false;
  const b = document.body.classList;
  if (b.contains('aiming') || b.contains('dragging')) return false;
  return !!el.closest('[data-zone], .unit');
}

/** Pure: does a gesture from (x0,y0) to (x1,y1) stay inside the tap slop? */
export function isTap(x0: number, y0: number, x1: number, y1: number, slop = TAP_SLOP): boolean {
  return Math.hypot(x1 - x0, y1 - y0) <= slop;
}

let installed = false;
export function installTouchInput(): () => void {
  if (installed || typeof window === 'undefined') return () => {};
  installed = true;

  const onOver = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch' || (e as unknown as Record<string, unknown>)[SYNTHETIC]) return;
    // A new touch is landing. Close the previous tap's hover the way a moving mouse would: a pointerout on the old
    // target, towards the new one, BEFORE the new target's pointerover is handled.
    const prev = tapTarget;
    tapTarget = null;
    if (prev && prev.isConnected && prev !== e.target) {
      const out = new PointerEvent('pointerout', { bubbles: true, cancelable: true, composed: true, pointerType: 'touch', pointerId: e.pointerId, isPrimary: true, relatedTarget: e.target as Element | null, clientX: e.clientX, clientY: e.clientY });
      (out as unknown as Record<string, unknown>)[SYNTHETIC] = true;
      prev.dispatchEvent(out);
      const leave = new PointerEvent('pointerleave', { bubbles: false, pointerType: 'touch', pointerId: e.pointerId, isPrimary: true, relatedTarget: e.target as Element | null });
      (leave as unknown as Record<string, unknown>)[SYNTHETIC] = true;
      prev.dispatchEvent(leave);
    }
  };
  const onDown = (e: PointerEvent): void => {
    lastType = e.pointerType;
    if (e.pointerType !== 'touch') { clearChain(); return; }
    downX = e.clientX; downY = e.clientY; moved = false; lastTapWasTap = false;
    const t = e.target as Element | null;
    // Tap-away: a touch anywhere but on the tapped element closes its tip (a touch on it keeps it open).
    if (!t || !chainLeaf || !chainLeaf.contains(t)) clearChain();
  };
  const onMove = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch' || moved) return;
    if (!isTap(downX, downY, e.clientX, e.clientY)) moved = true;
  };
  const onUp = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    if (!isTap(downX, downY, e.clientX, e.clientY)) moved = true;
    lastTapWasTap = !moved && !document.body.classList.contains('dragging');
    if (!lastTapWasTap) { tapTarget = null; return; }
    const t = e.target as Element | null;
    tapTarget = t;
    markChain(t);
  };
  // Hold back the release's out / leave for a TAP so hover-opened previews stay readable (see the header).
  const onOutOrLeave = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch' || (e as unknown as Record<string, unknown>)[SYNTHETIC]) return;
    if (tapTarget && lastTapWasTap) e.stopImmediatePropagation();
  };
  const onCancel = (e: PointerEvent): void => { if (e.pointerType === 'touch') { moved = true; lastTapWasTap = false; } };

  const cap = { capture: true } as const;
  window.addEventListener('pointerover', onOver, cap);
  window.addEventListener('pointerdown', onDown, cap);
  window.addEventListener('pointermove', onMove, { capture: true, passive: true });
  window.addEventListener('pointerup', onUp, cap);
  window.addEventListener('pointerout', onOutOrLeave, cap);
  window.addEventListener('pointerleave', onOutOrLeave, cap);
  window.addEventListener('pointercancel', onCancel, cap);
  return () => {
    window.removeEventListener('pointerover', onOver, cap);
    window.removeEventListener('pointerdown', onDown, cap);
    window.removeEventListener('pointermove', onMove, cap);
    window.removeEventListener('pointerup', onUp, cap);
    window.removeEventListener('pointerout', onOutOrLeave, cap);
    window.removeEventListener('pointerleave', onOutOrLeave, cap);
    window.removeEventListener('pointercancel', onCancel, cap);
    clearChain();
    installed = false;
  };
}
