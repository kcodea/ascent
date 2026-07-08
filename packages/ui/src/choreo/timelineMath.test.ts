import { describe, expect, it } from 'vitest';
import { msToPx, pxToMs, clampOffset, allowsNegative } from './timelineMath';

describe('timelineMath', () => {
  it('msToPx / pxToMs invert over a track window', () => {
    const w = { widthPx: 600, maxMs: 300 };            // 2px per ms
    expect(msToPx(150, w)).toBe(300);
    expect(pxToMs(300, w)).toBe(150);
  });
  it('clampOffset: start anchors clamp >= 0; contact/landed allow negative', () => {
    expect(clampOffset(-50, 'start')).toBe(0);
    expect(clampOffset(-50, 'contact')).toBe(-50);
    expect(clampOffset(-50, 'landed')).toBe(-50);
    expect(clampOffset(80, 'start')).toBe(80);
  });
  it('allowsNegative: start rejects negatives; contact/landed allow them', () => {
    expect(allowsNegative('start')).toBe(false);
    expect(allowsNegative('contact')).toBe(true);
    expect(allowsNegative('landed')).toBe(true);
  });
});
