import { beforeEach, describe, expect, it } from 'vitest';
import type { FxDef, FxLayer } from './def';
import { coerceParams, validateSpecs, type FxParamSpecs } from './params';
import { transformParams } from './paramTransform';
import { clearPrimitives, registerPrimitive } from './registry';
import { makeRng } from './rng';
import { axisTransform, normalizeAxis, scaleDef, scaleMs } from './scaleDef';
import { burstPrimitive, sampleBurstAngle } from './primitives/burst';
import { emitterPrimitive } from './primitives/emitter';
import { shockwavePrimitive } from './primitives/shockwave';

const SPECS = {
  size: { kind: 'slider', label: 'Size', min: 1, max: 20, step: 1, default: 10, axis: 'scale' },
  speed: { kind: 'slider', label: 'Speed', min: 0, max: 500, step: 10, default: 100, axis: 'scale' },
  count: { kind: 'slider', label: 'Count', min: 1, max: 40, step: 1, default: 10, axis: 'intensity' },
  /** A duration in ms — the canonical `time` param. */
  life: { kind: 'slider', label: 'Life', min: 10, max: 2000, step: 10, default: 200, axis: 'time' },
  /** A per-second rate whose PERIOD is the thing being stretched — rides `time` INVERSELY. */
  cadence: { kind: 'slider', label: 'Cadence', min: 0.1, max: 8, step: 0.05, default: 2, axis: 'timeInverse' },
  /** No axis — the majority case. Must be untouched by ALL multipliers. */
  drag: { kind: 'slider', label: 'Drag', min: 0, max: 1, step: 0.05, default: 0.9 },
  /** A non-slider, to pin that nothing tries to multiply one. */
  glow: { kind: 'toggle', label: 'Glow', default: true },
} satisfies FxParamSpecs;

const BASE_PARAMS: Record<string, unknown> = {
  size: 10, speed: 100, count: 10, life: 200, cadence: 2, drag: 0.9, glow: true,
};

function def(params: Record<string, unknown> = {}, primitive = 'p'): FxDef {
  const layer: FxLayer = { primitive, anchor: 'target', at: 0, params: { ...BASE_PARAMS, ...params } };
  return { id: 'x', duration: 500, layers: [layer] };
}

