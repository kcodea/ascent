import {
  ColorMatrixFilter,
  Container,
  DisplacementFilter,
  MeshPlane,
  MeshRope,
  NineSliceSprite,
  PerspectiveMesh,
  Rectangle,
  Sprite,
  Texture,
  type Filter,
} from 'pixi.js';
import { BLUR_PARAM_SPECS } from '../blurFilter';
import { FilterStack, filterLabSpecs } from '../filterStack';
import { FILTERS } from '../filterRegistry';
import { ContainerTransform, TRANSFORM_PARAM_SPECS } from '../transformEnvelope';
import type { FxParamSpecs, ParamsOf } from '../params';
import type { FxContext, FxInstance, FxPrimitive } from '../primitive';
import { sampleCurve, CURVE_PRESETS } from '../curve';
import { FX_BLEND_MODES, type FxBlendMode } from '../blendModes';
import { getImageTexture, IMAGE_NONE } from '../imageLibrary';
import { makeRng, randomSeed } from '../rng';
import {
  aimsLeft,
  reverseFrame,
  rollScatter,
  rollVariation,
  ropePoints,
  SCATTER_SHAPES,
  SHEET_MODES,
  sheetFrameIndex,
  sheetFrameRects,
  tiltCorners,
  WOBBLE_AXES,
  wobblePositions,
  type ScatterRoll,
  type ScatterShape,
  type SheetMode,
  type VariationRoll,
  type WobbleAxis,
} from '../customGeometry';
import { registerPrimitive } from '../registry';
import { HeadTrail, smoothAngle } from '../trail';

/**
 * `custom` — an IMPORTED IMAGE (PNG / SVG) as a first-class effect layer.
 *
 * Phase 1: one picture, true colours at display resolution, placed at the layer's anchor and driven by
 * everything every primitive gets (transform envelope, filter lab, blend), plus placement (size / pivot /
 * offset / rotation / flip / aim-at-target), an alpha-over-life curve and a flat tint.
 *
 * Phase 2 (all composable):
 *   • SPRITE SHEET — the image is a grid; Columns × Rows × Frame count cut it, and a frame plays per copy
 *     (loop / once / ping-pong at an fps, or `overLife` = the whole strip exactly once per play). A frame is
 *     a sub-`Texture` sharing the sheet's source; `Size` refers to ONE frame, not the sheet.
 *   • COUNT + SCATTER — N copies rolled off the layer's seed (deterministic per fire: same seed, same field)
 *     inside a radius, with rotation / scale / alpha jitter and an in-order stagger.
 *   • RENDER MODE — `sprite` (a Sprite), `slice` (a 3-slice: the end caps stay crisp while the body
 *     stretches — for beams), `plane` (a MeshPlane whose vertices ripple), `rope` (a MeshRope bent along an
 *     arc + wave), `perspective` (a PerspectiveMesh tilted in 2.5D).
 *   • ROLE — `draw` shows the image; `displace` and `mask` instead act on the effect's OTHER layers through
 *     `ctx.effectRoot`: a hidden map sprite drives a DisplacementFilter on the root, or the image becomes the
 *     root's alpha mask. Everything attached to the root is removed in `destroy()`.
 *
 * Phase 3:
 *   • ANTI-STALE — per-copy, seeded VARIATION from ONE sheet: variant rows (each row a different take, one
 *     picked per copy), random start frame, random flip X/Y, fps jitter, hue jitter (a per-copy
 *     ColorMatrixFilter — a real hue rotation, opt-in because it is a filter pass per copy), random reverse.
 *     In-game every fire rolls a fresh seed, so all of it varies per fire; a workbench-locked seed repeats.
 *   • AIMED ART — `aimStretch` scales the image's LENGTH to the source→target distance (Size becomes its
 *     thickness), `aimUpright` mirrors it across its own axis when the aim points left so a side-view image
 *     never renders upside-down, and `slice` mode stretches only the body between two caps.
 *
 * No particle shader on purpose: `particleMaterial.ts` recolours / cel-quantises a texture's RGB, which is
 * right for a silhouette and wrong for a picture. Every copy is a `wrap` Container (placement, alpha, hue)
 * around a `node` (the Sprite/Mesh: texture, tint, blend); the node is offset inside the wrap by the pivot,
 * so a pivot change is a retune, not a rebuild. Copies are built LAZILY the first frame the texture is
 * decoded and rebuilt only when a STRUCTURAL param changes (see `structureKey`). `isComplete` is clocked,
 * never texture-gated, so a missing image can't hang a fire.
 *
 * The pure maths (frame cutting, scatter + variation rolls, wobble, rope arc, tilt corners) lives in
 * `customGeometry.ts`.
 */

export const CUSTOM_AIM_MODES = ['fixed', 'sourceToTarget', 'travel'] as const;
export const CUSTOM_RENDER_MODES = ['sprite', 'slice', 'plane', 'rope', 'perspective'] as const;
export const CUSTOM_ROLES = ['draw', 'displace', 'mask'] as const;
export const CUSTOM_BEND_MODES = ['arc', 'trail'] as const;

const DEG_TO_RAD = Math.PI / 180;
const TAU = Math.PI * 2;
/** Below this squared distance the source→target vector has no direction worth aiming along. */
const AIM_EPSILON_SQ = 1e-6;

