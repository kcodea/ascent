import { beforeEach, describe, expect, it } from 'vitest';
import type { FxDef, FxLayer } from './def';
import { coerceParams, validateSpecs, type FxParamSpecs } from './params';
import { transformParams } from './paramTransform';
import { clearPrimitives, registerPrimitive } from './registry';
import { makeRng } from './rng';
import { axisTransform, normalizeAxis, scaleDef } from './scaleDef';
import { burstPrimitive, sampleBurstAngle } from './primitives/burst';

const SPECS = {
  size: { kind: 'slider', label: 'Size', min: 1, max: 20, step: 1, default: 10, axis: 'scale' },
  speed: { kind: 'slider', label: 'Speed', min: 0, max: 500, step: 10, default: 100, axis: 'scale' },
  count: { kind: 'slider', label: 'Count', min: 1, max: 40, step: 1, default: 10, axis: 'intensity' },
  /** No axis — the majority case. Must be untouched by BOTH multipliers. */
  drag: { kind: 'slider', label: 'Drag', min: 0, max: 1, step: 0.05, default: 0.9 },
  /** A non-slider, to pin that nothing tries to multiply one. */
  glow: { kind: 'toggle', label: 'Glow', default: true },
} satisfies FxParamSpecs;

const BASE_PARAMS: Record<string, unknown> = { size: 10, speed: 100, count: 10, drag: 0.9, glow: true };

function def(params: Record<string, unknown> = {}, primitive = 'p'): FxDef {
  const layer: FxLayer = { primitive, anchor: 'target', at: 0, params: { ...BASE_PARAMS, ...params } };
  return { id: 'x', duration: 500, layers: [layer] };
}

beforeEach(() => {
  clearPrimitives();
  registerPrimitive({
    id: 'p',
    params: SPECS,
    spawn: () => ({ update: () => {}, setParams: () => {}, destroy: () => {} }),
  });
});

describe('normalizeAxis', () => {
  it('passes a usable multiplier through', () => {
    expect(normalizeAxis(2)).toBe(2);
    expect(normalizeAxis(0.5)).toBe(0.5);
  });

  it('falls back to 1 for every kind of caller error', () => {
    // Each of these would otherwise reach the multiply: 0 collapses the effect to nothing, a negative one
    // inverts it, and Infinity pins every axis param to its max AND poisons `0 * Infinity` into a NaN.
    for (const bad of [undefined, 0, -1, NaN, Infinity, -Infinity]) {
      expect(normalizeAxis(bad)).toBe(1);
    }
  });
});

describe('axisTransform', () => {
  it('maps each declared param onto its own axis and omits everything else', () => {
    expect(axisTransform(SPECS, 2, 3)).toEqual({ size: 2, speed: 2, count: 3 });
  });

  it('omits a multiplier of exactly 1, so one axis alone never rewrites the other', () => {
    expect(axisTransform(SPECS, 2, 1)).toEqual({ size: 2, speed: 2 });
    expect(axisTransform(SPECS, 1, 3)).toEqual({ count: 3 });
    expect(axisTransform(SPECS, 1, 1)).toEqual({});
  });
});

