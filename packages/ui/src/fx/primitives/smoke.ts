import { Particle, Shader, type ParticleContainer, type Texture } from 'pixi.js';
import { BLUR_PARAM_SPECS, ContainerBlur } from '../blurFilter';
import type { FxParamSpecs, ParamsOf } from '../params';
import type { FxContext, FxInstance, FxPrimitive } from '../primitive';
import { PALETTE_PRESETS } from '../palettes';
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
import { turbulenceX, turbulenceY, emissionOffset, spawnVelocity, EMIT_SHAPES, fieldPhaseOffset } from '../motion';
import { makeRng, randomSeed, type FxRandom } from '../rng';
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
    kind: 'slider', label: 'Rate', group: 'Emit', min: 5, max: 1200, step: 5, default: 40, essential: true,
    axis: 'intensity',
    help: 'How many puffs are born each second. Smoke is sparse and lingering, so this runs far lower than a spark stream — 40 is a steady plume, and much above that reads as a solid cloud.',
  },
  life: {
    kind: 'slider', label: 'Life', group: 'Emit', min: 200, max: 8000, step: 10, default: 1500, essential: true,
    // A duration, so it rides `time` — and, exactly as in `emitter.ts`, it is also the one-shot EMIT WINDOW
    // (`smokeWithinEmitWindow`), so a stretched plume emits proportionally more puffs at the same `rate`.
    // See `FxScaleAxes.time` for why `rate` deliberately stays off this axis.
    axis: 'time',
    help: 'How long each puff lives, in ms. Long is the point — a puff needs time to swell, drift and fade. It also doubles as how long the plume keeps emitting in a one-shot, so raising it makes more smoke as well as slower smoke.',
  },
  spread: {
    kind: 'slider', label: 'Spread', group: 'Emit', min: 0, max: 1, step: 0.01, default: 0.5,
    help: 'How wide the plume fans out. 1 pushes puffs in every direction like a burst of dust; 0.5 (the default) is a leaning column, and 0 a single narrow chimney.',
  },

  speed: {
    kind: 'slider', label: 'Speed', group: 'Motion', min: 0, max: 3000, step: 5, default: 30, axis: 'scale',
    help: 'px/sec initial — gentle drift.' },
  speedVar: {
    kind: 'slider', label: 'Speed variance', group: 'Motion', min: 0, max: 1, step: 0.01, default: 0.4,
    enabledWhen: { param: 'speed', above: 0 },
    help: 'How much puffs differ from each other in launch speed, as a fraction of Speed — 0 sends them all off at the same rate, 0.4 (the default) spreads them between 0.6x and 1.4x. Nothing to vary while Speed is 0.',
  },
  reverse: {
    kind: 'toggle', label: 'Reverse', group: 'Motion', default: false,
    help: 'Turns the stream into a GATHER: puffs start out where they would have finished and drift inward to the anchor, and every over-life curve is read back to front. This is a VISUAL reverse, not a rewind — gravity and turbulence still act on the way in, so a puff eases toward the middle and stops a little short of it. The built-in fade is deliberately not mirrored, so puffs still fade out at the end rather than vanishing at full strength.',
  },
  speedCurve: {
    kind: 'curve', label: 'Speed / life', group: 'Motion',
    // vMax 2 so a puff can OVERSHOOT its launch speed mid-life rather than only decaying from it. Default is
    // flat 1, where `sampleCurve` returns exactly 1 and `x * 1 === x` — a byte-identical no-op.
    default: [[0, 1], [1, 1]], vMax: 2, presets: CURVE_PRESETS,
    help: 'Multiplier on how fast a puff TRAVELS over its life (0 = birth, 1 = death), on top of Speed. Flat 1 = no change. It retimes drift without steering it — heading, gravity and turbulence are untouched — so a curve that falls to 0 lets a column rise and then hang, which is the shape smoke usually wants and that Gravity alone cannot make.',
  },
  gravity: {
    kind: 'slider', label: 'Gravity', group: 'Motion', min: -4000, max: 4000, step: 10, default: -30, essential: true,
    axis: 'scale',
    help: 'Constant pull on every puff, in px/sec². Negative makes smoke rise (the default, and what reads as heat); positive lets heavy dust settle, 0 leaves it hanging where it was born.',
  },
  spin: {
    kind: 'slider', label: 'Spin', group: 'Motion', min: 0, max: 1440, step: 1, default: 25,
    enabledWhen: { param: 'orientToVelocity', is: false },
    help: 'Degrees/sec each puff slowly rotates — 25 is a lazy tumble, 0 leaves every puff frozen at the angle it was born with. Ignored entirely while Orient to velocity is on.',
  },
  spinVar: {
    kind: 'slider', label: 'Spin variance', group: 'Motion', min: 0, max: 1, step: 0.01, default: 0.6,
    // Two dependencies (Spin > 0 as well as this one), and the shape only carries one — so it declares the
    // HARD override, which greys the whole Spin pair together the moment Orient to velocity goes on. The
    // "nothing to vary at Spin 0" half stays in the help text below.
    enabledWhen: { param: 'orientToVelocity', is: false },
    help: 'How much puffs differ from each other in tumble rate; which way each one turns is random either way. Does nothing while Spin is 0, or while Orient to velocity is on.',
  },
  orientToVelocity: {
    kind: 'toggle', label: 'Orient to velocity', group: 'Motion', default: false,
    help: 'Point each particle along its direction of travel (good for shards, arrows, and imported directional art). Overrides spin/rotation while on.',
  },

  turbulence: {
    kind: 'slider', label: 'Turbulence', group: 'Physics', min: 0, max: 2000, step: 5, default: 40, axis: 'scale',
    help: 'Swirling lateral force (px/sec²) that makes the column billow and wander — 0 = straight lines.',
  },
  turbScale: {
    kind: 'slider', label: 'Turbulence scale', group: 'Physics', min: 0.005, max: 0.1, step: 0.001, default: 0.02,
    enabledWhen: { param: 'turbulence', above: 0 },
    help: 'How tight the billowing is — low values give broad lazy drifts, high values a small nervous wiggle. Only bites while Turbulence is above 0 (smoke ships with it on).',
  },
  fieldPhase: {
    kind: 'slider', label: 'Field variation', group: 'Physics', min: 0, max: 1, step: 0.01, default: 0,
    enabledWhen: { param: 'turbulence', above: 0 },
    help: 'Per-cast variation in the turbulence field (and the animated texture noise). At 0 every copy of this effect billows in lockstep, so many firing at once look identical; raise it and each fire starts the field at its own seeded phase, so a crowd of casts decorrelates. Reproducible when the def locks a seed. Does nothing while Turbulence is 0.',
  },
  emitShape: {
    kind: 'enum', label: 'Emit shape', group: 'Physics', options: EMIT_SHAPES, default: 'disc', essential: true,
    help: 'Where puffs are born relative to the anchor: all from one spot, off the edge of a ring, anywhere inside a disc (the default — a soft-edged smoke source), or anywhere in a box. Does nothing while Emit radius is 0 — every shape collapses to a single spot there.',
  },
  emitRadius: {
    kind: 'slider', label: 'Emit radius', group: 'Physics', min: 0, max: 400, step: 1, default: 8, axis: 'scale', essential: true,
    // Only one half of the mutually-dead shape/radius pair may declare the dependency (see burst.ts) —
    // shape is the gateway, radius the thing it unlocks. Smoke ships with both live (disc + 8px).
    enabledWhen: { param: 'emitShape', not: 'point' },
    help: 'How far out from the anchor that spawn area reaches, in px — bigger reads as a wider, softer smoke source instead of a pinpoint. Does nothing while Emit shape is point.',
  },
  emitFill: {
    kind: 'toggle', label: 'SVG fill', group: 'Physics', default: false,
    enabledWhen: { param: 'emitShape', is: 'svg' },
    help: 'Fill the SVG silhouette solid instead of sampling only its outline. Off traces the stroke; on scatters spawns across the whole interior. Does nothing unless Emit shape is svg.',
  },
  emitDensity: {
    // 64 / 400 / 4000 mirror EMIT_POINTS_MIN / _DEFAULT / _MAX in svgEmit.ts — how many points the baker lays down.
    kind: 'slider', label: 'SVG density', group: 'Physics', min: 64, max: 4000, step: 1, default: 400,
    enabledWhen: { param: 'emitShape', is: 'svg' },
    help: 'How many points the baker samples off the SVG — more points read as a denser, more faithful silhouette at some cost. Does nothing unless Emit shape is svg.',
  },
  emitPoints: {
    kind: 'emitpoints', label: 'SVG shape', group: 'Physics', default: [],
    enabledWhen: { param: 'emitShape', is: 'svg' },
    help: 'The baked point cloud itself — set by importing an SVG, not tuned by hand. A spawn picks one point at random. Empty until you bake a shape. Does nothing unless Emit shape is svg.',
  },
  squashX: {
    kind: 'slider', label: 'Squash X', group: 'Physics', min: 0.2, max: 3, step: 0.01, default: 1, essential: true,
    // NOT gated on `emitShape`. The pair was, while squash only moved the spawn area — meaningless without
    // one. They now scale spawn VELOCITY too, so they shape a `point` emitter's spray, which is the common
    // case. Not `axis: 'scale'` either: a RATIO scaled by `scaleDef` would distort the shape as the effect
    // resized instead of resizing it.
    help: 'Horizontal scale of the plume — 1 is untouched, lower squeezes it narrow, higher stretches it wide. Scales BOTH the spawn area and the speed particles fly at, so it holds its shape at any speed.',
  },
  squashY: {
    kind: 'slider', label: 'Squash Y', group: 'Physics', min: 0.2, max: 3, step: 0.01, default: 1, essential: true,
    help: 'Vertical scale of the plume — 1 is untouched, lower flattens it into an oval, higher makes it taller than it is wide. Pair this with Squash X: equal values resize, unequal values reshape.',
  },
  offsetX: {
    kind: 'slider', label: 'Offset X', group: 'Physics', min: -200, max: 200, step: 1, default: 0, axis: 'scale', essential: true,
    // `axis: 'scale'` unlike the squash pair: this IS a length, so it must ride the same resize as the emit
    // radius — otherwise a scaled-down effect keeps a full-size displacement and drifts off its anchor.
    help: 'Shifts the plume sideways from its anchor, in px. Placement only — it moves where the effect sits without changing its shape or motion.',
  },
  offsetY: {
    kind: 'slider', label: 'Offset Y', group: 'Physics', min: -200, max: 200, step: 1, default: 0, axis: 'scale', essential: true,
    help: 'Shifts the plume up or down from its anchor, in px. Negative is up. Placement only — it moves where the effect sits without changing its shape or motion.',
  },
  inheritVel: {
    kind: 'slider', label: 'Inherit motion', group: 'Physics', min: 0, max: 1, step: 0.01, default: 0,
    help: 'Fraction of the anchor\'s own movement velocity added to each new particle.',
  },

  shape: {
    kind: 'shape', label: 'Shape', group: 'Shape', default: 'circle',
    help: 'Every live particle in the stream shares one base texture, so this swaps all of them at once. Custom imported PNG/SVG art is selectable here alongside the built-ins.',
  },
  size: {
    kind: 'slider', label: 'Size', group: 'Shape', min: 2, max: 200, step: 1, default: 14, essential: true, axis: 'scale',
    help: 'How big a puff is across, in px, at birth — 14 gives a chunky column, low values a thin wispy one. Size variance jitters it per puff and the Size / life curve grows it as the puff rises.',
  },
  sizeVar: {
    kind: 'slider', label: 'Size variance', group: 'Shape', min: 0, max: 1, step: 0.01, default: 0.4,
    help: 'How much puff sizes differ from each other, as a fraction of Size — 0 makes every puff identical (and the column read mechanical), 0.4 (the default) spreads them between 0.6x and 1.4x.',
  },
  stretchX: {
    kind: 'slider', label: 'Stretch X', group: 'Shape', min: 0.2, max: 8, step: 0.05, default: 1,
    help: 'Per-particle width multiplier on top of Size — 1 = the shape\'s own baked proportions.',
  },
  stretchY: {
    kind: 'slider', label: 'Stretch Y', group: 'Shape', min: 0.2, max: 8, step: 0.05, default: 1,
    help: 'Stretches every puff vertically on top of Size — above 1 makes them tall and column-like, below 1 squat and spreading. Pair with Stretch X to shape a plume.',
  },
  sizeCurve: {
    kind: 'curve', label: 'Size / life', group: 'Shape',
    // Grows from small at birth to HALF AGAIN its base size by death, so puffs genuinely billow out as they
    // rise rather than merely ramping up to their base size. This needs `vMax` (2 here): the curve kind
    // otherwise clamps every control point at 1x, which is what forced the earlier workaround of capping the
    // ramp at 1 and inflating the base `Size` to compensate (that scaled the whole column, not just the tail
    // of each puff's life).
    default: [[0, 0.3], [1, 1.6]], vMax: 2, presets: CURVE_PRESETS,
    help: 'Size multiplier over each mote\'s life (0 = birth, 1 = death) — grows, so puffs billow out.',
  },

  coreBias: {
    kind: 'slider', label: 'Core bias', group: 'Style', min: 0, max: 1, step: 0.01, default: 0.35,
    help: 'How far toward the pale core each puff sits — 0 keeps the column dark and sooty, 1 pushes it to the lightest stop (each puff jitters a little either side of this). With Bands at 1 there is only one flat colour to land on, so it stops changing the tint (it still shifts how much of a puff survives Erode).',
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
    help: 'How many flat colour steps each mote is cut into, instead of a smooth gradient — 3-4 gives the hand-drawn cel look, 1 is a single flat colour, 6 washes back toward a blur.',
  },
  plateau: {
    kind: 'slider', label: 'Plateau', group: 'Style', min: 0, max: 0.9, step: 0.01, default: 0.3,
    help: 'How much of a puff is one flat pale centre before its colour steps down toward the dark rim — wide gives fat cel bands and a big light middle, 0 shrinks the lightest colour to a hairline. It stops shaping the puff\'s body as Field mix approaches 1, though it still shapes the Glow halo.',
  },
  fieldMix: {
    kind: 'slider', label: 'Field mix', group: 'Style', min: 0, max: 1, step: 0.01, default: 0,
    help: 'Where a puff\'s colour rings come from: 0 draws them outward from its own centre (the ribbon look, and the only setting that can band a hard-edged silhouette at all), 1 follows the art\'s own soft edge instead — better for hand-painted PNGs that already fade out.',
  },
  tintMode: {
    kind: 'enum', label: 'Tint mode', group: 'Style', options: PARTICLE_TINT_MODES, default: 'palette',
    help: 'palette = recolour into the palette stops; texture = keep imported art\'s own colours, still posterized into Bands levels.',
  },
  fadeIn: {
    kind: 'slider', label: 'Fade in', group: 'Style', min: 0, max: 0.5, step: 0.01, default: 0.2,
    // Smoke's built-in-fade control, with the same genuine OFF at 0 as the emitter's — see that param, and
    // `burstFadeEnvelope` for why burst needed a new knob and these two did not.
    help: 'Fraction of life spent fading in, and symmetrically fading out at the end — soft on both ends. 0 turns the built-in fade OFF: puffs pop in at full opacity and hold it until they die, which is when Alpha / life becomes the whole opacity envelope.',
  },
  palette: {
    kind: 'palette', label: 'Palette', group: 'Style', essential: true,
    default: SMOKE_GREYS, presets: PALETTE_PRESETS,
    help: 'The four colours a puff steps through, dark rim first and pale core last — smoke starts on greys rather than one of the glowing presets, but any preset swaps all four at once. While Tint mode is texture only the last (core) colour is used, and only to tint the Glow halo, which smoke keeps at 0 by default.',
  },
  blendMode: {
    kind: 'enum', label: 'Blend mode', group: 'Style', options: FX_BLEND_MODES, default: 'normal', essential: true,
    help: 'How the puffs composite over what is behind them: normal (the default here) paints them as solid haze that hides what it covers, add makes them glow and brighten it instead, screen is a gentler lift, and multiply/overlay stain what is behind rather than lighting it.',
  },
  glow: {
    kind: 'slider', label: 'Glow', group: 'Style', min: 0, max: 1, step: 0.01, default: 0,
    help: 'Soft additive halo behind each particle — off for smoke (it\'s haze, not glow).',
  },

  noiseScale: {
    kind: 'slider', label: 'Noise scale', group: 'Texture', min: 0.5, max: 20, step: 0.1, default: 6,
    // Inert at Erode 0 — the shader only reads the noise as `baseShape * uGain - n * uErode`, and uGain
    // cancels out of the `d / uGain` normalisation once the noise term is gone (particleMaterial.ts).
    enabledWhen: { param: 'erode', above: 0 },
    help: 'How fine the mottling inside each puff is — low gives a couple of big blotches per puff, high a dense speckle. Does nothing while Erode is 0.',
  },
  warp: {
    kind: 'slider', label: 'Warp', group: 'Texture', min: 0, max: 1.5, step: 0.01, default: 0.35,
    enabledWhen: { param: 'erode', above: 0 },
    help: 'Curls that mottling into flowing, smoke-like streaks instead of round blobs — 0 leaves it plain and lumpy, 0.35 is the reference look. Does nothing while Erode is 0.',
  },
  scroll: {
    kind: 'slider', label: 'Scroll', group: 'Texture', min: 0, max: 6, step: 0.05, default: 1.4,
    enabledWhen: { param: 'erode', above: 0 },
    help: 'How fast the mottling drifts across each puff — this is what makes the smoke churn from the inside instead of looking stamped; 0 holds the pattern still. Does nothing while Erode is 0.',
  },
  erode: {
    kind: 'slider', label: 'Erode', group: 'Texture', min: 0, max: 1.2, step: 0.01, default: 0.35,
    help: 'How much the noise eats into each particle\'s shape — higher gives a more tattered edge.',
  },
  gain: {
    kind: 'slider', label: 'Gain', group: 'Texture', min: 0.3, max: 2, step: 0.01, default: 1,
    enabledWhen: { param: 'erode', above: 0 },
    help: 'How well a puff resists Erode — raise it and the noise takes smaller bites so puffs read solid, lower it and the same Erode chews them down to wisps. Does nothing while Erode is 0.',
  },
  ...BLUR_PARAM_SPECS,
} satisfies FxParamSpecs;