const SPECS = {
  // ── Image ──
  image: {
    kind: 'image', label: 'Image', group: 'Image', default: IMAGE_NONE, essential: true,
    help: 'The picture this layer draws. Import a PNG or SVG (it is written to defs/images/ and ships with the def — only commit art meant to ship). Nothing draws until one is picked.',
  },
  size: {
    kind: 'slider', label: 'Size', group: 'Image', min: 8, max: 1200, step: 1, default: 200, essential: true,
    help: 'Longest side in px of ONE frame (the whole image unless it is a sprite sheet), at the reference board size. The other side follows the frame\'s own aspect. With Stretch to target on, this is the THICKNESS instead. The Transform envelope\'s Scale / time multiplies this over life.',
  },
  durationMs: {
    kind: 'slider', label: 'Duration', group: 'Image', min: 100, max: 5000, step: 10, default: 800,
    help: 'How long one play lasts, in ms — the timeline every "/ time" curve on this layer runs over. A one-shot fire finishes here (plus any scatter stagger); the continuous preview loops it.',
  },
  // ── Sheet ──
  sheetCols: {
    kind: 'slider', label: 'Columns', group: 'Sheet', min: 1, max: 16, step: 1, default: 1,
    help: 'Sprite sheet: how many frames across. 1 × 1 = not a sheet, the whole image is the picture.',
  },
  sheetRows: {
    kind: 'slider', label: 'Rows', group: 'Sheet', min: 1, max: 16, step: 1, default: 1,
    help: 'Sprite sheet: how many frames down.',
  },
  sheetFrames: {
    kind: 'slider', label: 'Frame count', group: 'Sheet', min: 0, max: 256, step: 1, default: 0,
    help: 'How many cells of the grid are real frames, in reading order (left→right, top→bottom). 0 = all of them. Sheets exported from most tools pad the last row with blanks — set this to skip them. With Variant rows on, this is the frame count PER ROW.',
  },
  sheetVariantRows: {
    kind: 'toggle', label: 'Variant rows', group: 'Sheet', default: false,
    help: 'Treat each ROW of the sheet as a separate take of the same animation, and pick one per copy (and per fire, since each fire rolls a fresh seed). An 8 × 4 sheet becomes four different 8-frame animations — the biggest single cure for an effect looking the same every time.',
  },
  sheetFps: {
    kind: 'slider', label: 'FPS', group: 'Sheet', min: 0, max: 60, step: 1, default: 12,
    help: 'Frames per second for loop / once / pingpong. 0 freezes on the Start frame. Ignored by overLife, which paces itself to Duration.',
  },
  sheetMode: {
    kind: 'enum', label: 'Play', group: 'Sheet', options: SHEET_MODES, default: 'loop',
    help: 'loop cycles the strip at FPS. once plays it through and holds the last frame. pingpong bounces end to end. overLife plays the WHOLE strip exactly once over this layer\'s Duration, whatever the FPS — the right choice for a one-shot impact sheet.',
  },
  sheetStart: {
    kind: 'slider', label: 'Start frame', group: 'Sheet', min: 0, max: 255, step: 1, default: 0,
    help: 'Which frame the strip starts on (wraps). With FPS 0 this is the single frame shown.',
  },
  // ── Random (anti-stale; every roll comes off the layer's seed) ──
  randomStart: {
    kind: 'toggle', label: 'Random start frame', group: 'Random', default: false,
    help: 'Each copy starts the strip on a random frame (added to Start frame). With loop, a field of copies stops pulsing in lockstep.',
  },
  randomFlipX: {
    kind: 'toggle', label: 'Random flip X', group: 'Random', default: false,
    help: 'Each copy has a 50% chance of being mirrored left↔right — a mirrored slash reads as a different slash, for free.',
  },
  randomFlipY: {
    kind: 'toggle', label: 'Random flip Y', group: 'Random', default: false,
    help: 'Each copy has a 50% chance of being mirrored top↔bottom.',
  },
  fpsJitter: {
    kind: 'slider', label: 'FPS jitter', group: 'Random', min: 0, max: 1, step: 0.01, default: 0,
    help: 'Each copy plays at FPS × a random 1 ± this, so copies drift out of sync over time instead of marching together. 0 = all in step.',
  },
  hueJitter: {
    kind: 'slider', label: 'Hue jitter', group: 'Random', min: 0, max: 180, step: 1, default: 0,
    help: 'Each copy\'s colours are hue-rotated by a random ± this many degrees — variation with no new art. A REAL hue rotation (not a tint), which costs one filter pass per copy, so keep Count modest when this is on.',
  },
  randomReverse: {
    kind: 'toggle', label: 'Random reverse', group: 'Random', default: false,
    help: 'Each copy has a 50% chance of playing the strip backwards.',
  },
  // ── Scatter ──
  count: {
    kind: 'slider', label: 'Count', group: 'Scatter', min: 1, max: 64, step: 1, default: 1,
    help: 'How many copies of the image to draw. 1 = just the one. Every copy shares the look and each gets its own scatter + random roll. (Ignored by the displace / mask roles — they use one map.)',
  },
  scatterRadius: {
    kind: 'slider', label: 'Radius', group: 'Scatter', min: 0, max: 600, step: 1, default: 0,
    help: 'How far from the anchor copies can land, in px. 0 stacks them all on the anchor. Rolled from the layer\'s seed, so a seeded def scatters the same way every fire.',
  },
  scatterShape: {
    kind: 'enum', label: 'Area', group: 'Scatter', options: SCATTER_SHAPES, default: 'circle',
    help: 'The shape copies scatter within — a disc of Radius, or a square of half-width Radius.',
  },
  jitterRotation: {
    kind: 'slider', label: 'Rotation jitter', group: 'Scatter', min: 0, max: 180, step: 1, default: 0,
    help: 'Each copy gets a random extra rotation of up to ± this many degrees, on top of Rotation / Aim. Works with Count 1 too — a lone image lands at a different angle every fire.',
  },
  jitterScale: {
    kind: 'slider', label: 'Size jitter', group: 'Scatter', min: 0, max: 1, step: 0.01, default: 0,
    help: 'Each copy\'s size is multiplied by a random 1 ± this. 0.5 = anywhere from half to one-and-a-half size.',
  },
  jitterAlpha: {
    kind: 'slider', label: 'Alpha jitter', group: 'Scatter', min: 0, max: 1, step: 0.01, default: 0,
    help: 'Each copy\'s opacity is reduced by a random 0..this fraction. 0 = all copies equally opaque.',
  },
  staggerMs: {
    kind: 'slider', label: 'Stagger', group: 'Scatter', min: 0, max: 2000, step: 10, default: 0,
    help: 'Delay between copies, in ms, in order: copy 2 starts this long after copy 1, and so on. Each copy runs its own Duration (and its own sheet playback) from its start. A one-shot fire waits for the last copy.',
  },
  // ── Render ──
  renderMode: {
    kind: 'enum', label: 'Render as', group: 'Render', options: CUSTOM_RENDER_MODES, default: 'sprite', essential: true,
    help: 'sprite draws the flat picture. slice is a 3-slice: the two end caps stay crisp while only the body stretches — the right mode for a beam or bar that must reach any length. plane is a mesh whose surface ripples (Wobble knobs). rope bends the picture along an arc (Bend knobs). perspective tilts it in 2.5D (Tilt knobs). All of them still take sheets, scatter, tint, blend and the filter lab.',
  },
  sliceCap: {
    kind: 'slider', label: 'Cap width', group: 'Render', min: 0, max: 512, step: 1, default: 32, enabledWhen: { param: 'renderMode', is: 'slice' },
    help: 'How many px of the frame (un-scaled) at EACH end are a cap that never stretches. The middle is the body. Clamped to under half the frame.',
  },
  meshSegments: {
    kind: 'slider', label: 'Wobble detail', group: 'Render', min: 2, max: 32, step: 1, default: 12, enabledWhen: { param: 'renderMode', is: 'plane' },
    help: 'Vertices per side of the plane mesh. More = smoother ripples, more work per frame.',
  },
  waveAmp: {
    kind: 'slider', label: 'Wobble amount', group: 'Render', min: 0, max: 100, step: 1, default: 12, enabledWhen: { param: 'renderMode', is: 'plane' },
    help: 'How far the surface ripples, in px of the un-scaled frame. 0 = a flat plane.',
  },
  waveFreq: {
    kind: 'slider', label: 'Wobble waves', group: 'Render', min: 0, max: 8, step: 0.1, default: 1.5, enabledWhen: { param: 'renderMode', is: 'plane' },
    help: 'How many ripple cycles fit across the image. Low = one broad billow, high = fine shimmer.',
  },
  waveSpeed: {
    kind: 'slider', label: 'Wobble speed', group: 'Render', min: -5, max: 5, step: 0.1, default: 1, enabledWhen: { param: 'renderMode', is: 'plane' },
    help: 'How fast the ripples travel, in cycles per second. Negative reverses the direction; 0 freezes them.',
  },
  waveAxis: {
    kind: 'enum', label: 'Wobble axis', group: 'Render', options: WOBBLE_AXES, default: 'y', enabledWhen: { param: 'renderMode', is: 'plane' },
    help: 'y ripples the surface up/down along its width (a flag in wind). x ripples it side to side along its height (a hanging curtain). both does both.',
  },
  ropeSegments: {
    kind: 'slider', label: 'Bend detail', group: 'Render', min: 2, max: 48, step: 1, default: 16, enabledWhen: { param: 'renderMode', is: 'rope' },
    help: 'Points along the rope. More = a smoother curve.',
  },
  bendMode: {
    kind: 'enum', label: 'Bend', group: 'Render', options: CUSTOM_BEND_MODES, default: 'arc', enabledWhen: { param: 'renderMode', is: 'rope' },
    help: 'arc bows the image along a fixed curve (the Bend knobs). trail makes the image follow the PATH the layer just travelled: on a travel-anchored layer it bends through the actual arc of flight, like a comet or a slash following its swing. In trail mode Size is the thickness, Trail length is the length, and Rotation / Aim are ignored (the path IS the direction).',
  },
  trailLength: {
    kind: 'slider', label: 'Trail length', group: 'Render', min: 20, max: 800, step: 5, default: 160, enabledWhen: { param: 'renderMode', is: 'rope' },
    help: 'How much of the travelled path the image spans, in px, measured back from the head. Only in Bend = trail. Before the layer has moved that far the tail extends straight back, so it never starts squashed.',
  },
  bendAmount: {
    kind: 'slider', label: 'Bend', group: 'Render', min: -400, max: 400, step: 1, default: 60, enabledWhen: { param: 'renderMode', is: 'rope' },
    help: 'How far the middle of the image bows away from a straight line, in px of the un-scaled frame. Positive bows down, negative up, 0 = straight.',
  },
  bendWave: {
    kind: 'slider', label: 'Bend wave', group: 'Render', min: 0, max: 100, step: 1, default: 0, enabledWhen: { param: 'renderMode', is: 'rope' },
    help: 'An extra sine wave along the rope, in px. 0 = a clean arc.',
  },
  bendCycles: {
    kind: 'slider', label: 'Bend wave cycles', group: 'Render', min: 0, max: 8, step: 0.1, default: 2, enabledWhen: { param: 'renderMode', is: 'rope' },
    help: 'How many wave cycles fit along the rope. Does nothing while Bend wave is 0.',
  },
  bendSpeed: {
    kind: 'slider', label: 'Bend wave speed', group: 'Render', min: -5, max: 5, step: 0.1, default: 0, enabledWhen: { param: 'renderMode', is: 'rope' },
    help: 'How fast the wave travels along the rope, in cycles per second. 0 holds it still.',
  },
  tiltSegments: {
    kind: 'slider', label: 'Tilt detail', group: 'Render', min: 2, max: 24, step: 1, default: 8, enabledWhen: { param: 'renderMode', is: 'perspective' },
    help: 'Vertices per side of the perspective mesh. More = less texture warping at steep tilts.',
  },
  tiltX: {
    kind: 'slider', label: 'Tilt X', group: 'Render', min: -80, max: 80, step: 1, default: 0, enabledWhen: { param: 'renderMode', is: 'perspective' },
    help: 'Rotate the image about its horizontal axis, in degrees — the top leans away or toward you. 0 = flat on.',
  },
  tiltY: {
    kind: 'slider', label: 'Tilt Y', group: 'Render', min: -80, max: 80, step: 1, default: 35, enabledWhen: { param: 'renderMode', is: 'perspective' },
    help: 'Rotate the image about its vertical axis, in degrees — one side leans away. 0 = flat on.',
  },
  tiltDepth: {
    kind: 'slider', label: 'Tilt depth', group: 'Render', min: 100, max: 2000, step: 10, default: 600, enabledWhen: { param: 'renderMode', is: 'perspective' },
    help: 'Camera distance, in px. Smaller = stronger foreshortening (the far edge shrinks more); larger = a flatter, more orthographic tilt.',
  },
  // ── Placement ──
  pivotX: {
    kind: 'slider', label: 'Pivot X', group: 'Placement', min: 0, max: 1, step: 0.01, default: 0.5,
    help: 'Where the frame\'s own origin sits, left→right (0 = left edge, 0.5 = centre, 1 = right edge). Rotation, flip and Size act about this point, and it is what lands on the anchor. For an aimed beam use 0 so its base sits on the caster.',
  },
  pivotY: {
    kind: 'slider', label: 'Pivot Y', group: 'Placement', min: 0, max: 1, step: 0.01, default: 0.5,
    help: 'Where the frame\'s own origin sits, top→bottom (0 = top edge, 0.5 = centre, 1 = bottom edge).',
  },
  offsetX: {
    kind: 'slider', label: 'Offset X', group: 'Placement', min: -600, max: 600, step: 1, default: 0,
    help: 'Static nudge from the anchor point, in px (positive = right). For a drift that plays out over life use the Transform envelope\'s Drift instead.',
  },
  offsetY: {
    kind: 'slider', label: 'Offset Y', group: 'Placement', min: -600, max: 600, step: 1, default: 0,
    help: 'Static nudge from the anchor point, in px (negative = up).',
  },
  rotation: {
    kind: 'slider', label: 'Rotation', group: 'Placement', min: -180, max: 180, step: 1, default: 0,
    help: 'Static rotation in degrees, clockwise positive. With Aim = sourceToTarget this is added ON TOP of the aim, so it corrects art that was drawn pointing somewhere other than +x (right).',
  },
  aimMode: {
    kind: 'enum', label: 'Aim', group: 'Placement', options: CUSTOM_AIM_MODES, default: 'fixed',
    help: 'fixed keeps the Rotation you set. sourceToTarget rotates the image to point along the moment itself — from the source anchor toward the target anchor, at ANY angle — so art drawn pointing right (+x) points at the victim; falls back to fixed without both anchors. travel rotates it to face the direction the layer is MOVING, frame by frame — a projectile art drawn pointing right noses along its path and turns through an arc; it holds its last heading when still.',
  },
  aimSmoothing: {
    kind: 'slider', label: 'Aim smoothing', group: 'Placement', min: 0, max: 0.95, step: 0.05, default: 0.3, enabledWhen: { param: 'aimMode', is: 'travel' },
    help: 'How much the travel heading lags behind the raw direction of motion. 0 snaps to it every frame (twitchy on a jittery path); higher smooths the turn. Only in Aim = travel.',
  },
  aimStretch: {
    kind: 'toggle', label: 'Stretch to target', group: 'Placement', default: false, enabledWhen: { param: 'aimMode', is: 'sourceToTarget' },
    help: 'Scale the image\'s LENGTH so it spans exactly from the source anchor to the target anchor; Size then sets its THICKNESS. Anchor the layer at source with Pivot X 0 so the base sits on the caster. Use Render as = slice so the end caps stay crisp. Does nothing without both anchors.',
  },
  aimUpright: {
    kind: 'toggle', label: 'Keep upright', group: 'Placement', default: false,
    help: 'When the aim (sourceToTarget or travel) points LEFT, mirror the image across its own axis so its top stays on top — a side-view beam, slash or projectile with shading never renders upside-down. Off = a pure rotation. Does nothing in Aim = fixed.',
  },
  flipX: {
    kind: 'toggle', label: 'Flip X', group: 'Placement', default: false,
    help: 'Mirror the image left↔right about its pivot.',
  },
  flipY: {
    kind: 'toggle', label: 'Flip Y', group: 'Placement', default: false,
    help: 'Mirror the image top↔bottom about its pivot.',
  },
  // ── Look ──
  alpha: {
    kind: 'slider', label: 'Alpha', group: 'Look', min: 0, max: 1, step: 0.01, default: 1,
    help: 'Peak opacity. Rides the Alpha / time graph over each copy\'s Duration.',
  },
  alphaCurve: {
    kind: 'curve', label: 'Alpha / time', group: 'Look', default: [[0, 1], [1, 1]], vMax: 1, presets: CURVE_PRESETS,
    help: 'How Alpha plays over a copy\'s life (0 = starts, 1 = finishes). Flat 1 = solid the whole way; a bump fades it in and out; a falling curve dissolves it.',
  },
  tint: {
    kind: 'toggle', label: 'Tint', group: 'Look', default: false,
    help: 'Multiply the image by a colour. Off draws the art exactly as imported. (For hue shifts, saturation or contrast use the HSL / Adjustment filters below, or Hue jitter for per-copy variation.)',
  },
  tintColor: {
    kind: 'color', label: 'Tint colour', group: 'Look', default: 0xffffff, enabledWhen: { param: 'tint', is: true },
    help: 'The colour multiplied over the image while Tint is on. White = unchanged.',
  },
  blendMode: {
    kind: 'enum', label: 'Blend', group: 'Look', options: FX_BLEND_MODES, default: 'normal',
    help: 'How the image composites over what is behind it. normal draws it as a picture; add / screen make it glow like light; multiply / overlay darken or "stamp" it onto the board.',
  },
  // ── Role ──
  role: {
    kind: 'enum', label: 'Role', group: 'Role', options: CUSTOM_ROLES, default: 'draw',
    help: 'draw shows the image. displace instead uses it as a DISPLACEMENT MAP over the effect\'s OTHER layers — nothing of this layer is visible; the other layers ripple where the map is bright (an animated noise sheet = flowing heat haze). mask instead uses it as an ALPHA MASK over the other layers — they show only where the image is opaque (reveal a burst through a sigil). Both need at least one other layer to act on.',
  },
  displaceX: {
    kind: 'slider', label: 'Displace X', group: 'Role', min: 0, max: 200, step: 1, default: 30, enabledWhen: { param: 'role', is: 'displace' },
    help: 'How far, in px, the other layers are pushed sideways at the map\'s brightest. 0 = no horizontal push.',
  },
  displaceY: {
    kind: 'slider', label: 'Displace Y', group: 'Role', min: 0, max: 200, step: 1, default: 30, enabledWhen: { param: 'role', is: 'displace' },
    help: 'How far, in px, the other layers are pushed up/down at the map\'s brightest. 0 = no vertical push.',
  },
  maskInvert: {
    kind: 'toggle', label: 'Invert mask', group: 'Role', default: false, enabledWhen: { param: 'role', is: 'mask' },
    help: 'Off: the other layers show only INSIDE the image\'s opaque parts. On: they show only OUTSIDE it (the image punches a hole).',
  },
  ...BLUR_PARAM_SPECS,
  ...filterLabSpecs(FILTERS),
  ...TRANSFORM_PARAM_SPECS,
} satisfies FxParamSpecs;

