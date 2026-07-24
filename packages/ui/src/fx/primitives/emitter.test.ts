import { describe, expect, it } from 'vitest';
import { validateSpecs } from '../params';
import { advanceEmitBudget, emitterPrimitive, moteAlpha } from './emitter';

describe('emitter param specs', () => {
  it('has no self-contradictory defaults (registration-time invariant)', () => {
    expect(validateSpecs(emitterPrimitive.params)).toEqual([]);
  });

  it('registers under the id "emitter"', () => {
    expect(emitterPrimitive.id).toBe('emitter');
  });
});

describe('advanceEmitBudget', () => {
  it('spawns nothing and just accumulates budget below 1 mote', () => {
    const { budget, spawnCount } = advanceEmitBudget(0, 10, 0.05); // 10/s * 0.05s = 0.5 motes
    expect(spawnCount).toBe(0);
    expect(budget).toBeCloseTo(0.5);
  });

  it('spawns the whole-number part and carries the fractional remainder', () => {
    const { budget, spawnCount } = advanceEmitBudget(0.8, 10, 0.05); // 0.8 + 0.5 = 1.3
    expect(spawnCount).toBe(1);
    expect(budget).toBeCloseTo(0.3);
  });

  it('is exact over many frames regardless of frame rate (converges to rate * totalTime)', () => {
    // 80 motes/sec for 1 simulated second, stepped at a deliberately uneven 7ms per frame.
    let budget = 0;
    let total = 0;
    let elapsed = 0;
    const dtSec = 0.007;
    while (elapsed < 1) {
      const r = advanceEmitBudget(budget, 80, dtSec);
      budget = r.budget;
      total += r.spawnCount;
      elapsed += dtSec;
    }
    // Frame-rate independence: the running total should land within one mote of the exact rate*time,
    // never drifting low the way naive per-frame flooring (dropping the fraction every frame) would.
    expect(total).toBeGreaterThanOrEqual(Math.floor(80 * elapsed) - 1);
    expect(total).toBeLessThanOrEqual(Math.ceil(80 * elapsed));
  });

  it('a single big step spawns the same total as many small steps summing to the same time', () => {
    const big = advanceEmitBudget(0, 80, 1); // one full second in one frame
    let budget = 0;
    let total = 0;
    for (let i = 0; i < 100; i++) {
      const r = advanceEmitBudget(budget, 80, 0.01); // 100 frames of 10ms = 1s
      budget = r.budget;
      total += r.spawnCount;
    }
    expect(total).toBe(big.spawnCount);
  });
});

describe('moteAlpha', () => {
  it('is 0 at birth and ramps up during the fade-in window', () => {
    expect(moteAlpha(0, 0.1)).toBeCloseTo(0);
    expect(moteAlpha(0.05, 0.1)).toBeCloseTo(0.5);
    expect(moteAlpha(0.1, 0.1)).toBeCloseTo(1);
  });

  it('holds at full alpha in the plateau between fade-in and fade-out', () => {
    expect(moteAlpha(0.5, 0.1)).toBeCloseTo(1);
  });

  it('is 0 at death and symmetrically ramps down during the fade-out window', () => {
    expect(moteAlpha(1, 0.1)).toBeCloseTo(0);
    expect(moteAlpha(0.95, 0.1)).toBeCloseTo(0.5);
    expect(moteAlpha(0.9, 0.1)).toBeCloseTo(1);
  });

  it('never exceeds 1 or drops below 0 across the whole life range', () => {
    for (let t = 0; t <= 1; t += 0.01) {
      const a = moteAlpha(t, 0.1);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
    }
  });

  it('does not divide by zero at fadeIn = 0 (the slider minimum)', () => {
    expect(() => moteAlpha(0.5, 0)).not.toThrow();
    expect(Number.isFinite(moteAlpha(0.5, 0))).toBe(true);
  });
});
