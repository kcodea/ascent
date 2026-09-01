/**
 * WHERE THE REFERENCED-CARD POPUP SITS.
 *
 * Extracted from `Card.tsx` so it can be reasoned about and tested at all — inside the component it lives in
 * a `setTimeout` and is otherwise observable only by hovering a particular card at a particular window width.
 * (It lives in its own module rather than being exported from `Card.tsx` because a non-component export there
 * costs React Fast Refresh for the whole file.)
 *
 * Three cases, and the third is the one the owner reported (2026-08-31: *"please dont shove it off to the
 * left side of the screen"*): a cluster too wide for EITHER side used to clamp to the left edge, which laps
 * the hovered card and the left-hand UI both, and reads as the popup having escaped rather than been placed.
 */
export function refPopupLeft(args: {
  /** The hovered card's viewport rect edges. */
  cardLeft: number;
  cardRight: number;
  /** The whole cluster's estimated width — every preview card, the gaps, and the keyword-defs column. */
  tipW: number;
  viewportW: number;
  gap?: number;
  /** How close to the viewport edge the popup may sit. */
  edge?: number;
}): number {
  const { cardLeft, cardRight, tipW, viewportW, gap = 10, edge = 6 } = args;
  const flip = cardRight + gap + tipW > viewportW - edge; // off the right edge → try the left
  if (!flip) return cardRight + gap;
  const fitsLeft = cardLeft - gap - tipW >= edge;
  if (fitsLeft) return cardLeft - gap - tipW;
  // Fits on neither side: centre it. `Math.max` keeps a cluster wider than the viewport on-screen at all,
  // which is the one case where the edge really is the best answer available.
  return Math.max(edge, Math.round((viewportW - tipW) / 2));
}