type CustomParams = ParamsOf<typeof SPECS>;
type CustomNode = Sprite | NineSliceSprite | MeshPlane | MeshRope | PerspectiveMesh;

/** One drawn copy: `wrap` carries placement, alpha and the optional hue filter; `node` carries the texture,
 *  tint and blend. */
interface Copy {
  wrap: Container;
  node: CustomNode;
  roll: ScatterRoll;
  vroll: VariationRoll;
  /** Last applied frame index within the copy's strip, so a texture swap only happens on change. */
  frame: number;
  hueFilter: ColorMatrixFilter | null;
  /** `plane`: the un-wobbled vertex positions to displace from each frame. */
  basePositions?: Float32Array;
  /** `rope`: the point objects the rope follows — mutated in place (MeshRope auto-updates its geometry). */
  points?: { x: number; y: number }[];
  /** `perspective`: the corners last pushed, so `setCorners` (a geometry rebuild) runs only on change. */
  lastCorners?: string;
}

/** Frame textures per (image, grid). Sub-textures share the sheet's source and are never destroyed — the
 *  base texture is shared library state, and a handful of Texture wrappers per authored sheet is nothing. */
const FRAME_CACHE = new Map<string, Texture[]>();

function framesFor(image: string, tex: Texture, cols: number, rows: number, count: number): Texture[] {
  const c = Math.max(1, Math.floor(cols));
  const r = Math.max(1, Math.floor(rows));
  if (c === 1 && r === 1) return [tex];
  const key = `${image}|${tex.uid}|${c}x${r}|${count}`;
  const cached = FRAME_CACHE.get(key);
  if (cached) return cached;
  const frames = sheetFrameRects(tex.width, tex.height, c, r, count).map(
    (f) => new Texture({ source: tex.source, frame: new Rectangle(f.x, f.y, f.w, f.h) }),
  );
  FRAME_CACHE.set(key, frames);
  return frames;
}

