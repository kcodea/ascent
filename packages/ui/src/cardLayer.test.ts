import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// RECRUIT CARDS PAINT ONCE (R-PERF-CARD-LAYER-01, perf/card-raster 2026-11-18).
// Each shop and board card is its own compositor layer and the hand is one layer, so a buy / sell / play / refresh
// paints only what changed instead of every card that shared a tile with it (and every static filter on them).
// jsdom does not composite, so this pins the CSS the measurement was taken with: the three selectors, and the three
// things measured WRONG that must not come back (a layer per hand card, `opacity` as the hint, layers for the badges
// or their numbers). The frame numbers are in docs/devlog/2026-11-18-perf-card-raster.md, and
// `scripts/perf-card-raster.mjs` re-measures them.
const css = readFileSync(fileURLToPath(new URL('./styles.css', import.meta.url)), 'utf8');

/** Every flat rule as [selector text, declaration block], comments stripped. */
const rules = (() => {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Array<[string, string]> = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push([m[1]!.trim().replace(/\s+/g, ' '), m[2]!.trim()]);
  return out;
})();
const selectorsOf = (sel: string): string[] => sel.split(',').map((s) => s.trim());
const layerRule = rules.find(([sel]) => selectorsOf(sel).includes(".zone[data-zone='tavern'] .row > .card"));
const hints = rules.filter(([, body]) => /will-change\s*:/.test(body));

describe('recruit cards paint once: a layer per shop / board card, one layer for the hand', () => {
  it('the shop cards, the board cards and the hand zone carry will-change: transform, and nothing else rides that rule', () => {
    expect(layerRule, 'the card layer rule is missing from styles.css').toBeTruthy();
    const [sel, body] = layerRule!;
    expect(selectorsOf(sel)).toEqual([
      ".zone[data-zone='tavern'] .row > .card",
      ".zone[data-zone='warband'] .row > .card",
      ".zone[data-zone='hand']",
    ]);
    // `transform`, never `opacity`: an opacity-hinted card keeps its sub-pixel position and is painted again on every move
    expect(body.replace(/\s+/g, ' ')).toBe('will-change: transform;');
  });

  it('a hand card is never held on a layer of its own (its fan transform resamples the texture: 17 to 21% softer)', () => {
    const offenders = hints.filter(([sel]) => selectorsOf(sel).some((s) => /(\.row\.hand|data-zone='hand'\]).*\.card(:[a-z-]+(\([^)]*\))?)*$/.test(s)));
    expect(offenders.map(([s]) => s)).toEqual([]);
  });

  it('no layer is held for a stat badge or its number (measured: 195 layers instead of 112, every scene slower)', () => {
    const offenders = hints.filter(([sel]) => selectorsOf(sel).some((s) => /\.(badge|atk|hp)$/.test(s) || /\.badge\s*>\s*\.value$/.test(s)));
    expect(offenders.map(([s]) => s)).toEqual([]);
  });
});
