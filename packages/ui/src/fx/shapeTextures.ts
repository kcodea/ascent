import { Graphics, Texture, type Renderer } from 'pixi.js';

/**
 * Shared shape textures for `burst`/`emitter`'s particles — the "shapes" half of the owner's ribbon-parity
 * ask (noise/warp/erode/gain came first, see `particleMaterial.ts`). Previously each primitive baked its own
 * single hard-coded silhouette (burst's shard diamond, emitter's soft round mote); this generalizes that into
 * one shared, cached generator so any primitive can pick from a common shape set at the `shape` param.
 */

export const SHAPE_NAMES = ['circle', 'square', 'triangle', 'star', 'diamond', 'shard'] as const;
export type ShapeName = (typeof SHAPE_NAMES)[number];

/**
 * The canonical unit every shape is baked at (px, at scale 1) — burst/emitter map their `size` param onto
 * this via `size / SHAPE_UNIT`, the same convention the pre-existing bespoke textures already used
 * (`SHARD_LONG_AXIS = 24`, `MOTE_TEXTURE_RADIUS * 2 = 32`). Picking ONE shared unit (rather than a
 * per-shape one) is what makes switching `shape` not also silently rescale the particle: a given `size`
 * value renders at the same footprint regardless of which shape is selected.
 */
export const SHAPE_UNIT = 32;

/** Half of `SHAPE_UNIT` — the radius/half-extent every shape is drawn out to. */
const R = SHAPE_UNIT / 2;

/**
 * Draw one shape into `g`, centred on the origin, filled white (tinted per-particle at draw time via
 * `Particle.tint`, exactly like the old `getShardTexture`/`getMoteTexture`). `circle` and `shard` reproduce
 * the two pre-existing bespoke textures byte-for-byte in proportion (soft outer ring + hard core for
 * circle, matching the old mote; the elongated diamond for shard, matching the old burst default) so
 * switching to those two shapes — or leaving a primitive on its old default — doesn't shift the established
 * look. The other four are new, plain hard-edged fills.
 */
function draw(shape: ShapeName, g: Graphics): void {
  switch (shape) {
    case 'circle':
      // Soft outer ring + bright core — verbatim proportions from the old `getMoteTexture` (radius 16 @
      // alpha 0.35, radius 9 @ alpha 1; 9/16 = 0.5625).
      g.circle(0, 0, R).fill({ color: 0xffffff, alpha: 0.35 });
      g.circle(0, 0, R * 0.5625).fill({ color: 0xffffff, alpha: 1 });
      break;
    case 'square':
      g.rect(-R, -R, SHAPE_UNIT, SHAPE_UNIT).fill(0xffffff);
      break;
    case 'diamond':
      g.poly([0, -R, R, 0, 0, R, -R, 0]).fill(0xffffff);
      break;
    case 'triangle':
      g.poly([0, -R, R * 0.87, R * 0.5, -R * 0.87, R * 0.5]).fill(0xffffff);
      break;
    case 'star': {
      const points = 5;
      const outer = R;
      const inner = R * 0.42;
      const verts: number[] = [];
      for (let i = 0; i < points * 2; i++) {
        const rad = i % 2 === 0 ? outer : inner;
        const a = (Math.PI * i) / points - Math.PI / 2;
        verts.push(Math.cos(a) * rad, Math.sin(a) * rad);
      }
      g.poly(verts).fill(0xffffff);
      break;
    }
    case 'shard':
      // Verbatim proportions from the old `getShardTexture` (a shallow elongated diamond, long axis +x).
      g.poly([-R, 0, -R * 0.35, -R * 0.58, R, 0, -R * 0.35, R * 0.58]).fill(0xffffff);
      break;
  }
}

/** One cache of baked shape textures per `Renderer`, matching the `WeakMap<Renderer, ...>` convention
 *  `burst.ts`'s old `shardTextureCache` / `emitter.ts`'s old `moteTextureCache` used — a second renderer
 *  (a second workbench preview, a test) gets its own set, and the whole map falls out of scope with the
 *  renderer it belongs to. Nested `Map<ShapeName, Texture>` so all six shapes for one renderer share a
 *  single WeakMap entry instead of six. */
