import { Graphics, Particle, ParticleContainer, Rectangle } from 'pixi.js';
import type { Renderer, Texture } from 'pixi.js';
import type { FxParamSpecs, ParamsOf } from '../params';
import type { FxContext, FxInstance, FxPrimitive } from '../primitive';
import { palColorBiased, PALETTE_NAMES } from '../palettes';
import { registerPrimitive } from '../registry';

/**
 * A continuous mote stream — the emitter cousin of the burst primitive. Where a burst fires discrete
 * waves, this spawns motes every frame at a steady (fractional-accurate) rate, drifts them under gravity,
 * and fades them in-then-out over their lifetime. Used for ambient effects that need to keep running while
 * attached to a moving anchor (embers off a burning unit, sparks trailing a channel) rather than a single
 * one-shot pop.
 */

/**
 * The shared soft-round-dot texture every emitter instance tints per-particle. Generated once per renderer
 * (a Graphics circle baked via `generateTexture`, not re-inlined per instance) and cached at module scope —
 * instances never destroy it, only their own `ParticleContainer`. Keyed by renderer identity rather than a
 * `Map` because the workbench only ever runs one renderer at a time; if that ever changes, the worst case is
 * a harmless re-bake, not a leak (the old texture just falls out of the cache, still owned by whichever
 * instances hold a reference to it — GPU-side it's freed only if nothing regenerates it, which is fine since
 * nothing explicitly destroys it either).
 */
let moteTextureCache: { renderer: Renderer; texture: Texture } | null = null;

function getMoteTexture(renderer: Renderer): Texture {
  if (moteTextureCache && moteTextureCache.renderer === renderer) return moteTextureCache.texture;
  const g = new Graphics();
  // Soft edge: a faint wide underlay + a bright core, both plain fills (no per-frame cost — baked once).
  g.circle(0, 0, 16).fill({ color: 0xffffff, alpha: 0.35 });
  g.circle(0, 0, 9).fill({ color: 0xffffff, alpha: 1 });
  const texture = renderer.generateTexture({ target: g, resolution: 2 });
  g.destroy();
  moteTextureCache = { renderer, texture };
  return texture;
}

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

  size: { kind: 'slider', label: 'Size', group: 'Style', min: 2, max: 30, step: 1, default: 7 },
  sizeVar: { kind: 'slider', label: 'Size var', group: 'Style', min: 0, max: 1, step: 0.01, default: 0.4 },
  coreBias: {
    kind: 'slider', label: 'Core bias', group: 'Style', min: 0, max: 1, step: 0.01, default: 0.5,
    help: '0 = rim colour, 1 = white core.',
  },
  fadeIn: {
    kind: 'slider', label: 'Fade in', group: 'Style', min: 0, max: 0.5, step: 0.01, default: 0.1,
    help: 'Fraction of life spent fading in (and, symmetrically, fading out at the end).',
  },
  palette: { kind: 'enum', label: 'Palette', group: 'Style', options: PALETTE_NAMES, default: 'violet' },
  additive: { kind: 'toggle', label: 'Additive', group: 'Style', default: true },
} satisfies FxParamSpecs;

type EmitterParams = ParamsOf<typeof SPECS>;

/** Hard cap on live motes regardless of rate/life, so a pathological param combo can't grow unbounded. */
const MAX_MOTES = 1200;

/** The texture's baked radius (see `getMoteTexture`) — a particle's `size` param maps to scale via this. */
const MOTE_TEXTURE_RADIUS = 16;

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
  baseScale: number;
}

class EmitterInstance implements FxInstance<EmitterParams> {
  private readonly particles: ParticleContainer;
  private readonly texture: Texture;
  private params: EmitterParams;
  private readonly motes: Mote[] = [];
  private originX = 0;
  private originY = 0;
  private emitBudget = 0;

  constructor(ctx: FxContext, params: EmitterParams) {
    this.params = params;
    this.texture = getMoteTexture(ctx.renderer);
    this.particles = new ParticleContainer({
      texture: this.texture,
      // Generous fixed bounds: motes drift, so a tight box would get them culled as they leave it. Matches
      // the ribbon/burst house convention of a large static boundsArea rather than per-frame recomputation.
      boundsArea: new Rectangle(-2000, -2000, 4000, 4000),
      dynamicProperties: { position: true, rotation: false, color: true, vertex: true },
    });
    this.particles.blendMode = params.additive ? 'add' : 'normal';
    ctx.container.addChild(this.particles);
  }

  setHead(x: number, y: number): void {
    this.originX = x;
    this.originY = y;
  }

  update(dtMs: number): void {
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
      const scale = m.baseScale * (1 - 0.25 * t); // gentle shrink over life
      m.p.scaleX = scale;
      m.p.scaleY = scale;
      if (write !== i) motes[write] = m;
      children[write] = m.p;
      write++;
    }
    motes.length = write;
    children.length = write;

    // 2) spawn this frame's share, capped so a pathological rate*life combo can't outgrow MAX_MOTES.
    const { budget, spawnCount } = advanceEmitBudget(this.emitBudget, p.rate, dtSec);
    this.emitBudget = budget;
    const room = MAX_MOTES - motes.length;
    const toSpawn = spawnCount < room ? spawnCount : Math.max(0, room);
    for (let i = 0; i < toSpawn; i++) {
      const mote = this.spawnMote();
      motes.push(mote);
      children.push(mote.p);
    }

    this.particles.update();
  }

  setParams(next: EmitterParams): void {
    this.params = next;
    this.particles.blendMode = next.additive ? 'add' : 'normal';
  }

  destroy(): void {
    // The dot texture is shared across every emitter instance (see `getMoteTexture`) — destroying it here
    // would break every other live/future emitter. Only the container (and the Particle structs it alone
    // owns) belong to this instance.
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
    const bias = Math.min(1, Math.max(0, p.coreBias + (rand - 0.5) * 0.12));

    const particle = new Particle({
      texture: this.texture,
      x: this.originX,
      y: this.originY,
      anchorX: 0.5,
      anchorY: 0.5,
      tint: palColorBiased(p.palette, bias),
      alpha: 0,
    });
    const baseScale = size / MOTE_TEXTURE_RADIUS;
    particle.scaleX = baseScale;
    particle.scaleY = baseScale;

    return {
      p: particle,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      age: 0,
      maxLife: p.life,
      fadeIn: p.fadeIn,
      baseScale,
    };
  }
}

export const emitterPrimitive: FxPrimitive<typeof SPECS> = {
  id: 'emitter',
  params: SPECS,
  spawn: (ctx, params) => new EmitterInstance(ctx, params),
};

registerPrimitive(emitterPrimitive as FxPrimitive);
