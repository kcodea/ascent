import { Graphics, Particle, ParticleContainer, Rectangle, type Renderer, type Texture } from 'pixi.js';
import type { FxParamSpecs, ParamsOf } from '../params';
import type { FxContext, FxInstance, FxPrimitive } from '../primitive';
import { palColorBiased, PALETTE_NAMES } from '../palettes';
import { registerPrimitive } from '../registry';

/**
 * A one-shot radial particle burst (a spray of shards flying outward from a point) that re-fires on a
 * fixed interval for the looping workbench preview. Built on `ParticleContainer`/`Particle` (NOT Sprites —
 * see the pixijs-scene-particle-container skill) since we may have hundreds of short-lived particles live
 * at once and a per-particle Sprite/Container would be far too heavy for that.
 */

/** The shard's long axis in local px at scale 1 — `size` maps onto this via `size / SHARD_LONG_AXIS`. */
const SHARD_LONG_AXIS = 24;

/** Hard cap on simultaneously-live particles so a fast interval + high count can't grow unbounded. */
const MAX_LIVE = 800;

/** ms/frame at 60fps — `drag` is specified as "per-16.7ms retention", so `drag^(dtMs / DRAG_REF_MS)`
 *  normalises it to whatever the actual frame delta is. */
const DRAG_REF_MS = 1000 / 60;

/**
 * One small white shard texture, generated once per `Renderer` and shared across every burst instance
 * (tinted per-particle at draw time via `Particle.tint`). Cached in a `WeakMap` keyed by renderer so a
 * second renderer (a second workbench preview, a test) gets its own texture, and so the cache doesn't
 * outlive the renderer it belongs to. Never destroyed by an instance's `destroy()` — only the renderer
 * going away would invalidate it, and nothing here owns the renderer.
 */
const shardTextureCache = new WeakMap<Renderer, Texture>();

function getShardTexture(renderer: Renderer): Texture {
  const cached = shardTextureCache.get(renderer);
  if (cached) return cached;
  const half = SHARD_LONG_AXIS / 2;
  const g = new Graphics()
    // A shallow elongated diamond / chevron, long axis along +x, centered on the origin (so a particle
    // with anchor 0.5/0.5 spins and scales about its own middle, and `rotation` aims it along travel).
    .poly([-half, 0, -half * 0.35, -half * 0.58, half, 0, -half * 0.35, half * 0.58])
    .fill(0xffffff);
  const texture = renderer.generateTexture({ target: g, resolution: 2 });
  g.destroy();
  shardTextureCache.set(renderer, texture);
  return texture;
}

/**
 * Sample one particle's emission angle (radians). `spread` 1 = full circle, independent of `travelAngle`;
 * below 1 it narrows to a cone of half-width `spread * PI` centred on `travelAngle`. Pulled out as a pure
 * function (no Pixi/renderer dependency) so it's unit-testable without a WebGL context — this is the one
 * piece of the primitive's logic that isn't rendering. `rand` must return a uniform value in `[0, 1)`.
 */
export function sampleBurstAngle(travelAngle: number, spread: number, rand: () => number): number {
  if (spread >= 1) return rand() * Math.PI * 2;
  const halfWidth = spread * Math.PI;
  return travelAngle + (rand() * 2 - 1) * halfWidth;
}

