import { Particle, ParticleContainer, Rectangle, Shader, type Texture } from 'pixi.js';
import type { FxParamSpecs, ParamsOf } from '../params';
import type { FxContext, FxInstance, FxPrimitive } from '../primitive';
import { PALETTE_PRESETS } from '../palettes';
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
import { resolveParticleScale } from '../shapeTextures';
import { getShapeTextureById } from '../shapeLibrary';
import { turbulenceX, turbulenceY, emissionOffset, EMIT_SHAPES } from '../motion';
import { registerPrimitive } from '../registry';

/**
 * Posterized / cel-style smoke — the emitter's slow, rising cousin. Structurally this IS an emitter (see
 * `emitter.ts`, the template): a continuous fractional-rate mote stream, a swap-free compacting advance/cull
 * loop, and the same posterized-cel particle shader (`particleMaterial.ts`) so it matches the game's
 * stylized cel art rather than the default soft additive dots. What makes it read as SMOKE instead of a grey
 * emitter is the tuning + one extra channel:
 *   - motes RISE (default gravity negative) at a gentle speed and BILLOW OUT over life (size curve grows,
 *     the opposite of the emitter's shrink), with a long life and a low rate — slow and lingering;
 *   - each mote slowly ROTATES (the `spin` param, not present on the emitter) so the puffs tumble;
 *   - turbulence is ON by default and the source is a soft `disc`, so the column wanders and has body;
 *   - the default palette is desaturated grey and the blend mode is `normal` (opaque-ish haze), not `add`
 *     (glowing energy), with glow off and a rim-heavy core bias for a darker body.
 *
 * As with `burst`/`emitter`, motes' `tint` carries a greyscale core-bias (`biasTint`) for the shader to
 * posterize, NOT a resolved palette colour — so a live palette/band edit repaints every live mote. The
 * shader also carries the ribbon's own domain-warped-fbm shaping (noise/warp/scroll/erode/gain, the
 * `Texture` param group) for internal billow detail — see `particleMaterial.ts`'s `PARTICLE_FRAG`.
 */

/** Smoke's default rim→core greys — a desaturated four-stop tuple so the posterized bands read as haze, not
 *  energy. Not one of the (all-saturated) named PALETTE_PRESETS, but still recolourable to any of them via
 *  the palette param's presets. */
const SMOKE_GREYS: readonly [number, number, number, number] = [0x2a2a32, 0x55555f, 0x88889a, 0xb8b8c8];

/** Degrees → radians, for turning the `spin` param (deg/sec, an editor-friendly unit) into the rad/sec the
 *  per-mote integration actually applies. */
const DEG_TO_RAD = Math.PI / 180;

