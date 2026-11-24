import type { CrateRarity, PackLook } from '@game/progression';
import { packGlowRarity } from './packGlow';

/**
 * PACK WRAPPER ART (owner 2026-11-23: a wrapper per pack rarity). Which pack wears a painted wrapper: the whole pack
 * (tear strip + sleeve body) as one image cut on the `packGeom.ts` template, 600 x 900 webp (2x the pack's 300 x 450
 * base). The strip is the art above the tear line, the body the rest. A look with no entry (category and themed packs)
 * keeps the placeholder painting (packTextures.ts). The owner's Secret wrapper is not shipped: Secret is not a rarity
 * yet (its role is undecided).
 *
 * Mask-ready (owner ask, not built yet): a greyscale SHINE MASK per wrapper will limit where the gloss shows. Its URL
 * comes from `packShineFor` below; `packViews.ts` marks where the gloss takes it (the MASK HOOK beside the gloss mesh).
 */
const BASE = import.meta.env.BASE_URL;

/** A rarity pack's wrapper art, `packs/<rarity>-pack.webp`. */
export const RARITY_PACK_ART: Readonly<Record<CrateRarity, string>> = {
  common: `${BASE}packs/common-pack.webp`,
  rare: `${BASE}packs/rare-pack.webp`,
  epic: `${BASE}packs/epic-pack.webp`,
  legendary: `${BASE}packs/legendary-pack.webp`,
  ancient: `${BASE}packs/ancient-pack.webp`,
};

/** The wrapper art for `look`, or null (the placeholder painting). Only rarity packs have art today. */
export function packArtFor(look: PackLook): string | null {
  if (look.kind !== 'rarity') return null;
  return RARITY_PACK_ART[packGlowRarity(look)];
}

/**
 * THE SHINE-MASK HOOK: a wrapper's greyscale shine mask (light = glossy, dark = matte), or null. None exists yet, so it
 * is always null; when one ships, return its URL here and build the mask mesh at the gloss in `packViews.ts`.
 */
export function packShineFor(_look: PackLook): string | null {
  return null;
}
