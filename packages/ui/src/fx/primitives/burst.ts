import { Particle, ParticleContainer, Rectangle, Shader, type Texture } from 'pixi.js';
import type { FxParamSpecs, ParamsOf } from '../params';
import type { FxContext, FxInstance, FxPrimitive } from '../primitive';
import { PALETTE_PRESETS, paletteTuple } from '../palettes';
import { sampleCurve, CURVE_PRESETS } from '../curve';
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
 * A one-shot radial particle burst (a spray of shards flying outward from a point) that re-fires on a
 * fixed interval for the looping workbench preview. Built on `ParticleContainer`/`Particle` (NOT Sprites —
 * see the pixijs-scene-particle-container skill) since we may have hundreds of short-lived particles live
 * at once and a per-particle Sprite/Container would be far too heavy for that.
 *
 * Rendered with the shared posterized-cel particle shader (`particleMaterial.ts`) instead of the default
 * particle shader, so shards read as hard-edged chunks of the ribbon's energy style rather than soft tinted
 * dots — see that module's header comment for how the shader plumbs into `ParticleContainer`. Each shard's
 * `tint` no longer carries a pre-resolved palette colour (that was `tupleBiased`); it now carries a
 * greyscale "core bias" (`biasTint`) that the shader un-premultiplies and posterizes against the live
 * `uPal`/`uBands` uniforms, so a palette or band edit repaints every live shard instantly. The shader also
 * now carries the ribbon's own domain-warped-fbm shaping (noise/warp/scroll/erode/gain, see the `Texture`
 * param group) and a soft additive `glow` — see `particleMaterial.ts`'s `PARTICLE_FRAG` for the shared math.
 */

/** Hard cap on simultaneously-live particles so a fast interval + high count can't grow unbounded. */
const MAX_LIVE = 800;

/** ms/frame at 60fps — `drag` is specified as "per-16.7ms retention", so `drag^(dtMs / DRAG_REF_MS)`
 *  normalises it to whatever the actual frame delta is. */
const DRAG_REF_MS = 1000 / 60;

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

/**
 * Pure completion predicate for a one-shot Fire: true once the burst has fired its single wave AND every
 * particle from it has died. Pulled out of `BurstInstance.isComplete()` so the state machine's core logic
 * is unit-testable without a WebGL-constructed instance (see `burst.test.ts`'s note on why the rest of the
 * one-shot state machine can't be exercised headlessly). A continuous (non-one-shot) instance is never
 * complete — the loop preview keeps re-firing forever by design.
 */