const SPECS = {
  count: {
    kind: 'slider', label: 'Count', group: 'Emit', min: 4, max: 120, step: 1, default: 28,
    help: 'Particles per burst.',
  },
  interval: {
    kind: 'slider', label: 'Interval', group: 'Emit', min: 100, max: 2000, step: 10, default: 600,
    help: 'ms between re-fires (the preview loops).',
  },
  spread: {
    kind: 'slider', label: 'Spread', group: 'Emit', min: 0, max: 1, step: 0.01, default: 1,
    help: '1 = full circle, lower narrows to a forward cone along the travel direction.',
  },

  speed: { kind: 'slider', label: 'Speed', group: 'Motion', min: 20, max: 800, step: 5, default: 260, help: 'px/sec initial.' },
  speedVar: {
    kind: 'slider', label: 'Speed var', group: 'Motion', min: 0, max: 1, step: 0.01, default: 0.5,
    help: 'Randomises speed ± this fraction.',
  },
  drag: {
    kind: 'slider', label: 'Drag', group: 'Motion', min: 0.7, max: 1, step: 0.005, default: 0.9,
    help: 'Per-16.7ms velocity retention.',
  },
  gravity: {
    kind: 'slider', label: 'Gravity', group: 'Motion', min: -400, max: 800, step: 10, default: 0,
    help: 'px/sec² downward.',
  },
  life: { kind: 'slider', label: 'Life', group: 'Motion', min: 120, max: 1500, step: 10, default: 450, help: 'Particle lifetime ms.' },

  size: { kind: 'slider', label: 'Size', group: 'Style', min: 2, max: 40, step: 1, default: 9 },
  sizeVar: { kind: 'slider', label: 'Size var', group: 'Style', min: 0, max: 1, step: 0.01, default: 0.5 },
  coreBias: {
    kind: 'slider', label: 'Core bias', group: 'Style', min: 0, max: 1, step: 0.01, default: 0.5,
    help: '0 = rim colour, 1 = white core.',
  },
  palette: { kind: 'enum', label: 'Palette', group: 'Style', options: PALETTE_NAMES, default: 'violet' },
  additive: { kind: 'toggle', label: 'Additive', group: 'Style', default: true },
} satisfies FxParamSpecs;

type BurstParams = ParamsOf<typeof SPECS>;

/** Per-particle bookkeeping the `Particle` struct itself doesn't carry (velocity, spin, age/life). Kept as
 *  a flat array of plain objects, mutated in place every frame — no per-frame allocation. */
interface LiveParticle {
  particle: Particle;
  vx: number;
  vy: number;
  spin: number; // rad/sec
  age: number; // ms
  maxLife: number; // ms
  baseScale: number;
}

class BurstInstance implements FxInstance<BurstParams> {
  private readonly pc: ParticleContainer;
  private readonly texture: Texture;
  private params: BurstParams;
  private readonly live: LiveParticle[] = [];
  private headX = 0;
  private headY = 0;
  // `setHead` has landed at least once with a real anchor position. Gates the very first wave — see the
  // constructor comment below for why we can't just emit on construction.
  private headSet = false;
  private firstEmitDone = false;
  private travelAngle = 0; // radians; last known non-zero travel direction, aims the cone when spread < 1
  private timer = 0; // ms since last emit

  constructor(ctx: FxContext, params: BurstParams) {
    this.params = params;
    this.texture = getShardTexture(ctx.renderer);
    this.pc = new ParticleContainer({
      texture: this.texture,
      boundsArea: new Rectangle(-2000, -2000, 4000, 4000),
      dynamicProperties: { position: true, rotation: true, color: true, vertex: true },
    });
    this.pc.blendMode = params.additive ? 'add' : 'normal';
    ctx.container.addChild(this.pc);
    // Deliberately no emit here. `headX/headY` default to (0, 0) until the first real `setHead()` call,
    // and the real caller (`FxPlayer.update` → this instance's `update()`, THEN `FxPlayer.setHead` →
    // this instance's `setHead()` — see Workbench.tsx's ticker, which calls `p.update(dtMs)` before
    // `p.setHead(0, pt.x, pt.y)` every frame) has no calling order where `setHead` runs before the first
    // `update`. Emitting here fired the whole first wave at the container's local origin instead of the
    // intended anchor. The first wave now fires from `update()` once `headSet` flips true instead.
  }

  setHead(x: number, y: number): void {
    const dx = x - this.headX;
    const dy = y - this.headY;
    // Only derive a travel angle once we have a real prior head to diff against — otherwise the very
    // first call would diff against the (0, 0) default and bake in a bogus direction.
    if (this.headSet && dx * dx + dy * dy > 0.01) this.travelAngle = Math.atan2(dy, dx);
    this.headX = x;
    this.headY = y;
    this.headSet = true;
  }

