import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COSMETICS } from './cosmetics';

/**
 * SKIN RARITY COMES FROM THE ART FOLDER (owner 2026-10-01: "i also put all these skins into rarity folders which is how
 * i'll do it from now on ... correct their rarities as such"; R-PROG-SKINS-11). Every wired skin's master must sit in
 * `<Minion|Hero> Skins/<Rarity>/` under the owner's art folder, and its catalog rarity must be that folder's. A rarity
 * word in the filename is ignored. The art folder only exists on the owner's machine, so CI skips this check.
 *
 * And the other way round (owner 2026-10-01: "i added a bunch of art/portrait arts etc, can you make sure all get
 * added"): every image in a Hero, Minion or Spell Skins rarity folder must be wired as a catalog skin, so art the owner
 * drops in can never sit there unwired. (Spell skins have no catalog category yet, so a file there fails this check
 * until one exists.)
 *
 * A machine may hold only SOME masters (Mike's folder starts empty; the shipped art already lives in the repo as webp),
 * so a skin whose master is not on disk here is not checked. One that IS must sit in exactly one rarity folder.
 */
const SKINS_ROOT = 'C:/Game Assets/Ascent Art/Skins';
const RARITY_DIRS = { Common: 'common', Rare: 'rare', Epic: 'epic', Legendary: 'legendary', Ancient: 'ancient' } as const;

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
    if (found.length === 0) return; // not on this machine
    expect(found, `${c.assets.master} must sit in exactly one rarity folder`).toHaveLength(1);
    expect(found[0]!.category).toBe(c.category);
    expect(c.rarity, `${c.id} (${c.assets.master}) is in the ${found[0]!.rarity} folder`).toBe(found[0]!.rarity);
  });

  it('every image in a skin rarity folder is wired as a catalog skin', () => {
    const wired = new Set(skins.map((c) => c.assets.master));
    const unwired: string[] = [];
    for (const dir of ['Hero Skins', 'Minion Skins', 'Spell Skins']) {
      for (const folder of Object.keys(RARITY_DIRS)) {
        const full = join(SKINS_ROOT, dir, folder);
        if (!existsSync(full)) continue;
        for (const f of readdirSync(full)) if (/\.(png|jpe?g|webp)$/i.test(f) && !wired.has(f)) unwired.push(`${dir}/${folder}/${f}`);
      }
    }
    expect(unwired).toEqual([]);
  });
});
