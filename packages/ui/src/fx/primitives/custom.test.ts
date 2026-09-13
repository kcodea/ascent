import { describe, expect, it } from 'vitest';
import { Container, type Renderer } from 'pixi.js';
import { defaultsOf, validateSpecs, type FxParamSpecs } from '../params';
import type { FxContext } from '../primitive';
import { customPrimitive, CUSTOM_AIM_MODES, CUSTOM_RENDER_MODES, CUSTOM_ROLES } from './custom';

/**
 * Unlike the mesh primitives, a `custom` instance CAN be driven headless: with no image picked it never builds
 * a node, the filter lab allocates nothing until a filter is toggled on, and `ContainerTransform` only writes
 * plain Container transforms. So besides the spec invariants every primitive test checks, this one exercises
 * the real lifecycle — clock, one-shot completion (with scatter stagger), loop wrap, aim math, structural
 * param churn, cross-layer roles without a root — against the shipped code. The pixels themselves need a
 * browser (a texture needs one to decode); the pure maths is covered in `customGeometry.test.ts`.
 */

const ctx = (oneShot: boolean, effectRoot?: Container): FxContext => ({
  container: new Container(),
  renderer: {} as unknown as Renderer,
  oneShot,
  effectRoot,
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
    const d = defaultsOf(customPrimitive.params);
    expect(d.image).toBe('');
    expect(d.pivotX).toBe(0.5);
    expect(d.pivotY).toBe(0.5);
    expect(d.offsetX).toBe(0);
    expect(d.rotation).toBe(0);
    expect(d.aimMode).toBe('fixed');
    expect(d.tint).toBe(false);
    expect(d.blendMode).toBe('normal');
    expect(d.alpha).toBe(1);
  });

  it('Phase 2 defaults are all inert — a Phase 1 def renders identically', () => {
    // 1×1 "sheet" = not a sheet; 1 copy with 0 radius / 0 jitter = the identity roll; flat sprite; draw role.
    const d = defaultsOf(customPrimitive.params);
    expect([d.sheetCols, d.sheetRows, d.sheetFrames]).toEqual([1, 1, 0]);
    expect(d.count).toBe(1);
    expect([d.scatterRadius, d.jitterRotation, d.jitterScale, d.jitterAlpha, d.staggerMs]).toEqual([0, 0, 0, 0, 0]);
    expect(d.renderMode).toBe('sprite');
    expect(d.role).toBe('draw');
  });

  it('carries the shared blur, filter-lab and transform-envelope knobs like every other primitive', () => {
    const d = defaultsOf(customPrimitive.params) as Record<string, unknown>;
    expect(d.blur).toBe(0);
    expect(d.godrayOn).toBe(false);
    expect(d.fxSpin).toBe(0);
    expect(Array.isArray(d.fxScaleCurve)).toBe(true);
  });

  it('exposes its enums as as-const tuples (so ParamsOf narrows them)', () => {
    expect([...CUSTOM_AIM_MODES]).toEqual(['fixed', 'sourceToTarget']);
    expect([...CUSTOM_RENDER_MODES]).toEqual(['sprite', 'plane', 'rope', 'perspective']);
    expect([...CUSTOM_ROLES]).toEqual(['draw', 'displace', 'mask']);
  });

  it('gates every mode-specific knob on its mode, so the Inspector only lights the relevant ones', () => {
    const specs = customPrimitive.params as unknown as Record<string, { enabledWhen?: { param: string; is: unknown } }>;
    for (const k of ['meshSegments', 'waveAmp', 'waveFreq', 'waveSpeed', 'waveAxis']) expect(specs[k].enabledWhen).toEqual({ param: 'renderMode', is: 'plane' });
    for (const k of ['ropeSegments', 'bendAmount', 'bendWave', 'bendCycles', 'bendSpeed']) expect(specs[k].enabledWhen).toEqual({ param: 'renderMode', is: 'rope' });
    for (const k of ['tiltSegments', 'tiltX', 'tiltY', 'tiltDepth']) expect(specs[k].enabledWhen).toEqual({ param: 'renderMode', is: 'perspective' });
    for (const k of ['displaceX', 'displaceY']) expect(specs[k].enabledWhen).toEqual({ param: 'role', is: 'displace' });
    expect(specs.maskInvert.enabledWhen).toEqual({ param: 'role', is: 'mask' });
  });
});

