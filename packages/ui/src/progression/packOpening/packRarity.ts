import { RARITY_LABELS, type CrateRarity } from '@game/progression';

/**
 * PACK-OPENING RARITY IDENTITY (owner 2026-11-23). The rarity medallions (public/medallions/ascent_rarity_<id>.webp,
 * 560 px, transparent) and the player-facing label. The `ancient` rarity READS "Ascendant" inside the pack opening only;
 * its internal id stays `ancient` (the game-wide rename is a separate change). `ascent_rarity_secret.webp` ships beside
 * the others for the future sixth rarity, unused until it exists in code.
 */
export const rarityIconSrc = (r: CrateRarity): string => `${import.meta.env.BASE_URL}medallions/ascent_rarity_${r}.webp`;

/** What the pack opening calls a rarity: every ribbon, back, summary line and announcement goes through here. */
export const packRarityLabel = (r: CrateRarity): string => (r === 'ancient' ? 'Ascendant' : RARITY_LABELS[r]);
