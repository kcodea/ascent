import { Particle, ParticleContainer, Rectangle, Shader, type Texture } from 'pixi.js';
import type { FxParamSpecs, ParamsOf } from '../params';
import type { FxContext, FxInstance, FxPrimitive } from '../primitive';
import { PALETTE_PRESETS, paletteTuple } from '../palettes';
import {
  createParticleMaterial,
  updateParticleMaterial,
  updateParticleMaterialShaping,
  setParticleTime,
  biasTint,
  type ParticleShaping,
} from '../particleMaterial';
import { FX_BLEND_MODES } from '../blendModes';
import { SHAPE_NAMES, getShapeTexture, resolveParticleScale } from '../shapeTextures';
import { registerPrimitive } from '../registry';

/**
 * A continuous mote stream — the emitter cousin of the burst primitive. Where a burst fires discrete
 * waves, this spawns motes every frame at a steady (fractional-accurate) rate, drifts them under gravity,
 * and fades them in-then-out over their lifetime. Used for ambient effects that need to keep running while
 * attached to a moving anchor (embers off a burning unit, sparks trailing a channel) rather than a single
 * one-shot pop.
 *
 * Rendered with the shared posterized-cel particle shader (`particleMaterial.ts`) instead of the default
 * particle shader — see `burst.ts`'s header comment (which explains the same wiring) and
 * `particleMaterial.ts` itself for how the shader plumbs into `ParticleContainer`. Motes' `tint` carries a
 * greyscale core-bias (`biasTint`), not a resolved palette colour. The shader also now carries the ribbon's
 * own domain-warped-fbm shaping (noise/warp/scroll/erode/gain, see the `Texture` param group) and a soft
 * additive `glow` — see `particleMaterial.ts`'s `PARTICLE_FRAG` for the shared math.
 */

const SPECS = {
  rate: {
    kind: 'slider', label: 'Rate', group: 'Emit', min: 5, max: 300, step: 5, default: 80,
    help: 'Motes per second.',
  },
  life: {
    kind: 'slider', label: 'Life', group: 'Emit', min: 200, max: 2000, step: 10, default: 700,
    help: 'Mote lifetime in ms.',
  },
  spread: {
    kind: 'slider', label: 'Spread', group: 'Emit', min: 0, max: 1, step: 0.01, default: 1,
    help: '1 = emit in all directions, lower = upward cone.',
  },

  speed: { kind: 'slider', label: 'Speed', group: 'Motion', min: 0, max: 400, step: 5, default: 60, help: 'px/sec initial.' },
  speedVar: { kind: 'slider', label: 'Speed var', group: 'Motion', min: 0, max: 1, step: 0.01, default: 0.4 },
  gravity: {
    kind: 'slider', label: 'Gravity', group: 'Motion', min: -400, max: 400, step: 10, default: -30,
    help: 'px/sec² (negative = rise, like embers).',
  },

  shape: {
    kind: 'enum', label: 'Shape', group: 'Shape', options: SHAPE_NAMES, default: 'circle',
    help: 'Every live particle in the stream shares one base texture, so this swaps all of them at once.',
  },
  size: { kind: 'slider', label: 'Size', group: 'Shape', min: 2, max: 30, step: 1, default: 7 },
  sizeVar: { kind: 'slider', label: 'Size var', group: 'Shape', min: 0, max: 1, step: 0.01, default: 0.4 },
  stretchX: {
    kind: 'slider', label: 'Stretch X', group: 'Shape', min: 0.2, max: 4, step: 0.05, default: 1,
    help: 'Per-particle width multiplier on top of Size — 1 = the shape\'s own baked proportions.',
  },
  stretchY: {
    kind: 'slider', label: 'Stretch Y', group: 'Shape', min: 0.2, max: 4, step: 0.05, default: 1,
    help: 'Per-particle height multiplier on top of Size.',
  },

  coreBias: {
    kind: 'slider', label: 'Core bias', group: 'Style', min: 0, max: 1, step: 0.01, default: 0.5,
    help: '0 = rim colour, 1 = white core.',
  },
  bands: {
    kind: 'slider', label: 'Bands', group: 'Style', min: 1, max: 6, step: 1, default: 3,
    help: 'posterization levels — 3-4 is the cel look, higher washes out',
  },
  fadeIn: {
    kind: 'slider', label: 'Fade in', group: 'Style', min: 0, max: 0.5, step: 0.01, default: 0.1,
    help: 'Fraction of life spent fading in (and, symmetrically, fading out at the end).',
  },
  palette: {
    kind: 'palette', label: 'Palette', group: 'Style',
    default: paletteTuple('violet'), presets: PALETTE_PRESETS,
  },
  blendMode: { kind: 'enum', label: 'Blend mode', group: 'Style', options: FX_BLEND_MODES, default: 'add' },
  glow: {
    kind: 'slider', label: 'Glow', group: 'Style', min: 0, max: 1, step: 0.01, default: 0.25,
    help: 'Soft additive halo behind each particle.',
  },

  noiseScale: {
    kind: 'slider', label: 'Noise scale', group: 'Texture', min: 0.5, max: 20, step: 0.1, default: 6,
    help: 'Domain-warped fbm frequency across each particle — the ribbon\'s uNoise, isotropic here.',
  },
  warp: { kind: 'slider', label: 'Warp', group: 'Texture', min: 0, max: 1.5, step: 0.01, default: 0.35 },
  scroll: { kind: 'slider', label: 'Scroll', group: 'Texture', min: 0, max: 6, step: 0.05, default: 1.4 },
  erode: {
    kind: 'slider', label: 'Erode', group: 'Texture', min: 0, max: 1.2, step: 0.01, default: 0.35,
    help: 'How much the noise eats into each particle\'s shape — higher gives a more tattered edge.',
  },
  gain: { kind: 'slider', label: 'Gain', group: 'Texture', min: 0.3, max: 2, step: 0.01, default: 1.4 },
} satisfies FxParamSpecs;

