/**
 * THE DRAG CURSOR VEIL (gameplay perf pass 2026-10-09).
 *
 * While a card is dragged the cursor is the closed gauntlet everywhere. That used to be `body.dragging,
 * body.dragging * { cursor: … !important }`, and toggling it restyled the WHOLE document twice per drag: the
 * universal descendant rule invalidates every element, and `cursor` is an inherited property that Blink does not
 * propagate on its fast path. Measured on a heavy shop: a full restyle (~13-20 ms) inside the drag's first frame and
 * again inside the drop's `pointerup`, so every drag dropped several frames at both ends.
 *
 * Instead, a transparent full-viewport element is laid over everything for the life of the drag and carries the
 * cursor itself: the browser shows the cursor of the element under the pointer, which is now always the veil. One
 * small element is inserted and removed; nothing else restyles. The drag is driven by window-level pointer listeners,
 * so the veil takes no input away from it. The things it does change were already neutralised during a drag:
 * `:hover` on the cards under it (the `body.dragging … :hover` rules reset the hover pop and glow anyway), card
 * hover previews (suppressed while `dragging`), and click-through rules (`body.dragging .etbwrap { pointer-events:
 * none }` and friends), which exist so the pointer is not caught by the chrome, and the veil catches nothing.
 *
 * `body.dragging` itself stays: its other rules (the FLIP glide transitions, the hand tuck) target a handful of
 * elements by class and cost nothing like a universal restyle.
 */
import { stageHost } from './stage';

const VEIL_CLASS = 'drag-cursor-veil';
let veil: HTMLDivElement | null = null;

/** Lay the veil over the page (idempotent). */
export function showDragCursorVeil(): void {
  if (typeof document === 'undefined') return;
  if (!veil) {
    veil = document.createElement('div');
    veil.className = VEIL_CLASS;
    veil.setAttribute('aria-hidden', 'true');
  }
  // Inside the stage like every other layer (stageTripwire.test.ts): the drag happens on the stage, and the veil
  // covers it edge to edge.
  if (!veil.isConnected) stageHost().appendChild(veil);
}

/** Lift the veil (idempotent). */
export function hideDragCursorVeil(): void {
  veil?.remove();
}

/** The topmost element at a point, IGNORING the veil — for the drop's zone hit test, which runs while it is up. */
export function elementBelowVeil(x: number, y: number): Element | null {
  if (typeof document === 'undefined') return null;
  if (!veil?.isConnected) return document.elementFromPoint(x, y);
  for (const el of document.elementsFromPoint(x, y)) if (el !== veil) return el;
  return null;
}
