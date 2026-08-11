import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { coerceParams, validateSpecs, type FxParamSpecs } from '../params';
import { sampleCurve } from '../curve';
import { makeRng } from '../rng';
import {
  BURST_AIM_MODES,
  burstFadeEnvelope,
  burstFireComplete,
  burstPrimitive,
  resolveBurstAimAngle,
  resolveParticleRotation,
  sampleBurstAngle,
} from './burst';

describe('burst param specs', () => {
  it('has no self-contradictory defaults (registration-time invariant)', () => {
    expect(validateSpecs(burstPrimitive.params)).toEqual([]);
  });

  it('registers under the id "burst"', () => {
    expect(burstPrimitive.id).toBe('burst');
  });

  /** See ribbon.test.ts's copy for why every param must carry help — the same gate on burst's own SPECS. */
  it('gives every param non-empty help text', () => {
    const specs: FxParamSpecs = burstPrimitive.params;
    const missing = Object.keys(specs).filter((key) => (specs[key].help ?? '').trim() === '');
    expect(missing).toEqual([]);
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
  // it into the built-in fade envelope, so a flat 1 leaves that fade byte-identical (x * 1 === x) — a claim
  // that has to keep holding for the RIGHT reason now that the envelope itself is authored (`fade`).
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
  // The aim pair. `aimMode` MUST default to 'travel' — that is the entire backwards-compatibility story for
  // every def authored before aiming existed (an absent param takes its spec default in `coerceParams`).
  it('exposes an aimMode enum defaulting to travel, and a fixed-only angle slider', () => {
    const aim = burstPrimitive.params.aimMode;
    expect(aim).toBeDefined();
    expect(aim.kind).toBe('enum');
    expect(aim.default).toBe('travel');
    expect(aim.group).toBe('Emit');
    expect(BURST_AIM_MODES).toEqual(['travel', 'fixed', 'sourceToTarget']);

    const angle = burstPrimitive.params.angle;
    expect(angle).toBeDefined();
    expect(angle.kind).toBe('slider');
    expect(angle.group).toBe('Emit');
    // Degrees, screen convention: the range must reach a full turn either way so any direction is authorable.
    if (angle.kind === 'slider') {
      expect(angle.min).toBe(-180);
      expect(angle.max).toBe(180);
    }
    // Only live under `fixed` — the other two modes ignore it entirely.
    expect(angle.enabledWhen).toEqual({ param: 'aimMode', is: 'fixed' });
    // The sign convention is the thing most likely to be got backwards, so the help must SAY which way is up.
    expect(angle.help ?? '').toMatch(/-90 is straight UP/);
  });

  // The concrete form of "every existing def is unaffected": a def whose JSON never mentions aim coerces to
  // `travel`, and `travel` returns the travel angle the primitive always used.
  it('a def that never mentions aim coerces to travel and behaves exactly as before', () => {
    const p = coerceParams(burstPrimitive.params, { count: 10, spread: 0.5 }) as Record<string, unknown>;
    expect(p.aimMode).toBe('travel');
    expect(resolveBurstAimAngle('travel', 1.4, p.angle as number, null)).toBe(1.4);
  });

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

describe('resolveBurstAimAngle', () => {
  it('travel returns the travel angle verbatim, ignoring the authored angle', () => {
    expect(resolveBurstAimAngle('travel', 1.23, 45, null)).toBe(1.23);
    expect(resolveBurstAimAngle('travel', 0, 90, null)).toBe(0);
    // The whole back-compat claim in one line: an unaimed burst's base is exactly what it always was.
    expect(resolveBurstAimAngle('travel', -2.5, 170, null)).toBe(-2.5);
    // …and a delivered source→target aim is equally inert under `travel`. A moment stages source/target for
    // reasons of its own (every `travel`-anchored def does), so this must not leak into an unaimed burst.
    expect(resolveBurstAimAngle('travel', -2.5, 170, 0.75)).toBe(-2.5);
  });

  it('fixed converts the authored degrees to radians, in SCREEN convention (up is negative)', () => {
    expect(resolveBurstAimAngle('fixed', 9, 0, null)).toBeCloseTo(0); // right
    expect(resolveBurstAimAngle('fixed', 9, -90, null)).toBeCloseTo(-Math.PI / 2); // UP
    expect(resolveBurstAimAngle('fixed', 9, 90, null)).toBeCloseTo(Math.PI / 2); // down
    expect(resolveBurstAimAngle('fixed', 9, 180, null)).toBeCloseTo(Math.PI); // left
    // Sanity on the sign: a cone aimed at -90 launches with a NEGATIVE y velocity, i.e. up the screen.
    expect(Math.sin(resolveBurstAimAngle('fixed', 0, -90, null))).toBeLessThan(0);
    // The travel angle is dead under `fixed` — same authored angle, wildly different travel, same answer.
    expect(resolveBurstAimAngle('fixed', 3, -90, null)).toBe(resolveBurstAimAngle('fixed', -3, -90, null));
    // …as is the delivered aim.
    expect(resolveBurstAimAngle('fixed', 3, -90, 2.2)).toBe(resolveBurstAimAngle('fixed', 3, -90, null));
  });

  it('sourceToTarget takes the delivered aim, ignoring both travel and the authored angle', () => {
    expect(resolveBurstAimAngle('sourceToTarget', 9, -90, 1.75)).toBe(1.75);
    expect(resolveBurstAimAngle('sourceToTarget', -9, 33, 0)).toBe(0);
  });

  it('sourceToTarget falls back to TRAVEL when no aim was delivered', () => {
    // `null` covers both degenerate cases at once (never staged; staged coincident) — see the primitive's
    // `setAim`. The fallback is `travel` because that is what a burst with no direction has always done, and
    // it is emphatically NOT 0 rad, which would silently fan every such burst to the right.
    expect(resolveBurstAimAngle('sourceToTarget', 1.23, -90, null)).toBe(1.23);
    expect(resolveBurstAimAngle('sourceToTarget', -2.5, 170, null)).toBe(-2.5);
    expect(resolveBurstAimAngle('sourceToTarget', 1.23, -90, null))
      .toBe(resolveBurstAimAngle('travel', 1.23, -90, null));
  });

  it('draws no randomness at all — a rand passed anywhere near it would be a contract break', () => {
    // `resolveBurstAimAngle` takes no `rand` parameter by design (see its header + the RNG suite below).
    // Its arity is part of that contract: 4 positional args, none of them a function. `aimAngle` is
    // deliberately REQUIRED rather than defaulted, so a new call site cannot forget the channel exists.
    expect(resolveBurstAimAngle).toHaveLength(4);
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
    // The cone's base angle is now a variable (`aim`) rather than `this.travelAngle` directly — but it is
    // computed OUTSIDE the loop by `resolveBurstAimAngle`, which draws nothing. Both halves are asserted:
    // the call shape inside the loop, and that the aim is resolved once per wave rather than per particle.
    expect(codeOf(BURST_SRC)).toContain('sampleBurstAngle(aim, p.spread, this.rand)');
    // Exactly one CALL SITE (the `export function` declaration is the other textual match), and it is
    // outside the `for` loop — one aim per wave, not one per particle.
    expect(codeOf(BURST_SRC).match(/const aim = resolveBurstAimAngle\(/g)).toHaveLength(1);
  });
});

/**
 * THE regression guard for the aim feature: adding `aimMode`/`angle` must not add, remove or reorder a single
 * `rand()` call, or every seed anyone has ever locked replays a different burst.
 *
 * `BurstInstance` can't be built headlessly (see the note above), so this reproduces `emit()`'s per-particle
 * draw sequence exactly — the same seven draws in the same order, with the angle draw made BY REFERENCE
 * through `sampleBurstAngle` — and runs it two ways off the same seed: once with the pre-change base angle
 * (`this.travelAngle`, passed straight in) and once through `resolveBurstAimAngle`, which is what the
 * primitive does now. Identical output means the change is provably invisible to a seeded def.
 */
const SPREAD = 0.6;
const HALF_WIDTH = SPREAD * Math.PI;

/** One particle's slice of `emit()`'s draw sequence: angle, speed, size, bias, the two emission-shape
 *  offsets, then spin. Mirrors the primitive's literals so the arithmetic — not just the count — matches. */
function drawParticle(base: number, rand: () => number): number[] {
  const angle = sampleBurstAngle(base, SPREAD, rand); // 1 (drawn inside sampleBurstAngle, by reference)
  const speed = 260 * (1 + (rand() * 2 - 1) * 0.5); // 2
  const size = Math.max(0.5, 9 * (1 + (rand() * 2 - 1) * 0.5)); // 3
  const bias0 = 0.5 * rand(); // 4
  const ox = rand(); // 5 — emissionOffset's first arg
  const oy = rand(); // 6 — emissionOffset's second arg
  const spin = (rand() * 2 - 1) * 6; // 7
  return [angle, speed, size, bias0, ox, oy, spin];
}

/** N particles' worth of that sequence off ONE seeded stream — i.e. a whole wave. */
function drawWave(base: (travelAngle: number) => number, travelAngle: number, seed: number, n = 30): number[][] {
  const rand = makeRng(seed);
  return Array.from({ length: n }, () => drawParticle(base(travelAngle), rand));
}

describe('burst aim leaves the seeded draw sequence untouched', () => {
  const TRAVEL = 0.85;

  it("aimMode 'travel' reproduces the pre-aim stream byte-for-byte", () => {
    const before = drawWave((t) => t, TRAVEL, 20260730);
    const after = drawWave((t) => resolveBurstAimAngle('travel', t, -90, null), TRAVEL, 20260730);
    expect(after).toEqual(before);
    // …and it stays byte-for-byte with the source→target channel LIVE, which is the new half of the claim:
    // `driveLayerHeads` now delivers an aim to every fire that stages both anchors, i.e. to defs that have
    // nothing to do with this feature. It must be invisible to all of them.
    expect(drawWave((t) => resolveBurstAimAngle('travel', t, -90, 2.75), TRAVEL, 20260730)).toEqual(before);
  });

  it("aimMode 'travel' matches whatever angle the def happens to carry alongside it", () => {
    // A def may set `angle` and leave `aimMode` alone (or flip back to travel mid-tune). The authored angle
    // must be completely inert there — an accidental leak would show up as a rotated cone.
    const before = drawWave((t) => t, TRAVEL, 7);
    const after = drawWave((t) => resolveBurstAimAngle('travel', t, 33, null), TRAVEL, 7);
    expect(after).toEqual(before);
  });

  it('an AIMED burst consumes the identical stream — the cone rotates, the roll does not change', () => {
    const before = drawWave((t) => t, TRAVEL, 99);
    const aimed = drawWave((t) => resolveBurstAimAngle('fixed', t, -90, null), TRAVEL, 99);
    const base = -Math.PI / 2;
    for (let i = 0; i < before.length; i++) {
      // Every non-angle draw is identical...
      expect(aimed[i].slice(1)).toEqual(before[i].slice(1));
      // ...and the angle differs by exactly the rotation of the cone's centre, never by a re-roll.
      expect(aimed[i][0] - before[i][0]).toBeCloseTo(base - TRAVEL, 12);
      // Still inside the authored cone around the NEW centre.
      expect(Math.abs(aimed[i][0] - base)).toBeLessThanOrEqual(HALF_WIDTH + 1e-12);
    }
  });

  it('a sourceToTarget burst consumes the identical stream too — only the cone turns', () => {
    // The same proof for the new mode, and the reason it holds is structural: the aim is resolved once per
    // WAVE by a function that draws nothing, so the seven draws land in the same order with the same values.
    const AIM = -1.1; // radians, as `setAim` would have derived it from the staged pair
    const before = drawWave((t) => t, TRAVEL, 5150);
    const aimed = drawWave((t) => resolveBurstAimAngle('sourceToTarget', t, 0, AIM), TRAVEL, 5150);
    for (let i = 0; i < before.length; i++) {
      expect(aimed[i].slice(1)).toEqual(before[i].slice(1));
      expect(aimed[i][0] - before[i][0]).toBeCloseTo(AIM - TRAVEL, 12);
      expect(Math.abs(aimed[i][0] - AIM)).toBeLessThanOrEqual(HALF_WIDTH + 1e-12);
    }
    // And with no aim delivered it is byte-identical to the pre-aim stream, fallback and all.
    expect(drawWave((t) => resolveBurstAimAngle('sourceToTarget', t, 0, null), TRAVEL, 5150)).toEqual(before);
  });
});

describe('burstFadeEnvelope (the built-in fade, now authored)', () => {
  // THE assertion of this whole change: the default must reproduce the bare `frac * frac` the update loop
  // inlined for the life of the primitive, to the LAST BIT — every shipped def's look rests on it, and
  // `Math.pow` is not required by the spec to agree with a multiply.
  it('is byte-identical to `frac * frac` at its default of 2', () => {
    const spec = burstPrimitive.params.fade;
    expect(spec).toBeDefined();
    expect(spec.kind).toBe('slider');
    expect(spec.default).toBe(2);
    for (let i = 0; i <= 1000; i++) {
      const frac = i / 1000;
      expect(burstFadeEnvelope(frac, 2)).toBe(frac * frac);
    }
  });

  // The capability the owner could not reach before: no built-in fade at all, so the authored Alpha / life
  // curve is the entire opacity envelope.
  it('is OFF at 0 — full opacity for the whole life, including the instant of death', () => {
    for (const frac of [1, 0.75, 0.5, 0.25, 0.01, 0]) {
      expect(burstFadeEnvelope(frac, 0)).toBe(1);
    }
  });

  it('is exactly linear at 1', () => {
    for (const frac of [1, 0.9, 0.5, 0.3, 0]) expect(burstFadeEnvelope(frac, 1)).toBe(frac);
  });

  it('front-loads harder as the exponent rises, and never leaves [0, 1]', () => {
    // Mid-life: a bigger exponent must leave strictly less alpha (0.5 > 0.25 > 0.0625).
    const mid = [0, 1, 2, 4].map((n) => burstFadeEnvelope(0.5, n));
    expect(mid).toEqual([...mid].sort((a, b) => b - a));
    expect(new Set(mid).size).toBe(mid.length);
    for (const n of [0, 0.5, 1, 2, 2.5, 4]) {
      for (let i = 0; i <= 20; i++) {
        const a = burstFadeEnvelope(i / 20, n);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
      }
    }
  });

  it('holds the endpoints for every exponent the slider can reach', () => {
    const spec = burstPrimitive.params.fade as { min: number; max: number; step: number };
    for (let n = spec.min; n <= spec.max + 1e-9; n += spec.step) {
      expect(burstFadeEnvelope(1, n)).toBe(1);                  // birth: nothing faded yet
      expect(burstFadeEnvelope(0, n)).toBe(n <= 0 ? 1 : 0);     // death: gone, unless the fade is off
    }
  });
});

/**
 * SPEED OVER LIFE. The design property worth locking is not the sampling (curve.test.ts owns that) but the
 * INTEGRATION SEMANTICS: the curve scales the distance covered this frame and never touches stored velocity.
 *
 * Scaling `lp.vx/vy` in place would compound — a 0.5 curve would halve the velocity every frame instead of
 * halving this frame's travel, so the shard would decay to a standstill and never recover when the curve
 * came back up. `BurstInstance` can't be built headlessly (see the note above the aim guard), so the loop's
 * ARITHMETIC IS PINNED IN SOURCE, which is the same technique the rand-draw guards use.
 */
describe('burst speed over life', () => {
  it('exposes a speedCurve curve param defaulting to the flat (no-op) [[0,1],[1,1]]', () => {
    const spec = burstPrimitive.params.speedCurve;
    expect(spec).toBeDefined();
    expect(spec.kind).toBe('curve');
    expect(spec.default).toEqual([[0, 1], [1, 1]]);
    expect(spec.group).toBe('Motion');
    // Flat 1 across life → travel = vx * 1 * dt, i.e. exactly the expression the loop had before the curve
    // existed. This is what makes every already-authored def byte-identical.
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      expect(sampleCurve(spec.default, t)).toBe(1);
    }
  });

  it('allows overshoot above 1x, so a shard can lurch rather than only decay', () => {
    expect(burstPrimitive.params.speedCurve.vMax).toBe(2);
  });

  it('scales the POSITION delta on both axes, not the stored velocity', () => {
    const code = codeOf(BURST_SRC);
    expect(code).toContain('particle.x += lp.vx * travel * dtSec');
    expect(code).toContain('particle.y += lp.vy * travel * dtSec');
  });

  /**
   * THE compounding guard, stated as what must never appear rather than as a count: `travel` must never land
   * on a velocity field. `lp.vx *= travel` is the obvious mistake — it type-checks, it renders plausibly, and
   * it turns a per-frame multiplier into an exponential decay, halving the VELOCITY every frame instead of
   * that frame's travel, so a shard could never recover when the curve came back up.
   *
   * Counting occurrences of the identifier does not work here: `travel` is also a burst aim mode and the
   * phrase "direction of travel" appears in help text, which `codeOf` keeps because string literals are code.
   */
  it('never lets the curve reach stored velocity, which would compound', () => {
    expect(codeOf(BURST_SRC)).not.toMatch(/\.v[xy]\s*(?:\*=|\+=|-=|=)[^;\n]*\btravel\b/);
  });

  /** Sampled once per particle per frame, not once per axis — the loop is the hot path. */
  it('samples the curve once per particle per frame', () => {
    expect(codeOf(BURST_SRC).match(/sampleCurve\(p\.speedCurve/g)).toHaveLength(1);
  });
});

/**
 * REVERSE — a gather instead of a spray. Specced in docs/fx-workbench-friction.md as a VISUAL reverse, not a
 * rewind: nothing is rolled back, the spawn is simply placed at the far end of the flight with the velocity
 * negated, and the authored curves are read back to front.
 */
describe('burst reverse', () => {
  it('exposes a reverse toggle defaulting to off', () => {
    const spec = burstPrimitive.params.reverse;
    expect(spec).toBeDefined();
    expect(spec.kind).toBe('toggle');
    expect(spec.default).toBe(false);
    expect(spec.group).toBe('Motion');
  });

  /** Spawn where the flight would have ENDED, then fly the negated velocity back down the same line. */
  it('offsets the spawn by v * life and negates the velocity', () => {
    const code = codeOf(BURST_SRC);
    expect(code).toContain('rev ? this.velScratch.vx * lifeSec : 0');
    expect(code).toContain('rev ? this.velScratch.vy * lifeSec : 0');
    expect(code).toContain('const vx0 = rev ? -this.velScratch.vx : this.velScratch.vx;');
    expect(code).toContain('const vy0 = rev ? -this.velScratch.vy : this.velScratch.vy;');
  });

  /**
   * THE constraint on this feature. `emit()` draws exactly 7 random values per particle in a fixed order, and
   * every saved seed replays against that sequence. Reverse is built entirely from values already drawn — if
   * it ever needs a draw of its own, every previously locked burst changes.
   */
  it('adds no rand() draw, so seeded replays are unaffected', () => {
    expect(codeOf(BURST_SRC).match(/this\.rand\(\)/g)).toHaveLength(6);
  });

  /** Authored curves mirror; the built-in fade does not, or a shard would die at full brightness. */
  it('mirrors the authored curves but leaves the built-in fade forward', () => {
    const code = codeOf(BURST_SRC);
    expect(code).toContain('const curveT = reverse ? 1 - lifeT : lifeT;');
    for (const c of ['speedCurve', 'alphaCurve', 'sizeCurve', 'biasCurve']) {
      expect(code).toContain(`sampleCurve(p.${c}, curveT)`);
    }
    // burstFadeEnvelope still rides `frac`, which is never mirrored.
    expect(code).toContain('burstFadeEnvelope(frac, p.fade)');
  });

  it('points the shard the way it is actually travelling', () => {
    expect(codeOf(BURST_SRC)).toContain('rotation: rev ? angle + Math.PI : angle,');
  });
});
