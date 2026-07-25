import { describe, expect, it } from 'vitest';
import { sampleCurve } from '../curve';
import {
  advanceSmokeBudget,
  smokeFireComplete,
  smokeMoteAlpha,
  smokePrimitive,
  smokeWithinEmitWindow,
} from './smoke';

// NB: the live WebGL instance (SmokeInstance) can't be built headlessly — it needs a Pixi `Renderer` and a
// GL context, neither of which exists under Vitest/Node. So, exactly like emitter.test.ts, these tests cover
// the PURE helpers (`advanceSmokeBudget`/`smokeMoteAlpha`/`smokeWithinEmitWindow`/`smokeFireComplete`) plus
// the SPECS defaults that define smoke's identity vs the emitter it's modelled on.

describe('smoke param specs', () => {
  it('registers under the id "smoke"', () => {
    expect(smokePrimitive.id).toBe('smoke');
  });

  // The smoke-defining defaults (vs the emitter template): motes RISE, BILLOW OUT, are grey, and composite as
  // opaque-ish haze rather than additive glow. Each of these flipping back to an emitter-style default would
  // silently turn smoke into a grey emitter.
  it('bills out over life: sizeCurve default is the GROW curve [[0,0.3],[1,1]]', () => {
    const spec = smokePrimitive.params.sizeCurve;
    expect(spec.kind).toBe('curve');
    expect(spec.default).toEqual([[0, 0.3], [1, 1]]);
    // Grows: the multiplier at death exceeds the multiplier at birth (the opposite of the emitter's shrink).
    expect(sampleCurve(spec.default, 1)).toBeGreaterThan(sampleCurve(spec.default, 0));
    // Stays within the curve kind's [0,1] multiplier range, so coerceParams doesn't clamp it and
    // validateSpecs stays quiet (a >1 grow needs the vMax follow-up).
    if (spec.kind === 'curve') for (const [, v] of spec.default) expect(v).toBeLessThanOrEqual(1);
  });

  it('composites as haze, not glow: blendMode default is "normal"', () => {
    expect(smokePrimitive.params.blendMode.default).toBe('normal');
  });

  it('rises: gravity default is negative', () => {
    const spec = smokePrimitive.params.gravity;
    expect(spec.kind).toBe('slider');
    expect((spec as { default: number }).default).toBeLessThan(0);
  });

  it('reads as smoke: palette default is the grey rim→core tuple', () => {
    expect(smokePrimitive.params.palette.default).toEqual([0x2a2a32, 0x55555f, 0x88889a, 0xb8b8c8]);
  });

  it('exposes the new spin (+ spinVar) rotation params in the Motion group', () => {
    const keys = Object.keys(smokePrimitive.params);
    expect(keys).toContain('spin');
    expect(keys).toContain('spinVar');
    expect(smokePrimitive.params.spin.group).toBe('Motion');
    expect(smokePrimitive.params.spinVar.group).toBe('Motion');
  });

  // Carries the same shaping/shape/blend/physics surface as the emitter it's modelled on, so a smoke def can
  // reach every knob a burst/emitter can.
  it('exposes the shaping, shape+stretch, blend+glow, and motion-physics params', () => {
    const keys = Object.keys(smokePrimitive.params);
    for (const k of [
      'noiseScale', 'warp', 'scroll', 'erode', 'gain',
      'shape', 'stretchX', 'stretchY', 'blendMode', 'glow',
      'turbulence', 'turbScale', 'emitShape', 'emitRadius', 'inheritVel',
    ]) {
      expect(keys).toContain(k);
    }
  });

  it('turbulence is ON by default (billows) and the source is a soft disc', () => {
    expect((smokePrimitive.params.turbulence as { default: number }).default).toBeGreaterThan(0);
    expect(smokePrimitive.params.emitShape.default).toBe('disc');
  });

  it('exposes a biasCurve defaulting to the flat (no-op) [[0,1],[1,1]]', () => {
    const spec = smokePrimitive.params.biasCurve;
    expect(spec.kind).toBe('curve');
    expect(spec.default).toEqual([[0, 1], [1, 1]]);
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expect(sampleCurve(spec.default, t)).toBe(1);
    }
  });
});

