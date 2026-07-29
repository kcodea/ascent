import { describe, expect, it } from 'vitest';
import { SHAPE_NAMES, SHAPE_UNIT, resolveParticleScale } from './shapeTextures';

// `getShapeTexture` bakes a real Pixi texture (Graphics -> renderer.generateTexture) and so needs a live
// Renderer to exercise meaningfully — the same constraint `particleMaterial.test.ts`/`burst.test.ts`
// document for their own Renderer-dependent constructors ("can't be exercised without a WebGL context...
// covered by the coordinator's manual/visual verification instead"). `resolveParticleScale` is the one
// piece of this module's logic that's pure (no Pixi/GL dependency), plus the shape of `SHAPE_NAMES` itself,
// so those are what's unit-tested here.
describe('SHAPE_NAMES', () => {
  it('has no duplicate shape ids', () => {
    expect(new Set(SHAPE_NAMES).size).toBe(SHAPE_NAMES.length);
  });

  it('includes both pre-existing bespoke shapes (circle for the old mote, shard for the old burst)', () => {
    expect(SHAPE_NAMES).toContain('circle');
    expect(SHAPE_NAMES).toContain('shard');
  });
});

describe('resolveParticleScale', () => {
  it('at stretch 1/1, scale is just size / SHAPE_UNIT on both axes (a plain, unstretched particle)', () => {
    const { scaleX, scaleY } = resolveParticleScale(16, 1, 1);
    expect(scaleX).toBeCloseTo(16 / SHAPE_UNIT);
    expect(scaleY).toBeCloseTo(16 / SHAPE_UNIT);
  });

  it('stretchX and stretchY apply independently, on top of the same base scale', () => {
    const base = 16 / SHAPE_UNIT;
    const { scaleX, scaleY } = resolveParticleScale(16, 2, 0.5);
    expect(scaleX).toBeCloseTo(base * 2);
    expect(scaleY).toBeCloseTo(base * 0.5);
  });

  it('is linear in size for a fixed stretch (doubling size doubles both scale axes)', () => {
    const a = resolveParticleScale(10, 1.5, 0.75);
    const b = resolveParticleScale(20, 1.5, 0.75);
    expect(b.scaleX).toBeCloseTo(a.scaleX * 2);
    expect(b.scaleY).toBeCloseTo(a.scaleY * 2);
  });

  it('size 0 collapses to zero scale regardless of stretch', () => {
    const { scaleX, scaleY } = resolveParticleScale(0, 3, 5);
    expect(scaleX).toBe(0);
    expect(scaleY).toBe(0);
  });
});
