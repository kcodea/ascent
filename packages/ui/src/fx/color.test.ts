import { describe, it, expect } from 'vitest';
import { hsbToNum, numToHsb, numToHex, hexToNum } from './color';

describe('color maths', () => {
  it('round-trips pure red', () => {
    const n = hsbToNum({ h: 0, s: 1, b: 1 });
    expect(n).toBe(0xff0000);
    expect(numToHsb(n)).toEqual({ h: 0, s: 1, b: 1 });
  });
  it('round-trips a mid colour within 1/255', () => {
    const start = { h: 327, s: 0.82, b: 1 };
    const back = numToHsb(hsbToNum(start));
    expect(Math.abs(back.h - start.h)).toBeLessThan(1.5);
    expect(Math.abs(back.s - start.s)).toBeLessThan(0.01);
    expect(back.b).toBeCloseTo(1, 2);
  });
  it('hex <-> num', () => {
    expect(hexToNum('#ff2d95')).toBe(0xff2d95);
    expect(numToHex(0x00ff00)).toBe('#00ff00');
  });
  it('black and white are stable', () => {
    expect(hsbToNum({ h: 0, s: 0, b: 0 })).toBe(0x000000);
    expect(hsbToNum({ h: 0, s: 0, b: 1 })).toBe(0xffffff);
  });
});
