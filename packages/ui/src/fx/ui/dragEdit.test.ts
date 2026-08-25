import { describe, it, expect } from 'vitest';
import { reorderTargetIndex, applyReorder, scrubValue } from './dragEdit';

describe('applyReorder', () => {
  it('moves an item forward', () => {
    expect(applyReorder(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });
  it('moves an item backward', () => {
    expect(applyReorder(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });
  it('returns an unchanged copy when from === to', () => {
    const src = ['a', 'b', 'c'];
    const out = applyReorder(src, 1, 1);
    expect(out).toEqual(src);
    expect(out).not.toBe(src);
  });
  it('returns an unchanged copy for out-of-range indices', () => {
    expect(applyReorder(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });
});

describe('reorderTargetIndex', () => {
  // three rows, each 40px tall, tops at 0, 40, 80
  const tops = [0, 40, 80];
  it('keeps the row in place when the pointer stays over its own band', () => {
    expect(reorderTargetIndex({ fromIndex: 0, count: 3 }, 10, tops)).toBe(0);
  });
  it('moves down when the pointer passes the next row midpoint', () => {
    // row 1 midpoint = 60; pointer at 65 is past it
    expect(reorderTargetIndex({ fromIndex: 0, count: 3 }, 65, tops)).toBe(1);
  });
  it('clamps to the last index', () => {
    expect(reorderTargetIndex({ fromIndex: 0, count: 3 }, 999, tops)).toBe(2);
  });
  it('clamps to zero above the list', () => {
    expect(reorderTargetIndex({ fromIndex: 2, count: 3 }, -50, tops)).toBe(0);
  });
});

describe('scrubValue', () => {
  const drag = { startValue: 10, min: 0, max: 100, step: 1, pxPerStep: 4 };
  it('increments one step per pxPerStep of drag', () => {
    expect(scrubValue(drag, 8, false)).toBe(12);
  });
  it('applies a quarter rate when fine', () => {
    // round((8/4) * 0.25) = round(0.5) = 1 (JS rounds half up) -> 10 + 1*1 = 11, already on the step grid.
    expect(scrubValue(drag, 8, true)).toBe(11);
  });
  it('clamps to max', () => {
    expect(scrubValue(drag, 10000, false)).toBe(100);
  });
  it('clamps to min', () => {
    expect(scrubValue(drag, -10000, false)).toBe(0);
  });
});
