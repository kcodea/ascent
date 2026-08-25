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
import type { Renderer } from 'pixi.js';
import { registerFxRuntimeHooks } from '../fxRuntime';
import {
  particleLayerPoolSize,
  prewarmParticleLayers,
  resetParticleLayerPool,
} from '../particleLayerPool';
import { resetShaderPools } from '../shaderPool';
import { prewarmRibbonShaders } from './ribbon';
import { prewarmShockwaveShaders } from './shockwave';
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
  if (!renderer) return;
  prewarmParticleLayers(renderer);
  prewarmRibbonShaders(renderer);
  prewarmShockwaveShaders(renderer);
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