const SPECS = {
  rate: {
    kind: 'slider', label: 'Rate', group: 'Emit', min: 5, max: 300, step: 5, default: 40,
    help: 'Motes per second — smoke is sparse and lingering, so this runs low.',
  },
  life: {
    kind: 'slider', label: 'Life', group: 'Emit', min: 200, max: 2000, step: 10, default: 1500,
    help: 'Mote lifetime in ms — long, so puffs linger and billow.',
  },
  spread: {
    kind: 'slider', label: 'Spread', group: 'Emit', min: 0, max: 1, step: 0.01, default: 0.5,
    help: '1 = emit in all directions, lower = a tighter upward cone.',
  },

  speed: { kind: 'slider', label: 'Speed', group: 'Motion', min: 0, max: 400, step: 5, default: 30, help: 'px/sec initial — gentle drift.' },
  speedVar: { kind: 'slider', label: 'Speed var', group: 'Motion', min: 0, max: 1, step: 0.01, default: 0.4 },
  gravity: {
    kind: 'slider', label: 'Gravity', group: 'Motion', min: -400, max: 400, step: 10, default: -30,
    help: 'px/sec² (negative = rise, like smoke/embers).',
  },
  spin: {
    kind: 'slider', label: 'Spin', group: 'Motion', min: 0, max: 180, step: 1, default: 25,
    help: 'Degrees/sec each puff slowly rotates — 0 = no tumble.',
  },
  spinVar: {
    kind: 'slider', label: 'Spin var', group: 'Motion', min: 0, max: 1, step: 0.01, default: 0.6,
    help: 'Per-mote randomisation of the spin rate; direction is randomised regardless.',
  },

  turbulence: {
    kind: 'slider', label: 'Turbulence', group: 'Physics', min: 0, max: 400, step: 5, default: 40,
    help: 'Swirling lateral force (px/sec²) that makes the column billow and wander — 0 = straight lines.',
  },
  turbScale: {
    kind: 'slider', label: 'Turb scale', group: 'Physics', min: 0.005, max: 0.1, step: 0.001, default: 0.02,
    help: 'Spatial frequency of the turbulence field — higher = tighter swirls.',
  },
  emitShape: {
    kind: 'enum', label: 'Emit shape', group: 'Physics', options: EMIT_SHAPES, default: 'disc',
    help: 'Where particles spawn relative to the anchor — a small disc gives a soft-edged smoke source.',
  },
  emitRadius: {
    kind: 'slider', label: 'Emit radius', group: 'Physics', min: 0, max: 120, step: 1, default: 8,
    help: 'Size of the emission shape in px (ignored for point).',
  },
  inheritVel: {
    kind: 'slider', label: 'Inherit vel', group: 'Physics', min: 0, max: 1, step: 0.01, default: 0,
    help: 'Fraction of the anchor\'s own movement velocity added to each new particle.',
  },

  shape: {
    kind: 'shape', label: 'Shape', group: 'Shape', default: 'circle',
    help: 'Every live particle in the stream shares one base texture, so this swaps all of them at once. Custom imported PNG/SVG art is selectable here alongside the built-ins.',
  },
  size: { kind: 'slider', label: 'Size', group: 'Shape', min: 2, max: 30, step: 1, default: 14 },
  sizeVar: { kind: 'slider', label: 'Size var', group: 'Shape', min: 0, max: 1, step: 0.01, default: 0.4 },
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
    // Grows from small at birth to full `size` over life, so puffs billow out as they rise. Values stay
    // within the curve kind's [0,1] multiplier range (a >1 multiplier — growing past the base size — needs
    // the `vMax` curve-param follow-up); set the base `Size` for the overall scale, this shapes the ramp to it.
    default: [[0, 0.3], [1, 1]], presets: CURVE_PRESETS,
    help: 'Size multiplier over each mote\'s life (0 = birth, 1 = death) — grows, so puffs billow out.',
  },

  coreBias: {
    kind: 'slider', label: 'Core bias', group: 'Style', min: 0, max: 1, step: 0.01, default: 0.35,
    help: '0 = rim colour (darker body), 1 = white core.',
  },
  biasCurve: {
    kind: 'curve', label: 'Bias / life', group: 'Style',
    default: [[0, 1], [1, 1]], presets: CURVE_PRESETS,
    help: 'Multiplier over life on how far coreward the particle sits (0 = rim colour, 1 = its spawn bias). Flat 1 = fixed colour; a falling curve cools rim-ward over life.',
  },
  bands: {
    kind: 'slider', label: 'Bands', group: 'Style', min: 1, max: 6, step: 1, default: 3,
    help: 'posterization levels — 3-4 is the cel look, higher washes out',
  },
  fadeIn: {
    kind: 'slider', label: 'Fade in', group: 'Style', min: 0, max: 0.5, step: 0.01, default: 0.2,
    help: 'Fraction of life spent fading in (and, symmetrically, fading out at the end) — soft on both ends.',
  },
  palette: {
    kind: 'palette', label: 'Palette', group: 'Style',
    default: SMOKE_GREYS, presets: PALETTE_PRESETS,
  },
  blendMode: { kind: 'enum', label: 'Blend mode', group: 'Style', options: FX_BLEND_MODES, default: 'normal' },
  glow: {
    kind: 'slider', label: 'Glow', group: 'Style', min: 0, max: 1, step: 0.01, default: 0,
    help: 'Soft additive halo behind each particle — off for smoke (it\'s haze, not glow).',
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
  gain: { kind: 'slider', label: 'Gain', group: 'Texture', min: 0.3, max: 2, step: 0.01, default: 1 },
} satisfies FxParamSpecs;