type EmitterParams = ParamsOf<typeof SPECS>;

/** Pull the ribbon-derived shaping uniforms out of an `EmitterParams` into the shape `particleMaterial.ts`
 *  wants. Kept as one small helper (mirrors `burst.ts`'s own `shapingOf`) so the two call sites can't drift
 *  on which fields map to `noise.x` vs `noise.y`. */
function shapingOf(p: EmitterParams): ParticleShaping {
  return { noise: [p.noiseScale, p.noiseScale], warp: p.warp, scroll: p.scroll, erode: p.erode, gain: p.gain };
}

/** Hard cap on live motes regardless of rate/life, so a pathological param combo can't grow unbounded. */
const MAX_MOTES = 1200;

/**
 * Advance the fractional emit budget by `rate * dtSec` and pull out the whole number of motes to spawn
 * this frame, keeping the remainder for next frame. This is what makes `rate` exact and frame-rate
 * independent: at any framerate the long-run average spawn rate converges to exactly `rate`/sec, rather
 * than truncating a fraction of a mote every frame (which would under-emit, worse at higher framerates).
 * Pure and standalone so it's unit-testable without a WebGL context.
 */
export function advanceEmitBudget(budget: number, rate: number, dtSec: number): { budget: number; spawnCount: number } {
  const b = budget + rate * dtSec;
  const spawnCount = Math.floor(b);
  return { budget: b - spawnCount, spawnCount };
}

/**
 * Whether a one-shot emitter's bounded emission window is still open. The emitter is inherently a
 * continuous stream, so its "Fire" is a bounded puff: emit for one window, then stop and let whatever's
 * already live fade out on its own. The window is chosen as the emitter's own `life` param — one lifespan
 * of continuous emission produces a puff with a natural, self-similar density (motes emitted at the very
 * start of the window have just died by the time the last ones emitted at the end of the window do), rather
 * than a magic constant unrelated to the emitter's own timing. Pure + standalone for the same reason as
 * `advanceEmitBudget`/`moteAlpha` above — unit-testable without a WebGL context.
 */
export function withinEmitWindow(elapsedMs: number, windowMs: number): boolean {
  return elapsedMs < windowMs;
}

/**
 * Pure completion predicate for a one-shot Fire: true once the emission window (see `withinEmitWindow`) has
 * closed AND every mote spawned during it has died. A continuous (non-one-shot) instance is never complete
 * — the loop preview keeps streaming forever by design. Mirrors `burst.ts`'s `burstFireComplete`.
 */
export function emitterFireComplete(oneShot: boolean, elapsedMs: number, windowMs: number, moteCount: number): boolean {
  return oneShot && !withinEmitWindow(elapsedMs, windowMs) && moteCount === 0;
}

/**
 * A mote's alpha at life-fraction `t` (0 at birth, 1 at death): ramps 0→1 over the first `fadeIn` fraction
 * of life, holds at 1, then symmetrically ramps 1→0 over the last `fadeIn` fraction. `fadeIn` is floored to
 * a small epsilon to avoid a division by zero at the param's minimum (0) — at that floor the fade is
 * effectively instant at both ends, which is the expected limit, not a special case. Pure + standalone for
 * the same reason as `advanceEmitBudget`.
 */
export function moteAlpha(t: number, fadeIn: number): number {
  const f = fadeIn > 0.0001 ? fadeIn : 0.0001;
  if (t > 1 - f) return Math.max(0, (1 - t) / f);
  return Math.min(1, t / f);
}