const shapeTextureCache = new WeakMap<Renderer, Map<ShapeName, Texture>>();

/**
 * Get (or bake) the shared texture for `shape`. `aspect` is accepted for call-site symmetry with a future
 * per-aspect bake, but is deliberately NOT used today, for two reasons: (1) a `ParticleContainer` has
 * exactly ONE base texture shared by every live particle (see `burst.ts`/`emitter.ts`'s `setParams` —
 * switching `shape` reassigns `pc.texture` and every particle changes at once), so per-aspect textures
 * would defeat that sharing the moment two particles in the same container wanted different aspects; and
 * (2) burst/emitter instead apply width/height as a per-particle `scaleX`/`scaleY` stretch (`stretchX`/
 * `stretchY` params, via `resolveParticleScale` below) so aspect varies per-particle for free without any
 * extra baked textures at all. If a future shape ever needs a genuinely different SILHOUETTE at different
 * aspects (not just a stretched one), key the cache on a rounded `aspect` bucket then.
 */
export function getShapeTexture(renderer: Renderer, shape: ShapeName, _aspect: number = 1): Texture {
  let byShape = shapeTextureCache.get(renderer);
  if (!byShape) {
    byShape = new Map();
    shapeTextureCache.set(renderer, byShape);
  }
  const cached = byShape.get(shape);
  if (cached) return cached;
  const g = new Graphics();
  draw(shape, g);
  const texture = renderer.generateTexture({ target: g, resolution: 2 });
  g.destroy();
  byShape.set(shape, texture);
  return texture;
}

/**
 * Bake every built-in shape NOW, off the play path — and with it, GL-link Pixi's DEFAULT BATCH SHADER.
 *
 * The first minion played in a run froze the page for 0.6–0.8 s in the prod build (8 headed-Chrome runs,
 * 2026-09-01). A CPU profile through the sourcemaps put ~620 ms of it in `getProgramParameter` under
 * `GlBatchAdaptor.start → GlShaderSystem.bind`, reached from THIS module's `generateTexture` — i.e. the very
 * first `Graphics` the session ever rasterised compiled the batcher program (Pixi v8's multi-texture
 * megashader, the most expensive link in the app) synchronously, on the first fire. `prewarmFxMaterials`
 * already links the custom particle / ribbon / shockwave programs at load; it never touched the batcher,
 * because nothing it built drew a Graphics. Baking the six shapes here does exactly what the first fire
 * would have done, so the link (and the raster) is paid during a screen that has time to spare.
 *
 * Per RENDERER, like the cache it fills: each slot canvas (over / under / above) is its own GL context with
 * its own program cache, so the batcher links once per context — warm every slot renderer that exists.
 * Best-effort throughout: a failure leaves the first fire to bake, exactly as before.
 */
export function prewarmShapeTextures(renderer: Renderer | null): void {
  if (!renderer) return;
  for (const shape of SHAPE_NAMES) {
    try {
      getShapeTexture(renderer, shape);
    } catch (e) {
      if (import.meta.env.DEV) console.warn(`[fx] shape pre-bake failed for '${shape}' — first fire will pay for it:`, e);
      return;
    }
  }
}

/**
 * A particle's `scaleX`/`scaleY` for a given `size` (the base, in px — what `size / SHAPE_UNIT` has always
 * meant) and a `stretchX`/`stretchY` multiplier (1 = the shape's own baked proportions, >1 wider/taller,
 * <1 narrower/shorter). Pulled out as a pure function — shared by `burst.ts` and `emitter.ts` so the
 * size→scale formula can't drift between the two primitives — and unit-testable without a WebGL context,
 * unlike everything else in this module (texture generation needs a live `Renderer`).
 */
export function resolveParticleScale(
  size: number,
  stretchX: number,
  stretchY: number,
): { scaleX: number; scaleY: number } {
  const base = size / SHAPE_UNIT;
  return { scaleX: base * stretchX, scaleY: base * stretchY };
}
