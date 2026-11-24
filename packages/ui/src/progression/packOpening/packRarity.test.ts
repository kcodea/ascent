import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { COSMETIC_RARITIES } from '@game/progression';
import { packRarityLabel, rarityIconSrc } from './packRarity';

describe('packRarity', () => {
  it('has an icon for every code rarity, and the file ships', () => {
    expect(COSMETIC_RARITIES).toEqual(['common', 'rare', 'epic', 'legendary', 'ancient']);
    const pub = join(__dirname, '../../../../../apps/web/public');
    for (const r of COSMETIC_RARITIES) {
      const src = rarityIconSrc(r);
      expect(src).toMatch(new RegExp(`medallions/ascent_rarity_${r}\.webp$`));
      expect(existsSync(join(pub, 'medallions', `ascent_rarity_${r}.webp`))).toBe(true);
    }
    expect(existsSync(join(pub, 'medallions', 'ascent_rarity_secret.webp'))).toBe(true); // future rarity, unused
  });

  it('Ancient reads Ascendant; the rest keep their labels', () => {
    expect(packRarityLabel('ancient')).toBe('Ascendant');
    expect(packRarityLabel('legendary')).toBe('Legendary');
    expect(packRarityLabel('common')).toBe('Common');
  });
});
