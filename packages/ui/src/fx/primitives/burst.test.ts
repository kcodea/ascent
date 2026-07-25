import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateSpecs } from '../params';
import { sampleCurve } from '../curve';
import { makeRng } from '../rng';
import { burstFireComplete, burstPrimitive, resolveParticleRotation, sampleBurstAngle } from './burst';

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

  // The motion-physics group (turbulence / emit shape / velocity inheritance) must be present alongside the
  // sibling emitter's identical set.
  it('exposes the motion-physics params', () => {
    const keys = Object.keys(burstPrimitive.params);
    for (const k of ['turbulence', 'turbScale', 'emitShape', 'emitRadius', 'inheritVel']) {
      expect(keys).toContain(k);
    }
  });

  // Colour-over-life bias curve: its flat [[0,1],[1,1]] default guards the no-op invariant — every t samples
  // to 1, so effectiveBias = bias0 * 1 = bias0, i.e. the exact spawn tint is recomputed each frame.
  it('exposes a biasCurve curve param defaulting to the flat (no-op) [[0,1],[1,1]]', () => {
    const spec = burstPrimitive.params.biasCurve;
    expect(spec).toBeDefined();
    expect(spec.kind).toBe('curve');
    expect(spec.default).toEqual([[0, 1], [1, 1]]);
    // Flat 1 across life → the multiplier is identity, so bias0 * sampleCurve === bias0 for any t.
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expect(sampleCurve(spec.default, t)).toBe(1);
    }
  });

  // Alpha-over-life curve: same flat-default no-op invariant as biasCurve above. The advance loop multiplies
  // it into the built-in `frac * frac` fade, so a flat 1 leaves that fade byte-identical (x * 1 === x).
  it('exposes an alphaCurve curve param defaulting to the flat (no-op) [[0,1],[1,1]]', () => {
    const spec = burstPrimitive.params.alphaCurve;
    expect(spec).toBeDefined();
    expect(spec.kind).toBe('curve');
    expect(spec.default).toEqual([[0, 1], [1, 1]]);
    expect(spec.group).toBe('Style');
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      expect(sampleCurve(spec.default, t)).toBe(1);
    }
  });

  // Orient-to-velocity must default OFF, so an existing def keeps its spin exactly as before.
  it('exposes an orientToVelocity toggle defaulting to false (an exact no-op)', () => {
    const spec = burstPrimitive.params.orientToVelocity;
    expect(spec).toBeDefined();
    expect(spec.kind).toBe('toggle');
    expect(spec.default).toBe(false);
    expect(spec.group).toBe('Motion');
  });
});

