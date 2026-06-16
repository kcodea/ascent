import { describe, it, expect } from 'vitest';
import { makeRng } from './rng';

describe('makeRng (mulberry32)', () => {
  it('is reproducible for the same seed', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    const seqA = Array.from({ length: 16 }, () => a.next());
    const seqB = Array.from({ length: 16 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('diverges for different seeds', () => {
    const a = makeRng(1).next();
    const b = makeRng(2).next();
    expect(a).not.toEqual(b);
  });

  it('produces floats in [0, 1)', () => {
    const r = makeRng(7);
    for (let i = 0; i < 2000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int() stays in [0, maxExclusive) and is integral', () => {
    const r = makeRng(123);
    for (let i = 0; i < 2000; i++) {
      const v = r.int(6);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
    }
    expect(r.int(0)).toBe(0);
  });

  it('fork() is deterministic and reproducible across parents', () => {
    const f1 = makeRng(99).fork();
    const f2 = makeRng(99).fork();
    const a = Array.from({ length: 8 }, () => f1.next());
    const b = Array.from({ length: 8 }, () => f2.next());
    expect(a).toEqual(b);
  });

  it('fork() yields a stream independent of the parent', () => {
    const parent = makeRng(5);
    const fork = parent.fork();
    // Advancing the fork must not change the parent's subsequent stream.
    fork.next();
    fork.next();
    const parentNext = parent.next();
    const parentAgain = makeRng(5);
    parentAgain.fork(); // consume the same amount of parent state as above
    expect(parentNext).toEqual(parentAgain.next());
  });
});
