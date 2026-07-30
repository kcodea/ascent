import { Container, DOMAdapter, Texture } from 'pixi.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PARTICLE_LAYER_POOL_MAX,
  acquireParticleLayer,
  particleLayerPoolSize,
  releaseParticleLayer,
  resetParticleLayerPool,
  type ParticleLayerRequest,
} from './particleLayerPool';
import type { ParticleShaping, ParticleStyle } from './particleMaterial';
import type { Renderer } from 'pixi.js';

/**
 * These run headless. Nothing here needs a GL context: `ParticleContainer` is a plain scene node until the
 * pipe draws it, and `Shader.from({ gl })` only does string preprocessing + reflection bookkeeping — the
 * compile/link that cost 68 ms per fire happens at DRAW time, which no test reaches. So the object-level
 * pooling contract (the part that produces wrong PIXELS when it breaks) is fully testable here; the timing
 * half is measured in a browser and written up in `docs/performance.md`.
 *
 * `renderer` is only ever threaded through to `createParticleMaterial`, which ignores it (see that function's
 * `_renderer` parameter), so a cast placeholder is honest rather than a mock.
 */
const RENDERER = {} as Renderer;

/**
 * Pixi's `GlProgram` constructor probes fragment precision by creating a `<canvas>` and asking for a WebGL
 * context — which the bare-node test environment has neither of, so `Shader.from` throws on collection.
 * Swapping in a DOM adapter whose canvas yields no context makes it fall back to its own `'mediump'` default,
 * which is all this suite needs: the shader is never drawn here, only inspected.
 */
beforeAll(() => {
  const base = DOMAdapter.get();
  DOMAdapter.set({
    ...base,
    createCanvas: () => ({ getContext: () => null }) as unknown as HTMLCanvasElement,
  });
});

const STYLE_A: ParticleStyle = {
  palette: [0x110000, 0x220000, 0x330000, 0x440000],
  bands: 3,
  glow: 0.75,
  plateau: 0.2,
  fieldMix: 1,
  tintMode: 'texture',
};
const SHAPING_A: ParticleShaping = { noise: [7, 9], warp: 0.5, scroll: 0.25, erode: 0.9, gain: 2 };

const STYLE_B: ParticleStyle = {
  palette: [0x000011, 0x000022, 0x000033, 0x000044],
  bands: 6,
  glow: 0,
  plateau: 0.8,
  fieldMix: 0,
  tintMode: 'palette',
};
const SHAPING_B: ParticleShaping = { noise: [1, 2], warp: 0, scroll: 0, erode: 0, gain: 1 };

const TEX_A = Texture.EMPTY;
const TEX_B = Texture.WHITE;

function request(over: Partial<ParticleLayerRequest> = {}): ParticleLayerRequest {
  return {
    renderer: RENDERER,
    parent: new Container(),
    texture: TEX_A,
    blendMode: 'add',
    style: STYLE_A,
    shaping: SHAPING_A,
    ...over,
  };
}

function uniformsOf(layer: { shader: { resources: Record<string, unknown> } }): Record<string, unknown> {
  return (layer.shader.resources.fxUniforms as { uniforms: Record<string, unknown> }).uniforms;
}

