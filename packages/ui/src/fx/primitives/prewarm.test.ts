import { describe, expect, it, vi } from 'vitest';

// The load-time warm-up's COMPOSITION: the shape bake (Pixi's batch-shader link — the measured 0.6 s
// first-play freeze) must ride `prewarmFxMaterials` for the main canvas and `prewarmSlotRenderer` for the
// under / above canvases, each against the renderer it was handed. The custom-program warms are mocked out:
// they need a GL context, and their own contracts live with their modules.
vi.mock('../shapeTextures', () => ({ prewarmShapeTextures: vi.fn(), SHAPE_NAMES: ['circle'] }));
vi.mock('../particleLayerPool', () => ({ prewarmParticleLayers: vi.fn(), linkParticleMaterialOn: vi.fn(() => ({ id: 'particle' })), particleLayerPoolSize: () => 0, resetParticleLayerPool: vi.fn() }));
vi.mock('./ribbon', () => ({ prewarmRibbonShaders: vi.fn(), linkRibbonShaderOn: vi.fn(() => ({ id: 'ribbon' })) }));
vi.mock('./shockwave', () => ({ prewarmShockwaveShaders: vi.fn(), linkShockwaveShaderOn: vi.fn(() => ({ id: 'shockwave' })) }));
vi.mock('./burst', () => ({}));
vi.mock('./emitter', () => ({}));
vi.mock('./smoke', () => ({}));
vi.mock('./react', () => ({}));
vi.mock('./screen', () => ({}));

const prewarmRibbonShadersCalls = (m: typeof import('./ribbon')) => vi.mocked(m.prewarmRibbonShaders).mock.calls.length;

describe('FX pre-warm composition', () => {
  it('prewarmFxMaterials bakes the shapes (batch-shader link) on the main renderer, after the custom programs', async () => {
    const shapes = await import('../shapeTextures');
    const pool = await import('../particleLayerPool');
    const { prewarmFxMaterials } = await import('./index');
    const renderer = { id: 'main' } as unknown as import('pixi.js').Renderer;
    prewarmFxMaterials(renderer);
    expect(pool.prewarmParticleLayers).toHaveBeenCalledWith(renderer);
    expect(shapes.prewarmShapeTextures).toHaveBeenCalledTimes(1);
    expect(shapes.prewarmShapeTextures).toHaveBeenCalledWith(renderer);
  });

  it('a SLOT renderer gets a link-only set of every program — shapes first — and never the main-context pools', async () => {
    const shapes = await import('../shapeTextures');
    const pool = await import('../particleLayerPool');
    const ribbon = await import('./ribbon');
    const shock = await import('./shockwave');
    const { prewarmSlotRenderer, slotPrewarmSteps } = await import('./index');
    vi.mocked(shapes.prewarmShapeTextures).mockClear();
    vi.mocked(pool.prewarmParticleLayers).mockClear();
    vi.mocked(ribbon.prewarmRibbonShaders).mockClear();
    const under = { id: 'under' } as unknown as import('pixi.js').Renderer;
    const steps = slotPrewarmSteps(under);
    expect(steps.length).toBe(4);
    steps[0]!();
    expect(shapes.prewarmShapeTextures).toHaveBeenCalledWith(under);
    expect(pool.linkParticleMaterialOn, 'the particle link is the SECOND step').not.toHaveBeenCalled();
    prewarmSlotRenderer(under);
    expect(pool.linkParticleMaterialOn).toHaveBeenCalledWith(under);
    expect(ribbon.linkRibbonShaderOn).toHaveBeenCalledWith(under);
    expect(shock.linkShockwaveShaderOn).toHaveBeenCalledWith(under);
    expect(pool.prewarmParticleLayers, 'the pools belong to the main context').not.toHaveBeenCalled();
    expect(prewarmRibbonShadersCalls(ribbon), 'no pooled ribbon warm on a slot').toBe(0);
  });

  it('fxPrewarmSteps links the batch shader (shape bake) FIRST, one program per step', async () => {
    const shapes = await import('../shapeTextures');
    const pool = await import('../particleLayerPool');
    const { fxPrewarmSteps } = await import('./index');
    vi.mocked(shapes.prewarmShapeTextures).mockClear();
    vi.mocked(pool.prewarmParticleLayers).mockClear();
    const renderer = { id: 'main' } as unknown as import('pixi.js').Renderer;
    const steps = fxPrewarmSteps(renderer);
    expect(steps.length).toBe(4);
    expect(shapes.prewarmShapeTextures, 'building the steps must not run them').not.toHaveBeenCalled();
    steps[0]!();
    expect(shapes.prewarmShapeTextures).toHaveBeenCalledWith(renderer);
    expect(pool.prewarmParticleLayers, 'the particle link is a later step').not.toHaveBeenCalled();
    steps[1]!();
    expect(pool.prewarmParticleLayers).toHaveBeenCalledWith(renderer);
    expect(fxPrewarmSteps(null)).toEqual([]);
  });

  it('a null renderer warms nothing', async () => {
    const shapes = await import('../shapeTextures');
    const { prewarmFxMaterials } = await import('./index');
    vi.mocked(shapes.prewarmShapeTextures).mockClear();
    prewarmFxMaterials(null);
    expect(shapes.prewarmShapeTextures).not.toHaveBeenCalled();
  });
});
