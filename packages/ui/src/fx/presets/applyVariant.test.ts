import { describe, it, expect, beforeEach } from 'vitest';
import { applyVariant } from './applyVariant';
import { registerPrimitive, clearPrimitives } from '../registry';
import type { FxParamSpecs } from '../params';
import type { FxDef, FxLayer } from '../def';

const SPECS = {
  size: { kind: 'slider', label: 'Size', min: 1, max: 20, step: 1, default: 10 },
  speed: { kind: 'slider', label: 'Speed', min: 0, max: 500, step: 10, default: 100 },
  /** A FRACTIONAL step — the dominant real shape (88 of 121 registered slider specs have one), and the
   *  only shape in which the multiply leaves float dust for `toFixed` to clear. */
  fade: { kind: 'slider', label: 'Fade', min: 0, max: 1, step: 0.1, default: 0.3 },
  /** A range that is NOT a whole number of steps, so the snap can push a clamped value back out of it. */
  odd: { kind: 'slider', label: 'Odd', min: 0, max: 25, step: 10, default: 20 },
  glow: { kind: 'toggle', label: 'Glow', default: true },
  /** A non-slider param whose value is a NUMBER — without it, the slider-kind check and the
   *  value-is-a-number check mask each other and neither is independently covered. */
  tint: { kind: 'color', label: 'Tint', default: 0xff0000 },
} satisfies FxParamSpecs;

const BASE_PARAMS: Record<string, unknown> = {
  size: 10,
  speed: 100,
  fade: 0.3,
  odd: 20,
  glow: true,
  tint: 0xff0000,
};

function def(params: Record<string, unknown> = {}): FxDef {
  const layer: FxLayer = {
    primitive: 'p',
    anchor: 'source',
    at: 0,
    params: { ...BASE_PARAMS, ...params },
  };
  return { id: 'x', duration: 500, layers: [layer] };
}

beforeEach(() => {
  clearPrimitives();
  // A REAL `FxPrimitive` shape (the plan's fixture cast `as never`, which would have hidden the missing
  // `setParams` that `FxInstance` requires). `applyVariant` only ever reads `params`, but a fixture that
  // can't satisfy the interface is a fixture that proves nothing about the interface.
  registerPrimitive({
    id: 'p',
    params: SPECS,
    spawn: () => ({ update: () => {}, setParams: () => {}, destroy: () => {} }),
  });
});

