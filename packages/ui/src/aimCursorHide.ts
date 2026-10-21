/**
 * HIDE THE CURSOR WHILE AIMING, WITHOUT RESTYLING THE PAGE (desktop jank pass 2026-10-18, R-PERF-AIM-CURSOR-01).
 *
 * While a hero power, a piece of Equipment, a targeted Shout or a targeted spell is aimed, the Pixi aim line IS the
 * pointer, so the OS cursor is hidden. That used to be `body.aiming, body.aiming * { cursor: none !important }`, and
 * toggling it restyled the WHOLE document twice per aim: the universal descendant rule invalidates every element
 * (measured 11 ms for 756 elements per toggle on a heavy shop, ~19 ms late game, 14-15 frames over 6.25 ms). The drag
 * had the same bug and moved to a cursor veil (`dragCursorVeil.ts`), but a veil would swallow the clicks an aim still
 * lets through (End Turn while a Shout waits for its target), so the aim takes the other cheap route:
 *
 * The browser shows the cursor of the element under the pointer and nothing else. So only THAT element needs
 * `cursor: none`. While the aim is live, every element the pointer enters (`pointerover`, which fires on element
 * boundaries only, never per move) gets an inline `cursor: none !important` (inline important beats every stylesheet
 * rule, the global gauntlet ones included), and the element the pointer was already over when the aim started gets it
 * at once. Each write restyles one element. When the aim ends the touched elements get their old inline value back.
 * The look is the same as before: no cursor anywhere the pointer goes while aiming.
 *
 * `body.aiming` itself stays as a plain flag (touchInput.ts reads it). No stylesheet rule keys on it any more, so
 * toggling it restyles nothing.
 */

type Styled = HTMLElement | SVGElement;
/** Elements we hid the cursor on, with the inline cursor they had before (almost always none). */
const touched = new Map<Styled, { value: string; priority: string }>();
let hiding = false;
let lastOver: Element | null = null;
let installed = false;

const styled = (t: EventTarget | null): t is Styled =>
  typeof HTMLElement !== 'undefined' && (t instanceof HTMLElement || (typeof SVGElement !== 'undefined' && t instanceof SVGElement));

function hideOn(el: EventTarget | null): void {
  if (!styled(el) || touched.has(el)) return;
  touched.set(el, { value: el.style.getPropertyValue('cursor'), priority: el.style.getPropertyPriority('cursor') });
  el.style.setProperty('cursor', 'none', 'important');
}

function onOver(e: Event): void {
  lastOver = e.target as Element | null;
  if (hiding) hideOn(e.target);
}

/**
 * Track the element under the pointer (one passive capture listener on `pointerover`: element boundaries only). Called
 * once from the recruit screen; idempotent.
 */
export function installAimCursorHide(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('pointerover', onOver, { capture: true, passive: true });
}

/** Hide (true) or restore (false) the cursor for the aim. Idempotent both ways. */
export function setAimCursorHidden(next: boolean): void {
  if (next === hiding) return;
  hiding = next;
  if (next) {
    hideOn(lastOver);
    return;
  }
  for (const [el, prev] of touched) {
    if (prev.value) el.style.setProperty('cursor', prev.value, prev.priority);
    else el.style.removeProperty('cursor');
  }
  touched.clear();
}

/** Is the aim cursor hidden right now? (tests) */
export function aimCursorHidden(): boolean {
  return hiding;
}

/** How many elements currently carry the hidden cursor (tests). */
export function aimCursorTouched(): number {
  return touched.size;
}
