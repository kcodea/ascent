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
  PARTICLE_TINT_MODES,
  type ParticleShaping,
  type ParticleStyle,
} from '../particleMaterial';
import { FX_BLEND_MODES } from '../blendModes';
import { resolveParticleScale } from '../shapeTextures';
import { getShapeTextureById } from '../shapeLibrary';
import { turbulenceX, turbulenceY, emissionOffset, EMIT_SHAPES } from '../motion';
import { makeRng, randomSeed, type FxRandom } from '../rng';
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
 * How a burst decides WHICH WAY its cone points (the `aimMode` param). See `resolveBurstAimAngle`.
 * `travel` is first and is the default, so every def authored before this existed is untouched.
 *
 * ── the third mode, and the channel it cost ───────────────────────────────────────────────────────────
 * `sourceToTarget` aims along the FIRE's own vector: source anchor → target anchor, i.e. "which way this
 * moment went". A directional mode was built in #764 (as `awayFrom`, source → the layer's own head) and cut
 * before merge for want of a caller; `impact` — a melee blow that fans its sparks along the attacker→defender
 * vector — is that caller, and it arrived in #767. What was recorded then as the cost is what was paid:
 * a layer only ever learns its OWN head, so the fire's geometry has to be plumbed down to the instance
 * (`setAim` on `FxInstance` and `FxPlayer`, delivered by `driveLayerHeads` from the STAGED anchors, and only
 * when they were really staged — so "none" can never arrive as `resolveAnchor`'s invented (0, 0) origin).
 *
 * It aims between the two ANCHORS rather than source → this layer's head, which is the one place it departs
 * from the cut design. The vector then describes the MOMENT, not the layer: every layer of a composition
 * blows the same way whichever anchor its author pinned it to. Under source→head a layer anchored at `source`
 * would be degenerate and one anchored at `slot` would fan somewhere unrelated — the same def looking
 * different for a reason invisible in the tuner. For `impact` itself the two are identical anyway: its layers
 * are anchored at `target`, the strike point.
 */
export const BURST_AIM_MODES = ['travel', 'fixed', 'sourceToTarget'] as const;
export type BurstAimMode = (typeof BURST_AIM_MODES)[number];

/** Degrees → radians, for the `fixed` aim angle. */
const DEG_TO_RAD = Math.PI / 180;

/** Squared px below which a staged source and target count as the SAME point, i.e. no direction at all.
 *  Matches `setHead`'s own travel-angle threshold — 0.1px of separation is not a blow direction. */
const AIM_EPSILON_SQ = 0.01;

/**
 * The BASE angle `sampleBurstAngle` centres the cone on — i.e. the authored launch direction.
 *
 * `sampleBurstAngle` takes whatever base it is handed; choosing that base is this function's whole job, and
 * it is kept separate for one load-bearing reason: **it draws no randomness.** `emit()`'s RNG contract is 7
 * draws per particle in a fixed order (see there), so a seeded def must replay byte-for-byte across this
 * change. A pure function of existing state cannot disturb that sequence — there is nothing here that could.
 *
 *  - `travel` (the default): the emitter's own direction of travel, which is 0 for a static point anchor.
 *    Every def that predates aiming behaves exactly as it always did.
 *  - `fixed`: the authored `angleDeg`, in SCREEN convention — 0 is +x (right), and because screen Y grows
 *    DOWNWARD, -90 is straight up and +90 straight down.
 *  - `sourceToTarget`: `aimAngle`, the fire's staged source→target direction, delivered by `setAim`.
 *
 * `aimAngle` is `null` in BOTH degenerate cases, and both fall back to `travel` — which is the honest
 * fallback because it is what a burst with no direction has always done:
 *   • NOT STAGED. The fire never supplied a source/target pair, so `setAim` was never called. This is
 *     distinguishable only upstream, in `driveLayerHeads`, which is why the gate lives there: `resolveAnchor`
 *     invents `(0, 0)` for an absent anchor, and a burst that aimed at that would fan away from the screen's
 *     top-left corner on every def that happens not to stage one.
 *   • COINCIDENT. Both staged, but at (near enough) the same point — a self-targeted moment. `atan2(0, 0)` is
 *     0, which would SNAP the cone to +x; the same trap `resolveParticleRotation` guards below.
 */
export function resolveBurstAimAngle(
  mode: BurstAimMode,
  travelAngle: number,
  angleDeg: number,
  aimAngle: number | null,
): number {
  if (mode === 'fixed') return angleDeg * DEG_TO_RAD;
  if (mode === 'sourceToTarget') return aimAngle ?? travelAngle;
  return travelAngle;
}

/**
 * The rotation a particle should hold THIS frame. Two mutually exclusive modes, matching the
 * `orientToVelocity` param:
 *  - OFF (the default): advance the particle's own spin — `prevRot + spinRad * dtSec`, byte-for-byte the
 *    expression this loop always used inline, so the toggle's `false` default is an exact no-op.
 *  - ON: point the sprite along its direction of travel (`atan2(vy, vx)`), which is what makes an imported
 *    shard/arrow/directional sprite read correctly. Spin is deliberately ignored while on — you can't both
 *    tumble and track a heading.
 *
 * Zero-length velocity has no direction: `Math.atan2(0, 0)` is 0, which would SNAP a stalled particle to
 * pointing right (+x). Below the epsilon we keep the previous rotation instead, so a particle dragged to a
 * halt holds its last heading rather than flicking. Pure + allocation-free so it can run per-particle
 * per-frame, and standalone so it's unit-testable without a WebGL context (same reason as `sampleBurstAngle`
 * above). Deliberately NOT shared with emitter.ts/smoke.ts's identical copies: importing across primitive
 * modules would drag this module's `registerPrimitive` side effect into their module graphs, and these files
 * already keep primitive-local pure helpers self-contained (see `advanceEmitBudget` vs `advanceSmokeBudget`).
 */
export function resolveParticleRotation(
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
    kind: 'slider', label: 'Count', group: 'Emit', min: 4, max: 400, step: 1, default: 28, essential: true,
    axis: 'intensity',
    help: 'Particles per burst. The whole wave is emitted at once, so this is the density of the spray — 28 is a handful of shrapnel, the top of the range a wall of it. A burst can never put more than 800 particles on screen at once however high this and Interval go.',
  },
  interval: {
    kind: 'slider', label: 'Interval', group: 'Emit', min: 100, max: 6000, step: 10, default: 600,
    // A duration, so it rides `time` for consistency — a stretched def's looping cadence stretches with it.
    // Inert on the shipped path either way: `playDef` always fires one-shot, where `interval` is never
    // consulted (see the `oneShot` branch in `update`), so this can never move a fired burst's particle count.
    axis: 'time',
    help: 'Gap in ms between repeat bursts while the preview is looping. Fire throws exactly one burst, so this does nothing there — turn Loop on to see it.',
  },
  spread: {
    kind: 'slider', label: 'Spread', group: 'Emit', min: 0, max: 1, step: 0.01, default: 1,
    help: '1 = full circle, lower narrows to a cone — 0.18 is a ±33° fan, 0 a single line. Aim decides which way that cone points.',
  },
  aimMode: {
    kind: 'enum', label: 'Aim', group: 'Emit', options: BURST_AIM_MODES, default: 'travel',
    help: 'Which way the cone points. travel (the default) follows the emitter\'s own direction of movement — which is nothing at all for a burst pinned to a static point, so it fans along +x there. fixed points it at the Angle you set. sourceToTarget points it along the moment itself — from the source anchor toward the target anchor, so an attacker\'s blow throws its sparks at the defender — and falls back to travel when the effect was fired without both anchors, or with the two on the same spot. Does nothing at Spread 1 — a full circle has no centre to aim.',
  },
  angle: {
    kind: 'slider', label: 'Angle', group: 'Emit', min: -180, max: 180, step: 1, default: -90,
    enabledWhen: { param: 'aimMode', is: 'fixed' },
    // Screen space, so UP is NEGATIVE. Stated in the help rather than left to the reader because getting the
    // sign backwards produces a burst that fires into the floor and looks like a tuning mistake, not a bug.
    help: 'Where the cone points, in degrees, when Aim is fixed. Screen convention: 0 is right, and because the screen\'s Y axis grows DOWNWARD, -90 is straight UP, +90 straight DOWN, and ±180 is left. Does nothing while Aim is travel.',
  },

  speed: {
    kind: 'slider', label: 'Speed', group: 'Motion', min: 20, max: 3000, step: 5, default: 260, essential: true,
    axis: 'scale', help: 'How fast a shard leaves the anchor, in px/sec. 260 is a normal spray; past ~1500 shards clear the card in a couple of frames, which is what sells a hit as violent (pair it with a short Life or they just leave).',
  },
  speedVar: {
    kind: 'slider', label: 'Speed var', group: 'Motion', min: 0, max: 1, step: 0.01, default: 0.5,
    help: 'Randomises speed ± this fraction.',
  },
  drag: {
    kind: 'slider', label: 'Drag', group: 'Motion', min: 0.7, max: 1, step: 0.005, default: 0.9,
    help: 'How quickly shards slow down — 1 keeps them flying flat out the whole way, 0.9 (the default) coasts them to a stop, 0.7 stalls them almost the moment they leave.',
  },
  gravity: {
    kind: 'slider', label: 'Gravity', group: 'Motion', min: -4000, max: 4000, step: 10, default: 0, axis: 'scale',
    help: 'Downward acceleration in px/sec². 0 is weightless; positive pulls shards down into an arc (coins.json throws at ~1700 to get a real ballistic lob), negative floats them up. It is signed, so the full range covers both.',
  },
  life: {
    kind: 'slider', label: 'Life', group: 'Motion', min: 120, max: 6000, step: 10, default: 450, essential: true,
    // The canonical `time` param: a duration in ms. A burst emits its whole wave at t=0, so stretching this
    // makes each shard live (and therefore fly) longer WITHOUT changing how many shards there are — which is
    // what keeps a seeded burst's 7-draws-per-particle stream byte-identical at any `time`.
    axis: 'time',
    help: 'How long each shard lives, in ms. Together with Speed and Drag this decides how far it gets — a long Life on a heavily-dragged shard leaves it hanging where it stopped, which is usually the moment to fade it with Alpha / life.',
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
    kind: 'enum', label: 'Emit shape', group: 'Physics', options: EMIT_SHAPES, default: 'point',
    help: 'Where shards are born relative to the anchor: all from one spot, off the edge of a ring, anywhere inside a disc, or anywhere in a box. Does nothing while Emit radius is 0 — every shape collapses to a single spot there.',
  },
  emitRadius: {
    kind: 'slider', label: 'Emit radius', group: 'Physics', min: 0, max: 400, step: 1, default: 0, axis: 'scale',
    // `emitShape` and `emitRadius` are mutually dead at these defaults (point + 0), so only ONE of the pair
    // may declare the dependency — disabling both would be a deadlock with no way back in. Shape is the
    // gateway you pick first; picking anything but `point` unlocks the radius.
    enabledWhen: { param: 'emitShape', not: 'point' },
    help: 'How far out from the anchor that spawn area reaches, in px — bigger reads as a wider, softer source instead of a pinpoint. Does nothing while Emit shape is point.',
  },
  inheritVel: {
    kind: 'slider', label: 'Inherit vel', group: 'Physics', min: 0, max: 1, step: 0.01, default: 0,
    help: 'Fraction of the anchor\'s own movement velocity added to each new particle.',
  },

  shape: {
    kind: 'shape', label: 'Shape', group: 'Shape', default: 'shard',
    help: 'Every live particle in the burst shares one base texture, so this swaps all of them at once. Custom imported PNG/SVG art is selectable here alongside the built-ins.',
  },
  size: {
    kind: 'slider', label: 'Size', group: 'Shape', min: 2, max: 200, step: 1, default: 9, essential: true, axis: 'scale',
    help: 'How big a shard is across, in px — 9 reads as shrapnel, 40 as flying chunks, and the top of the range is debris the size of the card. Size var jitters it per shard and the Size / life curve rescales it as the shard ages.',
  },
  sizeVar: {
    kind: 'slider', label: 'Size var', group: 'Shape', min: 0, max: 1, step: 0.01, default: 0.5,
    help: 'How much shard sizes differ from each other, as a fraction of Size — 0 makes every shard identical, 0.5 (the default) spreads them between half and one-and-a-half size.',
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
    // vMax 2 lets a shard OVERSHOOT its base size mid-life (a pop/flash) rather than only decaying from it.
    // The default is unchanged (1 -> 0, the original linear shrink), so this widens the editor's range without
    // altering the look until a point is dragged above the 1x line.
    default: [[0, 1], [1, 0]], vMax: 2, presets: CURVE_PRESETS,
    help: 'Size multiplier over each particle\'s life (0 = birth, 1 = death).',
  },

  coreBias: {
    kind: 'slider', label: 'Core bias', group: 'Style', min: 0, max: 1, step: 0.01, default: 0.5,
    help: 'How far toward the bright core a shard\'s colour is allowed to reach — 0 keeps them all rim-dark, 1 lets the hottest hit the white core. With Bands at 1 there is only one flat colour to land on, so it stops changing the tint (it still shifts how much of a shard survives Erode).',
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
    help: 'How much of a shard is one flat hot centre before its colour steps down toward the rim — wide gives fat cel bands and a big bright middle, 0 shrinks the brightest colour to a hairline. It stops shaping the shard\'s body as Field mix approaches 1, though it still shapes the Glow halo.',
  },
  fieldMix: {
    kind: 'slider', label: 'Field mix', group: 'Style', min: 0, max: 1, step: 0.01, default: 0,
    help: 'Where a shard\'s colour rings come from: 0 draws them outward from its own centre (the ribbon look, and the only setting that can band a hard-edged silhouette at all), 1 follows the art\'s own soft edge instead — better for hand-painted PNGs that already fade out.',
  },
  tintMode: {
    kind: 'enum', label: 'Tint mode', group: 'Style', options: PARTICLE_TINT_MODES, default: 'palette',
    help: 'palette = recolour into the palette stops; texture = keep imported art\'s own colours, still posterized into Bands levels.',
  },
  palette: {
    kind: 'palette', label: 'Palette', group: 'Style', essential: true,
    default: paletteTuple('violet'), presets: PALETTE_PRESETS,
    help: 'The four colours a shard steps through, dark rim first and white-hot core last; a preset swaps all four at once. While Tint mode is texture only the last (core) colour is used — and only to tint the Glow halo — so the other three do nothing there.',
  },
  blendMode: {
    kind: 'enum', label: 'Blend mode', group: 'Style', options: FX_BLEND_MODES, default: 'add', essential: true,
    help: 'How the shards composite over what is behind them: add (the default) makes them glow and brighten whatever they cross, normal paints them as solid opaque colour, screen is a gentler lift, and multiply/overlay stain what is behind rather than lighting it.',
  },
  glow: {
    kind: 'slider', label: 'Glow', group: 'Style', min: 0, max: 1, step: 0.01, default: 0.25,
    help: 'Soft additive halo behind each particle.',
  },

  noiseScale: {
    kind: 'slider', label: 'Noise scale', group: 'Texture', min: 0.5, max: 20, step: 0.1, default: 6,
    // The whole noise/texture group is inert while Erode is 0: the shader only ever consumes the noise as
    // `baseShape * uGain - n * uErode`, so at erode 0 the noise term vanishes AND uGain cancels out of the
    // `d / uGain` normalisation. See particleMaterial.ts's PARTICLE_FRAG.
    enabledWhen: { param: 'erode', above: 0 },
    help: 'How fine the mottling inside each shard is — low gives a couple of big blotches per shard, high a dense speckle. Does nothing while Erode is 0.',
  },
  warp: {
    kind: 'slider', label: 'Warp', group: 'Texture', min: 0, max: 1.5, step: 0.01, default: 0.35,
    enabledWhen: { param: 'erode', above: 0 },
    help: 'Curls that mottling into flowing, flame-like streaks instead of round blobs — 0 leaves it plain and lumpy, 0.35 is the reference look. Does nothing while Erode is 0.',
  },
  scroll: {
    kind: 'slider', label: 'Scroll', group: 'Texture', min: 0, max: 6, step: 0.05, default: 1.4,
    enabledWhen: { param: 'erode', above: 0 },
    help: 'How fast the mottling drifts across each shard — this is what makes shards flicker and churn instead of looking stamped; 0 holds the pattern still. Does nothing while Erode is 0.',
  },
  erode: {
    kind: 'slider', label: 'Erode', group: 'Texture', min: 0, max: 1.2, step: 0.01, default: 0.35,
    help: 'How much the noise eats into each particle\'s shape — higher gives a more tattered edge.',
  },
  gain: {
    kind: 'slider', label: 'Gain', group: 'Texture', min: 0.3, max: 2, step: 0.01, default: 1.4,
    enabledWhen: { param: 'erode', above: 0 },
    help: 'How well a shard resists Erode — raise it and the noise takes smaller bites so shards read solid, lower it and the same Erode chews them down to wisps. Does nothing while Erode is 0.',
  },
} satisfies FxParamSpecs;

