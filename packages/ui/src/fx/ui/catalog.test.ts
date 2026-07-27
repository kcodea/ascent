import { describe, expect, it } from 'vitest';
import { hueBucketOf, FX_HUES, deriveFacets, bindingsByDef, kindCoverage } from './catalog';
import type { StoredFxDef } from '../defStore';
import { getScore } from '../../choreo/score';
import { CARD_FX } from '../../choreo/cardFx';

describe('hueBucketOf', () => {
  it('buckets the saturated stop of each shipped palette', () => {
    expect(hueBucketOf(0xd41f1f)).toBe('red');
    expect(hueBucketOf(0xff9c1e)).toBe('orange');
    expect(hueBucketOf(0xffb81f)).toBe('gold');
    expect(hueBucketOf(0x7ade22)).toBe('green');
    expect(hueBucketOf(0x2ee0ac)).toBe('cyan');
    expect(hueBucketOf(0x2f8bff)).toBe('blue');
    expect(hueBucketOf(0xc936ef)).toBe('violet');
    expect(hueBucketOf(0xff33a8)).toBe('magenta');
  });

  // THE trap this function exists to avoid. Stop 4 is #ffffff in nearly every def and stop 1 is a near-black
  // rim; both have no usable hue, so bucketing either would make most defs look identical.
  it('calls a colourless value neutral rather than inventing a hue', () => {
    expect(hueBucketOf(0xffffff)).toBe('neutral');
    expect(hueBucketOf(0x000000)).toBe('neutral');
    expect(hueBucketOf(0x808080)).toBe('neutral');
  });

  it('is total for junk input', () => {
    expect(hueBucketOf(Number.NaN)).toBe('neutral');
    expect(hueBucketOf(-1)).toBe('neutral');
  });

  it('FX_HUES lists every bucket the function can return', () => {
    const samples = [0xd41f1f, 0xff9c1e, 0xffb81f, 0x7ade22, 0x2ee0ac, 0x2f8bff, 0xc936ef, 0xff33a8, 0xffffff];
    samples.forEach((n) => expect(FX_HUES).toContain(hueBucketOf(n)));
  });
});

const def = (layers: StoredFxDef['layers']): StoredFxDef => ({ version: 1, id: 'd', duration: 900, layers });
const layer = (primitive: string, over: Partial<StoredFxDef['layers'][number]> = {}) =>
  ({ primitive, anchor: 'source' as const, at: 0, params: {}, ...over });

describe('deriveFacets', () => {
  it('labels the shape from the primitives, in layer order, using the human names', () => {
    const f = deriveFacets(def([layer('shockwave'), layer('burst'), layer('ribbon')]));
    expect(f.shape).toBe('Ring + Burst + Trail');
  });

  it('collapses repeated primitives so three bursts do not read as three things', () => {
    expect(deriveFacets(def([layer('burst'), layer('burst'), layer('burst')])).shape).toBe('Burst');
  });

  it('takes the SECOND palette stop, not the first or last', () => {
    // stop 1 near-black rim, stop 2 the identifying red, stop 4 white.
    const f = deriveFacets(def([layer('burst', { params: { palette: [0x0a0a0a, 0xd41f1f, 0xff8a5c, 0xffffff] } })]));
    expect(f.hue).toBe('red');
  });

  it('uses the most common bucket across layers, ties going to the first layer', () => {
    const f = deriveFacets(def([
      layer('burst', { params: { palette: [0, 0x2f8bff, 0, 0] } }),
      layer('burst', { params: { palette: [0, 0xd41f1f, 0, 0] } }),
      layer('burst', { params: { palette: [0, 0xd41f1f, 0, 0] } }),
    ]));
    expect(f.hue).toBe('red');

    const tied = deriveFacets(def([
      layer('burst', { params: { palette: [0, 0x2f8bff, 0, 0] } }),
      layer('burst', { params: { palette: [0, 0xd41f1f, 0, 0] } }),
    ]));
    expect(tied.hue).toBe('blue');
  });

  it('is neutral when no layer carries a palette at all', () => {
    expect(deriveFacets(def([layer('burst')])).hue).toBe('neutral');
  });

  it('reports motion from the travel anchor', () => {
    expect(deriveFacets(def([layer('burst', { anchor: 'target' })])).motion).toBe('in place');
    expect(deriveFacets(def([layer('burst'), layer('ribbon', { anchor: 'travel' })])).motion).toBe('travels');
  });

  it('survives an empty layer list', () => {
    const f = deriveFacets(def([]));
    expect(f.shape).toBe('');
    expect(f.hue).toBe('neutral');
    expect(f.motion).toBe('in place');
  });
});