type SmokeParams = ParamsOf<typeof SPECS>;

/** Pull the ribbon-derived shaping uniforms out of a `SmokeParams` into the shape `particleMaterial.ts`
 *  wants. Kept as one small helper (mirrors `emitter.ts`'s own `shapingOf`) so the two call sites can't
 *  drift on which fields map to `noise.x` vs `noise.y`. */
function shapingOf(p: SmokeParams): ParticleShaping {
  return { noise: [p.noiseScale, p.noiseScale], warp: p.warp, scroll: p.scroll, erode: p.erode, gain: p.gain };
}

/** Hard cap on live motes regardless of rate/life, so a pathological param combo can't grow unbounded. */
const MAX_MOTES = 1200;

/**
 * Advance the fractional emit budget by `rate * dtSec` and pull out the whole number of motes to spawn this
 * frame, keeping the remainder for next frame. This is what makes `rate` exact and frame-rate independent:
 * at any framerate the long-run average spawn rate converges to exactly `rate`/sec, rather than truncating a
 * fraction of a mote every frame (which would under-emit, worse at higher framerates). Pure + standalone
 * (smoke's own copy — see this file's header on staying self-contained) so it's unit-testable without a
 * WebGL context. Mirrors `emitter.ts`'s `advanceEmitBudget`.
 */
export function advanceSmokeBudget(budget: number, rate: number, dtSec: number): { budget: number; spawnCount: number } {
  const b = budget + rate * dtSec;
  const spawnCount = Math.floor(b);
  return { budget: b - spawnCount, spawnCount };
}

/**
 * Whether a one-shot smoke instance's bounded emission window is still open. Smoke is inherently a
 * continuous stream, so its "Fire" is a bounded puff: emit for one window, then stop and let whatever's
 * already live rise and fade out on its own. The window is the instance's own `life` param — one lifespan of
 * continuous emission produces a puff with a natural, self-similar density. Pure + standalone (smoke's own
 * copy) for the same reason as `advanceSmokeBudget`; mirrors `emitter.ts`'s `withinEmitWindow`.
 */
export function smokeWithinEmitWindow(elapsedMs: number, windowMs: number): boolean {
  return elapsedMs < windowMs;
}

/**
 * Pure completion predicate for a one-shot Fire: true once the emission window (see `smokeWithinEmitWindow`)
 * has closed AND every mote spawned during it has died. A continuous (non-one-shot) instance is never
 * complete — the loop preview keeps streaming forever by design. Mirrors `emitter.ts`'s `emitterFireComplete`.
 */
export function smokeFireComplete(oneShot: boolean, elapsedMs: number, windowMs: number, moteCount: number): boolean {
  return oneShot && !smokeWithinEmitWindow(elapsedMs, windowMs) && moteCount === 0;
}

/**
 * A mote's alpha at life-fraction `t` (0 at birth, 1 at death): ramps 0→1 over the first `fadeIn` fraction of
 * life, holds at 1, then symmetrically ramps 1→0 over the last `fadeIn` fraction. `fadeIn` is floored to a
 * small epsilon to avoid a division by zero at the param's minimum (0). Pure + standalone (smoke's own copy)
 * for the same reason as `advanceSmokeBudget`; mirrors `emitter.ts`'s `moteAlpha`.
 */
