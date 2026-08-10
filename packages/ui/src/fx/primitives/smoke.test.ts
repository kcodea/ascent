import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sampleCurve } from '../curve';
import type { FxParamSpecs } from '../params';
import { makeRng, type FxRandom } from '../rng';
import {
  advanceSmokeBudget,
  resolveSmokeRotation,
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

  /** See ribbon.test.ts's copy for why every param must carry help — the same gate on smoke's own SPECS. */
  it('gives every param non-empty help text', () => {
    const specs: FxParamSpecs = smokePrimitive.params;
    const missing = Object.keys(specs).filter((key) => (specs[key].help ?? '').trim() === '');
    expect(missing).toEqual([]);
  });

  // The smoke-defining defaults (vs the emitter template): motes RISE, BILLOW OUT, are grey, and composite as
  // opaque-ish haze rather than additive glow. Each of these flipping back to an emitter-style default would
  // silently turn smoke into a grey emitter.
  it('bills out over life: sizeCurve default is the GROW curve [[0,0.3],[1,1.6]] with vMax 2', () => {
    const spec = smokePrimitive.params.sizeCurve;
    expect(spec.kind).toBe('curve');
    expect(spec.default).toEqual([[0, 0.3], [1, 1.6]]);
    // Grows: the multiplier at death exceeds the multiplier at birth (the opposite of the emitter's shrink).
    expect(sampleCurve(spec.default, 1)).toBeGreaterThan(sampleCurve(spec.default, 0));
    // Grows PAST the base size — the whole point of opting into vMax. A default above 1 is only legal (and
    // only survives coerceParams unclamped) because the spec declares a vMax above it; without that this
    // would silently clamp back to 1x and the billow would flatten into a plain ramp-to-base-size.
    if (spec.kind === 'curve') {
      expect(spec.vMax).toBe(2);
      expect(sampleCurve(spec.default, 1)).toBeGreaterThan(1);
      for (const [, v] of spec.default) expect(v).toBeLessThanOrEqual(spec.vMax ?? 1);
    }
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

  // Alpha-over-life curve: same flat-default no-op invariant as biasCurve above. The advance loop multiplies
  // it into `smokeMoteAlpha(t, fadeIn)`, so a flat 1 leaves the built-in fade byte-identical (x * 1 === x).
  it('exposes an alphaCurve curve param defaulting to the flat (no-op) [[0,1],[1,1]]', () => {
    const spec = smokePrimitive.params.alphaCurve;
    expect(spec).toBeDefined();
    expect(spec.kind).toBe('curve');
    expect(spec.default).toEqual([[0, 1], [1, 1]]);
    expect(spec.group).toBe('Style');
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      expect(sampleCurve(spec.default, t)).toBe(1);
    }
  });

  // Orient-to-velocity must default OFF, so smoke keeps its defining slow tumble untouched.
  it('exposes an orientToVelocity toggle defaulting to false (an exact no-op)', () => {
    const spec = smokePrimitive.params.orientToVelocity;
    expect(spec).toBeDefined();
    expect(spec.kind).toBe('toggle');
    expect(spec.default).toBe(false);
    expect(spec.group).toBe('Motion');
  });
});

