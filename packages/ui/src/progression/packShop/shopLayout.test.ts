import { describe, expect, it } from 'vitest';
import { HAND_FAN_MAX, HAND_RECLINE, clampScroll, handPile, handPoseInto, shelfPoseInto, shopLayout, startScroll } from './shopLayout';
import { PACK_BASE_SIZE } from '../packOpening/packFxConfig';

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

describe('the pedestal and the hand keep clear of the bar and the line', () => {
  for (const [w, h] of [[1920, 1080], [1600, 900], [2160, 1080]] as const) {
    it(`at ${w} x ${h}: the pedestal pack sits between the top bar and the counter line`, () => {
      const L = shopLayout(w, h), p = { x: 0, y: 0, h: 0, rot: 0, alpha: 0 };
      shelfPoseInto(p, L, 2, 2);
      expect(p.h).toBeCloseTo(0.46 * h);
      expect(p.y - p.h / 2).toBeGreaterThan(0.1 * h);
      expect(p.y + p.h / 2).toBeLessThanOrEqual(L.lineY - 0.04 * h);
      expect(L.packH).toBeCloseTo(0.72 * L.pedestalH);
    });
    it(`at ${w} x ${h}: every place of a full fan lies wholly below the line (a hand pack is drawn reclined)`, () => {
      const L = shopLayout(w, h), p = { x: 0, y: 0, h: 0, rot: 0, alpha: 0 };
      const hw = (L.handPackH * PACK_BASE_SIZE.w) / PACK_BASE_SIZE.h / 2;
      for (let i = 0; i < HAND_FAN_MAX; i++) {
        handPoseInto(p, L, i, HAND_FAN_MAX);
        // the highest corner of the rotated pack
        const lie = Math.cos((HAND_RECLINE * Math.PI) / 180);
        const top = p.y - (p.h / 2) * lie * Math.cos(p.rot) - hw * Math.abs(Math.sin(p.rot));
        expect(top).toBeGreaterThan(L.lineY);
      }
    });
  }
});

describe('startScroll', () => {
  it('starts the rack on the middle offer', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(startScroll)).toEqual([0, 0, 0, 1, 1, 2, 4]);
  });
});

describe('the packs stand on one line', () => {
  for (const [w, h] of [[1920, 1080], [1600, 900], [2160, 1080]] as const) {
    it(`at ${w} x ${h}: every shelf pack's bottom is on the floor, the pedestal pack's too`, () => {
      const L = shopLayout(w, h), p = { x: 0, y: 0, h: 0, rot: 0, alpha: 0 };
      for (const scroll of [3, 3.4, 2.75]) {
        for (let i = 0; i < 7; i++) {
          shelfPoseInto(p, L, i, scroll);
          expect(p.y + p.h / 2).toBeCloseTo(L.floorY, 6);
        }
      }
      shelfPoseInto(p, L, 3, 3);
      expect(p.y + p.h / 2).toBeCloseTo(L.floorY, 6);
      shelfPoseInto(p, L, 4, 3);
      expect(p.y + p.h / 2).toBeCloseTo(L.floorY, 6);
      expect(L.floorY).toBeLessThan(L.lineY);
    });
  }
});