describe('advanceSmokeBudget', () => {
  it('spawns nothing and just accumulates budget below 1 mote', () => {
    const { budget, spawnCount } = advanceSmokeBudget(0, 10, 0.05); // 10/s * 0.05s = 0.5 motes
    expect(spawnCount).toBe(0);
    expect(budget).toBeCloseTo(0.5);
  });

  it('spawns the whole-number part and carries the fractional remainder', () => {
    const { budget, spawnCount } = advanceSmokeBudget(0.8, 10, 0.05); // 0.8 + 0.5 = 1.3
    expect(spawnCount).toBe(1);
    expect(budget).toBeCloseTo(0.3);
  });

  it('is exact over many frames regardless of frame rate (converges to rate * totalTime)', () => {
    let budget = 0;
    let total = 0;
    let elapsed = 0;
    const dtSec = 0.007;
    while (elapsed < 1) {
      const r = advanceSmokeBudget(budget, 40, dtSec);
      budget = r.budget;
      total += r.spawnCount;
      elapsed += dtSec;
    }
    expect(total).toBeGreaterThanOrEqual(Math.floor(40 * elapsed) - 1);
    expect(total).toBeLessThanOrEqual(Math.ceil(40 * elapsed));
  });

  it('a single big step spawns the same total as many small steps summing to the same time', () => {
    const big = advanceSmokeBudget(0, 40, 1); // one full second in one frame
    let budget = 0;
    let total = 0;
    for (let i = 0; i < 100; i++) {
      const r = advanceSmokeBudget(budget, 40, 0.01); // 100 frames of 10ms = 1s
      budget = r.budget;
      total += r.spawnCount;
    }
    expect(total).toBe(big.spawnCount);
  });
});

describe('smokeMoteAlpha', () => {
  it('is 0 at birth and ramps up during the fade-in window', () => {
    expect(smokeMoteAlpha(0, 0.2)).toBeCloseTo(0);
    expect(smokeMoteAlpha(0.1, 0.2)).toBeCloseTo(0.5);
    expect(smokeMoteAlpha(0.2, 0.2)).toBeCloseTo(1);
  });

  it('holds at full alpha in the plateau between fade-in and fade-out', () => {
    expect(smokeMoteAlpha(0.5, 0.2)).toBeCloseTo(1);
  });

  it('is 0 at death and symmetrically ramps down during the fade-out window', () => {
    expect(smokeMoteAlpha(1, 0.2)).toBeCloseTo(0);
    expect(smokeMoteAlpha(0.9, 0.2)).toBeCloseTo(0.5);
    expect(smokeMoteAlpha(0.8, 0.2)).toBeCloseTo(1);
  });

  it('never exceeds 1 or drops below 0 across the whole life range', () => {
    for (let t = 0; t <= 1; t += 0.01) {
      const a = smokeMoteAlpha(t, 0.2);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
    }
  });

  it('does not divide by zero at fadeIn = 0 (the slider minimum)', () => {
    expect(() => smokeMoteAlpha(0.5, 0)).not.toThrow();
    expect(Number.isFinite(smokeMoteAlpha(0.5, 0))).toBe(true);
  });
});

describe('smokeWithinEmitWindow', () => {
  it('is open at t=0 and stays open strictly before the window closes', () => {
    expect(smokeWithinEmitWindow(0, 1500)).toBe(true);
    expect(smokeWithinEmitWindow(1499, 1500)).toBe(true);
  });

  it('closes exactly at (and past) the window boundary', () => {
    expect(smokeWithinEmitWindow(1500, 1500)).toBe(false);
    expect(smokeWithinEmitWindow(1501, 1500)).toBe(false);
    expect(smokeWithinEmitWindow(10_000, 1500)).toBe(false);
  });
});

describe('smokeFireComplete', () => {
  it('is never complete outside one-shot mode, regardless of window/mote state', () => {
    expect(smokeFireComplete(false, 10_000, 1500, 0)).toBe(false);
    expect(smokeFireComplete(false, 0, 1500, 0)).toBe(false);
  });

  it('is not complete while the emission window is still open, even with zero live motes', () => {
    expect(smokeFireComplete(true, 0, 1500, 0)).toBe(false);
    expect(smokeFireComplete(true, 1499, 1500, 0)).toBe(false);
  });

  it('is not complete once the window closes while motes are still alive and fading', () => {
    expect(smokeFireComplete(true, 1500, 1500, 3)).toBe(false);
  });

  it('is complete once the window has closed and every mote has died', () => {
    expect(smokeFireComplete(true, 1500, 1500, 0)).toBe(true);
    expect(smokeFireComplete(true, 5000, 1500, 0)).toBe(true);
  });
});