describe('resolveSmokeRotation', () => {
  it('with the toggle off, advances the tumble exactly as the old inline expression did', () => {
    expect(resolveSmokeRotation(0, 30, -10, false, 2, 0.5)).toBeCloseTo(1);
    expect(resolveSmokeRotation(0.25, 0, 0, false, -4, 0.25)).toBeCloseTo(-0.75);
    // Velocity is irrelevant while off — same prevRot/spin/dt, wildly different velocity, same result.
    expect(resolveSmokeRotation(1, 999, -999, false, 3, 0.1)).toBe(resolveSmokeRotation(1, 0, 0, false, 3, 0.1));
  });

  it('with spin 0 and the toggle off, is an exact identity on the previous rotation', () => {
    expect(resolveSmokeRotation(1.234, 50, 50, false, 0, 0.016)).toBe(1.234);
  });

  it('with the toggle on, points along the velocity and ignores the tumble', () => {
    expect(resolveSmokeRotation(9, 1, 0, true, 100, 0.5)).toBeCloseTo(0); // +x
    expect(resolveSmokeRotation(9, 0, 1, true, 100, 0.5)).toBeCloseTo(Math.PI / 2); // +y (screen: down)
    expect(resolveSmokeRotation(9, -1, 0, true, 100, 0.5)).toBeCloseTo(Math.PI); // -x
    expect(resolveSmokeRotation(9, 0, -1, true, 100, 0.5)).toBeCloseTo(-Math.PI / 2); // rising smoke
    expect(resolveSmokeRotation(0, 300, 300, true, 0, 0.016)).toBeCloseTo(Math.PI / 4);
  });

  it('keeps the previous rotation for a stalled mote instead of snapping to 0 rad', () => {
    expect(resolveSmokeRotation(1.5, 0, 0, true, 5, 0.5)).toBe(1.5);
    expect(resolveSmokeRotation(-2.25, 1e-9, -1e-9, true, 5, 0.5)).toBe(-2.25);
    expect(resolveSmokeRotation(1.5, 0.01, 0, true, 5, 0.5)).toBeCloseTo(0);
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

  // Smoke's half of the claim that let `burst` gain a `fade` param while these two got none: driving the
  // authored fade WIDTH to its own minimum is a genuine OFF. See emitter.test.ts's copy for the reasoning.
  it('collapses to a square envelope at fadeIn 0 — the built-in fade is genuinely OFF', () => {
    for (const t of [0.0001, 0.01, 0.1, 0.5, 0.9, 0.99, 0.9998]) {
      expect(smokeMoteAlpha(t, 0)).toBe(1);
    }
    expect(smokeMoteAlpha(0.05, 0.2)).toBeLessThan(1);
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

/**
 * Seeded randomness. As noted at the top of this file, `SmokeInstance` can't be built headlessly, so the
 * seeding is covered through a pure mirror of `spawnMote`'s draw sequence plus structural assertions over
 * the module source for the parts that live only inside the instance.
 */
const SMOKE_SRC = readFileSync(new URL('./smoke.ts', import.meta.url), 'utf8');

/** The module source with its comments stripped. The prose in these files legitimately NAMES
 *  `Math.random()` (explaining what the seeding replaced), so the regression assertion below has to look at
 *  CODE only or it would fail on its own documentation. */
function codeOf(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}


/** The exact draws `SmokeInstance.spawnMote()` makes, in order — 9 per puff (the emitter's 6 plus spin
 *  jitter, spin sign, and the spawn rotation). The executable statement of the contract in smoke.ts. */
function puffDraws(rand: FxRandom): number[] {
  const bias = rand();
  const spread = rand() * 2 - 1;
  const speedJitter = rand();
  const sizeJitter = rand();
  const spinJitter = rand();
  const spinSign = rand() < 0.5 ? -1 : 1;
  const offsetU = rand();
  const offsetV = rand();
  const rotation = rand() * Math.PI * 2;
  return [bias, spread, speedJitter, sizeJitter, spinJitter, spinSign, offsetU, offsetV, rotation];
}

describe('smoke seeded randomness', () => {
  it('two instances seeded the same draw an identical puff sequence', () => {
    const a = makeRng(31337);
    const b = makeRng(31337);
    const streamA = Array.from({ length: 30 }, () => puffDraws(a));
    const streamB = Array.from({ length: 30 }, () => puffDraws(b));
    expect(streamA).toEqual(streamB);
  });

  it('two instances seeded differently draw a different puff sequence', () => {
    const a = makeRng(1);
    const b = makeRng(2);
    expect(Array.from({ length: 30 }, () => puffDraws(a)))
      .not.toEqual(Array.from({ length: 30 }, () => puffDraws(b)));
  });

  it('tumbles both ways off a seeded source (the spin sign is still a coin flip, not a constant)', () => {
    const r = makeRng(5);
    const signs = Array.from({ length: 200 }, () => puffDraws(r)[5]);
    expect(signs).toContain(-1);
    expect(signs).toContain(1);
  });

  it('builds exactly one seeded source per instance, falling back to a fresh seed when none is given', () => {
    expect(SMOKE_SRC).toContain('this.rand = makeRng(ctx.seed ?? randomSeed())');
    expect(codeOf(SMOKE_SRC).match(/makeRng\(/g)).toHaveLength(1);
  });

  it('has no Math.random() left in the spawn path', () => {
    expect(codeOf(SMOKE_SRC)).not.toContain('Math.random(');
  });

  it('still draws exactly 9 values per puff, in the original order', () => {
    // If this count moves, every previously saved seed replays a different column.
    expect(codeOf(SMOKE_SRC).match(/this\.rand\(\)/g)).toHaveLength(9);
    // The pinned call text tracks the two `this.rand()` draws and their ORDER, which is what a saved
    // seed replays. `squash` was appended after the scratch (2026-08-07) and consumes no randomness, so
    // the stream is untouched — the count assertion above is the half that guards determinism. It was named
    // `emitSquash`, then `squash`, before splitting into the squashX/squashY pair; the call now takes the
    // whole params object rather than nine positional args, which is why the pinned text is short.
    expect(SMOKE_SRC).toContain('emissionOffset(p, this.rand(), this.rand(), this.emitScratch)');
    expect(SMOKE_SRC).toContain('rotation: this.rand() * Math.PI * 2,');
  });
});
