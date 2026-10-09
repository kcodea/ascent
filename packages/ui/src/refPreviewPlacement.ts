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

/** Where an OPEN popup settles once its real size is known (`useFitRefPopup`). */
export interface RefPopupFit { left: number; top: number; origin: 'left' | 'right' }

/**
 * THE SECOND, MEASURED PASS (player report 2026-10-08: *"I can't read the Lasso spell when the Rune of Lassoing is
 * the rightmost rune"*). Every surface places its popup on open from an ESTIMATED width, and an estimate that runs
 * short never flips: the Rune of Lassoing's two plated cards (Rope Wrangler, then Lasso) measured ~480 px against
 * a ~300 px estimate, so the chain opened right and the Lasso ran off the screen. Given the popup's MEASURED
 * width and height this re-runs the same rule as `refPopupLeft` (right if it fits, else left, else centred) and
 * clamps the top, so the whole chain lands on screen whatever the estimate said.
 */
export function fitRefPopup(args: {
  /** The hovered element's rect edges (stage px). */
  anchorLeft: number;
  anchorRight: number;
  /** The top the surface wants before clamping (usually the hovered element's top). */
  prefTop: number;
  /** The popup's measured footprint (stage px). */
  w: number;
  h: number;
  viewportW: number;
  viewportH: number;
  gap?: number;
  edge?: number;
}): RefPopupFit {
  const { anchorLeft, anchorRight, prefTop, w, h, viewportW, viewportH, gap = 10, edge = 6 } = args;
  const left = refPopupLeft({ cardLeft: anchorLeft, cardRight: anchorRight, tipW: w, viewportW, gap, edge });
  const top = Math.max(edge, Math.min(prefTop, viewportH - h - edge));
  return { left, top, origin: left < anchorLeft ? 'right' : 'left' };
}
