import { describe, expect, it } from 'vitest';
import { isTap, TAP_SLOP } from './touchInput';

describe('touch tap slop', () => {
  it('a finger wobble inside the slop is a tap, past it a drag', () => {
    expect(isTap(100, 100, 100, 100)).toBe(true);
    expect(isTap(100, 100, 106, 106)).toBe(true);          // ~8.5px: a normal fingertip wobble
    expect(isTap(100, 100, 100 + TAP_SLOP + 1, 100)).toBe(false);
    expect(isTap(0, 0, 3, 4, 5)).toBe(true);
    expect(isTap(0, 0, 3, 4, 4.9)).toBe(false);
  });
});