describe('bindingsByDef', () => {
  const index = bindingsByDef();

  it('maps a def id to the moment kinds whose cue names it', () => {
    expect(index.get('ward-gained')?.kinds).toContain('shieldGain');
  });

  it('maps a def id to the cards that override to it, with their tribes', () => {
    const ruby = index.get('ruby-lance');
    expect(ruby?.cards.map((c) => c.cardId)).toContain('bloodbinder');
    expect(ruby?.cards.find((c) => c.cardId === 'bloodbinder')?.tribe).toBe('demon');
  });

  it('has no entry for a def nothing binds to', () => {
    expect(index.get('blue-glow-trail')).toBeUndefined();
  });
});

describe('kindCoverage', () => {
  const coverage = kindCoverage();

  it('lists EVERY moment kind, bound or not', () => {
    expect(coverage.length).toBe(Object.keys(getScore()).length);
  });

  it('names the def for a bound kind', () => {
    expect(coverage.find((c) => c.kind === 'shieldGain')?.def).toBe('ward-gained');
  });

  // Gaps are the entire point of the coverage lens.
  it('reports null for a kind with no authored def', () => {
    const gap = coverage.find((c) => c.kind === 'summon');
    expect(gap).toBeDefined();
    expect(gap?.def).toBeNull();
  });
});

/**
 * THE guard. A binding naming a def that does not exist is a silent no-op at runtime (`playDef` returns
 * null and nothing plays), indistinguishable from a binding that was never wired — which is exactly the
 * ambiguity that cost a long debugging session on Bloodbinder.
 */
describe('binding integrity', () => {
  it('every bound def id exists in the registry', async () => {
    await import('../primitives');
    const { listDefs } = await import('../fxDefs');
    const known = new Set(listDefs().map((d) => d.id));
    const missing: string[] = [];
    for (const cues of Object.values(getScore())) {
      for (const c of cues) if (c.ch === 'fxDef' && c.def && !known.has(c.def)) missing.push(c.def);
    }
    for (const [cardId, byKind] of Object.entries(CARD_FX)) {
      for (const b of Object.values(byKind)) if (b && !known.has(b.def)) missing.push(`${cardId}:${b.def}`);
    }
    expect(missing, `bindings naming defs that do not exist: ${missing.join(', ')}`).toEqual([]);
  });
});

import { buildCatalog } from './catalog';

describe('buildCatalog', () => {
  it('returns one entry per registered def, exactly once', async () => {
    await import('../primitives');
    const { listDefs } = await import('../fxDefs');
    const catalog = buildCatalog();
    expect(catalog.length).toBe(listDefs().length);
    expect(new Set(catalog.map((e) => e.def.id)).size).toBe(catalog.length);
  });

  it('carries the derived facets and the bindings on each entry', async () => {
    await import('../primitives');
    const entry = buildCatalog().find((e) => e.def.id === 'ward-gained');
    expect(entry?.facets.shape).toBeTruthy();
    expect(entry?.bindings.kinds).toContain('shieldGain');
  });

  it('gives an unbound def empty bindings rather than undefined', async () => {
    await import('../primitives');
    const entry = buildCatalog().find((e) => e.def.id === 'blue-glow-trail');
    expect(entry?.bindings).toEqual({ kinds: [], cards: [] });
  });

  it('sorts by id so the list is stable between renders', async () => {
    await import('../primitives');
    const ids = buildCatalog().map((e) => e.def.id);
    expect(ids).toEqual([...ids].sort());
  });
});