  /** Push `count` fresh particles into both `live` and the container's `particleChildren` at the current
   *  head position. Called only from `update()` (never the constructor — see there). */
  private emit(): void {
    const p = this.params;
    const room = MAX_LIVE - this.live.length;
    const n = Math.min(p.count, room);
    const children = this.pc.particleChildren;
    for (let i = 0; i < n; i++) {
      const angle = sampleBurstAngle(this.travelAngle, p.spread, Math.random);
      const speed = p.speed * (1 + (Math.random() * 2 - 1) * p.speedVar);
      const size = Math.max(0.5, p.size * (1 + (Math.random() * 2 - 1) * p.sizeVar));
      const baseScale = size / SHARD_LONG_AXIS;
      const tint = palColorBiased(p.palette, p.coreBias * Math.random());
      const particle = new Particle({
        texture: this.texture,
        x: this.headX,
        y: this.headY,
        anchorX: 0.5,
        anchorY: 0.5,
        rotation: angle,
        scaleX: baseScale,
        scaleY: baseScale,
        tint,
        alpha: 1,
      });
      this.live.push({
        particle,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        spin: (Math.random() * 2 - 1) * 6,
        age: 0,
        maxLife: Math.max(1, p.life),
        baseScale,
      });
      children.push(particle);
    }
  }

  update(dtMs: number): void {
    const dtSec = dtMs / 1000;
    const dragF = Math.pow(this.params.drag, dtMs / DRAG_REF_MS);
    const gravity = this.params.gravity;
    const live = this.live;
    const children = this.pc.particleChildren;

    // Advance + cull dead particles, compacting `live` and `particleChildren` together in a single
    // forward pass (write index trails read index — mirrors emitter.ts's pattern). A whole wave shares
    // `maxLife` and so tends to die on the same frame; per-particle `ParticleContainer.removeParticle`
    // (an `indexOf` + `splice` each call) would make that O(n*m). This pass is O(n) regardless.
    let write = 0;
    for (let i = 0; i < live.length; i++) {
      const lp = live[i];
      lp.age += dtMs;
      if (lp.age >= lp.maxLife) continue;
      const particle = lp.particle;
      particle.x += lp.vx * dtSec;
      particle.y += lp.vy * dtSec;
      lp.vy += gravity * dtSec;
      lp.vx *= dragF;
      lp.vy *= dragF;
      particle.rotation += lp.spin * dtSec;

      const frac = 1 - lp.age / lp.maxLife; // 1 -> 0 over life
      particle.alpha = frac * frac;
      const scale = lp.baseScale * frac;
      particle.scaleX = scale;
      particle.scaleY = scale;

      if (write !== i) live[write] = lp;
      children[write] = particle;
      write++;
    }
    live.length = write;
    children.length = write;

    // Fire: the very first wave waits for a real anchor position (see `setHead` / the constructor
    // comment above); every wave after that follows the fixed interval timer.
    if (!this.firstEmitDone) {
      if (this.headSet) {
        this.emit();
        this.firstEmitDone = true;
        this.timer = 0;
      }
    } else {
      this.timer += dtMs;
      if (this.timer >= this.params.interval) {
        // Guard against a runaway re-fire loop if a huge dt (tab was backgrounded) blows past several
        // intervals at once — fire once and resync rather than emitting a burst per missed interval.
        this.timer = this.timer % this.params.interval;
        this.emit();
      }
    }

    this.pc.update();
  }

  setParams(next: BurstParams): void {
    this.params = next;
    this.pc.blendMode = next.additive ? 'add' : 'normal';
  }

  destroy(): void {
    // Only the ParticleContainer is ours to free — the shard texture is shared across every burst
    // instance (cached per-renderer above) and must outlive any single instance's destroy().
    this.pc.destroy({ children: true });
  }
}

export const burstPrimitive: FxPrimitive<typeof SPECS> = {
  id: 'burst',
  params: SPECS,
  spawn: (ctx, params) => new BurstInstance(ctx, params),
};

registerPrimitive(burstPrimitive as FxPrimitive);
