import { RARITY_LABELS, type CrateRarity } from '@game/progression';

/**
 * PACK-OPENING ART AND RARITY LABELS (owner 2026-11-23). The rarity medallions (public/medallions/ascent_rarity_<id>.webp,
 * 560 px, transparent) and the player-facing label. `ancient` reads "Ancient" (owner: "Ascendant is the Rank. Ancient is
 * the rarity"). `ascent_rarity_secret.webp` ships beside the others: a Secret medallion supplied for later, unused.
 */
export const rarityIconSrc = (r: CrateRarity): string => `${import.meta.env.BASE_URL}medallions/ascent_rarity_${r}.webp`;

/**
 * The owner's cosmetic card plate (1024 x 1536 webp from `Reference Art/Cosmetic Card Plate.png`): the frame of every
 * pack card, the Pixi backs (`packTextures.ts`) and the DOM faces (`packFaces.tsx`) alike, so the two match at the flip.
 */
export const CARD_PLATE_SRC = `${import.meta.env.BASE_URL}packs/cosmetic-card-plate.webp`;

/**
 * The owner's rarity card plates (owner 2026-11-24, `Reference Art/Card - <Rarity> Rarity.png`, 1024 x 1536 webp): the
 * card plate recoloured per rarity, the same geometry exactly (window and outer edge), "it should serve as both": a
 * card's rarity back in Pixi (`packTextures.ts paintRarityBack`) and its face's frame (`packFaces.tsx`), so the flip
 * turns one plate over. The plain back, worn before the result arrives, keeps the gold `CARD_PLATE_SRC`.
 * `card-plate-secret.webp` ships beside them: a Secret plate supplied for later, unused (no Secret rarity yet).
 */
export const cardPlateSrc = (r: CrateRarity): string => `${import.meta.env.BASE_URL}packs/card-plate-${r}.webp`;

/** What the pack opening calls a rarity: every ribbon, back, summary line and announcement goes through here. */
export const packRarityLabel = (r: CrateRarity): string => RARITY_LABELS[r];