type SmokeParams = ParamsOf<typeof SPECS>;

/** Pull the ribbon-derived shaping uniforms out of a `SmokeParams` into the shape `particleMaterial.ts`
 *  wants. Kept as one small helper (mirrors `emitter.ts`'s own `shapingOf`) so the two call sites can't
 *  drift on which fields map to `noise.x` vs `noise.y`. */
function shapingOf(p: SmokeParams): ParticleShaping {
  return { noise: [p.noiseScale, p.noiseScale], warp: p.warp, scroll: p.scroll, erode: p.erode, gain: p.gain };
}

/** The Style-group half of the same mapping (see `shapingOf` above for why these are helpers rather than
 *  inlined at the constructor + `setParams` call sites). Mirrors `emitter.ts`'s own `styleOf`. */
function styleOf(p: SmokeParams): ParticleStyle {
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

/** A STOPPED smoke instance (see `FxInstance.stopEmitting`) is complete once its last puff has died —
 *  independent of the one-shot emit window, which is why it is its own predicate rather than a branch of
 *  `smokeFireComplete`. Mirrors `emitter.ts`'s `emitterStoppedComplete`. */
export function smokeStoppedComplete(stopped: boolean, puffCount: number): boolean {
  return stopped && puffCount === 0;
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

/**
 * The rotation a mote should hold THIS frame. Two mutually exclusive modes, matching the `orientToVelocity`
 * param:
 *  - OFF (the default): advance the mote's own tumble — `prevRot + spinRad * dtSec`, byte-for-byte the
 *    expression this loop always used inline, so the toggle's `false` default is an exact no-op.
 *  - ON: point the mote along its direction of travel (`atan2(vy, vx)`), for shards/arrows/imported
 *    directional art. The tumble is deliberately ignored while on — you can't both spin and track a heading.
 *
 * Zero-length velocity has no direction: `Math.atan2(0, 0)` is 0, which would SNAP a stalled mote to pointing
 * right (+x). Below the epsilon we keep the previous rotation instead. Pure + allocation-free so it can run
 * per-mote per-frame, and standalone (smoke's own copy — see `advanceSmokeBudget` on staying self-contained;
 * importing burst.ts/emitter.ts's identical helper would drag their `registerPrimitive` side effect into this
 * module's graph) so it's unit-testable without a WebGL context.
 */
export function resolveSmokeRotation(
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
  private readonly velScratch = { vx: 0, vy: 0 };
  private clockSec = 0; // drives the shader's uTime — see setParticleTime's own comment
  // True when this instance was spawned for a one-shot Fire (see FxContext.oneShot). Bounds emission to a
  // single window (see `smokeWithinEmitWindow`) instead of streaming forever.
  private readonly oneShot: boolean;
  // Set by `stopEmitting()` (see `FxInstance.stopEmitting`): stops spawning new puffs but leaves any already
  // live to finish their own fade, instead of being culled outright — see `smokeStoppedComplete`.
  private stopped = false;
  // This instance's ONE random source, seeded once in the constructor and drawn from by `spawnMote()` in a
  // fixed order (see there). With `ctx.seed` set the whole column replays identically, which is what makes a
  // tuning holdable/screenshot-able; without one we roll a fresh seed per instance, i.e. exactly the previous
  // `Math.random()` behaviour. See `fx/rng.ts`.
  private readonly rand: FxRandom;
  // ms elapsed since this instance's very first update() call — ticks unconditionally once oneShot (not gated
  // on headSet, matching emitter.ts's reasoning: a Fire's setHead typically lands the same frame anyway).
  private emitElapsedMs = 0;
  // Shared post-process blur + the clock its Blur / time envelope rides (ms since first update, over Life).
  private readonly blur: ContainerBlur;
  private blurElapsedMs = 0;
  // Reused scratch object for the emit-budget accumulation — `advanceSmokeBudget` (kept pure above for the
  // test suite) would otherwise allocate a fresh `{ budget, spawnCount }` literal every single frame. Same
  // values, written in place instead of returned (mirrors emitter.ts's `budgetState`).
  private readonly budgetState = { budget: 0, spawnCount: 0 };

  constructor(ctx: FxContext, params: SmokeParams) {
    this.params = params;
    this.renderer = ctx.renderer;
    this.oneShot = ctx.oneShot === true;
    const seed = ctx.seed ?? randomSeed();
    this.rand = makeRng(seed);
    // Start the field clock (turbulence + shader texture noise) at a per-instance seeded phase so many casts
    // firing at once don't billow in lockstep — from a SEPARATE stream off `seed`, never `this.rand`, so the
    // frozen per-puff draw order is untouched. `fieldPhase` 0 → offset 0 → clockSec starts at 0 as before.
    this.clockSec = fieldPhaseOffset(seed, params.fieldPhase);
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
    this.blur = new ContainerBlur(ctx.container);
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
    // Whole-effect blur envelope: sample the Blur/time curve over elapsed life (normalised by Life) and hand it
    // to the shared blur (owns the filter's create/retime/destroy). A no-blur puff costs only this branch.
    this.blurElapsedMs += dtMs;
    this.blur.frame(p.blur, p.blurCurve, p.life > 0 ? Math.min(1, this.blurElapsedMs / p.life) : 1);
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
    const orient = p.orientToVelocity;
    const reverse = p.reverse;
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
      const t = m.age / m.maxLife;
      // Authored over-life curves are read back to front when reversed. The built-in fade below is
      // deliberately left forward: mirroring it too would leave a puff at full strength as it dies.
      const curveT = reverse ? 1 - t : t;
      // Speed-over-life scales the DISTANCE COVERED this frame, not the stored velocity — it retimes drift
      // rather than steering it, and leaves gravity/turbulence accumulating as they were. Scaling m.vx/m.vy
      // in place would compound every frame and drift. Default flat 1 -> exactly 1, a byte-identical no-op.
      const travel = sampleCurve(p.speedCurve, curveT);
      m.p.x += m.vx * travel * dtSec;
      m.p.y += m.vy * travel * dtSec;
      // Slow tumble — the smoke-defining extra channel over the emitter. spinRad is signed (random direction
      // per mote), so a puff rotates steadily either way. When `orientToVelocity` is on the mote points along
      // its direction of travel instead (see `resolveSmokeRotation` — with the toggle off this is exactly
      // `rotation += spinRad * dtSec`, the expression that used to be inlined here). Reads m.vx/m.vy AFTER
      // this frame's gravity + turbulence, so the sprite tracks the heading it is actually drifting on.
      m.p.rotation = resolveSmokeRotation(m.p.rotation, m.vx, m.vy, orient, m.spinRad, dtSec);
      // Built-in fade-in/out, times the explicit alpha-over-life curve (default flat 1 → sampleCurve returns
      // exactly 1 and `x * 1 === x`, so the default is a byte-identical no-op).
      m.p.alpha = smokeMoteAlpha(t, m.fadeIn) * sampleCurve(p.alphaCurve, curveT);
      const sizeMul = sampleCurve(p.sizeCurve, curveT); // size-over-life multiplier (grows for smoke)
      m.p.scaleX = m.scaleX0 * sizeMul;
      m.p.scaleY = m.scaleY0 * sizeMul;
      // Colour-over-life: the spawn bias scaled by the bias curve, recomputed every frame (default flat 1 =
      // exactly the spawn tint — a no-op; the color buffer already re-uploads each frame, so this is free).
      m.p.tint = biasTint(m.bias0 * sampleCurve(p.biasCurve, curveT));
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
    const emitting = this.headSet && !this.stopped && (!this.oneShot || smokeWithinEmitWindow(this.emitElapsedMs, p.life));
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
    return smokeFireComplete(this.oneShot, this.emitElapsedMs, this.params.life, this.motes.length)
      || smokeStoppedComplete(this.stopped, this.motes.length);
  }

  setParams(next: SmokeParams): void {
    const shapeChanged = next.shape !== this.params.shape;
    this.params = next;
    this.particles.blendMode = next.blendMode;
    updateParticleMaterial(this.shader, styleOf(next));
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

  stopEmitting(): void {
    this.stopped = true;
  }

  destroy(): void {
    // Back to the pool, NOT destroyed. `releaseParticleLayer` unparents the container first — the player
    // destroys our owning container with `{ children: true }` immediately after this returns, which would
    // otherwise take the pooled pair down with it. Shape textures are shared and cached per-renderer in
    // `shapeTextures.ts`; nothing here touches them.
    this.blur.destroy();
    releaseParticleLayer({ shader: this.shader, pc: this.particles });
  }

  /**
   * Build one puff. Every draw below comes from `this.rand` (this instance's seeded stream) rather than
   * `Math.random`. The distributions and the ORDER of the draws are byte-for-byte what they were — 9 per
   * mote: bias jitter, spread, speed jitter, size jitter, spin jitter, spin sign, the two emission-shape
   * offsets, then the spawn rotation — so the statistical look is unchanged and only its reproducibility is
   * new. Reordering or adding a draw here changes what every saved seed replays, so treat the sequence as
   * part of the contract.
   */
  private spawnMote(): Mote {
    const p = this.params;
    const rand = this.rand();
    const spreadRand = this.rand() * 2 - 1;
    // A cone of half-width `spread * PI` centred on "up" (-PI/2, screen convention: +y is down). At spread = 1
    // the half-width is PI, so the range covers a full 2*PI uniformly regardless of centre — one formula
    // naturally degenerates to "all directions" without a branch.
    const angle = -Math.PI / 2 + spreadRand * p.spread * Math.PI;
    const speedJitter = 1 + (this.rand() * 2 - 1) * p.speedVar;
    const speed = Math.max(0, p.speed * speedJitter);
    const sizeJitter = 1 + (this.rand() * 2 - 1) * p.sizeVar;
    const size = Math.max(0.5, p.size * sizeJitter);
    // Small per-mote core-bias jitter for organic variety in the tint, not just a flat colour per palette. As
    // with emitter.ts, this is a greyscale bias signal for the shader to posterize — NOT a resolved palette
    // colour — so a live palette/band edit repaints every live mote.
    const bias = Math.min(1, Math.max(0, p.coreBias + (rand - 0.5) * 0.12));
    // Per-mote spin rate (rad/sec): the base `spin` (deg→rad) jittered by ±spinVar and given a random sign so
    // puffs tumble both ways. spin 0 → 0 regardless (no tumble).
    const spinJitter = 1 + (this.rand() * 2 - 1) * p.spinVar;
    const spinSign = this.rand() < 0.5 ? -1 : 1;
    const spinRad = p.spin * DEG_TO_RAD * spinJitter * spinSign;

    // Spawn-position offset for the emission shape (point/radius 0 → (0, 0), i.e. no change).
    emissionOffset(p, this.rand(), this.rand(), this.emitScratch);
    spawnVelocity(angle, speed, p.squashX, p.squashY, this.velScratch);
    // REVERSE — a gather instead of a stream. A straight-line flight is its own inverse: put the puff where
    // that flight WOULD have ended (v * life) and negate the velocity, and it retraces the same line inward.
    // Adds no rand() draw, which the seeded-replay contract depends on. It lands NEAR the anchor rather than
    // on it, because gravity/turbulence still act on the way in — the honest meaning of "visual reverse".
    const rev = p.reverse;
    const revLifeSec = p.life / 1000;
    const vx0 = rev ? -this.velScratch.vx : this.velScratch.vx;
    const vy0 = rev ? -this.velScratch.vy : this.velScratch.vy;

    const particle = new Particle({
      texture: this.texture,
      x: this.originX + this.emitScratch.ox + (rev ? this.velScratch.vx * revLifeSec : 0),
      y: this.originY + this.emitScratch.oy + (rev ? this.velScratch.vy * revLifeSec : 0),
      anchorX: 0.5,
      anchorY: 0.5,
      tint: biasTint(bias),
      alpha: 0,
      // A random starting rotation so newly spawned puffs don't all share one orientation; `spin` advances it.
      rotation: this.rand() * Math.PI * 2,
    });
    const { scaleX: scaleX0, scaleY: scaleY0 } = resolveParticleScale(size, p.stretchX, p.stretchY);
    particle.scaleX = scaleX0;
    particle.scaleY = scaleY0;

    return {
      p: particle,
      // Base emission velocity plus a fraction of the anchor's own movement (inheritVel 0 → no change).
      vx: vx0 + p.inheritVel * this.headVx,
      vy: vy0 + p.inheritVel * this.headVy,
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
