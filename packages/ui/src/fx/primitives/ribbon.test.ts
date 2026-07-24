import { describe, expect, it } from 'vitest';
import { validateSpecs } from '../params';
import { RIBBON_FIRE_GRACE_MS, pushSpineHead, ribbonOneShotComplete, ribbonPrimitive } from './ribbon';
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

describe('ribbonOneShotComplete', () => {
  it('is never complete in continuous mode, however long the head has been idle', () => {
    expect(ribbonOneShotComplete(false, true, 10_000)).toBe(false);
  });

  it('is not complete until the head has been fed at least once (guards a large first-frame dt)', () => {
    // headEverSet false: even a huge msSinceHead must not complete before the effect ever started.
    expect(ribbonOneShotComplete(true, false, 10_000)).toBe(false);
  });

  it('stays incomplete while the head is still being fed (msSinceHead below the grace)', () => {
    expect(ribbonOneShotComplete(true, true, RIBBON_FIRE_GRACE_MS - 1)).toBe(false);
  });

  it('completes once one-shot, the head was fed, and it has been idle for the grace period', () => {
    expect(ribbonOneShotComplete(true, true, RIBBON_FIRE_GRACE_MS)).toBe(true);
    expect(ribbonOneShotComplete(true, true, RIBBON_FIRE_GRACE_MS + 500)).toBe(true);
  });

  it('honours a custom grace period', () => {
    expect(ribbonOneShotComplete(true, true, 40, 50)).toBe(false);
    expect(ribbonOneShotComplete(true, true, 50, 50)).toBe(true);
  });
});
