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
 *  - LONG-PRESS (owner 2026-10-18, R-TOUCH-LONGPRESS-01): a finger held still for `LONG_PRESS_MS` (inside the same
 *    `TAP_SLOP`) is the touch RIGHT-CLICK. It fires ONE synthetic `contextmenu` at the held element, so every
 *    existing right-click path answers it with no per-surface wiring: card Inspect (shop, board, hand, Discover,
 *    Choose One), the emote menu on your portrait, muting a spectator, pinning a lobby-rail scout. An element with no
 *    right-click of its own (a hero-select card, a Runeforge offer) gets its HOVER face instead (`.tt-on` plus a
 *    synthetic `mouseover`, so React `onMouseEnter` previews open). A short tap keeps its old action, movement past
 *    the slop cancels the hold (a drag starts exactly as before), the browser's own long-press `contextmenu`
 *    (Android) is swallowed so it never fires twice, and the click a long-press release would send is eaten. A
 *    haptic tick (`navigator.vibrate(10)`) marks the moment it fires where the browser supports it (not iOS Safari).
 *
 * Cards open the full Inspect overlay on a tap instead (see Card.tsx, `touchTapInspect`), which reads better on a
 * phone than the desktop hover reveal and closes on a tap on its backdrop.
 *
 * Nothing here runs for a mouse or a pen: every handler returns on `pointerType !== 'touch'`.
 */

/** px a touch may travel and still count as a tap (screen px, a physical distance). Matches the drag threshold's
 *  intent: a finger wobbles more than a mouse. */
export const TAP_SLOP = 10;
/** ms a finger must stay down (inside `TAP_SLOP`) for a long-press (owner 2026-10-18 audit: "hold ~350 ms"). */
export const LONG_PRESS_MS = 350;
/** ms after a long-press release during which the browser's follow-up click is swallowed. */
export const LONG_PRESS_CLICK_EAT_MS = 350;

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

/**
 * Is this a TOUCH DEVICE (a phone or tablet: no hover, a coarse pointer)? Help, rules and Settings text that says
 * "Right-click" / "Hover" / "Press Tab" picks its touch wording off this (R-TOUCH-WORDING-01). A touchscreen laptop
 * with a mouse reports `hover: hover` and keeps the mouse wording.
 */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try { return window.matchMedia('(hover: none) and (pointer: coarse)').matches; } catch { return false; }
}
/**
 * Pure: a help line's MOUSE wording in TOUCH words (R-TOUCH-WORDING-01), for the rules answers with no hand-written
 * `aTouch`: "Right-click" becomes "Tap and hold" (the long-press is the touch right-click) and "Hover" becomes "Tap" (a
 * tap is the touch hover). Case and the `**bold**` markers are kept.
 */
export function touchWording(text: string): string {
  return text
    .replace(/\b([Rr])ight-clicking\b/g, (_m, r: string) => (r === 'R' ? 'Tapping and holding' : 'tapping and holding'))
    .replace(/\b([Rr])ight-click(s?)\b/g, (_m, r: string, s: string) => (r === 'R' ? `Tap${s} and hold` : `tap${s} and hold`))
    .replace(/\b([Hh])overing\b/g, (_m, h: string) => (h === 'H' ? 'Tapping' : 'tapping'))
    .replace(/\b([Hh])over(s?)\b/g, (_m, h: string, s: string) => (h === 'H' ? `Tap${s}` : `tap${s}`));
}
/** `mouse` on a mouse device, `touch` on a touch device. */
export function touchText(mouse: string, touch: string): string { return isTouchDevice() ? touch : mouse; }

/**
 * THE HERO POWER / EQUIPMENT AIM, on release (owner 2026-10-18, R-TOUCH-AIMTAP-01): does this pointerup resolve the
 * aim (fire on a valid target, or cancel off one)? A press-drag-release always does (`moved`). A release with NO
 * movement does only if the press STARTED after the aim armed (`pressedSinceArm`): that is the second tap of
 * tap-the-power-then-tap-the-minion. A finger tap sends no pointermove at all, so the old `moved`-only test left the
 * power armed forever on a phone. The release of the very press that ARMED it (the power arms on pointerdown) never
 * resolves, so a plain tap on the power still just arms it.
 */
