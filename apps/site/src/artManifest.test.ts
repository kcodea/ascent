import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ART_MANIFEST, artSource, DENIED_ART } from './artManifest';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));

describe('art manifest', () => {
  it('every manifest source exists in the repo', () => {
    for (const [key, entry] of Object.entries(ART_MANIFEST)) {
      const src = artSource(entry);
      expect(existsSync(resolve(REPO, src)), `${key} <- ${src}`).toBe(true);
    }
  });
  it('no manifest source matches a denied pattern', () => {
    for (const entry of Object.values(ART_MANIFEST)) for (const re of DENIED_ART) expect(artSource(entry)).not.toMatch(re);
  });
  it('the icons ship and no unused art does (the logo is the owner\'s own file, in public/hero)', () => {
    expect(ART_MANIFEST).not.toHaveProperty('crest.webp');
    expect(ART_MANIFEST).not.toHaveProperty('crest.png');
    expect(ART_MANIFEST).not.toHaveProperty('end-button.webp');
    expect(ART_MANIFEST['icon-192.png']).toBe('apps/web/public/icon-192.png');
    expect(ART_MANIFEST['apple-touch-icon.png']).toBe('apps/web/public/apple-touch-icon.png');
  });
  it('a resized entry names a width and a format', () => {
    for (const [key, entry] of Object.entries(ART_MANIFEST)) {
      if (typeof entry === 'string') continue;
      expect(entry.width, key).toBeGreaterThan(0);
      expect(key.endsWith(`.${entry.format}`), key).toBe(true);
    }
  });
  it('has all six Ancients and all five chest tiers', () => {
    for (const a of ['bonds', 'death', 'fortune', 'genesis', 'time', 'war']) expect(ART_MANIFEST).toHaveProperty(`ancients/${a}.webp`);
    for (const c of ['standard', 'rare', 'epic', 'legendary', 'ancient']) expect(ART_MANIFEST).toHaveProperty(`chests/${c}.webp`);
  });
  it('denies Secret art and non-live Skins rarities', () => {
    const hit = (p: string) => DENIED_ART.some((re) => re.test(p));
    expect(hit('x/Secret/a.webp')).toBe(true);
    expect(hit('Reference/Skins/Mythic/a.webp')).toBe(true);
    expect(hit('Reference/Skins/Epic/a.webp')).toBe(false);
    expect(hit('apps/web/public/homescreen.webp')).toBe(false);
  });
});
