/**
 * A one-field registry letting eagerly-loaded code (`pixiFx.ts`, `playDef.ts`) reach into the LAZILY-loaded
 * FX primitive runtime without importing it.
 *
 * ## Why the indirection instead of a plain import
 *
 * `particleLayerPool.ts` transitively pulls `particleMaterial.ts`, i.e. the posterized-cel GLSL — and the
 * primitives (~134 kB of shader source and param specs) live in their OWN lazily-fetched chunk on purpose,
 * behind `ensureDefsReady()`'s dynamic `import('./primitives')`, so they are not in the critical path ahead
 * of first paint (see `primitives/index.ts`'s header). A static import of the pool from `pixiFx.ts` — which
 * every session loads immediately — would drag all of it into the entry chunk and silently undo that split.
 *
 * The registry also states a truth the import would obscure: **the pools only exist once the FX runtime has
 * loaded.** A session that never fires a def has nothing to tear down, and `resetFxPools()` correctly does
 * nothing rather than forcing the chunk to load just to clear two empty arrays.
 */

export interface FxRuntimeHooks {
  /** Empty the shader + particle-layer pools. Called by `pixiFx.detach()` — the pools are module-global and
   *  outlive the `Application` whose GPU resources they were built against. */
  resetPools(): void;
  /** Current particle-layer pool depth, for the DEV `window.__fx.poolSize()` diagnostic. */
  poolSize(): number;
}

let hooks: FxRuntimeHooks | null = null;

/** Called once by `primitives/index.ts` as it loads. */
export function registerFxRuntimeHooks(next: FxRuntimeHooks): void {
  hooks = next;
}

/** Drop everything the FX pools are holding. A no-op when the primitives never loaded. */
export function resetFxPools(): void {
  hooks?.resetPools();
}

/** Particle-layer pool depth, or 0 when the primitives never loaded. */
export function fxPoolSize(): number {
  return hooks?.poolSize() ?? 0;
}
