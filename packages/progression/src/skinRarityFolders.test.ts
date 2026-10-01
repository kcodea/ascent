import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COSMETICS } from './cosmetics';

/**
 * SKIN RARITY COMES FROM THE ART FOLDER (owner 2026-10-01: "i also put all these skins into rarity folders which is how
 * i'll do it from now on ... correct their rarities as such"; R-PROG-SKINS-11). Every wired skin's master must sit in
 * `<Minion|Hero> Skins/<Rarity>/` under the owner's art folder, and its catalog rarity must be that folder's. A rarity
 * word in the filename is ignored. The art folder only exists on the owner's machine, so CI skips this check.
 */
const SKINS_ROOT = 'C:/Game Assets/Ascent Art/Skins';
const RARITY_DIRS = { Common: 'common', Rare: 'rare', Epic: 'epic', Legendary: 'legendary' } as const;

describe.skipIf(!existsSync(SKINS_ROOT))('skin rarity = the art folder it sits in', () => {
  const where = new Map<string, { category: string; rarity: string }[]>();
  for (const [category, dir] of [['minion_skin', 'Minion Skins'], ['hero_skin', 'Hero Skins']] as const) {
    for (const [folder, rarity] of Object.entries(RARITY_DIRS)) {
      const full = join(SKINS_ROOT, dir, folder);
      if (!existsSync(full)) continue;
      for (const f of readdirSync(full)) where.set(f, [...(where.get(f) ?? []), { category, rarity }]);
    }
  }
  const skins = COSMETICS.filter((c) => (c.category === 'hero_skin' || c.category === 'minion_skin') && c.assets.master);

  it.each(skins.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const found = where.get(c.assets.master!) ?? [];
    expect(found, `${c.assets.master} must sit in exactly one rarity folder`).toHaveLength(1);
    expect(found[0]!.category).toBe(c.category);
    expect(c.rarity, `${c.id} (${c.assets.master}) is in the ${found[0]!.rarity} folder`).toBe(found[0]!.rarity);
  });
});