/** The params whose change means "tear down and rebuild the copies" (vs a per-frame retune). Roll knobs
 *  are here because a roll happens at build; changing one re-rolls the SAME seed into the new shape. */
function structureKey(p: CustomParams): string {
  return [
    p.image, p.count, p.renderMode, p.sheetCols, p.sheetRows, p.sheetFrames, p.sheetVariantRows, p.meshSegments,
    p.ropeSegments, p.tiltSegments, p.sliceCap, p.role, p.scatterRadius, p.scatterShape, p.jitterRotation,
    p.jitterScale, p.jitterAlpha, p.staggerMs, p.randomStart, p.randomFlipX, p.randomFlipY, p.fpsJitter,
    p.hueJitter, p.randomReverse,
  ].join('|');
}

class CustomInstance implements FxInstance<CustomParams> {
  private params: CustomParams;
  private readonly container: Container;
  private readonly effectRoot: Container | null;
  private readonly filters: FilterStack;
  private readonly transform: ContainerTransform;
  private readonly oneShot: boolean;
  private readonly seed: number;

  private copies: Copy[] = [];
  private builtKey = '';
  private builtTex: Texture | null = null;
  /** Every frame of the sheet, reading order. */
  private frames: Texture[] = [];
  /** The strips copies play: one per variant row, or a single strip of every frame. */
  private strips: Texture[][] = [[]];

