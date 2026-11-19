import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// RECRUIT CARDS PAINT ONCE (R-PERF-CARD-LAYER-01, perf/card-raster 2026-11-18).
// Each shop and board card is its own compositor layer and the hand is one layer (plus, since R-PERF-HAND-LAYER-01, a
// supersampled layer inside each hand card), so a buy / sell / play / refresh
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

  it('the hand card ELEMENT is never the layer (its fan transform would resample a 1:1 texture: 24 to 34% softer)', () => {
    const offenders = hints.filter(([sel]) => selectorsOf(sel).some((s) => /(\.row\.hand|data-zone='hand'\]).*\.card(:[a-z-]+(\([^)]*\))?)*$/.test(s)));
    expect(offenders.map(([s]) => s)).toEqual([]);
  });

  // R-PERF-HAND-LAYER-01 (perf/card-raster-2 2026-11-19): the layer is a WRAPPER inside the hand card, rastered at
  // --hand-ss times the card's size and drawn back down, so the fan tilt resamples a larger picture and stays sharp.
  it('a hand card holds its body on a supersampled layer: .card-ssl drawn at 1 / --hand-ss, .card-ss scaled back by --hand-ss', () => {
    const find = (tail: string, prop: RegExp) => rules.find(([sel, body]) => selectorsOf(sel).some((s) => s === `html:not(.lite-art) .row.hand .card > ${tail}`) && prop.test(body));
    const layer = find('.card-ssl', /will-change\s*:/);
    expect(layer, 'the hand layer rule is missing').toBeTruthy();
    const body = layer![1].replace(/\s+/g, ' ');
    expect(body).toContain('will-change: transform');
    expect(body).toContain('transform: scale(calc(1 / var(--hand-ss)))');
    // 1.35: measured closest to a directly painted card (1.25 is softer, 1.5 crisper). Below 1.25 the hand goes soft.
    const ss = Number(/--hand-ss:\s*([0-9.]+)/.exec(body)?.[1]);
    expect(ss).toBeGreaterThanOrEqual(1.25);
    expect(ss).toBeLessThanOrEqual(2);
    const inner = find('.card-ssl > .card-ss', /transform\s*:\s*scale\(var\(--hand-ss\)\)/);
    expect(inner, 'the inner wrapper must scale the body back up by --hand-ss').toBeTruthy();
    // both scale from the same corner, or the two do not cancel and the card moves
    const shared = rules.find(([sel]) => { const ss2 = selectorsOf(sel); return ss2.includes('html:not(.lite-art) .row.hand .card > .card-ssl') && ss2.includes('html:not(.lite-art) .row.hand .card > .card-ssl > .card-ss'); });
    expect(shared?.[1]).toMatch(/transform-origin:\s*0 0/);
  });

  it('the wrappers vanish everywhere else (display: contents), and the hovered card is rastered at its own size', () => {
    const base = rules.find(([sel]) => sel === '.card-ssl, .card-ss');
    expect(base?.[1].replace(/\s+/g, ' ')).toBe('display: contents;');
    const hover = rules.find(([sel]) => selectorsOf(sel).includes('html:not(.lite-art) body:not(.dragging) .row.hand .card:hover > .card-ssl'));
    expect(hover, 'the hover rule is missing').toBeTruthy();
    expect(selectorsOf(hover![0])).toContain('html:not(.lite-art) body:not(.dragging) .row.hand .card:hover > .card-ssl > .card-ss');
    expect(hover![1].replace(/\s+/g, ' ')).toBe('transform: none;');
    // never on a phone: every hand layer rule is gated on html:not(.lite-art)
    const ungated = rules.filter(([sel, body]) => /\.card-ss/.test(sel) && sel !== '.card-ssl, .card-ss' && selectorsOf(sel).some((s) => !s.startsWith('html:not(.lite-art) ')) && body.length > 0);
    expect(ungated.map(([s]) => s)).toEqual([]);
  });

  it('Card.tsx wraps the body in the two wrappers only for a hand card (the caller that passes fanRot)', () => {
    const card = readFileSync(fileURLToPath(new URL('./Card.tsx', import.meta.url)), 'utf8');
    expect(card).toContain('<HandLayer on={fanRot !== undefined}>');
    expect(card).toMatch(/on \? <div className="card-ssl"><div className="card-ss">\{children\}<\/div><\/div> : <>\{children\}<\/>/);
  });

  it('no layer is held for a stat badge or its number (measured: 195 layers instead of 112, every scene slower)', () => {
    const offenders = hints.filter(([sel]) => selectorsOf(sel).some((s) => /\.(badge|atk|hp)$/.test(s) || /\.badge\s*>\s*\.value$/.test(s)));
    expect(offenders.map(([s]) => s)).toEqual([]);
  });
});
