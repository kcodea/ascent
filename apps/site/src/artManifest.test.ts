import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ART_MANIFEST, DENIED_ART } from './artManifest';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));

describe('art manifest', () => {
  it('every manifest source exists in the repo', () => {
    for (const [key, src] of Object.entries(ART_MANIFEST)) expect(existsSync(resolve(REPO, src)), `${key} <- ${src}`).toBe(true);
  });
  it('no manifest source matches a denied pattern', () => {
    for (const src of Object.values(ART_MANIFEST)) for (const re of DENIED_ART) expect(src).not.toMatch(re);
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
