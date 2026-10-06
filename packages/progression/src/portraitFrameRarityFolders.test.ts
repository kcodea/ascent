import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COSMETICS } from './cosmetics';

/**
 * PORTRAIT FRAME RARITY COMES FROM THE ART FOLDER (owner 2026-10-01: the frames now sit in
 * `C:/Game Assets/Ascent Art/Skins/Portraits/<Common|Rare|Epic|Legendary|Ancient>/`, and the folder is the rarity, which is how
 * the owner will sort them from now on; R-PROG-FRAME-04). Mirrors skinRarityFolders.test.ts.
 *
 * Two halves:
 *  - the catalog half runs EVERYWHERE (CI included): each frame's `assets.master` names its rarity folder, and that
 *    folder is the frame's catalog rarity;
 *  - the disk half only runs where the owner's art folder exists (it skips in CI): every master really sits in that
 *    folder and in no other, and every PNG in the five rarity folders (Ancient joined 2026-10-02) is wired, so a newly added frame cannot be missed.
 *    A machine may hold only SOME masters (the shipped art already lives in the repo as webp), so a frame whose master
 *    is not on disk here is not checked.
 */
const PORTRAITS = 'C:/Game Assets/Ascent Art/Skins/Portraits';
const RARITY_DIRS = { Common: 'common', Rare: 'rare', Epic: 'epic', Legendary: 'legendary', Ancient: 'ancient' } as const;
const FRAMES = COSMETICS.filter((c) => c.category === 'portrait_frame');

describe('portrait frame rarity = its master\'s rarity folder (catalog)', () => {
  it.each(FRAMES.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const folder = c.assets.master?.split('/')[0];
    expect(Object.keys(RARITY_DIRS), `${c.id} master ${c.assets.master} must sit in a rarity folder`).toContain(folder);
    expect(c.rarity, `${c.id} (${c.assets.master})`).toBe(RARITY_DIRS[folder as keyof typeof RARITY_DIRS]);
  });
});

describe.skipIf(!existsSync(PORTRAITS))('portrait frame rarity = the art folder it sits in (disk)', () => {
  const where = new Map<string, string[]>();
  for (const [folder, rarity] of Object.entries(RARITY_DIRS)) {
    const full = join(PORTRAITS, folder);
    if (!existsSync(full)) continue;
    for (const f of readdirSync(full)) if (/\.png$/i.test(f)) where.set(f, [...(where.get(f) ?? []), rarity]);
  }

  it.each(FRAMES.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const file = c.assets.master!.split('/').pop()!;
    const found = where.get(file) ?? [];
    if (found.length === 0) return; // not on this machine
    expect(found, `${file} must sit in exactly one rarity folder`).toHaveLength(1);
    expect(c.rarity, `${c.id} (${file}) is in the ${found[0]} folder`).toBe(found[0]);
  });

  it('every frame master in the rarity folders is wired', () => {
    const wired = new Set(FRAMES.map((c) => c.assets.master!.split('/').pop()!));
    expect([...where.keys()].filter((f) => !wired.has(f))).toEqual([]);
  });
});