/** A live mote: its rendered `Particle` plus the simulation state driving it. */
interface Mote {
  p: Particle;
  vx: number;
  vy: number;
  age: number;
  maxLife: number;
  fadeIn: number;
  scaleX0: number;
  scaleY0: number;
}

class EmitterInstance implements FxInstance<EmitterParams> {
  private readonly particles: ParticleContainer;
  private readonly renderer: FxContext['renderer'];
  private texture: Texture;
  private readonly shader: Shader;
  private params: EmitterParams;
  private readonly motes: Mote[] = [];
  private originX = 0;
  private originY = 0;
  private headSet = false;
  private clockSec = 0; // drives the shader's uTime — see setParticleTime's own comment
  // True when this instance was spawned for a one-shot Fire (see FxContext.oneShot). Bounds emission to a
  // single window (see `withinEmitWindow`) instead of streaming forever.
  private readonly oneShot: boolean;
  // ms elapsed since this instance's very first update() call — ticks unconditionally once oneShot (not
  // gated on headSet: a Fire's setHead typically lands the same frame as its first update anyway, per
  // burst.ts's constructor comment on call order, so gating here would only ever save a fraction of a
  // frame at the cost of a second piece of state to reason about).
  private emitElapsedMs = 0;
  // Reused scratch object for the emit-budget accumulation — `advanceEmitBudget` (kept pure below for the
  // test suite) would otherwise allocate a fresh `{ budget, spawnCount }` literal every single frame. This
  // mirrors `ribbon.ts`'s cached `shape` scratch object: same values, written in place instead of returned.
  private readonly budgetState = { budget: 0, spawnCount: 0 };

  constructor(ctx: FxContext, params: EmitterParams) {
    this.params = params;
    this.renderer = ctx.renderer;
    this.oneShot = ctx.oneShot === true;
    this.texture = getShapeTexture(ctx.renderer, params.shape);
    this.shader = createParticleMaterial(ctx.renderer, params.palette, params.bands, shapingOf(params), params.glow);
    this.particles = new ParticleContainer({
      texture: this.texture,
      shader: this.shader,
      // Generous fixed bounds: motes drift, so a tight box would get them culled as they leave it. Matches
      // the ribbon/burst house convention of a large static boundsArea rather than per-frame recomputation.
      boundsArea: new Rectangle(-2000, -2000, 4000, 4000),
      dynamicProperties: { position: true, rotation: false, color: true, vertex: true },
    });
    this.particles.blendMode = params.blendMode;
    ctx.container.addChild(this.particles);
  }

  setHead(x: number, y: number): void {
    this.originX = x;
    this.originY = y;
    this.headSet = true;
  }

  update(dtMs: number): void {
    this.clockSec += dtMs / 1000;
    // One uniform write per frame regardless of live mote count (not per-mote) — see `setParticleTime`'s
    // own comment for why this is cheap.
    setParticleTime(this.shader, this.clockSec);

    const dtSec = dtMs / 1000;
    const p = this.params;
    const motes = this.motes;
    const children = this.particles.particleChildren;

    // 1) advance + cull live motes, compacting both arrays in one pass (swap-free — write index trails read
    //    index, so a dead mote is simply not copied forward; no per-mote array splice).
    let write = 0;
    for (let i = 0; i < motes.length; i++) {
      const m = motes[i];
      m.age += dtMs;
      if (m.age >= m.maxLife) continue;
      m.vy += p.gravity * dtSec;
      m.p.x += m.vx * dtSec;
      m.p.y += m.vy * dtSec;
      const t = m.age / m.maxLife;
      m.p.alpha = moteAlpha(t, m.fadeIn);
      const shrink = 1 - 0.25 * t; // gentle shrink over life
      m.p.scaleX = m.scaleX0 * shrink;
      m.p.scaleY = m.scaleY0 * shrink;
      if (write !== i) motes[write] = m;
      children[write] = m.p;
      write++;
    }
    motes.length = write;
    children.length = write;

    // 2) spawn this frame's share, capped so a pathological rate*life combo can't outgrow MAX_MOTES. Gated
    //    on `headSet`: `update()` can run before the first `setHead()` call (e.g. the very first tick after
    //    spawn), and without this guard that would emit a mote or two from the origin default (0,0) —
    //    a single flickering mote at the wrong spot before self-correcting next frame. Skipping the spawn
    //    (but still accumulating the budget below) closes that for free.
    //    In one-shot mode, ALSO gated on the emission window (`withinEmitWindow`) — once the window closes
    //    we stop spawning entirely (existing motes just fade out under step 1 above) rather than streaming
    //    for the whole Fire. `emitElapsedMs` ticks below regardless of whether we actually spawn this frame.
    const bs = this.budgetState;
    const b = bs.budget + p.rate * dtSec;
    bs.spawnCount = Math.floor(b);
    bs.budget = b - bs.spawnCount;
    const emitting = this.headSet && (!this.oneShot || withinEmitWindow(this.emitElapsedMs, p.life));
    if (emitting) {
      const room = MAX_MOTES - motes.length;
      const toSpawn = bs.spawnCount < room ? bs.spawnCount : Math.max(0, room);
      for (let i = 0; i < toSpawn; i++) {
        const mote = this.spawnMote();
        motes.push(mote);
        children.push(mote.p);
      }
    }
    if (this.oneShot) this.emitElapsedMs += dtMs;

    this.particles.update();
  }