export function smokeMoteAlpha(t: number, fadeIn: number): number {
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
  bias0: number;   // spawn core-bias; effectiveBias(t) = bias0 * sampleCurve(biasCurve, t)
  spinRad: number; // per-mote spin rate in rad/sec (signed); applied as rotation += spinRad * dtSec
}

class SmokeInstance implements FxInstance<SmokeParams> {
  private readonly particles: ParticleContainer;
  private readonly renderer: FxContext['renderer'];
  private texture: Texture;
  private readonly shader: Shader;
  private params: SmokeParams;
  private readonly motes: Mote[] = [];
  private originX = 0;
  private originY = 0;
  private headSet = false;
  // Previous frame's anchor position + the velocity derived from it (px/sec), for velocity inheritance.
  // Recomputed at the top of update(), read by spawnMote(). Zero until we have two real anchor samples.
  private lastOriginX = 0;
  private lastOriginY = 0;
  private lastOriginSet = false;
  private headVx = 0;
  private headVy = 0;
  // Reused scratch for `emissionOffset` so a shaped spawn allocates nothing (mirrors `budgetState` below).
  private readonly emitScratch = { ox: 0, oy: 0 };
  private clockSec = 0; // drives the shader's uTime — see setParticleTime's own comment
  // True when this instance was spawned for a one-shot Fire (see FxContext.oneShot). Bounds emission to a
  // single window (see `smokeWithinEmitWindow`) instead of streaming forever.
  private readonly oneShot: boolean;
  // ms elapsed since this instance's very first update() call — ticks unconditionally once oneShot (not gated
  // on headSet, matching emitter.ts's reasoning: a Fire's setHead typically lands the same frame anyway).
  private emitElapsedMs = 0;
  // Reused scratch object for the emit-budget accumulation — `advanceSmokeBudget` (kept pure above for the
  // test suite) would otherwise allocate a fresh `{ budget, spawnCount }` literal every single frame. Same
  // values, written in place instead of returned (mirrors emitter.ts's `budgetState`).
  private readonly budgetState = { budget: 0, spawnCount: 0 };

