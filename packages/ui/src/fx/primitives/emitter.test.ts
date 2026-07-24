import { describe, expect, it } from 'vitest';
import { validateSpecs } from '../params';
import { sampleCurve } from '../curve';
import { advanceEmitBudget, emitterFireComplete, emitterPrimitive, moteAlpha, withinEmitWindow } from './emitter';

describe('emitter param specs', () => {
  it('has no self-contradictory defaults (registration-time invariant)', () => {
    expect(validateSpecs(emitterPrimitive.params)).toEqual([]);
  });

  it('registers under the id "emitter"', () => {
    expect(emitterPrimitive.id).toBe('emitter');
  });

  // Guards against the "I don't see any of the ribbon's options applied to burst/emitter" gap regressing —
  // see burst.test.ts's identical check for the sibling primitive.
  it('exposes the ribbon-derived shaping params, shape+stretch, and blendMode+glow (not the old additive toggle)', () => {
    const keys = Object.keys(emitterPrimitive.params);
    for (const k of ['noiseScale', 'warp', 'scroll', 'erode', 'gain', 'shape', 'stretchX', 'stretchY', 'blendMode', 'glow']) {
      expect(keys).toContain(k);
    }
    expect(keys).not.toContain('additive');
  });

  // The motion-physics group (turbulence / emit shape / velocity inheritance) must be present alongside the
  // sibling burst's identical set.
  it('exposes the motion-physics params', () => {
    const keys = Object.keys(emitterPrimitive.params);
    for (const k of ['turbulence', 'turbScale', 'emitShape', 'emitRadius', 'inheritVel']) {
      expect(keys).toContain(k);
    }
  });

  // Colour-over-life bias curve: its flat [[0,1],[1,1]] default guards the no-op invariant — every t samples
  // to 1, so effectiveBias = bias0 * 1 = bias0, i.e. the exact spawn tint is recomputed each frame.
  it('exposes a biasCurve curve param defaulting to the flat (no-op) [[0,1],[1,1]]', () => {
    const spec = emitterPrimitive.params.biasCurve;
    expect(spec).toBeDefined();
    expect(spec.kind).toBe('curve');
    expect(spec.default).toEqual([[0, 1], [1, 1]]);
    // Flat 1 across life → the multiplier is identity, so bias0 * sampleCurve === bias0 for any t.
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expect(sampleCurve(spec.default, t)).toBe(1);
    }
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

describe('withinEmitWindow', () => {
  it('is open at t=0 and stays open strictly before the window closes', () => {
    expect(withinEmitWindow(0, 700)).toBe(true);
    expect(withinEmitWindow(699, 700)).toBe(true);
  });

  it('closes exactly at (and past) the window boundary', () => {
    expect(withinEmitWindow(700, 700)).toBe(false);
    expect(withinEmitWindow(701, 700)).toBe(false);
    expect(withinEmitWindow(10_000, 700)).toBe(false);
  });
});

describe('emitterFireComplete', () => {
  it('is never complete outside one-shot mode, regardless of window/mote state', () => {
    expect(emitterFireComplete(false, 10_000, 700, 0)).toBe(false);
    expect(emitterFireComplete(false, 0, 700, 0)).toBe(false);
  });

  it('is not complete while the emission window is still open, even with zero live motes', () => {
    // Guards frame-0: window just opened, no motes spawned yet.
    expect(emitterFireComplete(true, 0, 700, 0)).toBe(false);
    expect(emitterFireComplete(true, 699, 700, 0)).toBe(false);
  });

  it('is not complete once the window closes while motes are still alive and fading', () => {
    expect(emitterFireComplete(true, 700, 700, 3)).toBe(false);
  });

  it('is complete once the window has closed and every mote has died', () => {
    expect(emitterFireComplete(true, 700, 700, 0)).toBe(true);
    expect(emitterFireComplete(true, 5000, 700, 0)).toBe(true);
  });
});
