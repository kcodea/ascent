import type { CrateRarity, PackLook } from '@game/progression';
import { packGlowRarity } from './packGlow';

/**
 * PACK WRAPPER ART (owner 2026-11-23: "use this for the common card back wrapper"). Which pack wears a painted wrapper:
 * the whole pack (tear strip + sleeve body) as one image cut on the `packGeom.ts` template, 600 x 1094 webp (2x the
 * pack's 300 x 547 base). The strip is the art above the tear line, the body the rest. A look with no entry keeps the
 * placeholder painting (packTextures.ts). A later pack PNG is one line in `RARITY_PACK_ART`.
 *
 * Mask-ready (owner ask, not built yet): a greyscale SHINE MASK per wrapper will limit where the gloss shows. Its URL
 * comes from `packShineFor` below; `packViews.ts` marks where the gloss takes it (the MASK HOOK beside the gloss mesh).
 */
const BASE = import.meta.env.BASE_URL;

/** The Common pack's wrapper. */
export const COMMON_PACK_SRC = `${BASE}packs/common-pack.webp`;

/** A rarity pack's wrapper art by rarity. */
const RARITY_PACK_ART: Partial<Record<CrateRarity, string>> = {
  common: COMMON_PACK_SRC,
};

/** The wrapper art for `look`, or null (the placeholder painting). Only rarity packs have art today. */
export function packArtFor(look: PackLook): string | null {
  if (look.kind !== 'rarity') return null;
  return RARITY_PACK_ART[packGlowRarity(look)] ?? null;
}

/**
 * THE SHINE-MASK HOOK: a wrapper's greyscale shine mask (light = glossy, dark = matte), or null. None exists yet, so it
 * is always null; when one ships, return its URL here and build the mask mesh at the gloss in `packViews.ts`.
 */
export function packShineFor(_look: PackLook): string | null {
  return null;
}
