/// <reference types="vite/client" />
import type { Renderer, Shader } from 'pixi.js';

/**
 * A tiny keyed pool of `Shader` objects, for the two MESH primitives (`ribbon`, `shockwave`).
 *
 * The particle primitives don't use this — their shader can't be pooled apart from the `ParticleContainer`
 * that owns it, so they get their own paired pool in `particleLayerPool.ts`, whose header carries the full
 * write-up of the 68 ms-per-fire shader-recompile defect both pools exist to fix. Read that first; the short
 * version is:
 *
 * > `shader.destroy(true)` evicts Pixi's `programCache` entry, and the `GlProgram` rebuilt in its place gets
 * > a fresh auto-generated `#define SHADER_NAME`, hence a different `_key`, hence a miss in
 * > `GlShaderSystem._programDataHash` too — so every fire re-compiled and re-linked the GLSL and blocked the
 * > main thread in `getProgramParameter(LINK_STATUS)` for ~68 ms. **Never pass `true` to an FX shader's
 * > `destroy()`.**
 *
 * A `Mesh` is safe to keep constructing per fire — `Mesh.destroy()` nulls its `_shader` reference without
 * destroying it, and the geometry is sized per-instance anyway (the ribbon's segment count, the shockwave's
 * radius quad) so it is genuinely per-fire state. Only the shader is shared, and only the shader is pooled.
 *
 * ## The pooling contract (the classic bug, and how this avoids it)
 *
 * A pooled object carries its previous tenant's state. Resetting on RELEASE is the tempting place and the
 * wrong one: any early return or thrown error on the release path skips the reset and hands the next caller a
 * dirty object. `acquireShader` therefore takes the reset as a REQUIRED argument and runs it on every
 * acquire — pooled or freshly built, unconditionally, so a caller cannot forget it and the two paths cannot
 * diverge.
 */

/** Per-key ceiling. Above it, a released shader is destroyed (with `destroyPrograms = false`) rather than
 *  retained, so an effect storm can't grow the pool without bound. */
export const FX_SHADER_POOL_MAX = 16;

const pools = new Map<string, Shader[]>();

/**
 * Which shaders are CURRENTLY sitting in a pool — the guard that makes `releaseShader` idempotent.
 *
 * A double release would put the same `Shader` in the pool twice, after which two live meshes share one
 * uniform group and overwrite each other's palette, clock and shaping every frame; at cap the second release
 * would *destroy* a shader already queued for reuse. Today a double `destroy()` on ribbon/shockwave happens
 * to throw inside `Mesh.destroy()` before it ever reaches here — correct by accident, and not something to
 * rely on when workbench effects are starting and stopping at arbitrary moments.
 *
 * A `WeakSet` rather than a `Set` so a shader dropped over cap isn't retained by the guard.
 */
const pooled = new WeakSet<Shader>();

/**
 * Take a shader for `key` from the pool, or build one. `reset` runs on EVERY acquire and must write every
 * uniform the shader owns — see the pooling-contract note above.
 */
export function acquireShader(key: string, make: () => Shader, reset: (shader: Shader) => void): Shader {
  const shader = pools.get(key)?.pop() ?? make();
  pooled.delete(shader); // out of the pool now — a later release must be allowed to put it back
  reset(shader);
  return shader;
}

/**
 * Return a shader to `key`'s pool, or destroy it if the pool is full. NEVER destroys the GL program.
 *
 * **Idempotent**, and refuses an already-destroyed shader — see `pooled` above for what a second entry
 * would cost.
 */
export function releaseShader(key: string, shader: Shader): void {
  if (pooled.has(shader) || isDestroyed(shader)) return;
  let list = pools.get(key);
  if (!list) {
    list = [];
    pools.set(key, list);
  }
  if (list.length >= FX_SHADER_POOL_MAX) {
    shader.destroy(false); // false — see the module header. Freeing the program IS the bug.
    return;
  }
  pooled.add(shader);
  list.push(shader);
}

/** `Shader` has no public `destroyed` accessor, but `_destroyed` is on its published type — it is the same
 *  one-shot flag `Shader.destroy()` guards itself with. */
function isDestroyed(shader: Shader): boolean {
  return (shader as unknown as { _destroyed?: boolean })._destroyed === true;
}

/**
 * Force a shader's GL compile+link NOW rather than at first draw.
 *
 * `renderer.shader.bind(shader, true)` is what does it: `skipSync = true` resolves only the program
 * (`_getProgramData` → `generateProgram`, the expensive part) and touches no uniforms or bind groups. The
 * program data is cached under the source-derived `_key`, so linking ONE shader warms every other shader
 * built from the same GLSL — pooled or not.
 *
 * Best-effort by design: a renderer that isn't ready yet degrades to the old first-fire cost exactly once,
 * never to a crash.
 */
export function linkShader(renderer: Renderer | null, shader: Shader): void {
  if (!renderer) return;
  try {
    (renderer as unknown as { shader: { bind(s: Shader, skipSync: boolean): void } }).shader.bind(shader, true);
  } catch (e) {
    // Non-fatal: the first real fire links instead, exactly as it did before pre-warming existed.
    if (import.meta.env.DEV) console.warn('[fx] shader pre-warm link failed — first fire will pay for it:', e);
  }
}

/** Build `count` shaders for `key` up front, GL-linking the first one so the whole pool is warm. */
export function prewarmShaders(
  key: string,
  count: number,
  renderer: Renderer | null,
  make: () => Shader,
): void {
  let list = pools.get(key);
  if (!list) {
    list = [];
    pools.set(key, list);
  }
  let linked = false;
  while (list.length < Math.min(count, FX_SHADER_POOL_MAX)) {
    const shader = make();
    if (!linked) {
      linkShader(renderer, shader);
      linked = true; // one link per SOURCE — the program data is shared by _key
    }
    pooled.add(shader);
    list.push(shader);
  }
}

/** Pool depth for `key`. Diagnostic + test surface. */
export function shaderPoolSize(key: string): number {
  return pools.get(key)?.length ?? 0;
}

/**
 * Empty every pool.
 *
 * Not test-only: `pixiFx.detach()` calls it (via `fxRuntime.ts`) because the pools are module-global and
 * outlive the `Application` whose GPU resources their shaders' bind groups were built against. See
 * `particleLayerPool.ts`'s `resetParticleLayerPool` for the full reasoning — it is the same argument, and
 * likewise does not destroy what it drops.
 */
export function resetShaderPools(): void {
  for (const list of pools.values()) {
    for (const shader of list) pooled.delete(shader);
  }
  pools.clear();
}