  // cross-layer roles — everything here hangs off `effectRoot` and is removed in destroy()
  private roleSprite: Sprite | null = null;
  private displaceFilter: DisplacementFilter | null = null;
  private maskApplied = false;
  private maskInverse = false;

  private headX = 0;
  private headY = 0;
  private aimAngle: number | null = null;
  private aimDist = 0;
  /** The layer's own path (every head the player handed us) — for `aimMode: 'travel'` and `bendMode: 'trail'`. */
  private readonly trail = new HeadTrail();
  /** The smoothed travel heading; `null` until the head has moved, then held through stillness. */
  private travelAngle: number | null = null;
  private clockMs = 0;

  constructor(ctx: FxContext, params: CustomParams) {
    this.params = params;
    this.container = ctx.container;
    this.effectRoot = ctx.effectRoot ?? null;
    this.oneShot = ctx.oneShot === true;
    this.seed = ctx.seed ?? randomSeed();
    this.filters = new FilterStack(ctx.container, FILTERS);
    this.transform = new ContainerTransform(ctx.container);
  }

  // ── build / teardown ──────────────────────────────────────────────────────────────────────────────

  private teardownCopies(): void {
    for (const c of this.copies) {
      c.hueFilter?.destroy();
      c.wrap.destroy({ children: true }); // meshes drop their own geometry; textures are shared
    }
    this.copies = [];
  }

