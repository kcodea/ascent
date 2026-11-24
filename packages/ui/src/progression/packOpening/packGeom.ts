/**
 * PACK OPENING: the pack's geometry in BASE units, derived from the owner's wrapper art (owner 2026-11-23: "use this for
 * the common card back wrapper"). Pure, no dependencies, so `packFxConfig.ts` and `packTextures.ts` can both read it.
 *
 * The wrapper template (`apps/web/public/packs/<rarity>-pack.webp`, owner 2026-11-23: the five rarity wrappers from
 * `Game Assets/Ascent Art/Game UI/Card Packs`) is 600 x 900 with the dashed tear line on row 100. Each owner PNG
 * (1024 x 1536, art about 940 x 1410) is cropped to its opaque box and cut AT its own tear line into two bands, each
 * scaled on its own (the strip to 600 x 100, the body to 600 x 800), so every crimped edge stays whole and every tear
 * line lands on the same row (vertical scale within ~6% of the horizontal). The pack keeps its 300 wide base: the tear
 * strip is the art above the tear line and the sleeve body the rest. A pack without art paints its placeholder on the
 * same geometry.
 */

/** The wrapper template in source px (the cropped art): width, height and the tear line's centre row. */
export const PACK_ART_TEMPLATE = { w: 600, h: 900, tearY: 100 } as const;

/** The strip height and the whole pack height for a pack `W` wide drawn from `tpl` at its own aspect (rounded units). */
export function derivePackHeights(W: number, tpl: { w: number; h: number; tearY: number }): { H: number; total: number } {
  const k = W / tpl.w;
  return { H: Math.round(tpl.tearY * k), total: Math.round(tpl.h * k) };
}

const PACK_W = 300;
const DERIVED = derivePackHeights(PACK_W, PACK_ART_TEMPLATE);

/**
 * The pack's geometry in BASE units (`PACK_BASE_SIZE` = W x (H + BODY_H) = 300 x 450). The scene simulates in these
 * units and scales the whole pack to its on-stage size.
 */
export const PACK_GEOM = {
  /** Pack width. */
  W: PACK_W,
  /** The tear strip's height: the wrapper art above its tear line (50). */
  H: DERIVED.H,
  /** The sleeve body's height below the strip (400). */
  BODY_H: DERIVED.total - DERIVED.H,
  /** A card in the stack: 2:3, the same shape as the face's card plate (the DOM face lands at the back's size). */
  CARD_W: 260,
  CARD_H: 390,
} as const;