export function aimReleaseResolves(moved: boolean, pressedSinceArm: boolean): boolean {
  return moved || pressedSinceArm;
}

/** The long-press state machine, pure apart from the timer it is handed (unit-tested in touchInput.test.ts). */
export interface LongPress {
  /** A finger landed at (x, y) on `target`: start the hold. */
  down(target: Element | null, x: number, y: number): void;
  /** The finger moved: past the slop cancels the hold (it is a drag or a scroll). */
  move(x: number, y: number): void;
  /** The finger lifted. True when the hold had already fired (so the release is NOT a tap). */
  up(): boolean;
  /** The gesture was cancelled by the browser. */
  cancel(): void;
  /** Has the current (or just-released) gesture fired its long-press? */
  fired(): boolean;
  /** Is a finger down with the hold fired? A drag must not start under the view it opened. */
  active(): boolean;
}
export interface LongPressDeps {
  /** Fire on `target`. Return false if nothing took it (then it does not count as fired). */
  fire(target: Element | null, x: number, y: number): boolean;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(id: unknown): void;
  delay?: number;
  slop?: number;
}
export function createLongPress(deps: LongPressDeps): LongPress {
  const delay = deps.delay ?? LONG_PRESS_MS;
  const slop = deps.slop ?? TAP_SLOP;
  let timer: unknown = null;
  let down = false;
  let didFire = false;
  let x0 = 0;
  let y0 = 0;
  let tgt: Element | null = null;
  const stop = (): void => { if (timer !== null) { deps.clearTimer(timer); timer = null; } };
  return {
    down(target, x, y) {
      stop();
      down = true; didFire = false; x0 = x; y0 = y; tgt = target;
      timer = deps.setTimer(() => {
        timer = null;
        if (down) didFire = deps.fire(tgt, x0, y0);
      }, delay);
    },
    move(x, y) {
      if (!down || timer === null) return;
      if (!isTap(x0, y0, x, y, slop)) stop();
    },
    up() { stop(); down = false; return didFire; },
    cancel() { stop(); down = false; },
    fired: () => didFire,
    active: () => down && didFire,
  };
}

let longPress: LongPress | null = null;
/** True while a finger is down on a long-press that has fired: the drag path refuses to start (Recruit.tsx). */
export function longPressActive(): boolean { return !!longPress?.active(); }

let lastTouchEl: Element | null = null;
/** The element the most recent finger landed on (the card an Inspect was opened from, for its Buy / Pick button). */
export function lastTouchTarget(): Element | null { return lastTouchEl; }

/** What the Inspect overlay's touch action button does for the card it was opened from (R-TOUCH-INSPECTACT-01). */
export type InspectAction = { kind: 'buy'; uid: string } | { kind: 'pick'; el: HTMLElement } | null;
/**
 * Pure: from the element a finger opened Inspect on, the action the enlarged view offers. A SHOP offer gets Buy (the
 * same `buy` action a drag into your half sends; the reducer still refuses it without the Gold or a hand slot). A
 * clickable card OUTSIDE the play zones (a Discover, Choose One or quest option, where a tap commits) gets Pick, which
 * clicks that card. Anything else (your board, your hand, combat) has no button.
 */
export function inspectActionFor(el: Element | null): InspectAction {
  const card = (el && typeof el.closest === 'function' ? el.closest('.card') : null) as HTMLElement | null;
  if (!card || card.closest('.unit')) return null;
  const zone = card.closest('[data-zone]');
  if (zone) {
    if (zone.getAttribute('data-zone') !== 'tavern' || !card.closest('.row')) return null;
    const uid = card.getAttribute('data-uid');
    return uid ? { kind: 'buy', uid } : null;
  }
  return card.getAttribute('role') === 'button' ? { kind: 'pick', el: card } : null;
}

/** Pure: does a gesture from (x0,y0) to (x1,y1) stay inside the tap slop? */
export function isTap(x0: number, y0: number, x1: number, y1: number, slop = TAP_SLOP): boolean {
  return Math.hypot(x1 - x0, y1 - y0) <= slop;
}

/** The class a finger's press puts on the hand card under it (see `installTouchInput`). */
export const PRESS_CLASS = 'tt-press';
/** The class the body wears while a hand card is pressed. */
export const BODY_PRESS_CLASS = 'tt-handpress';
/** Pure: the hand card a touch landed on, or null. */
export function handCardOf(el: Element | null): Element | null {
  return el?.closest?.('.row.hand .card') ?? null;
}