describe('particle layer pool', () => {
  beforeEach(() => {
    resetParticleLayerPool();
  });

  it('reuses the same pair rather than building a new one', () => {
    const first = acquireParticleLayer(request());
    releaseParticleLayer(first);
    expect(particleLayerPoolSize()).toBe(1);
    const second = acquireParticleLayer(request());
    expect(second.pc).toBe(first.pc);
    expect(second.shader).toBe(first.shader);
    expect(particleLayerPoolSize()).toBe(0);
  });

  it('mounts the container into the requesting parent, and unmounts it on release', () => {
    const parent = new Container();
    const layer = acquireParticleLayer(request({ parent }));
    expect(parent.children).toContain(layer.pc);
    releaseParticleLayer(layer);
    expect(parent.children).not.toContain(layer.pc);
    expect(layer.pc.parent).toBeNull();
  });

  // THE classic pooling bug: B renders wearing A's clothes. Every field a previous tenant could have set is
  // asserted, because "we reset most of it" is exactly how this defect survives review.
  it('a recycled layer wears NONE of the previous tenant’s state', () => {
    const a = acquireParticleLayer(request({ texture: TEX_A, blendMode: 'add', style: STYLE_A, shaping: SHAPING_A }));
    // Dirty it the way a live fire would: particles, a moved/faded container, an advanced shader clock.
    a.pc.particleChildren.push({} as never, {} as never);
    a.pc.position.set(123, -456);
    a.pc.scale.set(3, 4);
    a.pc.rotation = 1.2;
    a.pc.alpha = 0.25;
    a.pc.visible = false;
    a.pc.tint = 0xff00ff;
    uniformsOf(a).uTime = 9.5;
    releaseParticleLayer(a);

    const b = acquireParticleLayer(
      request({ texture: TEX_B, blendMode: 'multiply', style: STYLE_B, shaping: SHAPING_B }),
    );
    expect(b.pc).toBe(a.pc); // same object — so every assertion below is about the RESET, not a fresh build

    expect(b.pc.particleChildren).toHaveLength(0);
    expect(b.pc.texture).toBe(TEX_B);
    expect(b.pc.blendMode).toBe('multiply');
    expect(b.pc.x).toBe(0);
    expect(b.pc.y).toBe(0);
    expect(b.pc.scale.x).toBe(1);
    expect(b.pc.scale.y).toBe(1);
    expect(b.pc.rotation).toBe(0);
    expect(b.pc.alpha).toBe(1);
    expect(b.pc.visible).toBe(true);
    expect(b.pc.tint).toBe(0xffffff);

    const u = uniformsOf(b);
    expect(u.uTime).toBe(0); // the noise phase must NOT carry over
    expect(u.uBands).toBe(STYLE_B.bands);
    expect(u.uGlow).toBe(STYLE_B.glow);
    expect(u.uPlateau).toBe(STYLE_B.plateau);
    expect(u.uFieldMix).toBe(STYLE_B.fieldMix);
    expect(u.uTintMode).toBe(0); // 'palette'
    expect(Array.from(u.uNoise as Float32Array)).toEqual([1, 2]);
    expect(u.uWarp).toBe(SHAPING_B.warp);
    expect(u.uScroll).toBe(SHAPING_B.scroll);
    expect(u.uErode).toBe(SHAPING_B.erode);
    expect(u.uGain).toBe(SHAPING_B.gain);
    // Float32 round-trip, so compare with tolerance: stop 0 of STYLE_B is 0x000011 → (0, 0, 17/255, 1).
    const pal = Array.from(u.uPal as Float32Array).slice(0, 4);
    expect(pal[0]).toBe(0);
    expect(pal[1]).toBe(0);
    expect(pal[2]).toBeCloseTo(17 / 255, 6);
    expect(pal[3]).toBe(1);
  });

  // The same reset must run on a FRESH pair too, or the two paths diverge and only the pooled one is tested.
  it('applies the identical reset to a freshly built pair', () => {
    const fresh = acquireParticleLayer(request({ texture: TEX_B, blendMode: 'multiply', style: STYLE_B, shaping: SHAPING_B }));
    expect(particleLayerPoolSize()).toBe(0); // nothing was pooled — this really is a fresh build
    expect(fresh.pc.texture).toBe(TEX_B);
    expect(fresh.pc.blendMode).toBe('multiply');
    expect(uniformsOf(fresh).uBands).toBe(STYLE_B.bands);
    expect(uniformsOf(fresh).uTime).toBe(0);
  });

  it('does not grow without bound — over the cap, the pair is destroyed instead of retained', () => {
    const held = Array.from({ length: PARTICLE_LAYER_POOL_MAX + 3 }, () => acquireParticleLayer(request()));
    for (const layer of held) releaseParticleLayer(layer);
    expect(particleLayerPoolSize()).toBe(PARTICLE_LAYER_POOL_MAX);
  });

  it('never hands out a destroyed container', () => {
    const held = Array.from({ length: PARTICLE_LAYER_POOL_MAX + 2 }, () => acquireParticleLayer(request()));
    for (const layer of held) releaseParticleLayer(layer);
    for (let i = 0; i < PARTICLE_LAYER_POOL_MAX; i++) {
      const layer = acquireParticleLayer(request());
      expect(layer.pc.destroyed).toBe(false);
    }
  });
});
