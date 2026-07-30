import {
  ParticleContainer,
  Rectangle,
  Texture,
  type Container,
  type Renderer,
  type Shader,
} from 'pixi.js';
import {
  createParticleMaterial,
  setParticleTime,
  updateParticleMaterial,
  updateParticleMaterialShaping,
  type ParticleShaping,
  type ParticleStyle,
} from './particleMaterial';
import { linkShader } from './shaderPool';
import type { FxBlendMode } from './blendModes';

/**
 * Pooled `(Shader, ParticleContainer)` pairs for the three particle primitives (`burst`, `emitter`, `smoke`).
 *
 * ## The defect this fixes (measured 2026-07-30 — see `docs/performance.md`)
 *
 * Every def layer used to build its own `Shader` in the primitive's constructor and free it in `destroy()`
 * with `shader.destroy(true)` — `destroyPrograms = true`. That looked like scrupulous cleanup. It was in fact
 * a **68 ms main-thread freeze per distinct shader, per fire**:
 *
 *  1. `Shader.from({ gl })` resolves its program through `GlProgram.from(src)`, memoised by raw source in a
 *     module-global `programCache`. Fine on its own.
 *  2. `shader.destroy(true)` calls `glProgram.destroy()`, which **nulls that `programCache` entry**. The next
 *     fire misses and constructs a fresh `GlProgram`.
 *  3. Constructing one runs Pixi's preprocessor chain, and `setProgramName` injects
 *     `#define SHADER_NAME pixi-program-fragment-<N>` with a globally incrementing N — so the *preprocessed*
 *     source, and therefore `GlProgram._key`, differs every time.
 *  4. `GlShaderSystem._programDataHash` is keyed by `_key`, so it misses too: full `createProgram` +
 *     `compileShader` ×2 + `linkProgram`, then a blocking `getProgramParameter(LINK_STATUS)` while the driver
 *     compiles. Measured at **68.7 ms** for the posterized-cel particle fragment.
 *  5. Nothing evicts the abandoned `_programDataHash` entries — the hash was observed growing by one per
 *     fire, unbounded, for the whole session.
 *
 * A collision fires `strike-impact` (4 burst + 1 shockwave), `damage-burst` (2 burst + 1 shockwave),
 * `impact-dust` (1 burst) and `self-buff-gold` (1 burst) together — two DISTINCT shader sources — so it paid
 * ~2 × 68 ms ≈ **160 ms** every time. That is the reported "quick but noticeable stutter as cards collide":
 * a ten-frame freeze.
 *
 * **The rule that falls out of it: never pass `true` to `Shader.destroy()` for an FX shader.** Every FX
 * shader's GLSL is a module constant. There is exactly one GL program per source for the life of the page and
 * holding it is `programCache`'s entire job; freeing it is not tidiness, it is discarding the most expensive
 * artifact the effect owns.
 *
 * ## Why a PAIR and not two independent pools
 *
 * A `ParticleContainer` is constructed with `{ texture, shader, … }` and `ParticleContainer.destroy()` calls
 * `this.shader?.destroy()` on the way out, so the two cannot be pooled separately without the container's
 * teardown reaching into a shader we are trying to keep. Pooling them together makes ownership unambiguous:
 * acquire hands out both, release takes back both, and the container's per-uid GPU vertex buffers (allocated
 * by the particle pipe) survive with it.
 *
 * The three primitives construct byte-identical containers (same `boundsArea`, same `dynamicProperties`), so
 * ONE pool serves all three. What differs per fire — texture, blend mode, every shader uniform — is exactly
 * what `acquireParticleLayer` rewrites.
 *
 * ## The reset happens on ACQUIRE, and it is total
 *
 * Resetting on RELEASE is the tempting place and the wrong one: any early return or error on the release path
 * skips it and hands the next caller a dirty object. Everything a previous tenant could have left behind is
 * overwritten on acquire, unconditionally — never a diff, never "only if changed":
 *
 *  - **all twelve shader uniforms** — `updateParticleMaterial` (uBands/uPal/uGlow/uPlateau/uFieldMix/
 *    uTintMode) + `updateParticleMaterialShaping` (uNoise/uWarp/uScroll/uErode/uGain) + `setParticleTime`
 *    (uTime back to 0, so a reused layer doesn't inherit the previous fire's noise phase);
 *  - **texture** and **blendMode**, the two container fields the primitives set themselves;
 *  - **`particleChildren`** truncated to empty, then `pc.update()` so the pipe re-uploads instead of drawing
 *    last fire's vertex buffer for a frame;
 *  - **the container transform** (position/scale/rotation/pivot/skew), **alpha**, **tint** and **visible** —
 *    none of which today's primitives touch, which is exactly why they must be reset: the day one of them
 *    does, the resulting bug would be intermittent and load-dependent, i.e. the worst kind.
 *
 * `boundsArea` is deliberately not reset — it is the same fixed rectangle for all three primitives and each
 * pooled container owns its own instance, so there is nothing to carry over.
 */

/** Ceiling on retained pairs. A collision needs ~8 concurrent particle layers; this leaves generous room for
 *  overlapping combat moments without letting an effect storm grow the pool forever. */
export const PARTICLE_LAYER_POOL_MAX = 24;

/** The `boundsArea` every particle primitive uses: motes drift, so a tight box would cull them as they leave
 *  it. Was duplicated in all three primitives; the pool is now the one place it is written. */
