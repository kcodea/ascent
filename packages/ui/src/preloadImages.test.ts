import { describe, it, expect } from 'vitest';
import { ALL_IMAGE_URLS, ART_COUNT } from './art';

/** The boot preload set must cover EVERY image the game can show — the pools that used to be left out
 *  (spells, quests, runes, equipment, modes) and every public/ file, not just minions + heroes + powers. */
describe('ALL_IMAGE_URLS (the boot preload set)', () => {
  const has = (frag: string): boolean => ALL_IMAGE_URLS.some((u) => u.includes(frag));

  it('includes a bundled file from every art pool', () => {
    for (const dir of ['minions', 'spells', 'equipment', 'heroes', 'powers', 'quests', 'runes', 'modes']) {
      expect(has(`/art/${dir}/`) || has(`${dir}/`), dir).toBe(true);
    }
  });

  it('includes the public assets that used to pop in', () => {
    for (const p of ['fx/damage-splash-2.png', 'frames/cardplate.webp', 'augustboardcombat.webp', 'cursors/gauntlet_open.svg']) {
      expect(has(p), p).toBe(true);
    }
  });

  it('includes the hero-select portrait (a static import outside every glob)', () => {
    expect(has('heroportrait')).toBe(true);
  });

  it('is deduped, non-empty, and matches ART_COUNT', () => {
    expect(ALL_IMAGE_URLS.length).toBeGreaterThan(1000);
    expect(new Set(ALL_IMAGE_URLS).size).toBe(ALL_IMAGE_URLS.length);
    expect(ART_COUNT).toBe(ALL_IMAGE_URLS.length);
  });
});