/** Elements with a HOVER face worth opening on a long-press when they have no right-click of their own. */
const HOVER_FACE = 'button, [role="button"], .gtip, [data-tip], .lobbyseat, .herocard, .runecard';

let installed = false;
export function installTouchInput(): () => void {
  if (installed || typeof window === 'undefined') return () => {};
  installed = true;

  let synthTook = false;                  // did a game handler cancel our synthetic contextmenu (seen at document)?
  let hoverHeld: Element | null = null;   // a long-press that fell back to the HOVER face
  let eatClickUntil = 0;
  const synth = <E extends Event>(ev: E): E => { (ev as unknown as Record<string, unknown>)[SYNTHETIC] = true; return ev; };
  const isSynth = (ev: Event): boolean => !!(ev as unknown as Record<string, unknown>)[SYNTHETIC];
  const fire = (target: Element | null, x: number, y: number): boolean => {
    if (!target || !target.isConnected) return false;
    const b = document.body.classList;
    if (b.contains('dragging') || b.contains('aiming')) return false; // there the finger is the drag / the aim
    // 1. The game's own right-click, wherever there is one (Inspect, emotes, mute, rail scout).
    // "Took it" is read at DOCUMENT level: the app's window listener (main.tsx) cancels every contextmenu to hide the
    // browser menu, so `dispatchEvent`'s own return value would say "handled" for anything.
    const cm = synth(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, composed: true, button: 2, buttons: 2, clientX: x, clientY: y }));
    synthTook = false;
    target.dispatchEvent(cm);
    let took = synthTook;
    // 2. No right-click here: open its HOVER face, held until the next touch lands elsewhere (like a tap's).
    if (!took && target.closest(HOVER_FACE)) {
      markChain(target);
      target.dispatchEvent(synth(new MouseEvent('mouseover', { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, relatedTarget: null })));
      hoverHeld = target;
      took = true;
    }
    if (took) { try { navigator.vibrate?.(10); } catch { /* unsupported (iOS Safari) */ } }
    return took;
  };
  const lp = createLongPress({ fire, setTimer: (fn, ms) => window.setTimeout(fn, ms), clearTimer: (id) => window.clearTimeout(id as number) });
  longPress = lp;

  const onOver = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch' || isSynth(e)) return;
    // A new touch is landing. Close the previous tap's hover the way a moving mouse would: a pointerout on the old
    // target, towards the new one, BEFORE the new target's pointerover is handled.
    const prev = tapTarget;
    tapTarget = null;
    const held = hoverHeld;
    hoverHeld = null;
    if (held && held.isConnected && held !== e.target && !held.contains(e.target as Node | null)) {
      held.dispatchEvent(synth(new MouseEvent('mouseout', { bubbles: true, cancelable: true, composed: true, relatedTarget: e.target as Element | null, clientX: e.clientX, clientY: e.clientY })));
    }
    if (prev && prev.isConnected && prev !== e.target) {
      const out = synth(new PointerEvent('pointerout', { bubbles: true, cancelable: true, composed: true, pointerType: 'touch', pointerId: e.pointerId, isPrimary: true, relatedTarget: e.target as Element | null, clientX: e.clientX, clientY: e.clientY }));
      prev.dispatchEvent(out);
      const leave = synth(new PointerEvent('pointerleave', { bubbles: false, pointerType: 'touch', pointerId: e.pointerId, isPrimary: true, relatedTarget: e.target as Element | null }));
      prev.dispatchEvent(leave);
    }
  };
  // A finger on a HAND card marks it `.tt-press` (and the body `.tt-handpress`, so the hand zone can rise above the HUD
  // without a `:has()`) until the finger lifts: on a zoomed phone the resting hand shows only the top of each card, and
  // the press pops the whole card up (touchUi.css). Classes only; nothing measures.
  let pressed: Element | null = null;
  const unpress = (): void => { if (pressed) { pressed.classList.remove(PRESS_CLASS); document.body.classList.remove(BODY_PRESS_CLASS); pressed = null; } };
  const onDown = (e: PointerEvent): void => {
    lastType = e.pointerType;
    unpress();
    if (e.pointerType !== 'touch') { lp.cancel(); clearChain(); return; }
    downX = e.clientX; downY = e.clientY; moved = false; lastTapWasTap = false;
    const t = e.target as Element | null;
    lastTouchEl = t;
    if (e.isPrimary !== false) { pressed = handCardOf(t); if (pressed) { pressed.classList.add(PRESS_CLASS); document.body.classList.add(BODY_PRESS_CLASS); } }
    if (e.isPrimary !== false) lp.down(t, e.clientX, e.clientY);
    else lp.cancel(); // a second finger is a pinch / two-finger gesture, never a long-press
    // Tap-away: a touch anywhere but on the tapped element closes its tip (a touch on it keeps it open).
    if (!t || !chainLeaf || !chainLeaf.contains(t)) clearChain();
  };
  const onMove = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    lp.move(e.clientX, e.clientY);
    if (moved) return;
    if (!isTap(downX, downY, e.clientX, e.clientY)) moved = true;
  };
  const onUp = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    unpress();
    if (!isTap(downX, downY, e.clientX, e.clientY)) moved = true;
    if (lp.up()) {
      // The release of a long-press is not a tap: no hover mark, no tap-inspect, and its click is eaten.
      lastTapWasTap = false;
      tapTarget = null;
      eatClickUntil = performance.now() + LONG_PRESS_CLICK_EAT_MS;
      return;
    }
    lastTapWasTap = !moved && !document.body.classList.contains('dragging');
    if (!lastTapWasTap) { tapTarget = null; return; }
    const t = e.target as Element | null;
    tapTarget = t;
    markChain(t);
  };
  // Hold back the release's out / leave for a TAP so hover-opened previews stay readable (see the header).
  const onOutOrLeave = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch' || isSynth(e)) return;
    if (tapTarget && lastTapWasTap) e.stopImmediatePropagation();
  };
  const onCancel = (e: PointerEvent): void => { if (e.pointerType === 'touch') { unpress(); lp.cancel(); moved = true; lastTapWasTap = false; } };
  // The BROWSER's long-press menu (Android Chrome fires `contextmenu` at ~500 ms): our hold already answered at
  // 350 ms, so a native one from a finger is swallowed before React sees it (no double fire, no OS menu). A mouse
  // right-click (lastType 'mouse') is untouched, and so is our own synthetic one.
  const onContext = (e: MouseEvent): void => {
    if (isSynth(e) || lastType !== 'touch') return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const onDocContext = (e: MouseEvent): void => { if (isSynth(e)) synthTook = e.defaultPrevented; };
  const onClick = (e: MouseEvent): void => {
    if (!eatClickUntil) return;
    const eat = performance.now() <= eatClickUntil;
    eatClickUntil = 0;
    if (eat) { e.preventDefault(); e.stopImmediatePropagation(); }
  };

  const cap = { capture: true } as const;
  window.addEventListener('pointerover', onOver, cap);
  window.addEventListener('pointerdown', onDown, cap);
  window.addEventListener('pointermove', onMove, { capture: true, passive: true });
  window.addEventListener('pointerup', onUp, cap);
  window.addEventListener('pointerout', onOutOrLeave, cap);
  window.addEventListener('pointerleave', onOutOrLeave, cap);
  window.addEventListener('pointercancel', onCancel, cap);
  window.addEventListener('contextmenu', onContext, cap);
  window.addEventListener('click', onClick, cap);
  document.addEventListener('contextmenu', onDocContext);
  return () => {
    window.removeEventListener('pointerover', onOver, cap);
    window.removeEventListener('pointerdown', onDown, cap);
    window.removeEventListener('pointermove', onMove, cap);
    window.removeEventListener('pointerup', onUp, cap);
    window.removeEventListener('pointerout', onOutOrLeave, cap);
    window.removeEventListener('pointerleave', onOutOrLeave, cap);
    window.removeEventListener('pointercancel', onCancel, cap);
    window.removeEventListener('contextmenu', onContext, cap);
    window.removeEventListener('click', onClick, cap);
    document.removeEventListener('contextmenu', onDocContext);
    lp.cancel();
    longPress = null;
    clearChain();
    installed = false;
  };
}
