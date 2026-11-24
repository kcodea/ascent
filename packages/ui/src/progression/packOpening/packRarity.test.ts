import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { COSMETIC_RARITIES } from '@game/progression';
import { CARD_PLATE_SRC, packRarityLabel, rarityIconSrc } from './packRarity';

describe('packRarity', () => {
  it('has an icon for every code rarity, and the file ships', () => {
    expect(COSMETIC_RARITIES).toEqual(['common', 'rare', 'epic', 'legendary', 'ancient']);
    const pub = join(__dirname, '../../../../../apps/web/public');
    for (const r of COSMETIC_RARITIES) {
      const src = rarityIconSrc(r);
      expect(src).toMatch(new RegExp(`medallions/ascent_rarity_${r}\.webp$`));
      expect(existsSync(join(pub, 'medallions', `ascent_rarity_${r}.webp`))).toBe(true);
    }
    expect(existsSync(join(pub, 'medallions', 'ascent_rarity_secret.webp'))).toBe(true); // a Secret medallion supplied for later, unused
  });

  it('every rarity reads its own label: Ancient is the rarity (Ascendant is the Rank)', () => {
    expect(packRarityLabel('ancient')).toBe('Ancient');
    expect(packRarityLabel('legendary')).toBe('Legendary');
    expect(packRarityLabel('common')).toBe('Common');
  });

  it('the card plate ships where CARD_PLATE_SRC points', () => {
    expect(CARD_PLATE_SRC).toMatch(/packs\/cosmetic-card-plate\.webp$/);
    expect(existsSync(join(__dirname, '../../../../../apps/web/public/packs/cosmetic-card-plate.webp'))).toBe(true);
  });
});
