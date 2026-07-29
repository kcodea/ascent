import { describe, it, expect, beforeEach } from 'vitest';
import { applyVariant } from './applyVariant';
import { registerPrimitive, clearPrimitives } from '../registry';
import type { FxParamSpecs } from '../params';
import type { FxDef } from '../def';

const SPECS = {
  size: { kind: 'slider', label: 'Size', min: 1, max: 20, step: 1, default: 10 },
  speed: { kind: 'slider', label: 'Speed', min: 0, max: 500, step: 10, default: 100 },
  glow: { kind: 'toggle', label: 'Glow', default: true },
} satisfies FxParamSpecs;

function def(): FxDef {
  return {
    id: 'x',
    duration: 500,
    layers: [{ primitive: 'p', anchor: 'source', at: 0, params: { size: 10, speed: 100, glow: true } }],
  };
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

  it('refuses a non-slider param and reports it missed', () => {
    const r = applyVariant(def(), { id: 'a', label: 'A', transform: { glow: 2 } });
    expect(r.def.layers[0].params.glow).toBe(true);
    expect(r.missed).toEqual(['glow']);
  });

  it('reports a transform key no layer has', () => {
    const r = applyVariant(def(), { id: 'a', label: 'A', transform: { nonexistent: 2 } });
    expect(r.missed).toEqual(['nonexistent']);
  });

  it('an override beats the transform for the same key', () => {
    const r = applyVariant(def(), { id: 'a', label: 'A', transform: { size: 1.5 } }, { size: 3 });
    expect(r.def.layers[0].params.size).toBe(3);
  });

  it('does not mutate the base def', () => {
    const base = def();
    applyVariant(base, { id: 'a', label: 'A', transform: { size: 1.5 } });
    expect(base.layers[0].params.size).toBe(10);
  });
});
