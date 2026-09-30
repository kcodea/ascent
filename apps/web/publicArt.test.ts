import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isReferenced, publicArtList } from './publicArt';

/**
 * Art pop-in fix (2026-09-29), the build + hosting half:
 *  - `__PUBLIC_ART__` (what the preload warms from `apps/web/public/`) is DERIVED from the UI source, so it
 *    includes templated names and leaves dead files out;
 *  - the Netlify `_headers` file ships in the build (Vite copies `public/` into `dist/` verbatim) and makes the
 *    hashed build output immutable while the page itself is always re-checked.
 */
const r = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

describe('isReferenced', () => {
  const src = [
    "const a = `${BASE}frames/cardplate-beast.webp`;",
    "const s = (t) => `${BASE}frames/tier-stars-${t}.webp`;",
    "const m = (stat, t) => `${BASE}frames/milestone-${stat}-${t}.webp`;",
    "const k = (id) => `${BASE}medallions/${id}.webp`;",
    "const u = `${BASE}frames/tavernup_tier${n}.webp`;",
  ].join('\n');
  it.each([
    ['frames/cardplate-beast.webp', true], // literal
    ['frames/tier-stars-4.webp', true], // templated suffix
    ['frames/milestone-hp-3.webp', true], // templated middle + suffix
    ['medallions/echo.webp', true], // whole-folder template
    ['frames/tavernup_tier7.webp', true], // templated digit
    ['board169.webp', false], // an old board nothing uses
    ['frames/cardplate-mech.webp', false], // same family, not named anywhere
  ])('%s → %s', (rel, want) => { expect(isReferenced(rel, src)).toBe(want); });
});

describe('the real public folder', () => {
  const list = publicArtList(r('./public'), [r('../../packages/ui/src'), r('./src')]);
  it('includes the card chrome and the templated families, and leaves dead files out', () => {
    for (const must of ['frames/oval-beast.webp', 'frames/tier-stars-1.webp', 'frames/tier-stars-7.webp', 'frames/cardplate-neutral.webp', 'augustfullboard.webp', 'cursors/gauntlet_open.svg']) {
      expect(list, must).toContain(must);
    }
    for (const dead of ['board.jpg', 'board169.webp', 'icon-512.png']) expect(list, dead).not.toContain(dead);
    expect(list.every((p) => !p.includes('\\'))).toBe(true);
  });
});

describe('Netlify _headers', () => {
  const file = r('./public/_headers');
  it('ships in public/ (so it lands at the root of dist/)', () => { expect(existsSync(file)).toBe(true); });
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const rule = (path: string): string => {
    const m = new RegExp(`^${path.replace(/[.*]/g, (c) => `\\${c}`)}\\r?\\n((?:[ \\t]+.*\\r?\\n?)+)`, 'm').exec(text);
    return m?.[1] ?? '';
  };
  it('hashed build output is cached for a year and immutable', () => {
    expect(rule('/assets/*')).toMatch(/Cache-Control: public, max-age=31536000, immutable/);
  });
  it('the page itself is always re-checked, so a deploy reaches returning players', () => {
    expect(rule('/')).toMatch(/Cache-Control: no-cache/);
    expect(rule('/index.html')).toMatch(/Cache-Control: no-cache/);
  });
  it('un-hashed public art is never marked immutable (its filename survives an edit)', () => {
    expect(rule('/frames/*')).toMatch(/max-age=3600/);
    expect(rule('/frames/*')).not.toMatch(/immutable/);
  });
});
