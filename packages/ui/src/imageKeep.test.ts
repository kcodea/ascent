import { describe, expect, it } from 'vitest';
import { createImageKeep, decodedBytes } from './imageKeep';

/** The preloader's decoded-image hold: unbounded on desktop, a bounded LRU on a phone (owner 2026-10-18). */
describe('createImageKeep', () => {
  it('desktop (Infinity) keeps everything', () => {
    const k = createImageKeep<string>(Infinity);
    for (let i = 0; i < 2000; i++) k.set(`u${i}`, 'img', decodedBytes(512, 512));
    expect(k.stats().count).toBe(2000);
    expect(k.stats().evicted).toBe(0);
  });

  it('a budget evicts the least recently used first, and a get refreshes', () => {
    const k = createImageKeep<string>(3 * 100);
    k.set('a', 'A', 100);
    k.set('b', 'B', 100);
    k.set('c', 'C', 100);
    expect(k.get('a')).toBe('A'); // a is now the newest
    k.set('d', 'D', 100);
    expect(k.has('b')).toBe(false);
    expect(k.has('a') && k.has('c') && k.has('d')).toBe(true);
    expect(k.stats()).toMatchObject({ count: 3, bytes: 300, evicted: 1 });
  });

  it('re-holding a key replaces its size; one oversized item is still held', () => {
    const k = createImageKeep<string>(100);
    k.set('a', 'A', 60);
    k.set('a', 'A2', 40);
    expect(k.stats().bytes).toBe(40);
    k.set('big', 'B', 500);
    expect(k.has('big')).toBe(true);
    expect(k.stats().count).toBe(1);
  });

  // R-PERF-LATE-FLAT-01 (2026-11-08, phone late-game hunt): the SAME pictures shown every round must cost the same every
  // round. A working set that fits is decoded once and never evicted again; one that does not fit evicts the same number
  // each round (a flat count), never more as the game goes on, and the hold never grows past its budget.
  it('a fixed working set replayed every round: evictions per round stay flat (zero when it fits)', () => {
    const budget = 48 * 1024 * 1024;
    const card = decodedBytes(256, 256); // a phone card-art copy
    const perRound = (n: number, rounds: number): number[] => {
      const k = createImageKeep<string>(budget);
      const out: number[] = [];
      for (let r = 0; r < rounds; r++) {
        const before = k.stats().evicted;
        for (let i = 0; i < n; i++) if (k.get(`card${i}`) === undefined) k.set(`card${i}`, 'img', card);
        out.push(k.stats().evicted - before);
        expect(k.stats().bytes).toBeLessThanOrEqual(budget);
      }
      return out;
    };
    // A late shop + hand + board (~25 cards) and far more (150) both fit 48 MB at 256 px: nothing is evicted after round 1.
    expect(perRound(25, 14).every((e) => e === 0)).toBe(true);
    expect(perRound(150, 14).every((e) => e === 0)).toBe(true);
    // A set larger than the budget (250 x 256 KB = 62.5 MB) churns, but by the same count every round.
    const churn = perRound(250, 14).slice(1);
    expect(new Set(churn).size).toBe(1);
    expect(churn[0]).toBeLessThanOrEqual(250);
  });

  it('decodedBytes is RGBA', () => {
    expect(decodedBytes(256, 256)).toBe(262144);
    expect(decodedBytes(0, 10)).toBe(0);
  });
});