const particleBounds = (): Rectangle => new Rectangle(-2000, -2000, 4000, 4000);

/**
 * All three primitives need per-frame position/rotation/colour/vertex uploads, which is what lets ONE pool
 * serve all three.
 *
 * `rotation: true` in particular is load-bearing and was arrived at rather than assumed (it used to be
 * `false` on the emitter, which had no per-frame rotation at all): burst's `orientToVelocity` and smoke's
 * `spin` both rewrite each particle's `rotation` every frame, and a STATIC attribute is only re-uploaded when
 * the pipe is told the child list changed — so leaving it false risks pinning every particle at its spawn
 * rotation. It is effectively free here anyway: all three call `pc.update()` every frame, which sets
 * `_childrenDirty` and makes `ParticleContainerPipe` re-upload the static buffer regardless, so `aRotation`
 * (one float × four verts) just moves from the static buffer to the dynamic one.
 */
const particleDynamic = (): Record<string, boolean> => ({
  position: true,
  rotation: true,
  color: true,
  vertex: true,
});

export interface ParticleLayer {
  readonly shader: Shader;
  readonly pc: ParticleContainer;
}

/** What acquiring a layer needs to know: everything that varies between two fires. */
export interface ParticleLayerRequest {
  renderer: Renderer;
  /** The per-layer container the player created for this instance. */
  parent: Container;
  texture: Texture;
  blendMode: FxBlendMode;
  style: ParticleStyle;
  shaping: ParticleShaping;
}

const pool: ParticleLayer[] = [];

function buildLayer(renderer: Renderer, style: ParticleStyle, shaping: ParticleShaping): ParticleLayer {
  const shader = createParticleMaterial(renderer, style, shaping);
  const pc = new ParticleContainer({
    // Placeholder: `resetLayer` sets the real shape texture on every acquire, fresh pair included.
    texture: Texture.WHITE,
    shader,
    boundsArea: particleBounds(),
    dynamicProperties: particleDynamic(),
  });
  return { shader, pc };
}

/** Total reset of a layer — pooled or fresh, the same lines run. See the module header. */
function resetLayer(layer: ParticleLayer, req: ParticleLayerRequest): void {
  const { shader, pc } = layer;
  updateParticleMaterial(shader, req.style);
  updateParticleMaterialShaping(shader, req.shaping);
  setParticleTime(shader, 0);
  pc.texture = req.texture;
  pc.blendMode = req.blendMode;
  pc.particleChildren.length = 0;
  pc.update(); // mark the child list dirty so the pipe re-uploads rather than drawing last fire's buffer
  pc.position.set(0, 0);
  pc.scale.set(1, 1);
  pc.pivot.set(0, 0);
  pc.skew.set(0, 0);
  pc.rotation = 0;
  pc.alpha = 1;
  pc.tint = 0xffffff;
  pc.visible = true;
}

/**
 * Hand out a ready-to-use particle layer, mounted into `req.parent`. Pooled when one is available, freshly
 * built otherwise; the caller cannot tell the difference, which is the whole contract.
 */
export function acquireParticleLayer(req: ParticleLayerRequest): ParticleLayer {
  const layer = pool.pop() ?? buildLayer(req.renderer, req.style, req.shaping);
  resetLayer(layer, req);
  req.parent.addChild(layer.pc);
  return layer;
}

/**
 * Give a layer back. MUST be called instead of `pc.destroy()` — the container has to leave its parent before
 * the player destroys that parent with `{ children: true }`, or the pooled container is destroyed underneath
 * us and the next acquire hands out a corpse.
 */
export function releaseParticleLayer(layer: ParticleLayer): void {
  const { pc } = layer;
  pc.removeFromParent();
  pc.particleChildren.length = 0;
  if (pool.length >= PARTICLE_LAYER_POOL_MAX) {
    // Over cap: drop the pair. `pc.destroy()` calls `shader.destroy()` with destroyPrograms = false, which
    // is the safe direction — the compiled GL program stays in Pixi's cache for the next fire.
    pc.destroy({ children: true });
    return;
  }
  pool.push(layer);
}

/**
 * Build `count` pairs at load and force the GL compile+link NOW, off the combat path, so the first collision
 * of a session doesn't pay for it. Best-effort: no renderer, or a renderer not yet ready, just leaves the
 * pool cold and the first fire behaves as it did before.
 */
export function prewarmParticleLayers(renderer: Renderer | null, count = 6): void {
  if (!renderer) return;
  const style: ParticleStyle = {
    palette: [0x000000, 0x000000, 0x000000, 0x000000],
    bands: 4,
    glow: 0,
    plateau: 0.5,
    fieldMix: 0,
    tintMode: 'palette',
  };
  const shaping: ParticleShaping = { noise: [1, 1], warp: 0, scroll: 0, erode: 0, gain: 1 };
  let linked = false;
  while (pool.length < Math.min(count, PARTICLE_LAYER_POOL_MAX)) {
    const layer = buildLayer(renderer, style, shaping);
    if (!linked) {
      linkShader(renderer, layer.shader);
      linked = true; // one link per SOURCE — every pooled shader shares the same compiled program
    }
    pool.push(layer);
  }
}

/** Test/diagnostic surface. */
export function particleLayerPoolSize(): number {
  return pool.length;
}

/** Drop every pooled pair without destroying it. Test surface only — the pool is module-global, so a test
 *  that fills it must be able to hand the next test a clean slate. */
export function resetParticleLayerPool(): void {
  pool.length = 0;
}
