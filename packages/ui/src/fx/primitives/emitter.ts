import { Particle, Shader, type ParticleContainer, type Texture } from 'pixi.js';
import type { FxParamSpecs, ParamsOf } from '../params';
import type { FxContext, FxInstance, FxPrimitive } from '../primitive';
import { PALETTE_PRESETS, paletteTuple } from '../palettes';
import { sampleCurve, CURVE_PRESETS } from '../curve';
import {
  updateParticleMaterial,
  updateParticleMaterialShaping,
  setParticleTime,
  biasTint,
  PARTICLE_TINT_MODES,
  type ParticleShaping,
  type ParticleStyle,
} from '../particleMaterial';
import { FX_BLEND_MODES } from '../blendModes';
import { acquireParticleLayer, releaseParticleLayer } from '../particleLayerPool';
import { resolveParticleScale } from '../shapeTextures';
import { getShapeTextureById } from '../shapeLibrary';
import { turbulenceX, turbulenceY, emissionOffset, EMIT_SHAPES } from '../motion';
import { makeRng, randomSeed, type FxRandom } from '../rng';
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
    kind: 'slider', label: 'Rate', group: 'Emit', min: 5, max: 1200, step: 5, default: 80, essential: true,
    axis: 'intensity',
    help: 'Motes per second.',
  },
  life: {
    kind: 'slider', label: 'Life', group: 'Emit', min: 200, max: 8000, step: 10, default: 700, essential: true,
    // A duration, so it rides `time`. Note this param does DOUBLE duty in a one-shot: it is both the mote
    // lifetime and the EMIT WINDOW (`withinEmitWindow(emitElapsedMs, life)` below), so stretching it emits
    // proportionally more motes at the same `rate`. That is inherent to a continuous emitter running for
    // longer, and is spelled out on `FxScaleAxes.time` along with why `rate` is not the answer to it.
    axis: 'time',
    help: 'Mote lifetime in ms.',
  },
  spread: {
    kind: 'slider', label: 'Spread', group: 'Emit', min: 0, max: 1, step: 0.01, default: 1,
    help: '1 = emit in all directions, lower = upward cone.',
  },

  speed: {
    kind: 'slider', label: 'Speed', group: 'Motion', min: 0, max: 3000, step: 5, default: 60, essential: true,
    axis: 'scale', help: 'px/sec initial.',
  },
  speedVar: {
    kind: 'slider', label: 'Speed var', group: 'Motion', min: 0, max: 1, step: 0.01, default: 0.4,
    enabledWhen: { param: 'speed', above: 0 },
    help: 'How much motes differ from each other in launch speed, as a fraction of Speed — 0 sends them all off at the same rate, 0.4 (the default) spreads them between 0.6x and 1.4x. Nothing to vary while Speed is 0.',
  },
  gravity: {
    kind: 'slider', label: 'Gravity', group: 'Motion', min: -4000, max: 4000, step: 10, default: -30, axis: 'scale',
    help: 'px/sec² (negative = rise, like embers).',
  },
  orientToVelocity: {
    kind: 'toggle', label: 'Orient to velocity', group: 'Motion', default: false,
    help: 'Point each particle along its direction of travel (good for shards, arrows, and imported directional art). Overrides spin/rotation while on.',
  },

  turbulence: {
    kind: 'slider', label: 'Turbulence', group: 'Physics', min: 0, max: 2000, step: 5, default: 0, axis: 'scale',
    help: 'Swirling lateral force (px/sec²) that makes particles wander — 0 = straight lines.',
  },
  turbScale: {
    kind: 'slider', label: 'Turb scale', group: 'Physics', min: 0.005, max: 0.1, step: 0.001, default: 0.02,
    enabledWhen: { param: 'turbulence', above: 0 },
    help: 'How tight the wandering is — low values give broad lazy drifts, high values a small nervous wiggle. Only bites once Turbulence is above 0.',
  },
  emitShape: {
    kind: 'enum', label: 'Emit shape', group: 'Physics', options: EMIT_SHAPES, default: 'point', essential: true,
    help: 'Where motes are born relative to the anchor: all from one spot, off the edge of a ring, anywhere inside a disc, or anywhere in a box. Does nothing while Emit radius is 0 — every shape collapses to a single spot there.',
  },
  emitRadius: {
    kind: 'slider', label: 'Emit radius', group: 'Physics', min: 0, max: 400, step: 1, default: 0, axis: 'scale', essential: true,
    // Only one half of the mutually-dead shape/radius pair may declare the dependency, or the two lock each
    // other out permanently at these defaults. Shape is the gateway; see burst.ts for the same note.
    enabledWhen: { param: 'emitShape', not: 'point' },
    help: 'How far out from the anchor that spawn area reaches, in px — bigger reads as a wider, softer source instead of a pinpoint. Does nothing while Emit shape is point.',
  },
  emitSquash: {
    kind: 'slider', label: 'Emit squash', group: 'Physics', min: 0.2, max: 3, step: 0.01, default: 1, essential: true,
    // Rides the same gateway as the radius above: with `point` there is no area to squash. It does NOT
    // declare a dependency on `emitRadius` — the pair would deadlock (see the note there), and shape is the
    // single gateway both hang off.
    enabledWhen: { param: 'emitShape', not: 'point' },
    // NOT `axis: 'scale'`, unlike Emit radius: this is a RATIO, not a length. `scaleDef` multiplies every
    // `scale` param by the same factor, and scaling a ratio would distort the oval as the effect resized
    // rather than resizing it — the shape would change, not just its size.
    help: 'Squashes that spawn area vertically — 1 is a true circle/square, lower flattens it into an oval, higher makes it taller than it is wide. Does nothing while Emit shape is point.',
  },
  inheritVel: {
    kind: 'slider', label: 'Inherit vel', group: 'Physics', min: 0, max: 1, step: 0.01, default: 0,
    help: 'Fraction of the anchor\'s own movement velocity added to each new particle.',
  },

  shape: {
    kind: 'shape', label: 'Shape', group: 'Shape', default: 'circle',
    help: 'Every live particle in the stream shares one base texture, so this swaps all of them at once. Custom imported PNG/SVG art is selectable here alongside the built-ins.',
  },
  size: {
    kind: 'slider', label: 'Size', group: 'Shape', min: 2, max: 200, step: 1, default: 7, essential: true, axis: 'scale',
    help: 'How big a mote is across, in px — 7 reads as sparks, 30 as fat glowing blobs, and the top of the range is a single screen-filling bloom. Size var jitters it per mote and the Size / life curve rescales it as the mote ages.',
  },
  sizeVar: {
    kind: 'slider', label: 'Size var', group: 'Shape', min: 0, max: 1, step: 0.01, default: 0.4,
    help: 'How much mote sizes differ from each other, as a fraction of Size — 0 makes every mote identical, 0.4 (the default) spreads them between 0.6x and 1.4x size.',
  },
  stretchX: {
    kind: 'slider', label: 'Stretch X', group: 'Shape', min: 0.2, max: 8, step: 0.05, default: 1,
    help: 'Per-particle width multiplier on top of Size — 1 = the shape\'s own baked proportions.',
  },
  stretchY: {
    kind: 'slider', label: 'Stretch Y', group: 'Shape', min: 0.2, max: 8, step: 0.05, default: 1,
    help: 'Per-particle height multiplier on top of Size.',
  },
  sizeCurve: {
    kind: 'curve', label: 'Size / life', group: 'Shape',
    // vMax 2 lets a mote GROW past its base size over life (the smoke-style billow) rather than only shrinking
    // toward it. The default is unchanged (the original 1 -> 0.75 gentle shrink), so this only widens the
    // range the editor offers.
    default: [[0, 1], [1, 0.75]], vMax: 2, presets: CURVE_PRESETS,
    help: 'Size multiplier over each mote\'s life (0 = birth, 1 = death).',
  },

  coreBias: {
    kind: 'slider', label: 'Core bias', group: 'Style', min: 0, max: 1, step: 0.01, default: 0.5,
    help: 'How far toward the bright core each mote sits — 0 keeps them all rim-dark, 1 pushes them to the white core (each mote jitters a little either side of this). With Bands at 1 there is only one flat colour to land on, so it stops changing the tint (it still shifts how much of a mote survives Erode).',
  },
  biasCurve: {
    kind: 'curve', label: 'Bias / life', group: 'Style',
    default: [[0, 1], [1, 1]], presets: CURVE_PRESETS,
    help: 'Multiplier over life on how far coreward the particle sits (0 = rim colour, 1 = its spawn bias). Flat 1 = fixed colour; a falling curve cools rim-ward over life. With Bands at 1 there is only one flat colour, so it has no tint left to shift.',
  },
  alphaCurve: {
    kind: 'curve', label: 'Alpha / life', group: 'Style',
    default: [[0, 1], [1, 1]], presets: CURVE_PRESETS,
    help: 'Opacity multiplier over life (0 = birth, 1 = death), on top of the built-in fade. Flat 1 = just the built-in fade.',
  },
  bands: {
    kind: 'slider', label: 'Bands', group: 'Style', min: 1, max: 6, step: 1, default: 3,
    help: 'posterization levels — 3-4 is the cel look, higher washes out',
  },
  plateau: {
    kind: 'slider', label: 'Plateau', group: 'Style', min: 0, max: 0.9, step: 0.01, default: 0.3,
    help: 'How much of a mote is one flat hot centre before its colour steps down toward the rim — wide gives fat cel bands and a big bright middle, 0 shrinks the brightest colour to a hairline. It stops shaping the mote\'s body as Field mix approaches 1, though it still shapes the Glow halo.',
  },
  fieldMix: {
    kind: 'slider', label: 'Field mix', group: 'Style', min: 0, max: 1, step: 0.01, default: 0,
    help: 'Where a mote\'s colour rings come from: 0 draws them outward from its own centre (the ribbon look, and the only setting that can band a hard-edged silhouette at all), 1 follows the art\'s own soft edge instead — better for hand-painted PNGs that already fade out.',
  },
  tintMode: {
    kind: 'enum', label: 'Tint mode', group: 'Style', options: PARTICLE_TINT_MODES, default: 'palette',
    help: 'palette = recolour into the palette stops; texture = keep imported art\'s own colours, still posterized into Bands levels.',
  },
  fadeIn: {
    kind: 'slider', label: 'Fade in', group: 'Style', min: 0, max: 0.5, step: 0.01, default: 0.1,
    // This IS the emitter's built-in-fade control, and its 0 end is a genuine OFF (`moteAlpha` collapses to a
    // square envelope there — pinned in emitter.test.ts). That is why the 2026-07-30 pass gave `burst` a new
    // `fade` param and gave this primitive nothing: burst's `frac * frac` was unreachable, this never was.
    help: 'Fraction of life spent fading in, and symmetrically fading out at the end. 0 turns the built-in fade OFF — motes pop in at full opacity and hold it until they die, which is when Alpha / life becomes the whole opacity envelope.',
  },
  palette: {
    kind: 'palette', label: 'Palette', group: 'Style', essential: true,
    default: paletteTuple('violet'), presets: PALETTE_PRESETS,
    help: 'The four colours a mote steps through, dark rim first and white-hot core last; a preset swaps all four at once. While Tint mode is texture only the last (core) colour is used — and only to tint the Glow halo — so the other three do nothing there.',
  },
  blendMode: {
    kind: 'enum', label: 'Blend mode', group: 'Style', options: FX_BLEND_MODES, default: 'add', essential: true,
    help: 'How the motes composite over what is behind them: add (the default) makes them glow and brighten whatever they cross, normal paints them as solid opaque colour, screen is a gentler lift, and multiply/overlay stain what is behind rather than lighting it.',
  },
  glow: {
    kind: 'slider', label: 'Glow', group: 'Style', min: 0, max: 1, step: 0.01, default: 0.25,
    help: 'Soft additive halo behind each particle.',
  },

  noiseScale: {
    kind: 'slider', label: 'Noise scale', group: 'Texture', min: 0.5, max: 20, step: 0.1, default: 6,
    // Inert at Erode 0 — the shader only reads the noise as `baseShape * uGain - n * uErode`, and uGain
    // cancels out of the `d / uGain` normalisation once the noise term is gone (particleMaterial.ts).
    enabledWhen: { param: 'erode', above: 0 },
    help: 'How fine the mottling inside each mote is — low gives a couple of big blotches per mote, high a dense speckle. Does nothing while Erode is 0.',
  },
  warp: {
    kind: 'slider', label: 'Warp', group: 'Texture', min: 0, max: 1.5, step: 0.01, default: 0.35,
    enabledWhen: { param: 'erode', above: 0 },
    help: 'Curls that mottling into flowing, flame-like streaks instead of round blobs — 0 leaves it plain and lumpy, 0.35 is the reference look. Does nothing while Erode is 0.',
  },
  scroll: {
    kind: 'slider', label: 'Scroll', group: 'Texture', min: 0, max: 6, step: 0.05, default: 1.4,
    enabledWhen: { param: 'erode', above: 0 },
    help: 'How fast the mottling drifts across each mote — this is what makes motes flicker and churn instead of looking stamped; 0 holds the pattern still. Does nothing while Erode is 0.',
  },
  erode: {
    kind: 'slider', label: 'Erode', group: 'Texture', min: 0, max: 1.2, step: 0.01, default: 0.35,
    help: 'How much the noise eats into each particle\'s shape — higher gives a more tattered edge.',
  },
  gain: {
    kind: 'slider', label: 'Gain', group: 'Texture', min: 0.3, max: 2, step: 0.01, default: 1.4,
    enabledWhen: { param: 'erode', above: 0 },
    help: 'How well a mote resists Erode — raise it and the noise takes smaller bites so motes read solid, lower it and the same Erode chews them down to wisps. Does nothing while Erode is 0.',
  },
} satisfies FxParamSpecs;

