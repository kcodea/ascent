import { describe, expect, it } from 'vitest';
import { hueBucketOf, FX_HUES, deriveFacets } from './catalog';
import type { StoredFxDef } from '../defStore';

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
