import { describe, expect, it } from 'vitest';
import { Container, type Renderer } from 'pixi.js';
import { defaultsOf, validateSpecs, type FxParamSpecs } from '../params';
import type { FxContext } from '../primitive';
import { customPrimitive, CUSTOM_AIM_MODES } from './custom';

/**
 * Unlike the mesh primitives, a `custom` instance CAN be driven headless: with no image picked it never builds
 * a `Sprite`, the filter lab allocates nothing until a filter is toggled on, and `ContainerTransform` only
 * writes plain Container transforms. So besides the spec invariants every primitive test checks, this one
 * exercises the real lifecycle — clock, one-shot completion, loop wrap, aim math — against the shipped code.
 * The picture itself needs an in-workbench eyeball (a texture needs a browser to decode).
 */

const ctx = (oneShot: boolean): FxContext => ({
  container: new Container(),
  renderer: {} as unknown as Renderer,
  oneShot,
});

describe('custom primitive specs', () => {
  it('registers with valid specs under the id "custom"', () => {
    expect(customPrimitive.id).toBe('custom');
    expect(validateSpecs(customPrimitive.params)).toEqual([]);
  });

  it('gives every param non-empty help text', () => {
    const specs: FxParamSpecs = customPrimitive.params;
    const missing = Object.keys(specs).filter((key) => (specs[key].help ?? '').trim() === '');
    expect(missing).toEqual([]);
  });

  it('defaults to no image, a centred pivot, an untouched look, and NORMAL blend', () => {
    // `normal`, not the `add` every other primitive defaults to: a full-colour picture usually should not
    // be additive. Pivot 0.5/0.5 + zero offset/rotation means the image simply lands centred on the anchor.
    const d = defaultsOf(customPrimitive.params);
    expect(d.image).toBe('');
    expect(d.pivotX).toBe(0.5);
    expect(d.pivotY).toBe(0.5);
    expect(d.offsetX).toBe(0);
    expect(d.offsetY).toBe(0);
    expect(d.rotation).toBe(0);
    expect(d.aimMode).toBe('fixed');
    expect(d.tint).toBe(false);
    expect(d.blendMode).toBe('normal');
    expect(d.alpha).toBe(1);
  });

  it('carries the shared blur, filter-lab and transform-envelope knobs like every other primitive', () => {
    const d = defaultsOf(customPrimitive.params) as Record<string, unknown>;
    expect(d.blur).toBe(0);
    expect(d.godrayOn).toBe(false);
    expect(d.fxSpin).toBe(0);
    expect(Array.isArray(d.fxScaleCurve)).toBe(true);
  });

  it('exposes both aim modes as an as-const tuple (so ParamsOf narrows it)', () => {
    expect([...CUSTOM_AIM_MODES]).toEqual(['fixed', 'sourceToTarget']);
  });
});

describe('custom instance lifecycle (headless — no image picked)', () => {
  it('constructs with no sprite and is not complete before its duration', () => {
    const c = ctx(true);
    const inst = customPrimitive.spawn(c, defaultsOf(customPrimitive.params));
    expect(c.container.children.length).toBe(0);
    inst.update(100);
    expect(inst.isComplete?.()).toBe(false);
    expect(c.container.children.length).toBe(0); // still nothing to draw — and no throw
    inst.destroy();
  });

  it('a one-shot completes exactly at durationMs, so a missing image can never hang a fire', () => {
    const c = ctx(true);
    const params = { ...defaultsOf(customPrimitive.params), durationMs: 500 };
    const inst = customPrimitive.spawn(c, params);
    inst.update(499);
    expect(inst.isComplete?.()).toBe(false);
    inst.update(1);
    expect(inst.isComplete?.()).toBe(true);
    inst.destroy();
  });

  it('the continuous preview never self-completes (the player owns its lifetime)', () => {
    const c = ctx(false);
    const inst = customPrimitive.spawn(c, { ...defaultsOf(customPrimitive.params), durationMs: 200 });
    inst.update(5000);
    expect(inst.isComplete?.()).toBe(false);
    inst.destroy();
  });

  it('pivots the layer container about the head it was handed (transform envelope wiring)', () => {
    const c = ctx(false);
    const inst = customPrimitive.spawn(c, defaultsOf(customPrimitive.params));
    inst.setHead?.(120, 80);
    inst.update(16);
    expect(c.container.pivot.x).toBe(120);
    expect(c.container.pivot.y).toBe(80);
    expect(c.container.position.x).toBe(120);
    expect(c.container.position.y).toBe(80);
    inst.destroy();
  });

  it('setAim keeps a real direction and drops a degenerate one', () => {
    const c = ctx(false);
    const inst = customPrimitive.spawn(c, defaultsOf(customPrimitive.params)) as unknown as {
      setAim: (sx: number, sy: number, tx: number, ty: number) => void;
      aimAngle: number | null;
      destroy: () => void;
    };
    inst.setAim(0, 0, 10, 0);
    expect(inst.aimAngle).toBeCloseTo(0);
    inst.setAim(0, 0, 0, 10);
    expect(inst.aimAngle).toBeCloseTo(Math.PI / 2);
    inst.setAim(5, 5, 5, 5); // source and target on the same spot: no direction to aim along
    expect(inst.aimAngle).toBeNull();
    inst.destroy();
  });

  it('destroy leaves the container empty and is safe to call with nothing built', () => {
    const c = ctx(true);
    const inst = customPrimitive.spawn(c, defaultsOf(customPrimitive.params));
    inst.destroy();
    expect(c.container.children.length).toBe(0);
    expect(c.container.filters).toEqual([]);
  });
});