type EmitterParams = ParamsOf<typeof SPECS>;

/** Pull the ribbon-derived shaping uniforms out of an `EmitterParams` into the shape `particleMaterial.ts`
 *  wants. Kept as one small helper (mirrors `burst.ts`'s own `shapingOf`) so the two call sites can't drift
 *  on which fields map to `noise.x` vs `noise.y`. */
function shapingOf(p: EmitterParams): ParticleShaping {
  return { noise: [p.noiseScale, p.noiseScale], warp: p.warp, scroll: p.scroll, erode: p.erode, gain: p.gain };
}

/** The Style-group half of the same mapping (see `shapingOf` above for why these are helpers rather than
 *  inlined at the constructor + `setParams` call sites). Mirrors `burst.ts`'s own `styleOf`. */
function styleOf(p: EmitterParams): ParticleStyle {
  return {
    palette: p.palette,
    bands: p.bands,
    glow: p.glow,
    plateau: p.plateau,
    fieldMix: p.fieldMix,
    tintMode: p.tintMode,
  };
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

/**
 * The rotation a mote should hold THIS frame. Two mutually exclusive modes, matching the `orientToVelocity`
 * param:
 *  - OFF (the default): `prevRot + spinRad * dtSec`. The emitter has no spin channel of its own (unlike
 *    burst/smoke), so it always passes `spinRad = 0` and this reduces to `prevRot + 0` — the mote keeps the
 *    spawn rotation it has always had, an exact no-op. The parameter exists so the three primitives' copies
 *    stay literally identical, and so an emitter spin channel could be added later without touching this.
 *  - ON: point the mote along its direction of travel (`atan2(vy, vx)`), for shards/arrows/imported
 *    directional art.
 *
 * Zero-length velocity has no direction: `Math.atan2(0, 0)` is 0, which would SNAP a stalled mote to pointing
 * right (+x). Below the epsilon we keep the previous rotation instead. Pure + allocation-free so it can run
 * per-mote per-frame, and standalone so it's unit-testable without a WebGL context (same reason as
 * `advanceEmitBudget`). Deliberately this module's OWN copy of burst.ts/smoke.ts's identical helper, for the
 * same reason `advanceEmitBudget`/`advanceSmokeBudget` and `moteAlpha`/`smokeMoteAlpha` are duplicated:
 * importing across primitive modules would drag another primitive's `registerPrimitive` side effect into
 * this module's graph.
 */
export function resolveEmitterRotation(
  prevRot: number,
  vx: number,
  vy: number,
  orient: boolean,
  spinRad: number,
  dtSec: number,
): number {
  if (!orient) return prevRot + spinRad * dtSec;
  if (vx * vx + vy * vy < 1e-8) return prevRot;
  return Math.atan2(vy, vx);
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
  bias0: number; // spawn core-bias; effectiveBias(t) = bias0 * sampleCurve(biasCurve, t)
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
  // single window (see `withinEmitWindow`) instead of streaming forever.
  private readonly oneShot: boolean;
  // This instance's ONE random source, seeded once in the constructor and drawn from by `spawnMote()` in a
  // fixed order (see there). With `ctx.seed` set the whole stream replays identically, which is what makes a
  // tuning holdable/screenshot-able; without one we roll a fresh seed per instance, i.e. exactly the previous
  // `Math.random()` behaviour. See `fx/rng.ts`.
  private readonly rand: FxRandom;
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
    this.rand = makeRng(ctx.seed ?? randomSeed());
    this.texture = getShapeTextureById(ctx.renderer, params.shape);
    // Pooled, not constructed: building a fresh Shader here re-compiled and re-linked the GLSL on every
    // fire — a ~68 ms main-thread block. See `particleLayerPool.ts`'s header.
    const layer = acquireParticleLayer({
      renderer: ctx.renderer,
      parent: ctx.container,
      texture: this.texture,
      blendMode: params.blendMode,
      style: styleOf(params),
      shaping: shapingOf(params),
    });
    this.shader = layer.shader;
    this.particles = layer.pc;
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
    // Anchor velocity (px/sec) for velocity inheritance, from the origin's frame-over-frame delta. Zero
    // until we hold two real anchor samples (guards a spurious spike from diffing the (0,0) default). With
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
    const orient = p.orientToVelocity;
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
      // Pseudo-turbulence: a swirling lateral acceleration folded into velocity (turbulence 0 → adds 0, so
      // the default is a byte-identical no-op). Uses the mote's current position + the instance clock.
      if (turbulence !== 0) {
        m.vx += turbulence * turbulenceX(m.p.x, m.p.y, clockSec, turbScale) * dtSec;
        m.vy += turbulence * turbulenceY(m.p.x, m.p.y, clockSec, turbScale) * dtSec;
      }
      m.p.x += m.vx * dtSec;
      m.p.y += m.vy * dtSec;
      // Point along the direction of travel when `orientToVelocity` is on. The emitter has no spin channel,
      // so the off-branch is `rotation + 0 * dtSec` — the mote's untouched spawn rotation, an exact no-op
      // (see `resolveEmitterRotation`). Reads m.vx/m.vy AFTER this frame's gravity + turbulence.
      m.p.rotation = resolveEmitterRotation(m.p.rotation, m.vx, m.vy, orient, 0, dtSec);
      const t = m.age / m.maxLife;
      // Built-in fade-in/out, times the explicit alpha-over-life curve (default flat 1 → sampleCurve returns
      // exactly 1 and `x * 1 === x`, so the default is a byte-identical no-op).
      m.p.alpha = moteAlpha(t, m.fadeIn) * sampleCurve(p.alphaCurve, t);
      const shrink = sampleCurve(p.sizeCurve, t); // size-over-life multiplier
      m.p.scaleX = m.scaleX0 * shrink;
      m.p.scaleY = m.scaleY0 * shrink;
      // Colour-over-life: the spawn bias scaled by the bias curve, recomputed every frame (default flat 1 =
      // exactly the spawn tint — a no-op; the color buffer already re-uploads each frame, so this is free).
      m.p.tint = biasTint(m.bias0 * sampleCurve(p.biasCurve, t));
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

    // Snapshot this frame's anchor so next frame can derive its velocity from the delta. Only once we hold a
    // real anchor position (headSet), so the first velocity sample diffs two real anchors, not the default.
    if (this.headSet) {
      this.lastOriginX = this.originX;
      this.lastOriginY = this.originY;
      this.lastOriginSet = true;
    }

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
    updateParticleMaterial(this.shader, styleOf(next));
    updateParticleMaterialShaping(this.shader, shapingOf(next));
    if (shapeChanged) {
      // A ParticleContainer shares exactly ONE base texture across every live particle (see
      // `shapeTextures.ts`'s `getShapeTexture` header comment), so every mote already in flight changes
      // shape on the same frame as new ones — there's no way to have some particles keep the old shape
      // without a second container, and nothing in this workbench needs that.
      this.texture = getShapeTextureById(this.renderer, next.shape);
      this.particles.texture = this.texture;
    }
  }

  destroy(): void {
    // Back to the pool, NOT destroyed. `releaseParticleLayer` unparents the container first — the player
    // destroys our owning container with `{ children: true }` immediately after this returns, which would
    // otherwise take the pooled pair down with it. Shape textures are shared and cached per-renderer in
    // `shapeTextures.ts`; nothing here touches them.
    releaseParticleLayer({ shader: this.shader, pc: this.particles });
  }

  /**
   * Build one mote. Every draw below comes from `this.rand` (this instance's seeded stream) rather than
   * `Math.random`. The distributions and the ORDER of the draws are byte-for-byte what they were — 6 per
   * mote: bias jitter, spread, speed jitter, size jitter, then the two emission-shape offsets — so the
   * statistical look is unchanged and only its reproducibility is new. Reordering or adding a draw here
   * changes what every saved seed replays, so treat the sequence as part of the contract.
   */
  private spawnMote(): Mote {
    const p = this.params;
    const rand = this.rand();
    const spreadRand = this.rand() * 2 - 1;
    // A cone of half-width `spread * PI` centred on "up" (-PI/2, screen convention: +y is down). At
    // spread = 1 the half-width is PI, so the range covers a full 2*PI uniformly regardless of centre —
    // one formula naturally degenerates to "all directions" without a branch.
    const angle = -Math.PI / 2 + spreadRand * p.spread * Math.PI;
    const speedJitter = 1 + (this.rand() * 2 - 1) * p.speedVar;
    const speed = Math.max(0, p.speed * speedJitter);
    const sizeJitter = 1 + (this.rand() * 2 - 1) * p.sizeVar;
    const size = Math.max(0.5, p.size * sizeJitter);
    // Small per-mote core-bias jitter for organic variety in the tint, not just a flat colour per palette.
    // As with burst.ts, this is now a greyscale bias signal for the shader to posterize — NOT a resolved
    // palette colour (that was `tupleBiased`) — so a live palette/band edit repaints every live mote.
    const bias = Math.min(1, Math.max(0, p.coreBias + (rand - 0.5) * 0.12));

    // Spawn-position offset for the emission shape (point/radius 0 → (0, 0), i.e. no change).
    emissionOffset(p.emitShape, p.emitRadius, this.rand(), this.rand(), this.emitScratch, p.emitSquash);
    const particle = new Particle({
      texture: this.texture,
      x: this.originX + this.emitScratch.ox,
      y: this.originY + this.emitScratch.oy,
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
      // Base emission velocity plus a fraction of the anchor's own movement (inheritVel 0 → no change).
      vx: Math.cos(angle) * speed + p.inheritVel * this.headVx,
      vy: Math.sin(angle) * speed + p.inheritVel * this.headVy,
      age: 0,
      maxLife: p.life,
      fadeIn: p.fadeIn,
      scaleX0,
      scaleY0,
      bias0: bias,
    };
  }
}

export const emitterPrimitive: FxPrimitive<typeof SPECS> = {
  id: 'emitter',
  params: SPECS,
  spawn: (ctx, params) => new EmitterInstance(ctx, params),
};

registerPrimitive(emitterPrimitive as FxPrimitive);
