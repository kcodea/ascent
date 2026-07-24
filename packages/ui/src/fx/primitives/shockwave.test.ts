import { describe, expect, it } from 'vitest';
import { validateSpecs } from '../params';
import { shockwaveOneShotDurationSec, shockwavePrimitive } from './shockwave';

describe('shockwave param specs', () => {
  it('has no self-contradictory defaults (registration-time invariant)', () => {
    expect(validateSpecs(shockwavePrimitive.params)).toEqual([]);
  });

  it('registers under the id "shockwave"', () => {
    expect(shockwavePrimitive.id).toBe('shockwave');
  });
});

// The instance's isComplete() is a thin `clockSec >= shockwaveOneShotDurationSec(...)` check over a real
// Mesh/Shader that needs a WebGL context to render, so the completion *timing* is unit-tested here through
// the pure helper it delegates to; the actual single-expansion visual is browser-verified by the
// coordinator.
describe('shockwaveOneShotDurationSec', () => {
  it('matches the closed form (2*rings - 1) / (rings * speed) for the single staggered sweep', () => {
    // rings=1: one ring goes 0->1 over 1/speed seconds.
    expect(shockwaveOneShotDurationSec(1, 1)).toBeCloseTo(1);
    // rings=2, speed=1: last ring starts at t=0.5, finishes at t=1.5.
    expect(shockwaveOneShotDurationSec(2, 1)).toBeCloseTo(1.5);
    // rings=2 at the default speed 0.9.
    expect(shockwaveOneShotDurationSec(2, 0.9)).toBeCloseTo(3 / 1.8);
    // rings=5, speed=2: (2*5-1)/(5*2) = 9/10.
    expect(shockwaveOneShotDurationSec(5, 2)).toBeCloseTo(0.9);
  });

  it('shortens as speed rises (faster expansions finish sooner)', () => {
    expect(shockwaveOneShotDurationSec(3, 2)).toBeLessThan(shockwaveOneShotDurationSec(3, 1));
  });

  it('rounds a fractional ring count to a whole ring, mirroring the shader int(uRings)', () => {
    expect(shockwaveOneShotDurationSec(2.4, 1)).toBeCloseTo(shockwaveOneShotDurationSec(2, 1));
  });

  it('never divides by zero for a degenerate speed', () => {
    expect(Number.isFinite(shockwaveOneShotDurationSec(2, 0))).toBe(true);
  });
});
