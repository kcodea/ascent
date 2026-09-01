/**
 * Side-effect barrel: importing this registers every built-in primitive (each module calls
 * `registerPrimitive(...)` at load). `playDef.ts`'s `ensureDefsReady()` and the workbench both import THIS
 * instead of each primitive, so a new primitive appears in the picker — and becomes playable — just by being
 * added here.
 *
 * This SHIPS: authored defs play for players, so their primitives (GLSL shader source included) are part of
 * the production bundle — a measured **133,773 B raw / 29,338 B gzipped**, which is the bulk of what un-gating
 * defs costs. It stays behind a DYNAMIC `import()` at every call site so it lands in its OWN chunk rather than
 * the entry chunk: the registration is a top-level function CALL, a side effect Rollup cannot prove away, so a
 * static import would pull all 133 kB into the critical path ahead of first paint. Verified in a real build —
 * the primitives resolve to a separate `assets/index-*.js`, imported from `ensureDefsReady`'s `import()`.
 */
import type { Renderer, Shader } from 'pixi.js';
import { registerFxRuntimeHooks } from '../fxRuntime';
import {
  linkParticleMaterialOn,
  particleLayerPoolSize,
  prewarmParticleLayers,
  resetParticleLayerPool,
} from '../particleLayerPool';
import { resetShaderPools } from '../shaderPool';
import { prewarmShapeTextures } from '../shapeTextures';
import { linkRibbonShaderOn, prewarmRibbonShaders } from './ribbon';
import { linkShockwaveShaderOn, prewarmShockwaveShaders } from './shockwave';
import './ribbon';
import './burst';
import './shockwave';
import './emitter';
import './smoke';
import './react';
import './screen';

/**
 * GL-link every FX shader source NOW, off the combat path.
 *
 * Compiling and linking a shader is a blocking `getProgramParameter(LINK_STATUS)` on the main thread —
 * measured at ~68 ms for the posterized-cel particle fragment (see `particleLayerPool.ts`'s header). It is
 * paid exactly once per source per session either way; the only question is WHEN. Doing it here, at load,
 * means the first collision of a run costs the same as the thousandth instead of freezing for ~160 ms.
 *
 * One link per SOURCE is enough: Pixi caches program data under a source-derived key, so warming one shader
 * warms every other shader (pooled or not) built from the same GLSL. Best-effort throughout — a renderer
 * that isn't ready yet simply leaves the first fire to link, exactly as before.
 */
export function prewarmFxMaterials(renderer: Renderer | null): void {
  for (const step of fxPrewarmSteps(renderer)) step();
}

/**
 * The same warm-up as separately runnable steps, ONE program link each, so the scheduler can spread them
 * across frames instead of stacking every link into the frame the board mounts on. The shape bake goes
 * FIRST: it is the link the first fire is most likely to need (every burst / emitter draws a shape), and on
 * this class of driver the first link in a context carries the compiler's own start-up cost with it.
 */
export function fxPrewarmSteps(renderer: Renderer | null): Array<() => void> {
  if (!renderer) return [];
  return [
    () => prewarmShapeTextures(renderer), // Pixi's OWN batch shader — the 0.6 s first-play freeze
    () => prewarmParticleLayers(renderer),
    () => prewarmRibbonShaders(renderer),
    () => prewarmShockwaveShaders(renderer),
  ];
}

/**
 * The per-CONTEXT warm-up for the under / above slot canvases. Each is its own GL context with its own
 * program cache, and the module-global pools belong to the MAIN context — a def firing on a slot canvas
 * builds its layer against the slot's renderer, so every program it needs links cold there. Measured
 * 2026-09-01 on the prod build: the landing FX plays on the UNDER canvas, and its first fire linked the
 * particle program for ~550 ms even with the main canvas fully warm.
 *
 * So a slot gets one link of every program a def can reach: the batch shader (via the shape bake), the
 * particle material, the ribbon and the shockwave. The linked shaders are never pooled — they are anchored
 * per renderer so the programs stay cached (Pixi drops a program's data when its last shader is destroyed).
 */
const slotWarmAnchors = new WeakMap<Renderer, Shader[]>();

export function slotPrewarmSteps(renderer: Renderer | null): Array<() => void> {
  if (!renderer) return [];
  const keep = (make: (r: Renderer) => Shader) => (): void => {
    try {
      const list = slotWarmAnchors.get(renderer) ?? [];
      list.push(make(renderer));
      slotWarmAnchors.set(renderer, list);
    } catch (e) {
      if (import.meta.env.DEV) console.warn('[fx] slot shader pre-warm failed — first fire will pay for it:', e);
    }
  };
  return [
    () => prewarmShapeTextures(renderer),
    keep(linkParticleMaterialOn),
    keep(linkRibbonShaderOn),
    keep(linkShockwaveShaderOn),
  ];
}

export function prewarmSlotRenderer(renderer: Renderer | null): void {
  for (const step of slotPrewarmSteps(renderer)) step();
}

// Hand the eagerly-loaded half of the app a handle on the pools, now that they exist. Registering HERE (in
// the barrel that loads the primitives) rather than exporting the pools directly is what keeps the GLSL out
// of the entry chunk — see `fxRuntime.ts`'s header.
registerFxRuntimeHooks({
  resetPools: (): void => {
    resetParticleLayerPool();
    resetShaderPools();
  },
  poolSize: particleLayerPoolSize,
});
