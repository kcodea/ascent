import { describe, it, expect } from 'vitest';
import { scheduleLands, beatExceedsGap, scheduleDuration, type Recipient } from './land';

/**
 * The traversal schedule — the arithmetic that had been hand-written five times before it lived once.
 *
 * The case that motivated it is `cascade of 2-stacks`: a gilded Frenzied Excavator plays two Rubies on every
 * minion, and one of the five copies had flattened stacks away entirely, so the board under-reported two as
 * one. These tests pin the nesting explicitly.
 */
const rs = (...specs: [string, number][]): Recipient[] => specs.map(([uid, count]) => ({ uid, count }));

describe('scheduleLands', () => {
  it('a cascade of singles walks recipients by gap', () => {
    const out = scheduleLands(rs(['a', 1], ['b', 1], ['c', 1]), { gap: 100 });
    expect(out.map((l) => [l.uid, l.at])).toEqual([['a', 0], ['b', 100], ['c', 200]]);
  });

  /** THE headline case: nested, not flattened. */
  it('a cascade of 2-stacks nests beat inside gap', () => {
    const out = scheduleLands(rs(['a', 2], ['b', 2]), { gap: 100, beat: 50 });
    expect(out.map((l) => [l.uid, l.at])).toEqual([
      ['a', 0], ['a', 50],     // both of a's hits, 50ms apart…
      ['b', 100], ['b', 150],  // …then the sweep moves on
    ]);
  });

  it('reports index and repeat so a caller can vary a hit by its position', () => {
    const out = scheduleLands(rs(['a', 2], ['b', 1]), { gap: 100, beat: 50 });
    expect(out.map((l) => [l.index, l.repeat])).toEqual([[0, 0], [0, 1], [1, 0]]);
  });

  it('gap 0 is a volley — every recipient at once', () => {
    const out = scheduleLands(rs(['a', 1], ['b', 1], ['c', 1]), { gap: 0 });
    expect(out.every((l) => l.at === 0)).toBe(true);
  });

  it('lead delays the whole traversal, leaving room for a tell', () => {
    const out = scheduleLands(rs(['a', 1], ['b', 1]), { gap: 100, lead: 300 });
    expect(out.map((l) => l.at)).toEqual([300, 400]);
  });

  it('speed divides every offset', () => {
    const out = scheduleLands(rs(['a', 2], ['b', 1]), { gap: 100, beat: 50, speed: 2 });
    expect(out.map((l) => l.at)).toEqual([0, 25, 50]);
  });

  /** A paused replay can report speed 0. Dividing by it would put every land at Infinity — i.e. never — so a
   *  non-positive speed is treated as 1 rather than silently swallowing the whole effect. */
  it('treats a non-positive speed as 1 rather than producing Infinity', () => {
    for (const speed of [0, -1]) {
      const out = scheduleLands(rs(['a', 1], ['b', 1]), { gap: 100, speed });
      expect(out.map((l) => l.at)).toEqual([0, 100]);
    }
  });

  it('skips a recipient with no payload', () => {
    const out = scheduleLands(rs(['a', 0], ['b', 2], ['c', -1]), { gap: 100, beat: 50 });
    expect(out.map((l) => l.uid)).toEqual(['b', 'b']);
  });

  /** The index is the RECIPIENT's position, not the surviving-land position — a skipped recipient still
   *  occupies its slot, so the ones after it do not slide earlier and the sweep keeps its rhythm. */
  it('keeps a skipped recipient’s slot in the walk', () => {
    const out = scheduleLands(rs(['a', 0], ['b', 1]), { gap: 100 });
    expect(out).toEqual([{ uid: 'b', index: 1, repeat: 0, at: 100 }]);
  });

  it('is empty for no recipients', () => {
    expect(scheduleLands([], { gap: 100 })).toEqual([]);
  });
});

describe('beatExceedsGap', () => {
  it('flags timing that loses the count', () => {
    expect(beatExceedsGap({ gap: 100, beat: 100 })).toBe(true);
    expect(beatExceedsGap({ gap: 100, beat: 120 })).toBe(true);
  });

  it('passes the shipped Ruby timing', () => {
    expect(beatExceedsGap({ gap: 100, beat: 50 })).toBe(false);
  });

  /** A volley and a single-hit traversal are both legitimate and neither poses the question. */
  it('does not flag a volley or a beatless traversal', () => {
    expect(beatExceedsGap({ gap: 0, beat: 50 })).toBe(false);
    expect(beatExceedsGap({ gap: 100 })).toBe(false);
  });
});

describe('scheduleDuration', () => {
  it('is the last land’s offset', () => {
    expect(scheduleDuration(scheduleLands(rs(['a', 2], ['b', 2]), { gap: 100, beat: 50 }))).toBe(150);
  });

  it('is 0 for an empty schedule', () => {
    expect(scheduleDuration([])).toBe(0);
  });
});