  constructor(ctx: FxContext, params: SmokeParams) {
    this.params = params;
    this.renderer = ctx.renderer;
    this.oneShot = ctx.oneShot === true;
    this.texture = getShapeTextureById(ctx.renderer, params.shape);
    this.shader = createParticleMaterial(ctx.renderer, params.palette, params.bands, shapingOf(params), params.glow);
    this.particles = new ParticleContainer({
      texture: this.texture,
      shader: this.shader,
      // Generous fixed bounds: motes drift, so a tight box would get them culled as they leave it. Matches
      // the ribbon/burst/emitter house convention of a large static boundsArea rather than per-frame recompute.
      boundsArea: new Rectangle(-2000, -2000, 4000, 4000),
      // rotation ENABLED (the emitter leaves it false): each smoke mote slowly tumbles via `spin`, so its
      // per-mote `rotation` must actually upload to the GPU each frame.
      dynamicProperties: { position: true, rotation: true, color: true, vertex: true },
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
    // One uniform write per frame regardless of live mote count (not per-mote) — see `setParticleTime`'s own
    // comment for why this is cheap.
    setParticleTime(this.shader, this.clockSec);

    const dtSec = dtMs / 1000;
    const p = this.params;
    // Anchor velocity (px/sec) for velocity inheritance, from the origin's frame-over-frame delta. Zero until
    // we hold two real anchor samples (guards a spurious spike from diffing the (0,0) default). With
    // inheritVel = 0 this is never read, so it can't affect the default look.
    if (this.lastOriginSet && dtSec > 0) {
      this.headVx = (this.originX - this.lastOriginX) / dtSec;
      this.headVy = (this.originY - this.lastOriginY) / dtSec;
    } else {
      this.headVx = 0;
      this.headVy = 0;
    }
    const turbulence = p.turbulence;
    const turbScale = p.turbScale;
    const clockSec = this.clockSec;
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
      // Pseudo-turbulence: a swirling lateral acceleration folded into velocity (turbulence 0 → adds 0). Uses
      // the mote's current position + the instance clock — the smoke default (40) is ON so the column billows.
      if (turbulence !== 0) {
        m.vx += turbulence * turbulenceX(m.p.x, m.p.y, clockSec, turbScale) * dtSec;
        m.vy += turbulence * turbulenceY(m.p.x, m.p.y, clockSec, turbScale) * dtSec;
      }
      m.p.x += m.vx * dtSec;
      m.p.y += m.vy * dtSec;
      // Slow tumble — the smoke-defining extra channel over the emitter. spinRad is signed (random direction
      // per mote), so a puff rotates steadily either way.
      m.p.rotation += m.spinRad * dtSec;
      const t = m.age / m.maxLife;
      m.p.alpha = smokeMoteAlpha(t, m.fadeIn);
      const sizeMul = sampleCurve(p.sizeCurve, t); // size-over-life multiplier (grows for smoke)
      m.p.scaleX = m.scaleX0 * sizeMul;
      m.p.scaleY = m.scaleY0 * sizeMul;
      // Colour-over-life: the spawn bias scaled by the bias curve, recomputed every frame (default flat 1 =
      // exactly the spawn tint — a no-op; the color buffer already re-uploads each frame, so this is free).
      m.p.tint = biasTint(m.bias0 * sampleCurve(p.biasCurve, t));
      if (write !== i) motes[write] = m;
      children[write] = m.p;
      write++;
    }
    motes.length = write;
    children.length = write;

    // 2) spawn this frame's share, capped so a pathological rate*life combo can't outgrow MAX_MOTES. Gated on
    //    `headSet`: `update()` can run before the first `setHead()` call, and without this guard that would
    //    emit a mote or two from the origin default (0,0). In one-shot mode, ALSO gated on the emission window
    //    (`smokeWithinEmitWindow`) — once the window closes we stop spawning entirely (existing motes just
    //    rise and fade out under step 1) rather than streaming for the whole Fire. `emitElapsedMs` ticks
    //    below regardless of whether we actually spawn this frame.
    const bs = this.budgetState;
    const b = bs.budget + p.rate * dtSec;
    bs.spawnCount = Math.floor(b);
    bs.budget = b - bs.spawnCount;
    const emitting = this.headSet && (!this.oneShot || smokeWithinEmitWindow(this.emitElapsedMs, p.life));
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

    // Snapshot this frame's anchor so next frame can derive its velocity from the delta. Only once we hold a
    // real anchor position (headSet), so the first velocity sample diffs two real anchors, not the default.
    if (this.headSet) {
      this.lastOriginX = this.originX;
      this.lastOriginY = this.originY;
      this.lastOriginSet = true;
    }

    this.particles.update();
  }

  /** See `smokeFireComplete`'s header comment for the completion contract. */
  isComplete(): boolean {
    return smokeFireComplete(this.oneShot, this.emitElapsedMs, this.params.life, this.motes.length);
  }

  setParams(next: SmokeParams): void {
    const shapeChanged = next.shape !== this.params.shape;
    this.params = next;
    this.particles.blendMode = next.blendMode;
    updateParticleMaterial(this.shader, next.palette, next.bands, next.glow);
    updateParticleMaterialShaping(this.shader, shapingOf(next));
    if (shapeChanged) {
      // A ParticleContainer shares exactly ONE base texture across every live particle (see
      // `shapeTextures.ts`'s `getShapeTexture`), so every mote already in flight changes shape on the same
      // frame as new ones — there's no way to keep some particles on the old shape without a second container,
      // and nothing in this workbench needs that.
      this.texture = getShapeTextureById(this.renderer, next.shape);
      this.particles.texture = this.texture;
    }
  }

  destroy(): void {
    // The shape texture is shared across every particle primitive (see `shapeTextures.ts`'s `getShapeTexture`)
    // — destroying it here would break every other live/future primitive. Only the container (and the Particle
    // structs it alone owns) and our own shader belong to this instance.
    //
    // Order matters — see emitter.ts's `destroy()` for the full explanation: `ParticleContainer.destroy()`
    // also calls `this.shader?.destroy()` internally (destroyPrograms=false) since we handed it our shader in
    // the constructor, and Shader's destroy is a one-shot (`_destroyed` guard). Destroying the shader ourselves
    // first (with `true`, so the compiled GL program is actually freed) makes the container's later internal
    // call a harmless no-op instead of the reverse, which would leak the GL program.
    this.shader.destroy(true);
    this.particles.destroy({ children: true });
  }

  private spawnMote(): Mote {
    const p = this.params;
    const rand = Math.random();
    const spreadRand = Math.random() * 2 - 1;
    // A cone of half-width `spread * PI` centred on "up" (-PI/2, screen convention: +y is down). At spread = 1
    // the half-width is PI, so the range covers a full 2*PI uniformly regardless of centre — one formula
    // naturally degenerates to "all directions" without a branch.
    const angle = -Math.PI / 2 + spreadRand * p.spread * Math.PI;
    const speedJitter = 1 + (Math.random() * 2 - 1) * p.speedVar;
    const speed = Math.max(0, p.speed * speedJitter);
    const sizeJitter = 1 + (Math.random() * 2 - 1) * p.sizeVar;
    const size = Math.max(0.5, p.size * sizeJitter);
    // Small per-mote core-bias jitter for organic variety in the tint, not just a flat colour per palette. As
    // with emitter.ts, this is a greyscale bias signal for the shader to posterize — NOT a resolved palette
    // colour — so a live palette/band edit repaints every live mote.
    const bias = Math.min(1, Math.max(0, p.coreBias + (rand - 0.5) * 0.12));
    // Per-mote spin rate (rad/sec): the base `spin` (deg→rad) jittered by ±spinVar and given a random sign so
    // puffs tumble both ways. spin 0 → 0 regardless (no tumble).
    const spinJitter = 1 + (Math.random() * 2 - 1) * p.spinVar;
    const spinSign = Math.random() < 0.5 ? -1 : 1;
    const spinRad = p.spin * DEG_TO_RAD * spinJitter * spinSign;

    // Spawn-position offset for the emission shape (point/radius 0 → (0, 0), i.e. no change).
    emissionOffset(p.emitShape, p.emitRadius, Math.random(), Math.random(), this.emitScratch);
    const particle = new Particle({
      texture: this.texture,
      x: this.originX + this.emitScratch.ox,
      y: this.originY + this.emitScratch.oy,
      anchorX: 0.5,
      anchorY: 0.5,
      tint: biasTint(bias),
      alpha: 0,
      // A random starting rotation so newly spawned puffs don't all share one orientation; `spin` advances it.
      rotation: Math.random() * Math.PI * 2,
    });
    const { scaleX: scaleX0, scaleY: scaleY0 } = resolveParticleScale(size, p.stretchX, p.stretchY);
    particle.scaleX = scaleX0;
    particle.scaleY = scaleY0;

    return {
      p: particle,
      // Base emission velocity plus a fraction of the anchor's own movement (inheritVel 0 → no change).
      vx: Math.cos(angle) * speed + p.inheritVel * this.headVx,
      vy: Math.sin(angle) * speed + p.inheritVel * this.headVy,
      age: 0,
      maxLife: p.life,
      fadeIn: p.fadeIn,
      scaleX0,
      scaleY0,
      bias0: bias,
      spinRad,
    };
  }
}

export const smokePrimitive: FxPrimitive<typeof SPECS> = {
  id: 'smoke',
  params: SPECS,
  spawn: (ctx, params) => new SmokeInstance(ctx, params),
};

registerPrimitive(smokePrimitive as FxPrimitive);
