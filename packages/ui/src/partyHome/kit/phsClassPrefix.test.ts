/**
 * THE `phs-` PREFIX IS SHARED (final review 2026-11-23): the showcase card (phShowcase.css), the Settings page
 * (pages/phSettings.css) and the crate shop (progression/ph/crateShopPh.css) all name classes `phs-…`. The CSS is global, so
 * a class defined in two of them styles both surfaces (`.phs-row` and `.phs-name` once turned the Play lineup into a grid
 * and the Settings rows into size containers). This tripwire fails when the showcase card defines a class either other file
 * also defines.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** Every class name a stylesheet's selectors use (comments, strings and url() bodies stripped first, so `vellum.webp` or a
 *  decimal never reads as a class). */
export function classNames(css: string): Set<string> {
  const bare = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/url\([^)]*\)/g, '')
    .replace(/(["'])(?:\\.|(?!\1).)*\1/g, '');
  const out = new Set<string>();
  // Only selector text: what precedes each `{`, after the previous `}` or `;` (so declaration values never count).
  for (const m of bare.matchAll(/(?<=^|[{};])\s*([^{};]+)\{/g)) {
    for (const c of m[1]!.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) out.add(c[1]!);
  }
  return out;
}

describe('phs- class names', () => {
  it('reads selectors, not values', () => {
    expect([...classNames('.a .b-c:hover { background: url(x.webp); width: .5em; } /* .d */ @media (x) { .e > .f { } }')].sort())
      .toEqual(['a', 'b-c', 'e', 'f']);
  });
  it('the showcase card defines no class the Settings page or the crate shop defines', () => {
    const mine = classNames(read('./phShowcase.css'));
    expect(mine.has('phs-card')).toBe(true); // the reader found the card's own classes
    for (const other of ['../pages/phSettings.css', '../../progression/ph/crateShopPh.css']) {
      const theirs = classNames(read(other));
      expect(theirs.size, other).toBeGreaterThan(0);
      expect([...mine].filter((c) => theirs.has(c)), other).toEqual([]);
    }
  });
});
