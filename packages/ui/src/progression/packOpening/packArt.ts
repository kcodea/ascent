import type { CrateRarity, PackLook } from '@game/progression';
import { packGlowRarity } from './packGlow';

/**
 * PACK WRAPPER ART (owner 2026-11-23: a wrapper per pack rarity). Which pack wears a painted wrapper: the whole pack
 * (tear strip + sleeve body) as one image cut on the `packGeom.ts` template, 600 x 900 webp (2x the pack's 300 x 450
 * base). The strip is the art above the tear line, the body the rest. A look with no entry (category and themed packs)
 * keeps the placeholder painting (packTextures.ts). The owner's Secret wrapper ships as a THEMED look
 * (`SECRET_PACK_LOOK_ID`): Secret is not a rarity yet (its role is undecided), so it hangs off the look's id.
 *
 * Each wrapper has a greyscale SHINE MASK (`packShineFor` below) limiting where the holo sheen shows (packHoloMesh.ts).
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

/** The Secret pack's look id (a themed look until Secret's role is decided) and its wrapper. */
export const SECRET_PACK_LOOK_ID = 'themed-secret';
export const SECRET_PACK_SRC = `${BASE}packs/secret-pack.webp`;

/** The wrapper art for `look`, or null (the placeholder painting): every rarity pack, and the Secret pack. */
export function packArtFor(look: PackLook): string | null {
  if (look.kind === 'themed' && look.id === SECRET_PACK_LOOK_ID) return SECRET_PACK_SRC;
  if (look.kind !== 'rarity') return null;
  return RARITY_PACK_ART[packGlowRarity(look)];
}

/**
 * A wrapper's greyscale SHINE MASK (light = the holo shows, dark = matte), or null: `packs/<id>-pack-shine.webp`, 300 x
 * 450 (half the wrapper, aligned 1:1 with it), for every look that wears wrapper art. A first pass is generated from the
 * art by `scripts/pack-shine-masks.cjs`; a hand-painted mask may replace any of them. The holo mesh (packHoloMesh.ts)
 * multiplies its gradient by it.
 */
export function packShineFor(look: PackLook): string | null {
  const art = packArtFor(look);
  return art ? art.replace(/\.webp$/, '-shine.webp') : null;
}