  private teardownRole(): void {
    const root = this.effectRoot;
    if (this.displaceFilter !== null) {
      if (root !== null) {
        const current = (root.filters ?? []) as Filter[];
        root.filters = current.filter((f) => f !== this.displaceFilter);
      }
      this.displaceFilter.destroy();
      this.displaceFilter = null;
    }
    if (this.maskApplied && root !== null) {
      root.mask = null;
      this.maskApplied = false;
    }
    if (this.roleSprite !== null) {
      this.roleSprite.destroy();
      this.roleSprite = null;
    }
  }

  /** (Re)build the copies or the role sprite when the structure changed or the texture just landed. */
  private ensureBuilt(): void {
    const p = this.params;
    const key = structureKey(p);
    const tex = p.image === IMAGE_NONE ? null : getImageTexture(p.image);
    if (this.builtKey === key && this.builtTex === tex) return;
    this.teardownCopies();
    this.teardownRole();
    this.builtKey = key;
    this.builtTex = tex;
    if (tex === null) return; // nothing picked, or not decoded yet — retried every frame (two map lookups)

    // Variant rows need every cell cut (Frame count then limits PER ROW); otherwise Frame count limits the
    // whole grid and the one strip is all of it.
    const cols = Math.max(1, Math.floor(p.sheetCols));
    const rows = Math.max(1, Math.floor(p.sheetRows));
    const variants = p.sheetVariantRows && rows > 1;
    this.frames = framesFor(p.image, tex, cols, rows, variants ? 0 : p.sheetFrames);
    if (variants) {
      const perRow = p.sheetFrames > 0 ? Math.min(cols, Math.floor(p.sheetFrames)) : cols;
      this.strips = [];
      for (let r = 0; r < rows; r++) this.strips.push(this.frames.slice(r * cols, r * cols + perRow));
    } else {
      this.strips = [this.frames];
    }

    if (p.role !== 'draw') {
      this.buildRole();
      return;
    }
    const rng = makeRng(this.seed);
    const rolls = rollScatter(
      rng, p.count, p.scatterRadius, p.scatterShape as ScatterShape,
      p.jitterRotation, p.jitterScale, p.jitterAlpha, p.staggerMs,
    );
    const vrolls = rollVariation(rng, p.count, {
      variantRows: variants ? rows : 1, frames: this.strips[0].length, randomStart: p.randomStart,
      randomFlipX: p.randomFlipX, randomFlipY: p.randomFlipY, fpsJitter: p.fpsJitter, hueJitter: p.hueJitter,
      randomReverse: p.randomReverse,
    });
    rolls.forEach((roll, i) => {
      const copy = this.makeCopy(roll, vrolls[i]);
      this.container.addChild(copy.wrap);
      this.copies.push(copy);
    });
  }

  private makeCopy(roll: ScatterRoll, vroll: VariationRoll): Copy {
    const p = this.params;
    const frame0 = this.strips[vroll.row]?.[0] ?? this.frames[0];
    const fw = frame0.width;
    const fh = frame0.height;
    const wrap = new Container();
    const copy: Copy = { wrap, node: null as unknown as CustomNode, roll, vroll, frame: -1, hueFilter: null };
    switch (p.renderMode) {
      case 'slice': {
        const cap = Math.max(0, Math.min(Math.floor(p.sliceCap), Math.floor(fw / 2) - 1));
        copy.node = new NineSliceSprite({ texture: frame0, leftWidth: cap, rightWidth: cap, topHeight: 0, bottomHeight: 0, width: fw, height: fh });
        break;
      }
      case 'plane': {
        const segs = Math.max(2, Math.floor(p.meshSegments));
        const mesh = new MeshPlane({ texture: frame0, verticesX: segs, verticesY: segs });
        mesh.autoResize = false; // frames share one size, and we own the vertex positions
        copy.basePositions = Float32Array.from(mesh.geometry.positions);
        copy.node = mesh;
        break;
      }
      case 'rope': {
        const points: { x: number; y: number }[] = [];
        ropePoints(p.ropeSegments, fw, p.bendAmount, p.bendWave, p.bendCycles, 0, points);
        copy.points = points;
        copy.node = new MeshRope({ texture: frame0, points });
        break;
      }
      case 'perspective': {
        const segs = Math.max(2, Math.floor(p.tiltSegments));
        copy.node = new PerspectiveMesh({
          texture: frame0, verticesX: segs, verticesY: segs, x0: 0, y0: 0, x1: fw, y1: 0, x2: fw, y2: fh, x3: 0, y3: fh,
        });
        copy.lastCorners = '';
        break;
      }
      default:
        copy.node = new Sprite(frame0);
    }
    if (p.hueJitter > 0 && vroll.hueDeg !== 0) {
      const f = new ColorMatrixFilter();
      f.hue(vroll.hueDeg, false);
      copy.hueFilter = f;
      wrap.filters = [f];
    }
    wrap.addChild(copy.node);
    return copy;
  }

