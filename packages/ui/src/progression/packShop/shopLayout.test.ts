import { describe, expect, it } from 'vitest';
import { clampScroll, handPile, handPoseInto, nearestIndex, shelfPoseInto, shopLayout } from './shopLayout';

describe('shopLayout', () => {
  it('five slots are in view: the centre one is the pedestal, larger, and the outer ones fade', () => {
    const L = shopLayout(1920, 1080), p = { x: 0, y: 0, h: 0, rot: 0, alpha: 0 };
    expect(shelfPoseInto(p, L, 3, 3).x).toBeCloseTo(960);
    expect(shelfPoseInto(p, L, 3, 3).h).toBe(L.pedestalH);
    expect(shelfPoseInto(p, L, 4, 3).h).toBeLessThan(L.pedestalH);
    expect(shelfPoseInto(p, L, 5, 3).alpha).toBe(1);
    expect(shelfPoseInto(p, L, 6, 3).alpha).toBe(0);
  });
  it('the zones are ordered top to bottom and the scroll is clamped', () => {
    const L = shopLayout(1920, 1080);
    expect(L.shelfY).toBeLessThan(L.lineY); expect(L.lineY).toBeLessThan(L.handY);
    expect(clampScroll(-2, 6)).toBe(0); expect(clampScroll(9, 6)).toBe(5); expect(clampScroll(3, 0)).toBe(0);
  });
  it('the hand fans up to seven and piles the rest', () => {
    expect(handPile(0)).toEqual({ shown: 0, piled: 0 });
    expect(handPile(7)).toEqual({ shown: 7, piled: 0 });
    expect(handPile(30)).toEqual({ shown: 6, piled: 24 }); // the seventh place is the pile
  });
  it('a fanned hand is symmetric about the centre and leans outward', () => {
    const L = shopLayout(1920, 1080), a = { x: 0, y: 0, h: 0, rot: 0, alpha: 0 }, b = { ...a };
    handPoseInto(a, L, 0, 5); handPoseInto(b, L, 4, 5);
    expect(a.x + b.x).toBeCloseTo(1920); expect(a.rot).toBeCloseTo(-b.rot); expect(a.rot).toBeLessThan(0);
  });
});

describe('nearestIndex', () => {
  it('finds the offer under an x, inverting the shelf poses', () => {
    const L = shopLayout(1920, 1080), p = { x: 0, y: 0, h: 0, rot: 0, alpha: 0 };
    for (const i of [1, 2, 3, 4, 5]) expect(nearestIndex(L, 3, shelfPoseInto(p, L, i, 3).x)).toBe(i);
  });
});
