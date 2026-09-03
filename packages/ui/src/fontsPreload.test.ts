import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FONT_FACES, fontLoadSpec, preloadFonts } from './fontsPreload';

describe('FONT_FACES', () => {
  it('lists every weight styles.css uses for the UI/title families', () => {
    const css = readFileSync(resolve(__dirname, 'styles.css'), 'utf8');
    const weights = new Set([...css.matchAll(/font-weight:\s*(\d{3})/g)].map((m) => Number(m[1])));
    const outfit = new Set(FONT_FACES.filter((f) => f.family === 'Outfit').map((f) => f.weight));
    for (const w of weights) expect(outfit.has(w), `Outfit ${w}`).toBe(true);
    // The title / curtain announcements ask for Cinzel Decorative 600 (owner ask 2026-08-29); the face is cut
    // in 400/700/900, so 700 is what the browser resolves 600 to and what must be loaded.
    expect(FONT_FACES.some((f) => f.family === 'Cinzel Decorative' && f.weight === 700)).toBe(true);
  });

  it('matches the @fontsource imports wired in apps/web/src/main.tsx', () => {
    const main = readFileSync(resolve(__dirname, '../../../apps/web/src/main.tsx'), 'utf8');
    const slug = (family: string): string => family.toLowerCase().replace(/ /g, '-');
    for (const f of FONT_FACES) {
      expect(main, `${f.family} ${f.weight}`).toContain(`@fontsource/${slug(f.family)}/${f.weight}.css`);
    }
  });

  it('formats a face for document.fonts.load', () => {
    expect(fontLoadSpec({ family: 'Nunito Sans', weight: 700 })).toBe('700 1em "Nunito Sans"');
  });
});

describe('preloadFonts', () => {
  it('resolves immediately without a font API, reporting full progress', async () => {
    const seen: number[] = [];
    await preloadFonts((l, t) => seen.push(l / t), 50, undefined);
    expect(seen).toEqual([1]);
  });

  it('reports per-face progress and resolves when every face loads', async () => {
    const asked: string[] = [];
    const fonts = { load: (s: string): Promise<void> => { asked.push(s); return Promise.resolve(); }, ready: Promise.resolve() };
    let last = 0;
    await preloadFonts((l) => { last = l; }, 50, fonts);
    expect(asked.length).toBe(FONT_FACES.length);
    expect(last).toBe(FONT_FACES.length);
  });

  it('never hangs on a face that never settles (timeout)', async () => {
    const fonts = { load: (): Promise<void> => new Promise(() => {}) };
    const t0 = Date.now();
    await preloadFonts(undefined, 30, fonts);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});
