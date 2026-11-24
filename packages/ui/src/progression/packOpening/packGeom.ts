/**
 * PACK OPENING: the pack's geometry in BASE units, derived from the owner's wrapper art (owner 2026-11-23: "use this for
 * the common card back wrapper"). Pure, no dependencies, so `packFxConfig.ts` and `packTextures.ts` can both read it.
 *
 * The wrapper template (`apps/web/public/packs/common-pack.webp`) is the owner's booster PNG cropped to its opaque box:
 * 834 x 1520 source px, the dashed tear line centred 169.5 px down (measured from the pixels: the gold dash rows are
 * 203..206 of the 1586-tall original, whose opaque box starts at row 35). The pack keeps its 300 wide base, so the tear
 * strip is the art above the tear line and the sleeve body the rest, at the art's own aspect (no stretch). Every later
 * pack PNG is expected to share this template; a pack without art paints its placeholder on the same geometry.
 */

/** The wrapper template in source px (the cropped art): width, height and the tear line's centre row. */
export const PACK_ART_TEMPLATE = { w: 834, h: 1520, tearY: 169.5 } as const;

/** The strip height and the whole pack height for a pack `W` wide drawn from `tpl` at its own aspect (rounded units). */
export function derivePackHeights(W: number, tpl: { w: number; h: number; tearY: number }): { H: number; total: number } {
  const k = W / tpl.w;
  return { H: Math.round(tpl.tearY * k), total: Math.round(tpl.h * k) };
}

const PACK_W = 300;
const DERIVED = derivePackHeights(PACK_W, PACK_ART_TEMPLATE);

/**
 * The pack's geometry in BASE units (`PACK_BASE_SIZE` = W x (H + BODY_H) = 300 x 547). The scene simulates in these
 * units and scales the whole pack to its on-stage size.
 */
export const PACK_GEOM = {
  /** Pack width. */
  W: PACK_W,
  /** The tear strip's height: the wrapper art above its tear line (61). */
  H: DERIVED.H,
  /** The sleeve body's height below the strip (486). */
  BODY_H: DERIVED.total - DERIVED.H,
  /** A card in the stack: 2:3, the same shape as the face's card plate (the DOM face lands at the back's size). */
  CARD_W: 260,
  CARD_H: 390,
} as const;