  private buildRole(): void {
    const root = this.effectRoot;
    if (root === null) return; // spawned outside a player: nothing to act on
    const p = this.params;
    const sprite = new Sprite(this.frames[0]);
    this.roleSprite = sprite;
    if (p.role === 'displace') {
      // The map must be in the tree (the filter reads its world transform) but must not draw.
      sprite.renderable = false;
      root.addChild(sprite);
      const filter = new DisplacementFilter({ sprite, scale: { x: p.displaceX, y: p.displaceY } });
      this.displaceFilter = filter;
      root.filters = [...((root.filters ?? []) as Filter[]), filter];
    } else {
      root.addChild(sprite);
      root.setMask?.({ mask: sprite, inverse: p.maskInvert });
      this.maskApplied = true;
      this.maskInverse = p.maskInvert;
    }
  }

  // ── per frame ─────────────────────────────────────────────────────────────────────────────────────

  update(dtMs: number): void {
    this.clockMs += dtMs;
    const p = this.params;
    const dur = Math.max(1, p.durationMs);
    const maxDelay = p.role === 'draw' ? (Math.max(1, p.count) - 1) * Math.max(0, p.staggerMs) : 0;
    const period = dur + maxDelay;
    const layerClock = this.oneShot ? this.clockMs : this.clockMs % period;
    const layerProg = Math.min(1, layerClock / period);
    const dtSec = dtMs / 1000;
    const clockSec = this.clockMs / 1000;

    this.ensureBuilt();

    // The aim angle in force this frame: the moment's source→target, or the layer's own direction of travel
    // (smoothed along the shortest arc, held through stillness), or none.
    let aimNow: number | null = null;
    if (p.aimMode === 'sourceToTarget') {
      aimNow = this.aimAngle;
    } else if (p.aimMode === 'travel') {
      const heading = this.trail.headingRad();
      if (heading !== null) {
        this.travelAngle = this.travelAngle === null ? heading : smoothAngle(this.travelAngle, heading, 1 - Math.max(0, Math.min(0.95, p.aimSmoothing)));
      }
      aimNow = this.travelAngle;
    }
    const aimed = aimNow !== null;
    const aim = aimed ? (aimNow as number) : 0;
    const baseRot = p.rotation * DEG_TO_RAD + aim;
    // Keep upright: a side-view image rotated to point left is upside-down — mirror it across its own axis.
    const uprightFlip = aimed && p.aimUpright && aimsLeft(aim);
    // Stretch needs a TARGET to span to, so it is a source→target feature only.
    const stretch = p.aimMode === 'sourceToTarget' && aimed && p.aimStretch && this.aimDist > 0;
    // A trail-bent rope takes its shape (and direction) from the path itself.
    const trailMode = p.renderMode === 'rope' && p.bendMode === 'trail';

    if (p.role !== 'draw') {
      this.updateRole(layerClock, layerProg, baseRot);
    } else {
      for (const copy of this.copies) {
        const local = layerClock - copy.roll.delayMs;
        if (local < 0) { copy.wrap.visible = false; continue; }
        copy.wrap.visible = true;
        const cprog = Math.min(1, local / dur);
        const node = copy.node;
        const v = copy.vroll;

        // frame — this copy's strip, its own fps, start offset and direction
        const strip = this.strips[v.row] ?? this.frames;
        const n = strip.length;
        let fi = sheetFrameIndex(p.sheetMode as SheetMode, n, p.sheetFps * v.fpsMul, local, cprog, p.sheetStart + v.startOffset);
        if (v.reverse) fi = reverseFrame(fi, n);
        if (fi !== copy.frame) { node.texture = strip[fi]; copy.frame = fi; }
        const tex = strip[copy.frame] ?? strip[0];
        const fw = tex.width;
        const fh = tex.height;

        // scale — uniform from Size, or (stretched) length from the aim distance with Size as thickness
        const kUniform = (p.size / Math.max(1, fw, fh)) * copy.roll.scale;
        const ky = stretch ? (p.size / Math.max(1, fh)) * copy.roll.scale : kUniform;
        const sx = (p.flipX !== v.flipX ? -1 : 1);
        const sy = ((p.flipY !== v.flipY) !== uprightFlip ? -1 : 1);
        if (trailMode) {
          // thickness from Size; the rope's length and shape come from the path (below)
          const kt = (p.size / Math.max(1, fh)) * copy.roll.scale;
          copy.wrap.scale.set(kt * sx, kt * sy);
        } else if (stretch && p.renderMode === 'slice') {
          // the 3-slice keeps its caps and stretches only the body: width in local px at the thickness scale
          (node as NineSliceSprite).width = this.aimDist / ky;
          (node as NineSliceSprite).height = fh;
          copy.wrap.scale.set(ky * sx, ky * sy);
        } else if (stretch && p.renderMode === 'rope') {
          copy.wrap.scale.set(ky * sx, ky * sy);
        } else if (stretch) {
          copy.wrap.scale.set((this.aimDist / Math.max(1, fw)) * copy.roll.scale * sx, ky * sy);
        } else {
          if (p.renderMode === 'slice') { (node as NineSliceSprite).width = fw; (node as NineSliceSprite).height = fh; }
          copy.wrap.scale.set(kUniform * sx, kUniform * sy);
        }

        // Children draw at ABSOLUTE screen coords (the envelope pivots the layer container about the head).
        copy.wrap.position.set(this.headX + p.offsetX + copy.roll.dx, this.headY + p.offsetY + copy.roll.dy);
        // A trail rope is already in world orientation (its points ARE the path), so only the scatter jitter
        // rotates it; everything else takes the static rotation + aim.
        copy.wrap.rotation = (trailMode ? 0 : baseRot) + copy.roll.rot;
        copy.wrap.alpha = Math.max(0, Math.min(1, p.alpha * sampleCurve(p.alphaCurve, cprog) * copy.roll.alpha));
        // The node sits inside the wrap offset by the pivot; a rope's geometry is centred on its path, so it
        // gets the half-frame origin shift that puts its box at 0..w / 0..fh like the others. The pivot's x
        // is measured over the node's CURRENT width (a stretched slice or rope is wider than a frame). A trail
        // rope's head sits AT the wrap origin (the sampled points are head-relative), so it gets no offset.
        const localW = p.renderMode === 'slice' ? (node as NineSliceSprite).width
          : p.renderMode === 'rope' && stretch ? this.aimDist / ky : fw;
        const ox = p.renderMode === 'rope' ? localW / 2 : 0;
        const oy = p.renderMode === 'rope' ? fh / 2 : 0;
        if (trailMode) node.position.set(0, 0);
        else node.position.set(ox - p.pivotX * localW, oy - p.pivotY * fh);
        node.tint = p.tint ? p.tintColor : 0xffffff;
        node.blendMode = p.blendMode as FxBlendMode;

        if (p.renderMode === 'plane' && copy.basePositions) {
          const mesh = node as MeshPlane;
          wobblePositions(
            copy.basePositions, mesh.geometry.positions, fw, fh, p.waveAmp, p.waveFreq,
            clockSec * p.waveSpeed * TAU, p.waveAxis as WobbleAxis,
          );
          mesh.geometry.getBuffer('aPosition').update();
        } else if (p.renderMode === 'rope' && copy.points) {
          if (trailMode) {
            // The last `trailLength` px of the layer's own path, tail → head, head at (0,0) — in world px,
            // brought into the wrap's local (thickness-scaled) units.
            const kt = Math.abs(copy.wrap.scale.x) || 1;
            this.trail.sample(p.ropeSegments, p.trailLength, copy.points);
            for (const pt of copy.points) { pt.x /= kt; pt.y /= kt; }
          } else {
            ropePoints(p.ropeSegments, localW, p.bendAmount, p.bendWave, p.bendCycles, clockSec * p.bendSpeed * TAU, copy.points);
          }
        } else if (p.renderMode === 'perspective') {
          const corners = tiltCorners(fw, fh, p.tiltX, p.tiltY, p.tiltDepth);
          const sig = corners.join(',');
          if (sig !== copy.lastCorners) {
            const [x0, y0, x1, y1, x2, y2, x3, y3] = corners as [number, number, number, number, number, number, number, number];
            (node as PerspectiveMesh).setCorners(x0, y0, x1, y1, x2, y2, x3, y3);
            copy.lastCorners = sig;
          }
        }
      }
    }

    this.filters.frame(p, layerProg, dtSec);
    this.transform.frame(p, layerProg, dtSec, this.headX, this.headY);
  }