type BurstParams = ParamsOf<typeof SPECS>;

/** Pull the ribbon-derived shaping uniforms out of a `BurstParams` into the shape `particleMaterial.ts`
 *  wants. Kept as one small helper (rather than inlined at each of the constructor/setParams call sites)
 *  so the two call sites can't drift on which fields map to `noise.x` vs `noise.y`. */
function shapingOf(p: BurstParams): ParticleShaping {
  return { noise: [p.noiseScale, p.noiseScale], warp: p.warp, scroll: p.scroll, erode: p.erode, gain: p.gain };
}

/** The Style-group half of the same mapping (see `shapingOf` above for why these are helpers rather than
 *  inlined at the constructor + `setParams` call sites). */
function styleOf(p: BurstParams): ParticleStyle {
  return {
    palette: p.palette,
    bands: p.bands,
    glow: p.glow,
    plateau: p.plateau,
    fieldMix: p.fieldMix,
    tintMode: p.tintMode,
  };
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
  bias0: number; // spawn core-bias; effectiveBias(lifeT) = bias0 * sampleCurve(biasCurve, lifeT)
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
  // Previous frame's head position + the anchor velocity derived from it (px/sec), recomputed at the top of
  // each update() and read by emit() for velocity inheritance. Zero until we have two real head samples.
  private lastHeadX = 0;
  private lastHeadY = 0;
  private lastHeadSet = false;
  private headVx = 0;
  private headVy = 0;
  // Reused scratch for `emissionOffset` so a shaped spawn allocates nothing per particle (mirrors the
  // emitter's `budgetState` discipline).
  private readonly emitScratch = { ox: 0, oy: 0 };
  // `setHead` has landed at least once with a real anchor position. Gates the very first wave — see the
  // constructor comment below for why we can't just emit on construction.
  private headSet = false;
  private firstEmitDone = false;
  // True when this instance was spawned for a one-shot Fire (see FxContext.oneShot). Fires exactly the one
  // wave gated by `firstEmitDone` above and never re-fires on `interval` — the interval only drives re-firing
  // for the continuous workbench-loop preview.
  private readonly oneShot: boolean;
  // This instance's ONE random source, seeded once in the constructor and drawn from by `emit()` in a fixed
  // order (see there). With `ctx.seed` set the whole burst — every angle, speed, size, bias, offset and spin
  // — replays identically, which is what makes a tuning holdable/screenshot-able; without one we roll a
  // fresh seed per instance, i.e. exactly the previous `Math.random()` behaviour. See `fx/rng.ts`.
  private readonly rand: FxRandom;
  private travelAngle = 0; // radians; last known non-zero travel direction, aims the cone when spread < 1
  // radians; the fire's staged source→target direction, or null for "no usable direction" (never delivered,
  // or the two points coincide). Set by `setAim`; read ONCE PER WAVE by `emit`. See `resolveBurstAimAngle`.
  private aimAngle: number | null = null;
  private timer = 0; // ms since last emit
  private clockSec = 0; // drives the shader's uTime — see setParticleTime's own comment

  constructor(ctx: FxContext, params: BurstParams) {
    this.params = params;
    this.renderer = ctx.renderer;
    this.oneShot = ctx.oneShot === true;
    this.rand = makeRng(ctx.seed ?? randomSeed());
    this.texture = getShapeTextureById(ctx.renderer, params.shape);
    this.shader = createParticleMaterial(ctx.renderer, styleOf(params), shapingOf(params));
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

  /** The fire's source→target vector (see `FxInstance.setAim`). Reaching this method AT ALL already means the
   *  caller staged both anchors — `driveLayerHeads` will not call it otherwise — so the only thing left to
   *  reject here is the two points COINCIDING, which has no direction. `null` in that case, and
   *  `resolveBurstAimAngle` falls back to `travel` rather than snapping the cone to `atan2(0, 0)` = +x.
   *
   *  Draws no randomness and touches no particle: called every frame by the head-driving loop, read once per
   *  WAVE by `emit`, so it cannot disturb the seeded draw sequence documented there. */
  setAim(sx: number, sy: number, tx: number, ty: number): void {
    const dx = tx - sx;
    const dy = ty - sy;
    this.aimAngle = dx * dx + dy * dy > AIM_EPSILON_SQ ? Math.atan2(dy, dx) : null;
  }

  /** Push `count` fresh particles into both `live` and the container's `particleChildren` at the current
   *  head position. Called only from `update()` (never the constructor — see there).
   *
   *  Every draw below comes from `this.rand` (this instance's seeded stream) rather than `Math.random`. The
   *  distributions and the ORDER of the draws are byte-for-byte what they were — 7 per particle: angle,
   *  speed, size, bias, the two emission-shape offsets, then spin — so the statistical look is unchanged and
   *  only its reproducibility is new. Reordering or adding a draw here changes what every saved seed
   *  replays, so treat the sequence as part of the contract.
   *
   *  `aimMode`/`angle` — and the `sourceToTarget` aim delivered by `setAim` — deliberately do NOT
   *  participate: the cone's base angle is chosen by
   *  `resolveBurstAimAngle`, a pure function of state that draws nothing, once per WAVE rather than per
   *  particle. So an aimed burst consumes the identical stream an unaimed one did — the angles come out
   *  rotated, not re-rolled — and `aimMode: 'travel'` (the default) reproduces every saved seed exactly. */
  private emit(): void {
    const p = this.params;
    const room = MAX_LIVE - this.live.length;
    const n = Math.min(p.count, room);
    const children = this.pc.particleChildren;
    // The cone's centre for this whole wave. Computed ONCE, outside the loop, and drawing NOTHING from
    // `this.rand` — see `resolveBurstAimAngle`, which exists precisely so the base angle can be chosen
    // without touching the draw sequence documented above.
    const aim = resolveBurstAimAngle(p.aimMode, this.travelAngle, p.angle, this.aimAngle);
    for (let i = 0; i < n; i++) {
      const angle = sampleBurstAngle(aim, p.spread, this.rand);
      const speed = p.speed * (1 + (this.rand() * 2 - 1) * p.speedVar);
      const size = Math.max(0.5, p.size * (1 + (this.rand() * 2 - 1) * p.sizeVar));
      const { scaleX: scaleX0, scaleY: scaleY0 } = resolveParticleScale(size, p.stretchX, p.stretchY);
      // Greyscale core-bias tint (NOT a resolved palette colour — the shader posterizes into the live
      // uPal/uBands uniforms per-pixel, see particleMaterial.ts). Same distribution as before: uniform in
      // [0, coreBias], so `coreBias` still reads as "how deep toward the white core this burst reaches".
      const bias0 = p.coreBias * this.rand();
      const tint = biasTint(bias0);
      // Spawn-position offset for the emission shape (point/radius 0 → (0, 0), i.e. no change).
      emissionOffset(p.emitShape, p.emitRadius, this.rand(), this.rand(), this.emitScratch);
      const particle = new Particle({
        texture: this.texture,
        x: this.headX + this.emitScratch.ox,
        y: this.headY + this.emitScratch.oy,
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
        // Base radial velocity plus a fraction of the anchor's own movement (inheritVel 0 → no change).
        vx: Math.cos(angle) * speed + p.inheritVel * this.headVx,
        vy: Math.sin(angle) * speed + p.inheritVel * this.headVy,
        spin: (this.rand() * 2 - 1) * 6,
        age: 0,
        maxLife: Math.max(1, p.life),
        scaleX0,
        scaleY0,
        bias0,
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
    // Anchor velocity (px/sec) for velocity inheritance, from the head's frame-over-frame delta. The ticker
    // calls update() BEFORE setHead() each frame, so headX/headY here are last frame's anchor position;
    // lastHeadX/Y are the frame before. Zero until we have two real head samples (guards the spurious spike
    // that diffing against the (0,0) default would produce on the very first wave). With inheritVel = 0 this
    // is never read, so it can't affect the default look.
    if (this.lastHeadSet && dtSec > 0) {
      this.headVx = (this.headX - this.lastHeadX) / dtSec;
      this.headVy = (this.headY - this.lastHeadY) / dtSec;
    } else {
      this.headVx = 0;
      this.headVy = 0;
    }
    const dragF = Math.pow(p.drag, dtMs / DRAG_REF_MS);
    const gravity = p.gravity;
    const turbulence = p.turbulence;
    const turbScale = p.turbScale;
    const orient = p.orientToVelocity;
    const clockSec = this.clockSec;
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
      // Pseudo-turbulence: a swirling lateral acceleration folded into velocity (turbulence 0 → adds 0, so
      // the default is a byte-identical no-op). Uses the particle's current position + the instance clock.
      if (turbulence !== 0) {
        lp.vx += turbulence * turbulenceX(particle.x, particle.y, clockSec, turbScale) * dtSec;
        lp.vy += turbulence * turbulenceY(particle.x, particle.y, clockSec, turbScale) * dtSec;
      }
      // Spin, or point along the direction of travel when `orientToVelocity` is on (see
      // `resolveParticleRotation` — with the toggle off this is exactly `rotation += spin * dtSec`, the
      // expression that used to be inlined here). Reads lp.vx/lp.vy AFTER this frame's gravity/drag/
      // turbulence, so the sprite tracks the heading it is actually flying on right now.
      particle.rotation = resolveParticleRotation(particle.rotation, lp.vx, lp.vy, orient, lp.spin, dtSec);

      const frac = 1 - lp.age / lp.maxLife; // 1 -> 0 over life
      const lifeT = lp.age / lp.maxLife; // 0 -> 1 over life
      // Built-in quadratic fade, times the explicit alpha-over-life curve (default flat 1 → sampleCurve
      // returns exactly 1 and `x * 1 === x`, so the default is a byte-identical no-op).
      particle.alpha = frac * frac * sampleCurve(p.alphaCurve, lifeT);
      const s = sampleCurve(p.sizeCurve, lifeT);
      particle.scaleX = lp.scaleX0 * s;
      particle.scaleY = lp.scaleY0 * s;
      // Colour-over-life: the spawn bias scaled by the bias curve, recomputed every frame (default flat 1 =
      // exactly the spawn tint — a no-op; the color buffer already re-uploads each frame, so this is free).
      particle.tint = biasTint(lp.bias0 * sampleCurve(p.biasCurve, lifeT));

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

    // Snapshot this frame's head so next frame can derive the anchor velocity from the delta. Only once we
    // hold a real anchor position (headSet), so the first velocity sample diffs two real heads, never the
    // (0,0) default.
    if (this.headSet) {
      this.lastHeadX = this.headX;
      this.lastHeadY = this.headY;
      this.lastHeadSet = true;
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
    updateParticleMaterial(this.shader, styleOf(next));
    updateParticleMaterialShaping(this.shader, shapingOf(next));
    if (shapeChanged) {
      // A ParticleContainer shares exactly ONE base texture across every live particle (see
      // `shapeTextures.ts`'s `getShapeTexture` header comment), so every shard/mote already in flight
      // changes shape on the same frame as new ones — there's no way to have some particles keep the old
      // shape without a second container, and nothing in this workbench needs that.
      this.texture = getShapeTextureById(this.renderer, next.shape);
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
