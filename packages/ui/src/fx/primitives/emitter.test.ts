import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateSpecs, type FxParamSpecs } from '../params';
import { sampleCurve } from '../curve';
import { makeRng, type FxRandom } from '../rng';
import {
  advanceEmitBudget,
  emitterFireComplete,
  emitterPrimitive,
  emitterStoppedComplete,
  moteAlpha,
  resolveEmitterRotation,
  withinEmitWindow,
} from './emitter';

describe('emitter param specs', () => {
  it('has no self-contradictory defaults (registration-time invariant)', () => {
    expect(validateSpecs(emitterPrimitive.params)).toEqual([]);
  });

  it('registers under the id "emitter"', () => {
    expect(emitterPrimitive.id).toBe('emitter');
  });

  /** See ribbon.test.ts's copy for why every param must carry help — the same gate on emitter's own SPECS. */
  it('gives every param non-empty help text', () => {
    const specs: FxParamSpecs = emitterPrimitive.params;
    const missing = Object.keys(specs).filter((key) => (specs[key].help ?? '').trim() === '');
    expect(missing).toEqual([]);
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

  // Alpha-over-life curve: same flat-default no-op invariant as biasCurve above. The advance loop multiplies
  // it into `moteAlpha(t, fadeIn)`, so a flat 1 leaves the built-in fade byte-identical (x * 1 === x).
  it('exposes an alphaCurve curve param defaulting to the flat (no-op) [[0,1],[1,1]]', () => {
    const spec = emitterPrimitive.params.alphaCurve;
    expect(spec).toBeDefined();
    expect(spec.kind).toBe('curve');
    expect(spec.default).toEqual([[0, 1], [1, 1]]);
    expect(spec.group).toBe('Style');
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      expect(sampleCurve(spec.default, t)).toBe(1);
    }
  });

  // Orient-to-velocity must default OFF, so an existing def keeps its (spawn-fixed) rotation as before.
  it('exposes an orientToVelocity toggle defaulting to false (an exact no-op)', () => {
    const spec = emitterPrimitive.params.orientToVelocity;
    expect(spec).toBeDefined();
    expect(spec.kind).toBe('toggle');
    expect(spec.default).toBe(false);
    expect(spec.group).toBe('Motion');
  });
});

describe('resolveEmitterRotation', () => {
  // The emitter always passes spinRad = 0 (it has no spin channel), so the toggle-off branch must be an
  // exact identity on the mote's spawn rotation — that's what makes the `false` default a byte-identical
  // no-op against the old loop, which never wrote `rotation` at all.
  it('with the toggle off and the emitter\'s spin of 0, returns the previous rotation exactly', () => {
    expect(resolveEmitterRotation(0, 40, -10, false, 0, 0.016)).toBe(0);
    expect(resolveEmitterRotation(2.5, 0, 0, false, 0, 0.5)).toBe(2.5);
    expect(resolveEmitterRotation(-1.75, 999, 999, false, 0, 1)).toBe(-1.75);
  });

  it('with the toggle off and a non-zero spin, advances it (kept for parity with burst/smoke)', () => {
    expect(resolveEmitterRotation(0, 0, 0, false, 2, 0.5)).toBeCloseTo(1);
  });

  it('with the toggle on, points along the velocity and ignores spin', () => {
    expect(resolveEmitterRotation(9, 1, 0, true, 100, 0.5)).toBeCloseTo(0); // +x
    expect(resolveEmitterRotation(9, 0, 1, true, 100, 0.5)).toBeCloseTo(Math.PI / 2); // +y (screen: down)
    expect(resolveEmitterRotation(9, -1, 0, true, 100, 0.5)).toBeCloseTo(Math.PI); // -x
    expect(resolveEmitterRotation(0, 300, 300, true, 0, 0.016)).toBeCloseTo(Math.PI / 4);
  });

  it('keeps the previous rotation for a stalled mote instead of snapping to 0 rad', () => {
    expect(resolveEmitterRotation(1.5, 0, 0, true, 0, 0.5)).toBe(1.5);
    expect(resolveEmitterRotation(-2.25, 1e-9, -1e-9, true, 0, 0.5)).toBe(-2.25);
    expect(resolveEmitterRotation(1.5, 0.01, 0, true, 0, 0.5)).toBeCloseTo(0);
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

  /**
   * fadeIn 0 is a genuine OFF, and that is why the emitter got no new control when `burst` gained `fade`
   * (2026-07-30). Burst's built-in fade was a bare `frac * frac` no param could reach; this one's WIDTH has
   * always been authored, and driving it to the slider's own minimum collapses the envelope to a square —
   * full opacity across the whole life, leaving `alphaCurve` as the entire opacity story. The ramps do not
   * literally vanish (they compress into the epsilon floor), so this is asserted where an author can see it:
   * everywhere except the last ten-thousandth of a life.
   */
  it('collapses to a square envelope at fadeIn 0 — the built-in fade is genuinely OFF', () => {
    for (const t of [0.0001, 0.01, 0.1, 0.5, 0.9, 0.99, 0.9998]) {
      expect(moteAlpha(t, 0)).toBe(1);
    }
    // Compare against a real fade to show the difference is not vacuous.
    expect(moteAlpha(0.05, 0.2)).toBeLessThan(1);
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

describe('emitterStoppedComplete', () => {
  it('is not complete while stopped but motes remain', () => {
    expect(emitterStoppedComplete(true, 3)).toBe(false);
  });
  it('is complete once stopped and every mote has died', () => {
    expect(emitterStoppedComplete(true, 0)).toBe(true);
  });
  it('is never complete while still emitting (not stopped)', () => {
    expect(emitterStoppedComplete(false, 0)).toBe(false);
  });
});

/**
 * Seeded randomness. `EmitterInstance` can't be constructed headlessly (it needs a real Pixi `Renderer` +
 * GL context — see this file's sibling note in smoke.test.ts), so this covers the seeding the way the rest
 * of the file covers the instance: through a pure mirror of `spawnMote`'s draw sequence, plus structural
 * assertions over the module source for the parts that only exist inside the instance.
 */
const EMITTER_SRC = readFileSync(new URL('./emitter.ts', import.meta.url), 'utf8');

/** The module source with its comments stripped. The prose in these files legitimately NAMES
 *  `Math.random()` (explaining what the seeding replaced), so the regression assertion below has to look at
 *  CODE only or it would fail on its own documentation. */
function codeOf(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}


/** The exact draws `EmitterInstance.spawnMote()` makes, in order — 6 per mote. Kept here as the executable
 *  statement of the contract that comment in emitter.ts describes. */
function moteDraws(rand: FxRandom): number[] {
  const bias = rand();
  const spread = rand() * 2 - 1;
  const speedJitter = rand();
  const sizeJitter = rand();
  const offsetU = rand();
  const offsetV = rand();
  return [bias, spread, speedJitter, sizeJitter, offsetU, offsetV];
}

describe('emitter seeded randomness', () => {
  it('two instances seeded the same draw an identical mote sequence', () => {
    const a = makeRng(2024);
    const b = makeRng(2024);
    const streamA = Array.from({ length: 30 }, () => moteDraws(a));
    const streamB = Array.from({ length: 30 }, () => moteDraws(b));
    expect(streamA).toEqual(streamB);
  });

  it('two instances seeded differently draw a different mote sequence', () => {
    const a = makeRng(1);
    const b = makeRng(2);
    expect(Array.from({ length: 30 }, () => moteDraws(a)))
      .not.toEqual(Array.from({ length: 30 }, () => moteDraws(b)));
  });

  it('builds exactly one seeded source per instance, falling back to a fresh seed when none is given', () => {
    expect(EMITTER_SRC).toContain('const seed = ctx.seed ?? randomSeed()');
    expect(EMITTER_SRC).toContain('this.rand = makeRng(seed)');
    // Exactly one per-particle RNG in the PRIMITIVE — `fieldPhaseOffset`'s own stream lives in motion.ts, so
    // it can't disturb this instance's frozen per-mote draw order.
    expect(codeOf(EMITTER_SRC).match(/makeRng\(/g)).toHaveLength(1);
  });

  it('has no Math.random() left in the spawn path', () => {
    expect(codeOf(EMITTER_SRC)).not.toContain('Math.random(');
  });

  it('still draws exactly 6 values per mote, in the original order', () => {
    // If this count moves, every previously saved seed replays a different stream.
    expect(codeOf(EMITTER_SRC).match(/this\.rand\(\)/g)).toHaveLength(6);
    // The pinned call text tracks the two `this.rand()` draws and their ORDER, which is what a saved
    // seed replays. `squash` was appended after the scratch (2026-08-07) and consumes no randomness, so
    // the stream is untouched — the count assertion above is the half that guards determinism. It was named
    // `emitSquash`, then `squash`, before splitting into the squashX/squashY pair; the call now takes the
    // whole params object rather than nine positional args, which is why the pinned text is short.
    expect(EMITTER_SRC).toContain('emissionOffset(p, this.rand(), this.rand(), this.emitScratch)');
  });
});

/**
 * SPEED OVER LIFE — see burst.test.ts's block for the full reasoning. The invariant: the curve scales the
 * distance covered this frame, never the stored velocity, so it retimes drift instead of decaying it.
 */
describe('emitter speed over life', () => {
  it('exposes a speedCurve curve param defaulting to the flat (no-op) [[0,1],[1,1]]', () => {
    const spec = emitterPrimitive.params.speedCurve;
    expect(spec).toBeDefined();
    expect(spec.kind).toBe('curve');
    expect(spec.default).toEqual([[0, 1], [1, 1]]);
    expect(spec.group).toBe('Motion');
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      expect(sampleCurve(spec.default, t)).toBe(1);
    }
  });

  it('allows overshoot above 1x', () => {
    expect(emitterPrimitive.params.speedCurve.vMax).toBe(2);
  });

  it('scales the POSITION delta on both axes, not the stored velocity', () => {
    const code = codeOf(EMITTER_SRC);
    expect(code).toContain('m.p.x += m.vx * travel * dtSec');
    expect(code).toContain('m.p.y += m.vy * travel * dtSec');
  });

  /** The compounding guard — see burst.test.ts's copy. `m.vx *= travel` would decay velocity every frame
   *  instead of scaling that frame's travel, and the mote could never recover. */
  it('never lets the curve reach stored velocity, which would compound', () => {
    expect(codeOf(EMITTER_SRC)).not.toMatch(/\.v[xy]\s*(?:\*=|\+=|-=|=)[^;\n]*\btravel\b/);
  });

  it('samples the curve once per mote per frame', () => {
    expect(codeOf(EMITTER_SRC).match(/sampleCurve\(p\.speedCurve/g)).toHaveLength(1);
  });
});

/** REVERSE — see burst.test.ts's block for the full reasoning. Same mechanism: spawn at the far end of the
 *  flight, negate the velocity, mirror the authored curves only. */
describe('emitter reverse', () => {
  it('exposes a reverse toggle defaulting to off', () => {
    const spec = emitterPrimitive.params.reverse;
    expect(spec).toBeDefined();
    expect(spec.kind).toBe('toggle');
    expect(spec.default).toBe(false);
    expect(spec.group).toBe('Motion');
  });

  it('offsets the spawn by v * life and negates the velocity', () => {
    const code = codeOf(EMITTER_SRC);
    expect(code).toContain('rev ? this.velScratch.vx * revLifeSec : 0');
    expect(code).toContain('const vx0 = rev ? -this.velScratch.vx : this.velScratch.vx;');
    expect(code).toContain('const vy0 = rev ? -this.velScratch.vy : this.velScratch.vy;');
  });

  it('mirrors the authored curves but leaves the built-in fade forward', () => {
    const code = codeOf(EMITTER_SRC);
    expect(code).toContain('const curveT = reverse ? 1 - t : t;');
    for (const c of ['speedCurve', 'alphaCurve', 'sizeCurve', 'biasCurve']) {
      expect(code).toContain(`sampleCurve(p.${c}, curveT)`);
    }
  });
});
