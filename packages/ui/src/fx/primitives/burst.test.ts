import { describe, expect, it } from 'vitest';
import { validateSpecs } from '../params';
import { burstFireComplete, burstPrimitive, sampleBurstAngle } from './burst';

describe('burst param specs', () => {
  it('has no self-contradictory defaults (registration-time invariant)', () => {
    expect(validateSpecs(burstPrimitive.params)).toEqual([]);
  });

  it('registers under the id "burst"', () => {
    expect(burstPrimitive.id).toBe('burst');
  });

  // Guards against the "I don't see any of the ribbon's options applied to burst/emitter" gap regressing:
  // the ribbon-derived shaping (Texture group), shape/stretch, and blendMode/glow params must actually be
  // present, not just self-consistent (which the invariant test above already covers generically).
  it('exposes the ribbon-derived shaping params, shape+stretch, and blendMode+glow (not the old additive toggle)', () => {
    const keys = Object.keys(burstPrimitive.params);
    for (const k of ['noiseScale', 'warp', 'scroll', 'erode', 'gain', 'shape', 'stretchX', 'stretchY', 'blendMode', 'glow']) {
      expect(keys).toContain(k);
    }
    expect(keys).not.toContain('additive');
  });
});

// Note: the "first wave waits for a real setHead() before emitting" fix (see BurstInstance.update /
// setHead in burst.ts) isn't unit-tested here — that state machine (headSet / firstEmitDone) lives
// entirely inside BurstInstance, which requires a real Renderer to construct (getShapeTexture calls
// renderer.generateTexture in the constructor), so it can't be exercised without a WebGL context. It's
// covered by the coordinator's manual/visual verification instead.

describe('sampleBurstAngle', () => {
  it('spread 1 covers the full circle, ignoring travelAngle', () => {
    expect(sampleBurstAngle(0, 1, () => 0)).toBeCloseTo(0);
    expect(sampleBurstAngle(0, 1, () => 0.5)).toBeCloseTo(Math.PI);
    expect(sampleBurstAngle(0, 1, () => 0.999)).toBeCloseTo(Math.PI * 2 * 0.999);
    // travelAngle is irrelevant at spread 1 — same rand, different travelAngle, same result.
    expect(sampleBurstAngle(1.23, 1, () => 0.25)).toBeCloseTo(sampleBurstAngle(-2, 1, () => 0.25));
  });

  it('spread 0 collapses to exactly travelAngle regardless of rand', () => {
    expect(sampleBurstAngle(0.7, 0, () => 0)).toBeCloseTo(0.7);
    expect(sampleBurstAngle(0.7, 0, () => 1)).toBeCloseTo(0.7);
    expect(sampleBurstAngle(0.7, 0, () => 0.5)).toBeCloseTo(0.7);
  });

  it('spread narrows the cone symmetrically around travelAngle', () => {
    const travel = Math.PI / 2;
    const spread = 0.25; // half-width = spread * PI
    const halfWidth = spread * Math.PI;
    expect(sampleBurstAngle(travel, spread, () => 0)).toBeCloseTo(travel - halfWidth);
    expect(sampleBurstAngle(travel, spread, () => 1)).toBeCloseTo(travel + halfWidth);
    expect(sampleBurstAngle(travel, spread, () => 0.5)).toBeCloseTo(travel);
  });
});

describe('burstFireComplete', () => {
  it('is never complete outside one-shot mode, regardless of fired/live state', () => {
    expect(burstFireComplete(false, true, 0)).toBe(false);
    expect(burstFireComplete(false, false, 0)).toBe(false);
    expect(burstFireComplete(false, true, 5)).toBe(false);
  });

  it('is not complete before the single wave has fired, even with zero live particles', () => {
    // Guards frame-0: before setHead/emit, live is empty but nothing has fired yet.
    expect(burstFireComplete(true, false, 0)).toBe(false);
  });

  it('is not complete while the fired wave still has live particles', () => {
    expect(burstFireComplete(true, true, 1)).toBe(false);
    expect(burstFireComplete(true, true, 40)).toBe(false);
  });

  it('is complete once fired and every particle from the wave has died', () => {
    expect(burstFireComplete(true, true, 0)).toBe(true);
  });
});