describe('custom instance lifecycle (headless — no image picked)', () => {
  it('constructs with nothing built and is not complete before its duration', () => {
    const c = ctx(true);
    const inst = customPrimitive.spawn(c, defaultsOf(customPrimitive.params));
    expect(c.container.children.length).toBe(0);
    inst.update(100);
    expect(inst.isComplete?.()).toBe(false);
    expect(c.container.children.length).toBe(0);
    inst.destroy();
  });

  it('a one-shot completes exactly at durationMs, so a missing image can never hang a fire', () => {
    const c = ctx(true);
    const inst = customPrimitive.spawn(c, { ...defaultsOf(customPrimitive.params), durationMs: 500 });
    inst.update(499);
    expect(inst.isComplete?.()).toBe(false);
    inst.update(1);
    expect(inst.isComplete?.()).toBe(true);
    inst.destroy();
  });

  it('a staggered scatter one-shot waits for the LAST copy: duration + (count-1) × stagger', () => {
    const c = ctx(true);
    const inst = customPrimitive.spawn(c, { ...defaultsOf(customPrimitive.params), durationMs: 500, count: 4, staggerMs: 100 });
    inst.update(799);
    expect(inst.isComplete?.()).toBe(false);
    inst.update(1);
    expect(inst.isComplete?.()).toBe(true);
    inst.destroy();
  });

  it('the displace / mask roles ignore scatter stagger for completion (one map, not N copies)', () => {
    const c = ctx(true);
    const inst = customPrimitive.spawn(c, { ...defaultsOf(customPrimitive.params), durationMs: 500, count: 4, staggerMs: 100, role: 'mask' });
    inst.update(500);
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
    expect(c.container.position.y).toBe(80);
    inst.destroy();
  });

  it('setAim keeps a real direction and drops a degenerate one', () => {
    const c = ctx(false);
    const inst = customPrimitive.spawn(c, defaultsOf(customPrimitive.params)) as unknown as {
      setAim: (sx: number, sy: number, tx: number, ty: number) => void; aimAngle: number | null; destroy: () => void;
    };
    inst.setAim(0, 0, 10, 0);
    expect(inst.aimAngle).toBeCloseTo(0);
    inst.setAim(0, 0, 0, 10);
    expect(inst.aimAngle).toBeCloseTo(Math.PI / 2);
    inst.setAim(5, 5, 5, 5);
    expect(inst.aimAngle).toBeNull();
    inst.destroy();
  });

  it('structural param churn (mode / count / grid / role) with no image never throws or leaks children', () => {
    const c = ctx(false);
    const base = defaultsOf(customPrimitive.params);
    const inst = customPrimitive.spawn(c, base);
    for (const renderMode of CUSTOM_RENDER_MODES) {
      inst.setParams({ ...base, renderMode, count: 3, sheetCols: 2, sheetRows: 2 });
      inst.update(16);
    }
    for (const role of CUSTOM_ROLES) {
      inst.setParams({ ...base, role });
      inst.update(16);
    }
    expect(c.container.children.length).toBe(0);
    inst.destroy();
  });

  it('a cross-layer role without an effect root (spawned outside a player) is a safe no-op', () => {
    const c = ctx(true); // no effectRoot
    const inst = customPrimitive.spawn(c, { ...defaultsOf(customPrimitive.params), role: 'displace' });
    inst.update(16);
    inst.destroy();
    expect(c.container.children.length).toBe(0);
    expect(c.container.filters).toEqual([]);
  });

  it('destroy leaves the layer container AND the effect root untouched', () => {
    const root = new Container();
    const c = ctx(true, root);
    const inst = customPrimitive.spawn(c, { ...defaultsOf(customPrimitive.params), role: 'mask' });
    inst.update(16); // no image → nothing attached to the root
    inst.destroy();
    expect(c.container.children.length).toBe(0);
    expect(root.children.length).toBe(0);
    expect(root.mask ?? null).toBeNull(); // never assigned (no image) reads back undefined; cleared reads null
    expect(root.filters === null || root.filters === undefined || (root.filters as unknown[]).length === 0).toBe(true);
  });
});