export function burstFireComplete(oneShot: boolean, fired: boolean, liveCount: number): boolean {
  return oneShot && fired && liveCount === 0;
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

  shape: {
    kind: 'enum', label: 'Shape', group: 'Shape', options: SHAPE_NAMES, default: 'shard',
    help: 'Every live particle in the burst shares one base texture, so this swaps all of them at once.',
  },
  size: { kind: 'slider', label: 'Size', group: 'Shape', min: 2, max: 40, step: 1, default: 9 },
  sizeVar: { kind: 'slider', label: 'Size var', group: 'Shape', min: 0, max: 1, step: 0.01, default: 0.5 },
  stretchX: {
    kind: 'slider', label: 'Stretch X', group: 'Shape', min: 0.2, max: 4, step: 0.05, default: 1,
    help: 'Per-particle width multiplier on top of Size — 1 = the shape\'s own baked proportions.',
  },
  stretchY: {
    kind: 'slider', label: 'Stretch Y', group: 'Shape', min: 0.2, max: 4, step: 0.05, default: 1,
    help: 'Per-particle height multiplier on top of Size.',
  },
  sizeCurve: {
    kind: 'curve', label: 'Size / life', group: 'Shape',
    default: [[0, 1], [1, 0]], presets: CURVE_PRESETS,
    help: 'Size multiplier over each particle\'s life (0 = birth, 1 = death).',
  },

  coreBias: {
    kind: 'slider', label: 'Core bias', group: 'Style', min: 0, max: 1, step: 0.01, default: 0.5,
    help: '0 = rim colour, 1 = white core.',
  },
  bands: {
    kind: 'slider', label: 'Bands', group: 'Style', min: 1, max: 6, step: 1, default: 3,
    help: 'posterization levels — 3-4 is the cel look, higher washes out',
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

type BurstParams = ParamsOf<typeof SPECS>;

/** Pull the ribbon-derived shaping uniforms out of a `BurstParams` into the shape `particleMaterial.ts`
 *  wants. Kept as one small helper (rather than inlined at each of the constructor/setParams call sites)
 *  so the two call sites can't drift on which fields map to `noise.x` vs `noise.y`. */
function shapingOf(p: BurstParams): ParticleShaping {
  return { noise: [p.noiseScale, p.noiseScale], warp: p.warp, scroll: p.scroll, erode: p.erode, gain: p.gain };
}

/** Per-particle bookkeeping the `Particle` struct itself doesn't carry (velocity, spin, age/life). Kept as
 *  a flat array of plain objects, mutated in place every frame — no per-frame allocation. */
interface LiveParticle {
  particle: Particle;
  vx: number;
  vy: number;
  spin: number; // rad/sec
  age: number; // ms
  maxLife: number; // ms
  scaleX0: number;
  scaleY0: number;
}

class BurstInstance implements FxInstance<BurstParams> {
  private readonly pc: ParticleContainer;
  private readonly renderer: FxContext['renderer'];
  private texture: Texture;
  private readonly shader: Shader;
  private params: BurstParams;
  private readonly live: LiveParticle[] = [];
  private headX = 0;
  private headY = 0;
  // `setHead` has landed at least once with a real anchor position. Gates the very first wave — see the
  // constructor comment below for why we can't just emit on construction.
  private headSet = false;
  private firstEmitDone = false;
  // True when this instance was spawned for a one-shot Fire (see FxContext.oneShot). Fires exactly the one
  // wave gated by `firstEmitDone` above and never re-fires on `interval` — the interval only drives re-firing
  // for the continuous workbench-loop preview.
  private readonly oneShot: boolean;
  private travelAngle = 0; // radians; last known non-zero travel direction, aims the cone when spread < 1
  private timer = 0; // ms since last emit
  private clockSec = 0; // drives the shader's uTime — see setParticleTime's own comment

  constructor(ctx: FxContext, params: BurstParams) {
    this.params = params;
    this.renderer = ctx.renderer;
    this.oneShot = ctx.oneShot === true;
    this.texture = getShapeTexture(ctx.renderer, params.shape);
    this.shader = createParticleMaterial(ctx.renderer, params.palette, params.bands, shapingOf(params), params.glow);
    this.pc = new ParticleContainer({
      texture: this.texture,
      shader: this.shader,
      boundsArea: new Rectangle(-2000, -2000, 4000, 4000),
      dynamicProperties: { position: true, rotation: true, color: true, vertex: true },
    });
    this.pc.blendMode = params.blendMode;
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
      const { scaleX: scaleX0, scaleY: scaleY0 } = resolveParticleScale(size, p.stretchX, p.stretchY);
      // Greyscale core-bias tint (NOT a resolved palette colour — the shader posterizes into the live
      // uPal/uBands uniforms per-pixel, see particleMaterial.ts). Same distribution as before: uniform in
      // [0, coreBias], so `coreBias` still reads as "how deep toward the white core this burst reaches".
      const tint = biasTint(p.coreBias * Math.random());
      const particle = new Particle({
        texture: this.texture,
        x: this.headX,
        y: this.headY,
        anchorX: 0.5,
        anchorY: 0.5,
        rotation: angle,
        scaleX: scaleX0,
        scaleY: scaleY0,
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
        scaleX0,
        scaleY0,
      });
      children.push(particle);
    }
  }

  update(dtMs: number): void {
    this.clockSec += dtMs / 1000;
    // One uniform write per frame regardless of live particle count (not per-particle) — see
    // `setParticleTime`'s own comment for why this is cheap.
    setParticleTime(this.shader, this.clockSec);

    const dtSec = dtMs / 1000;
    const p = this.params;
    const dragF = Math.pow(p.drag, dtMs / DRAG_REF_MS);
    const gravity = p.gravity;
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
      const lifeT = lp.age / lp.maxLife; // 0 -> 1 over life
      particle.alpha = frac * frac;
      const s = sampleCurve(p.sizeCurve, lifeT);
      particle.scaleX = lp.scaleX0 * s;
      particle.scaleY = lp.scaleY0 * s;

      if (write !== i) live[write] = lp;
      children[write] = particle;
      write++;
    }
    live.length = write;
    children.length = write;

    // Fire: the very first wave waits for a real anchor position (see `setHead` / the constructor
    // comment above); every wave after that follows the fixed interval timer — EXCEPT in one-shot mode,
    // where the single wave gated by `firstEmitDone` is the whole Fire and `interval` is never consulted
    // again (that's exclusively what drives the continuous loop preview's re-firing).
    if (!this.firstEmitDone) {
      if (this.headSet) {
        this.emit();
        this.firstEmitDone = true;
        this.timer = 0;
      }
    } else if (!this.oneShot) {
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

  /** See `burstFireComplete`'s header comment for the completion contract. */
  isComplete(): boolean {
    return burstFireComplete(this.oneShot, this.firstEmitDone, this.live.length);
  }

  setParams(next: BurstParams): void {
    const shapeChanged = next.shape !== this.params.shape;
    this.params = next;
    this.pc.blendMode = next.blendMode;
    updateParticleMaterial(this.shader, next.palette, next.bands, next.glow);
    updateParticleMaterialShaping(this.shader, shapingOf(next));
    if (shapeChanged) {
      // A ParticleContainer shares exactly ONE base texture across every live particle (see
      // `shapeTextures.ts`'s `getShapeTexture` header comment), so every shard/mote already in flight
      // changes shape on the same frame as new ones — there's no way to have some particles keep the old
      // shape without a second container, and nothing in this workbench needs that.
      this.texture = getShapeTexture(this.renderer, next.shape);
      this.pc.texture = this.texture;
    }
  }

  destroy(): void {
    // The ParticleContainer and our own shader are ours to free. Shape textures are shared across every
    // burst/emitter instance (cached per-renderer in `shapeTextures.ts`) and must outlive any single
    // instance's destroy() — and it does: `ParticleContainer.destroy({ children: true })` only destroys
    // the container/particle structs
    // (`children: true` here means "also destroy the Particle instances", not the shared texture — see
    // ParticleContainer.destroy()'s `destroyTexture` branch, which we never opt into), and `Shader.destroy`
    // never touches its texture resources (only `resources`/`groups` refs and, with `true`, the compiled GL
    // program) — verified by reading both destroy() implementations.
    //
    // Order matters: `ParticleContainer.destroy()` ALSO calls `this.shader?.destroy()` internally (with no
    // args, i.e. destroyPrograms=false) since we handed it `shader: this.shader` in the constructor. Shader
    // guards its own destroy with a `_destroyed` flag, so whichever destroy() call lands first "wins" — if
    // `pc.destroy()` ran first, its no-arg call would set `_destroyed` and our own `destroy(true)` after it
    // would silently no-op, leaking the compiled GL program. Destroying the shader ourselves FIRST (with
    // `true`) makes the container's later internal call the no-op instead, which is the harmless direction.
    this.shader.destroy(true);
    this.pc.destroy({ children: true });
  }
}

export const burstPrimitive: FxPrimitive<typeof SPECS> = {
  id: 'burst',
  params: SPECS,
  spawn: (ctx, params) => new BurstInstance(ctx, params),
};

registerPrimitive(burstPrimitive as FxPrimitive);
