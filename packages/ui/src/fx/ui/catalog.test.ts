import { describe, expect, it } from 'vitest';
import { hueBucketOf, FX_HUES } from './catalog';

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
