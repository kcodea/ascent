import { describe, expect, it } from 'vitest';
import { makeRng, randomSeed } from './rng';

describe('makeRng', () => {
  it('replays an identical sequence for the same seed (the whole point — a held roll)', () => {
    const a = makeRng(12345);
    const b = makeRng(12345);
    for (let i = 0; i < 200; i++) expect(a()).toBe(b());
  });

  it('gives each closure its own independent state', () => {
    // Draining one stream must not advance the other; both still agree value-for-value afterwards.
    const a = makeRng(7);
    for (let i = 0; i < 50; i++) a();
    const b = makeRng(7);
    const drainedA = makeRng(7);
    for (let i = 0; i < 50; i++) drainedA();
    for (let i = 0; i < 20; i++) expect(a()).toBe(drainedA());
    expect(b()).toBe(makeRng(7)());
  });

  it('produces different sequences for different seeds', () => {
    const a = Array.from({ length: 16 }, makeRng(1));
    const b = Array.from({ length: 16 }, makeRng(2));
    expect(a).not.toEqual(b);
    // Not merely "not identical arrays" — no element should coincide at this length by chance.
    expect(a.filter((v, i) => v === b[i])).toEqual([]);
  });

  it('always returns a uniform value in [0, 1)', () => {
    for (const seed of [0, 1, -1, 12345, 2 ** 31 - 1, -(2 ** 31)]) {
      const r = makeRng(seed);
      for (let i = 0; i < 500; i++) {
        const v = r();
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });

  it('is roughly uniform (a smoke test that the bit-mixing is not degenerate)', () => {
    const r = makeRng(99);
    const buckets = new Array<number>(10).fill(0);
    const n = 20000;
    for (let i = 0; i < n; i++) buckets[Math.floor(r() * 10)]++;
    for (const count of buckets) expect(count).toBeGreaterThan(n / 10 * 0.85);
  });

  // The golden pin. mulberry32 is the algorithm `packages/core/src/rng.ts` runs, and these are the exact
  // values it produces — so an accidental edit to the mixing constants (or a swap to a different PRNG)
  // fails here loudly instead of silently invalidating every seed an author has saved.
  it('matches the pinned mulberry32 golden sequence for seed 12345', () => {
    const r = makeRng(12345);
    expect([r(), r(), r(), r(), r()]).toEqual([
      0.9797282677609473,
      0.3067522644996643,
      0.484205421525985,
      0.817934412509203,
      0.5094283693470061,
    ]);
  });

  it('matches the pinned golden sequence for seed 0 (the seed most likely to be special-cased by mistake)', () => {
    const r = makeRng(0);
    expect([r(), r(), r()]).toEqual([
      0.26642920868471265,
      0.0003297457005828619,
      0.2232720274478197,
    ]);
  });

  it('treats the seed as a 32-bit integer (|0), so equivalent seeds give equivalent streams', () => {
    expect(makeRng(5)()).toBe(makeRng(5.9)());
    expect(makeRng(5)()).toBe(makeRng(2 ** 32 + 5)());
  });
});

describe('randomSeed', () => {
  it('returns an unsigned 32-bit integer', () => {
    for (let i = 0; i < 200; i++) {
      const s = randomSeed();
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(4294967296);
    }
  });

  it('varies (an unseeded primitive still gets a fresh roll per instance, as before)', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 100; i++) seen.add(randomSeed());
    expect(seen.size).toBeGreaterThan(90);
  });

  it('feeds makeRng usefully — two fresh seeds give different streams', () => {
    const a = makeRng(randomSeed());
    const b = makeRng(randomSeed());
    expect(Array.from({ length: 8 }, a)).not.toEqual(Array.from({ length: 8 }, b));
  });
});