describe('applyVariant', () => {
  it('multiplies a slider param and reports it applied', () => {
    const r = applyVariant(def(), { id: 'a', label: 'A', transform: { size: 1.5 } });
    expect(r.def.layers[0].params.size).toBe(15);
    expect(r.applied).toEqual(['0.size']);
    expect(r.missed).toEqual([]);
  });

  it('clamps above max and below min', () => {
    expect(applyVariant(def(), { id: 'a', label: 'A', transform: { size: 100 } }).def.layers[0].params.size).toBe(20);
    expect(applyVariant(def(), { id: 'a', label: 'A', transform: { size: 0.001 } }).def.layers[0].params.size).toBe(1);
  });

  it('snaps to the param step', () => {
    // 100 * 1.07 = 107 → step 10 → 110
    expect(applyVariant(def(), { id: 'a', label: 'A', transform: { speed: 1.07 } }).def.layers[0].params.speed).toBe(110);
  });

  it('clears the float dust a fractional step leaves', () => {
    // 0.3 * 2.3333333 = 0.69999999 → snaps to 7 steps of 0.1, which multiplies back out to
    // 0.7000000000000001. Must land on exactly 0.7 — a param reading 0.7000000000000001 in the inspector
    // (and saving that way) is the workbench looking broken.
    const r = applyVariant(def(), { id: 'a', label: 'A', transform: { fade: 2.3333333 } });
    expect(r.def.layers[0].params.fade).toBe(0.7);
  });

  it('re-clamps a value the SNAP pushed back out of range', () => {
    // `odd` is 0..25 step 10 — a range that is not a whole number of steps. 20 * 1.5 = 30 → clamps to the
    // max of 25 → snaps UP to 30 (Math.round(2.5) === 3) → must be clamped a second time, back to 25.
    // In-range but off-grid is correct: the range is what `coerceParams` enforces at load, the grid isn't.
    const r = applyVariant(def(), { id: 'a', label: 'A', transform: { odd: 1.5 } });
    expect(r.def.layers[0].params.odd).toBe(25);
  });

  it('refuses a non-slider param and reports it missed', () => {
    const r = applyVariant(def(), { id: 'a', label: 'A', transform: { glow: 2 } });
    expect(r.def.layers[0].params.glow).toBe(true);
    expect(r.missed).toEqual(['glow']);
  });

  it('refuses a non-slider param even when its value IS a number', () => {
    // Isolates the slider-KIND check: a `color` holds a perfectly multipliable number, so only the kind
    // check can stop it. `0xff0000 * 2` would be a silently recoloured layer.
    const r = applyVariant(def(), { id: 'a', label: 'A', transform: { tint: 2 } });
    expect(r.def.layers[0].params.tint).toBe(0xff0000);
    expect(r.applied).toEqual([]);
    expect(r.missed).toEqual(['tint']);
  });

  it('refuses a slider param whose current value is not a number', () => {
    // Isolates the value-is-a-NUMBER check: the spec IS a slider, so the kind check passes and only the
    // typeof can stop `true * 2 === 2` being written as though it had been authored that way.
    const r = applyVariant(def({ size: true }), { id: 'a', label: 'A', transform: { size: 2 } });
    expect(r.def.layers[0].params.size).toBe(true);
    expect(r.applied).toEqual([]);
    expect(r.missed).toEqual(['size']);
  });

  it('refuses arithmetic that does not land on a finite number', () => {
    // The silent-poisoning case: a NaN written into a param AND reported in `applied` would be the
    // function claiming success while corrupting the def.
    const nan = applyVariant(def(), { id: 'a', label: 'A', transform: { size: NaN } });
    expect(nan.def.layers[0].params.size).toBe(10);
    expect(nan.applied).toEqual([]);
    expect(nan.missed).toEqual(['size']);

    // 0 × Infinity is NaN even though both operands pass a `typeof number` check.
    const inf = applyVariant(def({ speed: 0 }), { id: 'a', label: 'A', transform: { speed: Infinity } });
    expect(inf.def.layers[0].params.speed).toBe(0);
    expect(inf.applied).toEqual([]);
    expect(inf.missed).toEqual(['speed']);
  });

  it('an override beats the transform for the same key', () => {
    const r = applyVariant(def(), { id: 'a', label: 'A', transform: { size: 1.5 } }, { size: 3 });
    expect(r.def.layers[0].params.size).toBe(3);
  });

  it('holds an override to the same rules as a transform', () => {
    const r = applyVariant(def(), { id: 'a', label: 'A', transform: {} }, { tint: 2, size: 999 });
    expect(r.def.layers[0].params.tint).toBe(0xff0000); // non-slider → refused
    expect(r.def.layers[0].params.size).toBe(20); // clamped to max, not written raw
    expect(r.missed).toEqual(['tint']);
  });

  it('does not mutate the base def', () => {
    const base = def();
    applyVariant(base, { id: 'a', label: 'A', transform: { size: 1.5 } });
    expect(base.layers[0].params.size).toBe(10);
  });

  it('carries a richer def type and its extra fields through', () => {
    // `StoredFxDef`-shaped. These fields ride along at runtime, so the return type must keep them visible:
    // a variant silently inheriting its base's `label`/`tags` is what the library browser searches on.
    const stored = { ...def(), version: 1 as const, label: 'Bolt', tags: ['travel'] };
    const r = applyVariant(stored, { id: 'a', label: 'A', transform: { size: 1.5 } });
    expect(r.def.label).toBe('Bolt'); // typed, not `any` — `def` is the input type, not a widened `FxDef`
    expect(r.def.tags).toEqual(['travel']);
    expect(r.def.version).toBe(1);
    expect(r.def.layers[0].params.size).toBe(15);
  });
});