  /** See `emitterFireComplete`'s header comment for the completion contract. */
  isComplete(): boolean {
    return emitterFireComplete(this.oneShot, this.emitElapsedMs, this.params.life, this.motes.length);
  }

  setParams(next: EmitterParams): void {
    const shapeChanged = next.shape !== this.params.shape;
    this.params = next;
    this.particles.blendMode = next.blendMode;
    updateParticleMaterial(this.shader, next.palette, next.bands, next.glow);
    updateParticleMaterialShaping(this.shader, shapingOf(next));
    if (shapeChanged) {
      // A ParticleContainer shares exactly ONE base texture across every live particle (see
      // `shapeTextures.ts`'s `getShapeTexture` header comment), so every mote already in flight changes
      // shape on the same frame as new ones — there's no way to have some particles keep the old shape
      // without a second container, and nothing in this workbench needs that.
      this.texture = getShapeTexture(this.renderer, next.shape);
      this.particles.texture = this.texture;
    }
  }

  destroy(): void {
    // The shape texture is shared across every burst/emitter instance (see `shapeTextures.ts`'s
    // `getShapeTexture`) — destroying it here would break every other live/future primitive. Only the
    // container (and the Particle structs it alone owns) and our own shader belong to this instance.
    //
    // Order matters — see burst.ts's `destroy()` for the full explanation: `ParticleContainer.destroy()`
    // also calls `this.shader?.destroy()` internally (destroyPrograms=false) since we handed it our shader
    // in the constructor, and Shader's destroy is a one-shot (`_destroyed` guard). Destroying the shader
    // ourselves first (with `true`, so the compiled GL program is actually freed) makes the container's
    // later internal call a harmless no-op instead of the reverse, which would leak the GL program.
    this.shader.destroy(true);
    this.particles.destroy({ children: true });
  }

  private spawnMote(): Mote {
    const p = this.params;
    const rand = Math.random();
    const spreadRand = Math.random() * 2 - 1;
    // A cone of half-width `spread * PI` centred on "up" (-PI/2, screen convention: +y is down). At
    // spread = 1 the half-width is PI, so the range covers a full 2*PI uniformly regardless of centre —
    // one formula naturally degenerates to "all directions" without a branch.
    const angle = -Math.PI / 2 + spreadRand * p.spread * Math.PI;
    const speedJitter = 1 + (Math.random() * 2 - 1) * p.speedVar;
    const speed = Math.max(0, p.speed * speedJitter);
    const sizeJitter = 1 + (Math.random() * 2 - 1) * p.sizeVar;
    const size = Math.max(0.5, p.size * sizeJitter);
    // Small per-mote core-bias jitter for organic variety in the tint, not just a flat colour per palette.
    // As with burst.ts, this is now a greyscale bias signal for the shader to posterize — NOT a resolved
    // palette colour (that was `tupleBiased`) — so a live palette/band edit repaints every live mote.
    const bias = Math.min(1, Math.max(0, p.coreBias + (rand - 0.5) * 0.12));

    const particle = new Particle({
      texture: this.texture,
      x: this.originX,
      y: this.originY,
      anchorX: 0.5,
      anchorY: 0.5,
      tint: biasTint(bias),
      alpha: 0,
    });
    const { scaleX: scaleX0, scaleY: scaleY0 } = resolveParticleScale(size, p.stretchX, p.stretchY);
    particle.scaleX = scaleX0;
    particle.scaleY = scaleY0;

    return {
      p: particle,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      age: 0,
      maxLife: p.life,
      fadeIn: p.fadeIn,
      scaleX0,
      scaleY0,
    };
  }
}

export const emitterPrimitive: FxPrimitive<typeof SPECS> = {
  id: 'emitter',
  params: SPECS,
  spawn: (ctx, params) => new EmitterInstance(ctx, params),
};

registerPrimitive(emitterPrimitive as FxPrimitive);
