import { describe, expect, it } from 'vitest';
import { validateSpecs } from '../params';
import { pushSpineHead, ribbonPrimitive } from './ribbon';
import type { RibbonPoint } from '../ribbonGeometry';

describe('ribbon param specs', () => {
  it('has no self-contradictory defaults (registration-time invariant)', () => {
    expect(validateSpecs(ribbonPrimitive.params)).toEqual([]);
  });

  it('registers under the id "ribbon"', () => {
    expect(ribbonPrimitive.id).toBe('ribbon');
  });
});

describe('pushSpineHead', () => {
  it('adds the new head to the front of the spine', () => {
    const spine: RibbonPoint[] = [{ x: 10, y: 0 }];
    pushSpineHead(spine, { x: 20, y: 0 }, 1000);
    expect(spine[0]).toEqual({ x: 20, y: 0 });
    expect(spine[1]).toEqual({ x: 10, y: 0 });
  });

  it('trims the tail once the accumulated arc length exceeds maxLength', () => {
    // Five points 10px apart, all head-first: total arc length 40px if kept whole.
    const spine: RibbonPoint[] = [
      { x: 30, y: 0 }, { x: 20, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 },
    ];
    pushSpineHead(spine, { x: 40, y: 0 }, 25); // now 5 points, 40px total untrimmed
    // Walking from the new head (40,0): 10 (->30) + 10 (->20) = 20 < 25, + 10 (->10) = 30 >= 25 → keep through that point.
    expect(spine.map((p) => p.x)).toEqual([40, 30, 20, 10]);
  });

  it('keeps at least two points even when maxLength is tiny, so the ribbon never degenerates below drawable', () => {
    const spine: RibbonPoint[] = [{ x: 0, y: 0 }];
    pushSpineHead(spine, { x: 1, y: 0 }, 0.001);
    expect(spine.length).toBeGreaterThanOrEqual(2);
  });

  it('never grows the spine past the hard cap regardless of maxLength', () => {
    const spine: RibbonPoint[] = [];
    // Every new point is right on top of the last (near-zero motion) — arc length never grows, so
    // only the hard cap can bound the array.
    for (let i = 0; i < 500; i++) pushSpineHead(spine, { x: 0, y: 0 }, 1000, 200);
    expect(spine.length).toBeLessThanOrEqual(200);
  });

  it('respects a custom maxPoints cap', () => {
    const spine: RibbonPoint[] = [];
    for (let i = 0; i < 50; i++) pushSpineHead(spine, { x: 0, y: 0 }, 1000, 10);
    expect(spine.length).toBeLessThanOrEqual(10);
  });
});