describe('resolveParticleRotation', () => {
  it('with the toggle off, advances the spin exactly as the old inline expression did', () => {
    expect(resolveParticleRotation(0, 100, 0, false, 2, 0.5)).toBeCloseTo(1);
    expect(resolveParticleRotation(0.25, 0, 0, false, -4, 0.25)).toBeCloseTo(-0.75);
    // Velocity is irrelevant while off — same prevRot/spin/dt, wildly different velocity, same result.
    expect(resolveParticleRotation(1, 999, -999, false, 3, 0.1)).toBe(resolveParticleRotation(1, 0, 0, false, 3, 0.1));
  });

  it('with spin 0 and the toggle off, is an exact identity on the previous rotation', () => {
    expect(resolveParticleRotation(1.234, 50, 50, false, 0, 0.016)).toBe(1.234);
  });

  it('with the toggle on, points along the velocity and ignores spin', () => {
    expect(resolveParticleRotation(9, 1, 0, true, 100, 0.5)).toBeCloseTo(0); // +x
    expect(resolveParticleRotation(9, 0, 1, true, 100, 0.5)).toBeCloseTo(Math.PI / 2); // +y (screen: down)
    expect(resolveParticleRotation(9, -1, 0, true, 100, 0.5)).toBeCloseTo(Math.PI); // -x
    expect(resolveParticleRotation(9, 1, 1, true, 100, 0.5)).toBeCloseTo(Math.PI / 4);
    // Magnitude doesn't matter, only direction.
    expect(resolveParticleRotation(0, 300, 300, true, 0, 0.016)).toBeCloseTo(Math.PI / 4);
  });

  it('keeps the previous rotation for a stalled particle instead of snapping to 0 rad', () => {
    // The guard: atan2(0, 0) is 0, which would flick a stopped particle to pointing right.
    expect(resolveParticleRotation(1.5, 0, 0, true, 5, 0.5)).toBe(1.5);
    expect(resolveParticleRotation(-2.25, 1e-9, -1e-9, true, 5, 0.5)).toBe(-2.25);
    // Just above the epsilon it does track the heading again.
    expect(resolveParticleRotation(1.5, 0.01, 0, true, 5, 0.5)).toBeCloseTo(0);
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

/**
 * Seeded randomness. `BurstInstance` itself can't be constructed headlessly (see the note above — its
 * constructor needs a real Renderer), so the seeding is covered from two sides:
 *   - behaviourally, through `sampleBurstAngle`, the one draw site that IS a pure exported helper: a seeded
 *     source must reproduce its angles exactly, and two different seeds must not;
 *   - structurally, over the module source, for the parts that only exist inside the instance — that ONE
 *     `FxRandom` is built per instance from `ctx.seed ?? randomSeed()`, that no `Math.random()` survives in
 *     the spawn path, and that the number of draws per particle is unchanged (so the distributions, and
 *     therefore the statistical look, are the same as before seeding).
 */
const BURST_SRC = readFileSync(new URL('./burst.ts', import.meta.url), 'utf8');

/** The module source with its comments stripped. The prose in these files legitimately NAMES
 *  `Math.random()` (explaining what the seeding replaced), so the regression assertion below has to look at
 *  CODE only or it would fail on its own documentation. */
function codeOf(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}


describe('burst seeded randomness', () => {
  it('reproduces an identical angle sequence for the same seed', () => {
    const a = makeRng(4242);
    const b = makeRng(4242);
    const anglesA = Array.from({ length: 40 }, () => sampleBurstAngle(0.3, 0.6, a));
    const anglesB = Array.from({ length: 40 }, () => sampleBurstAngle(0.3, 0.6, b));
    expect(anglesA).toEqual(anglesB);
  });

  it('gives a genuinely different spray for a different seed', () => {
    const a = makeRng(1);
    const b = makeRng(2);
    const anglesA = Array.from({ length: 40 }, () => sampleBurstAngle(0.3, 0.6, a));
    const anglesB = Array.from({ length: 40 }, () => sampleBurstAngle(0.3, 0.6, b));
    expect(anglesA.filter((v, i) => v === anglesB[i])).toEqual([]);
  });

  it('stays inside the cone whatever the seed feeds it (the seeding changed the source, not the shape)', () => {
    const r = makeRng(77);
    const travel = 1.1;
    const spread = 0.25;
    for (let i = 0; i < 500; i++) {
      const angle = sampleBurstAngle(travel, spread, r);
      expect(Math.abs(angle - travel)).toBeLessThanOrEqual(spread * Math.PI + 1e-12);
    }
  });

  it('builds exactly one seeded source per instance, falling back to a fresh seed when none is given', () => {
    expect(BURST_SRC).toContain('this.rand = makeRng(ctx.seed ?? randomSeed())');
    expect(codeOf(BURST_SRC).match(/makeRng\(/g)).toHaveLength(1);
  });

  it('has no Math.random() left in the spawn path', () => {
    expect(codeOf(BURST_SRC)).not.toContain('Math.random(');
  });

  it('still draws exactly 7 values per particle, in the original order', () => {
    // 6 explicit `this.rand()` draws (speed, size, bias, two emission offsets, spin) plus the source passed
    // BY REFERENCE into sampleBurstAngle (the angle draw) = the same 7 draws the Math.random version made.
    // If this count moves, every previously saved seed replays a different burst.
    expect(codeOf(BURST_SRC).match(/this\.rand\(\)/g)).toHaveLength(6);
    expect(BURST_SRC).toContain('sampleBurstAngle(this.travelAngle, p.spread, this.rand)');
  });
});