describe('scaleDef', () => {
  it('multiplies the params on each axis and leaves the undeclared ones alone', () => {
    const out = scaleDef(def(), { scale: 2, intensity: 3 });
    expect(out.layers[0].params).toEqual({ size: 20, speed: 200, count: 30, drag: 0.9, glow: true });
  });

  // ── the exact-no-op contract ────────────────────────────────────────────────────────────────────────
  it('scale 1 returns the SAME object — not an equal copy', () => {
    // Identity, deliberately, not `toEqual`. "Multiplies by 1.0 and re-snaps" is not a no-op: a param whose
    // authored value sits off its own step grid would be silently moved onto it, so a def would play
    // differently the day someone passed `scale: 1` than it did the day before.
    const base = def();
    expect(scaleDef(base, { scale: 1, intensity: 1 })).toBe(base);
    expect(scaleDef(base, {})).toBe(base);
    // A caller-error value normalises to 1, and so must also be an exact no-op.
    expect(scaleDef(base, { scale: 0, intensity: NaN })).toBe(base);
  });

  it('returns the same object when the def declares no axis params at all', () => {
    registerPrimitive({
      id: 'inert',
      params: { drag: { kind: 'slider', label: 'Drag', min: 0, max: 1, step: 0.05, default: 0.9 } },
      spawn: () => ({ update: () => {}, setParams: () => {}, destroy: () => {} }),
    });
    const base = def({}, 'inert');
    expect(scaleDef(base, { scale: 4, intensity: 4 })).toBe(base);
  });

  it('never mutates the input', () => {
    const base = def();
    scaleDef(base, { scale: 2 });
    expect(base.layers[0].params.size).toBe(10);
  });

  // ── clamping is a real behaviour ────────────────────────────────────────────────────────────────────
  it('clamps to each param\'s own range, so scaling is NOT linear at the extremes', () => {
    // `size` maxes at 20, `speed` at 500. A caller asking for 10× gets 2× and 5× respectively — the whole
    // reason the axis doc says an author must leave headroom below the ceiling.
    const out = scaleDef(def(), { scale: 10 });
    expect(out.layers[0].params.size).toBe(20);
    expect(out.layers[0].params.speed).toBe(500);
  });

  it('snaps to the step and clears the float dust', () => {
    const out = scaleDef(def({ drag: 0.9 }), { scale: 1.07 }); // speed 100 * 1.07 = 107 → step 10 → 110
    expect(out.layers[0].params.speed).toBe(110);
  });

  // ── bad input must not reach `params` ───────────────────────────────────────────────────────────────
  it('leaves a param whose authored value is not a finite number exactly as it was', () => {
    const out = scaleDef(def({ size: 'huge' }), { scale: 2 });
    expect(out.layers[0].params.size).toBe('huge'); // never NaN, never coerced
  });

  it('passes a layer whose primitive is unregistered through untouched', () => {
    // Dropping unknown-primitive layers is `coerceDef`'s job, not a scaling function's.
    const base = def({}, 'nope');
    const out = scaleDef(base, { scale: 2 });
    expect(out.layers[0]).toBe(base.layers[0]);
  });

  it('carries a richer def type and its extra fields through', () => {
    const stored = { ...def(), version: 1 as const, label: 'Dust', tags: ['dust'], seed: 42 };
    const out = scaleDef(stored, { scale: 2 });
    expect(out.label).toBe('Dust');
    expect(out.seed).toBe(42); // a locked seed still replays the same roll, at a new size
    expect(out.layers[0].params.size).toBe(20);
  });
});

describe('an axis is only ever declared where it is legal', () => {
  it('validateSpecs rejects an axis on a non-slider param', () => {
    const bad = {
      glow: { kind: 'toggle', label: 'Glow', default: true, axis: 'scale' },
    } satisfies FxParamSpecs;
    expect(validateSpecs(bad)).toEqual([
      "'glow': axis 'scale' is only meaningful on a slider (this is a 'toggle')",
    ]);
  });

  it('every shipped primitive still validates clean with its axes declared', () => {
    expect(validateSpecs(burstPrimitive.params)).toEqual([]);
  });
});

/* ────────────────────────────────────────────────────────────────────────────────────────────────────────
 * DETERMINISM — the constraint that decides which params may ride `scale`.
 *
 * `burst.emit()` draws EXACTLY 7 random values per particle in a fixed order, and `burst.test.ts` guards
 * that count textually, because moving it re-rolls every seed anyone has ever locked. Scaling must be
 * invisible to that sequence.
 *
 * It is, structurally: `scale` is declared only on GEOMETRY (sizes, radii, speeds, accelerations), never on
 * a count, so the number of particles — and therefore the number of draws — cannot move. The first test
 * below pins that structurally on the REAL burst specs; the two after it reproduce the draw sequence the
 * way `burst.test.ts` does and prove the stream is byte-identical while the geometry changes.
 * ──────────────────────────────────────────────────────────────────────────────────────────────────────── */

const BURST_SPECS: FxParamSpecs = burstPrimitive.params;
const BURST_DEFAULTS = coerceParams(burstPrimitive.params, {}) as unknown as Record<string, number>;