  /** Keep the map / mask sprite placed like copy 0 would be (Size, pivot, offset, rotation, sheet frame). */
  private updateRole(layerClock: number, layerProg: number, baseRot: number): void {
    const s = this.roleSprite;
    if (s === null) return;
    const p = this.params;
    const strip = this.strips[0] ?? this.frames;
    const fi = sheetFrameIndex(p.sheetMode as SheetMode, strip.length, p.sheetFps, layerClock, layerProg, p.sheetStart);
    if (s.texture !== strip[fi]) s.texture = strip[fi];
    const fw = s.texture.width;
    const fh = s.texture.height;
    const k = p.size / Math.max(1, fw, fh);
    s.anchor.set(p.pivotX, p.pivotY);
    s.scale.set(k * (p.flipX ? -1 : 1), k * (p.flipY ? -1 : 1));
    s.position.set(this.headX + p.offsetX, this.headY + p.offsetY);
    s.rotation = baseRot;
    if (this.displaceFilter !== null) {
      this.displaceFilter.scale.x = p.displaceX;
      this.displaceFilter.scale.y = p.displaceY;
      this.displaceFilter.padding = Math.max(p.displaceX, p.displaceY);
    } else if (this.maskApplied && this.effectRoot !== null && this.maskInverse !== p.maskInvert) {
      this.effectRoot.setMask?.({ mask: s, inverse: p.maskInvert });
      this.maskInverse = p.maskInvert;
    }
  }

  // ── contract ──────────────────────────────────────────────────────────────────────────────────────

  setParams(next: CustomParams): void {
    this.params = next;
  }

  setHead(x: number, y: number): void {
    this.headX = x;
    this.headY = y;
    this.trail.push(x, y);
  }

  setAim(sx: number, sy: number, tx: number, ty: number): void {
    const dx = tx - sx;
    const dy = ty - sy;
    const d2 = dx * dx + dy * dy;
    this.aimAngle = d2 > AIM_EPSILON_SQ ? Math.atan2(dy, dx) : null;
    this.aimDist = Math.sqrt(d2);
  }

  isComplete(): boolean {
    if (!this.oneShot) return false;
    const p = this.params;
    const maxDelay = p.role === 'draw' ? (Math.max(1, p.count) - 1) * Math.max(0, p.staggerMs) : 0;
    return this.clockMs >= Math.max(1, p.durationMs) + maxDelay;
  }

  destroy(): void {
    this.teardownCopies();
    this.teardownRole();
    this.filters.destroy();
  }
}

export const customPrimitive: FxPrimitive<typeof SPECS> = {
  id: 'custom',
  params: SPECS,
  spawn: (ctx, params) => new CustomInstance(ctx, params),
};

registerPrimitive(customPrimitive as FxPrimitive);
