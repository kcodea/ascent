// @vitest-environment jsdom
/**
 * THE TUNED LOOK SHIPS (R-PRESENT-TUNED-01). A config module that pushes its tuned defaults to CSS when it loads (a
 * top-level `apply…()` call) must be imported by something a PRODUCTION build loads, not only by its DEV tuner panel
 * or `tunerAll.ts` (both are DEV-only since #2151). When one was not, its look silently reverted to the stylesheet's
 * fallbacks for players: on 2026-10-19 the mechanic medallion's CSS backing circle came back on every card.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = __dirname;
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === 'node_modules' ? [] : walk(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}
const FILES = walk(SRC);
const text = new Map(FILES.map((f) => [f, readFileSync(f, 'utf8')]));
/** A DEV-only importer: a tuner panel, or the panel registry. */
const devOnly = (f: string): boolean => /Tuner\.tsx$/.test(f) || /[\\/]tunerAll\.ts$/.test(f);
/** Modules that apply their look the moment they load. */
const SELF_APPLYING = FILES.filter((f) => /^(void )?apply[A-Za-z]*\(\);?\s*$/m.test(text.get(f)!));

describe('the tuned look ships (R-PRESENT-TUNED-01)', () => {
  it('finds the self-applying config modules (the scan is alive)', () => {
    expect(SELF_APPLYING.map((f) => relative(SRC, f).replace(/\\/g, '/'))).toContain('medallionConfig.ts');
    expect(SELF_APPLYING.length).toBeGreaterThan(20);
  });

  it('every one is imported by a module that is not a DEV tuner', () => {
    const orphans = SELF_APPLYING.filter((f) => {
      const base = f.replace(/\\/g, '/').split('/').pop()!.replace(/\.tsx?$/, '');
      const ref = new RegExp(`from '[./]*(?:[\\w-]+/)*${base}'|import '[./]*(?:[\\w-]+/)*${base}'`);
      return !FILES.some((g) => g !== f && !devOnly(g) && ref.test(text.get(g)!));
    }).map((f) => relative(SRC, f).replace(/\\/g, '/'));
    expect(orphans, 'add these to tunedDefaults.ts').toEqual([]);
  });

  it('Game.tsx loads tunedDefaults, and the DEV menu stays DEV-only', () => {
    const game = text.get(join(SRC, 'Game.tsx'))!;
    expect(game).toMatch(/^import '\.\/tunedDefaults';$/m);
    expect(game).not.toMatch(/^import .*'\.\/DevMenu'/m);
  });

  it('with the defaults loaded, the medallion has no CSS backing circle', async () => {
    document.documentElement.classList.remove('cgem-nobg');
    await import('./tunedDefaults');
    expect(document.documentElement.classList.contains('cgem-nobg')).toBe(true);
    const { MEDALLION_DEFAULTS } = await import('./medallionConfig');
    expect(MEDALLION_DEFAULTS.circleOn).toBe(0);
  });
});