/** One particle's slice of `emit()`'s draw sequence, parameterised by the params scaling moves. Mirrors
 *  `burst.test.ts`'s `drawParticle`; the emission-shape offsets are two draws whatever `emitRadius` is. */
function drawParticle(p: Record<string, number>, rand: () => number): number[] {
  const angle = sampleBurstAngle(0, p.spread, rand); // 1 — drawn inside sampleBurstAngle, by reference
  const speed = p.speed * (1 + (rand() * 2 - 1) * p.speedVar); // 2
  const size = Math.max(0.5, p.size * (1 + (rand() * 2 - 1) * p.sizeVar)); // 3
  const bias0 = p.coreBias * rand(); // 4
  const ox = rand(); // 5
  const oy = rand(); // 6
  const spin = (rand() * 2 - 1) * 6; // 7
  return [angle, speed, size, bias0, ox, oy, spin];
}

function drawWave(p: Record<string, number>, seed: number): number[][] {
  const rand = makeRng(seed);
  return Array.from({ length: Math.round(p.count) }, () => drawParticle(p, rand));
}

/** The params a burst plays with at these axes — i.e. exactly what `scaleDef` computes for one layer,
 *  including its short-circuit back to the input object when neither axis reaches anything. */
function burstAt(scale: number, intensity: number): Record<string, number> {
  const transform = axisTransform(BURST_SPECS, scale, intensity);
  if (Object.keys(transform).length === 0) return BURST_DEFAULTS;
  return transformParams(BURST_SPECS, BURST_DEFAULTS, transform).params as Record<string, number>;
}

describe('scaling a seeded burst does not disturb its random draws', () => {
  it('the scale axis touches NO count param on the real burst — the structural guarantee', () => {
    // This, not the numeric tests below, is what actually holds the line: if someone ever marks `count`
    // (or any future count-like param) `axis: 'scale'`, the number of draws moves with the size and every
    // locked seed replays differently. `count` must appear under intensity and nowhere else.
    const geometric = Object.keys(axisTransform(BURST_SPECS, 2, 1));
    expect(geometric).not.toContain('count');
    expect(geometric).toEqual(['speed', 'gravity', 'turbulence', 'emitRadius', 'size']);
    expect(Object.keys(axisTransform(BURST_SPECS, 1, 2))).toEqual(['count']);
  });

  it('scale 1 is byte-identical to no scaling at all', () => {
    expect(burstAt(1, 1)).toBe(BURST_DEFAULTS); // `transformParams` isn't even reached — no keys to write
    expect(drawWave(burstAt(1, 1), 20260730)).toEqual(drawWave(BURST_DEFAULTS, 20260730));
  });

  it('scale 2 consumes the SAME stream in the same order — the geometry changes, the roll does not', () => {
    const before = drawWave(BURST_DEFAULTS, 20260730);
    const bigger = drawWave(burstAt(2, 1), 20260730);
    expect(bigger).toHaveLength(before.length); // same particle count → same number of draws
    for (let i = 0; i < before.length; i++) {
      // The angle is drawn from the identical stream position and is unaffected by geometry…
      expect(bigger[i][0]).toBe(before[i][0]);
      // …speed and size are exactly doubled (the same roll, scaled)…
      expect(bigger[i][1]).toBeCloseTo(before[i][1] * 2, 9);
      expect(bigger[i][2]).toBeCloseTo(before[i][2] * 2, 9);
      // …and every draw after them is untouched, which is what "same sequence" means.
      expect(bigger[i].slice(3)).toEqual(before[i].slice(3));
    }
  });

  it('intensity 2 draws MORE particles — the same stream, continued, not a different one', () => {
    const before = drawWave(BURST_DEFAULTS, 20260730);
    const denser = drawWave(burstAt(1, 2), 20260730);
    expect(denser).toHaveLength(before.length * 2);
    // Changing a COUNT necessarily changes how many draws are taken — that is inherent to "more particles"
    // and is precisely why the two axes are separate. The particles that were already there are unchanged.
    expect(denser.slice(0, before.length)).toEqual(before);
  });
});