/** A def whose single layer declares a full temporal frame — the shape 13 of the 22 shipped defs have. */
function timedDef(over: Partial<FxLayer> = {}): FxDef {
  const layer: FxLayer = {
    primitive: 'p', anchor: 'travel', at: 100, life: 320, travelMs: 180, bow: 0.4,
    params: { ...BASE_PARAMS },
    ...over,
  };
  return { id: 'x', duration: 700, layers: [layer] };
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
    expect(out.layers[0].params).toEqual({
      size: 20, speed: 200, count: 30, life: 200, cadence: 2, drag: 0.9, glow: true,
    });
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

  it('time 1 is an exact no-op too, alongside the other two', () => {
    const base = timedDef();
    expect(scaleDef(base, { time: 1 })).toBe(base);
    expect(scaleDef(base, { scale: 1, intensity: 1, time: 1 })).toBe(base);
    expect(scaleDef(base, { time: 0 })).toBe(base);
    expect(scaleDef(base, { time: -2 })).toBe(base);
    expect(scaleDef(base, { time: NaN })).toBe(base);
    expect(scaleDef(base, { time: Infinity })).toBe(base);
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

/* ────────────────────────────────────────────────────────────────────────────────────────────────────────
 * THE TIME AXIS — the one that is not just a param transform.
 *
 * Two things in this system are called "life": a LAYER's window (`FxLayer.life`, how long the layer exists)
 * and a PARTICLE's lifetime (`params.life`). `playDef` fires via `fireOnce`, and `player.ts`'s rule there is
 * that a layer which DECLARES a `life` is bounded by that window. So stretching only the params would push
 * particles past a window that did not move, and they would be cut off with no error anywhere.
 * ──────────────────────────────────────────────────────────────────────────────────────────────────────── */

describe('the time axis rescales the whole temporal frame', () => {
  it('moves the def duration and every ms-valued field of every layer', () => {
    const out = scaleDef(timedDef(), { time: 2 });
    expect(out.duration).toBe(1400);
    expect(out.layers[0].at).toBe(200);
    expect(out.layers[0].life).toBe(640);
    expect(out.layers[0].travelMs).toBe(360);
  });

  it('leaves `bow`, `anchor` and `primitive` exactly as authored — a bow is a shape, not a time', () => {
    const out = scaleDef(timedDef(), { time: 3 });
    expect(out.layers[0].bow).toBe(0.4);
    expect(out.layers[0].anchor).toBe('travel');
    expect(out.layers[0].primitive).toBe('p');
  });

  it('a layer with no `life`/`travelMs` does not GROW them (undefined means "to the def duration")', () => {
    const bare: FxLayer = { primitive: 'p', anchor: 'target', at: 50, params: { ...BASE_PARAMS } };
    const out = scaleDef({ id: 'x', duration: 700, layers: [bare] }, { time: 2 });
    expect(out.layers[0].at).toBe(100);
    // Key ABSENCE, not just an undefined value: `layerStateOf` branches on `life !== undefined`, and an
    // unbounded layer is the one thing a fire is allowed to run past `def.duration` to true completion.
    expect('life' in out.layers[0]).toBe(false);
    expect('travelMs' in out.layers[0]).toBe(false);
  });

  it('stretches a layer window even when the layer\'s primitive is unregistered', () => {
    // The window is the PLAYER's arithmetic, knowable without the primitive. Only its params are left alone.
    const out = scaleDef(timedDef({ primitive: 'nope' }), { time: 2 });
    expect(out.layers[0].life).toBe(640);
    expect(out.layers[0].params.life).toBe(200); // untouched — no specs to consult
  });

  it('clears the float dust a stretch leaves behind', () => {
    expect(scaleMs(100, 1.1)).toBe(110); // not 110.00000000000001
    expect(scaleDef(timedDef({ at: 100 }), { time: 1.1 }).layers[0].at).toBe(110);
  });

  // ── the failure this exists to prevent, stated as a before/after ────────────────────────────────────────
  it('keeps a particle inside its layer window — the truncation that a params-only stretch would cause', () => {
    // The shape of `damage-burst`'s "hot core": a 200ms particle inside a 320ms window. Stretch the params
    // alone and the particle wants 400ms of a window that still closes at 320 — 80ms cut off, silently.
    const base = timedDef({ at: 0, life: 320, travelMs: undefined });
    expect(base.layers[0].params.life).toBe(200);
    expect(base.layers[0].life).toBe(320);
    const out = scaleDef(base, { time: 2 });
    expect(out.layers[0].params.life).toBe(400);
    expect(out.layers[0].life).toBe(640);
    // The invariant that matters, stated directly: the window still outlives the particle it contains.
    expect(out.layers[0].life as number).toBeGreaterThanOrEqual(out.layers[0].params.life as number);
  });

  it('stretches a duration param and shrinks an inverse-rate one, in the same call', () => {
    const out = scaleDef(def(), { time: 2 });
    expect(out.layers[0].params.life).toBe(400);   // ms   → ×2
    expect(out.layers[0].params.cadence).toBe(1);  // /sec → ×1/2, so its PERIOD doubles with everything else
    expect(out.layers[0].params.speed).toBe(100);  // px/sec is a VELOCITY — held, so particles travel further
    expect(out.layers[0].params.size).toBe(10);
    expect(out.layers[0].params.count).toBe(10);
  });

  it('clamps like every other axis — durations have a max, so `time: 10` is not 10x', () => {
    const out = scaleDef(def({ life: 400 }), { time: 10 });
    expect(out.layers[0].params.life).toBe(2000); // the spec max, i.e. 5x not 10x
    // A layer WINDOW has no declared range and so is not clamped — it must be free to follow the longest
    // thing inside it, which is the whole point of the axis.
    expect(scaleDef(timedDef(), { time: 10 }).layers[0].life).toBe(3200);
  });

  it('composes with the other two axes without any of them reaching each other\'s params', () => {
    const out = scaleDef(def(), { scale: 2, intensity: 3, time: 2 });
    expect(out.layers[0].params).toEqual({
      size: 20, speed: 200, count: 30, life: 400, cadence: 1, drag: 0.9, glow: true,
    });
  });
});

describe('the real primitives declare the time axis where the arithmetic says they should', () => {
  it('burst: the particle lifetime and the loop interval, and NOTHING that counts', () => {
    const timed = Object.keys(axisTransform(burstPrimitive.params, 1, 1, 2));
    expect(timed).toEqual(['interval', 'life']);
    expect(timed).not.toContain('count');
  });

  it('emitter: the mote lifetime — and `rate` stays on intensity, deliberately', () => {
    expect(Object.keys(axisTransform(emitterPrimitive.params, 1, 1, 2))).toEqual(['life']);
    expect(Object.keys(axisTransform(emitterPrimitive.params, 1, 2, 1))).toEqual(['rate']);
  });

  it('shockwave: `speed` is the only inverse-rate param in the library, and it goes as 1/time', () => {
    // A shockwave has no duration param at all — one expansion takes 1/speed — so this IS its clock.
    expect(axisTransform(shockwavePrimitive.params, 1, 1, 2)).toEqual({ speed: 0.5 });
    expect(axisTransform(shockwavePrimitive.params, 1, 1, 0.5)).toEqual({ speed: 2 });
  });

  it('no primitive puts a velocity or an acceleration on the time axis', () => {
    // The distinction from `PlayDefOptions.speed`: `time` holds velocities and lets particles travel further.
    for (const prim of [burstPrimitive, emitterPrimitive, shockwavePrimitive]) {
      const timed = Object.keys(axisTransform(prim.params, 1, 1, 2));
      for (const key of ['speed', 'gravity', 'turbulence', 'drain']) {
        if (prim === shockwavePrimitive && key === 'speed') continue; // the documented inverse-rate case
        expect(timed).not.toContain(key);
      }
    }
  });

  it('every shipped primitive still validates clean with the time axes declared', () => {
    for (const prim of [burstPrimitive, emitterPrimitive, shockwavePrimitive]) {
      expect(validateSpecs(prim.params)).toEqual([]);
    }
  });
});

describe('stretching a seeded burst does not disturb its random draws either', () => {
  it('the time axis touches NO count param on the real burst — the structural guarantee', () => {
    // The same line `scale` holds. A burst emits its whole wave at t=0, so as long as `time` cannot reach
    // `count`, the number of particles — and therefore the number of `rand()` draws — cannot move.
    expect(Object.keys(axisTransform(BURST_SPECS, 1, 1, 4))).not.toContain('count');
  });

  it('time 4 consumes the SAME stream in the same order — the shards live longer, the roll does not move', () => {
    const transform = axisTransform(BURST_SPECS, 1, 1, 4);
    const longer = transformParams(BURST_SPECS, BURST_DEFAULTS, transform).params as Record<string, number>;
    // 450 x 4 = 1800, and it LANDS there now: the 2026-07-30 headroom pass raised burst `life`'s ceiling
    // from 1500 to 6000, so a `time: 4` call stretches the whole way instead of quietly clamping a quarter of
    // the way short. That is exactly the "clamped, so not linear at the extremes" caveat in `FxParamMeta.axis`
    // biting less often — the stream below is unmoved either way, which is what this case is really about.
    expect(longer.life).toBe(1800);
    expect(longer.count).toBe(BURST_DEFAULTS.count);
    expect(drawWave(longer, 20260730)).toEqual(drawWave(BURST_DEFAULTS, 20260730));
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
    // `offsetX`/`offsetY` joined 2026-08-08: a placement in px is a LENGTH, so it has to ride the same
    // resize as the emit radius — a scaled-down effect keeping a full-size displacement would drift off
    // its anchor. The squash pair is deliberately absent: those are RATIOS, and scaling a ratio would
    // reshape the effect as it resized instead of resizing it.
    expect(geometric).toEqual(['speed', 'gravity', 'pointGravity', 'turbulence', 'emitRadius', 'offsetX', 'offsetY', 'size']);
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
