import { Mesh, MeshGeometry, Shader } from 'pixi.js';
import type { FxParamSpecs, ParamsOf } from '../params';
import type { FxContext, FxInstance, FxPrimitive } from '../primitive';
import { PALETTE_PRESETS, paletteTuple, tupleFloats } from '../palettes';
import { FX_BLEND_MODES } from '../blendModes';
import { registerPrimitive } from '../registry';
import { makeRng } from '../rng';
import { CURVE_PRESETS } from '../curve';
import {
  RIBBON_MAX_SEGMENTS,
  RIBBON_MIN_SEGMENTS,
  RIBBON_SEGMENTS,
  buildRibbonIndices,
  clampRibbonSegments,
  ribbonVertexFloats,
  writeRibbonIndices,
  writeRibbonPositions,
  writeRibbonUVs,
  type RibbonPoint,
} from '../ribbonGeometry';

/**
 * The first real FX primitive: a posterized energy trail that follows a moving point (a comet trail
 * whipping behind an attacking unit). The art style is hard-edged cel banding, not soft additive
 * particles — see the fragment shader below for the two load-bearing details (band quantisation +
 * plateau falloff) that were established by measuring a prototype. Do not "simplify" either.
 */

/**
 * Vertex shader for the ribbon Mesh (WebGL2 / GLSL ES 3.0), matching the house convention in
 * `pixiFx.ts`'s `SHIELD_VERT`: Pixi's GlMeshAdaptor binds the global-uniform group
 * (uProjectionMatrix, uWorldTransformMatrix) + the mesh's local-uniform group (uTransformMatrix), so we
 * just declare them and transform the geometry; `aUV` (a clean per-vertex UV from `ribbonGeometry.ts`)
 * feeds the fragment.
 */
const RIBBON_VERT = /* glsl */ `#version 300 es
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
}
`;

/**
 * The posterized cel-band trail fragment shader — the validated prototype, unchanged. Two details are
 * load-bearing:
 *  - Band quantisation (`floor(q * uBands) / max(uBands - 1.0, 1.0)`) is what produces the style; at
 *    `uBands` ~8 it washes out into generic fire (3-4 is the reference look).
 *  - The plateau width profile (`1.0 - smoothstep(uPlateau, 1.0, across)`) is what gives the fat
 *    white-hot core the reference art has — a linear falloff left only a ~3px centre line ever crossing
 *    the top band's threshold, so the hot core never rendered at all.
 * Output is premultiplied (`vec4(c.rgb, 1.0) * alpha`), matching how this codebase's other procedural
 * shaders emit colour (see `SHIELD_FRAG` in `pixiFx.ts`).
 */
const RIBBON_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 finalColor;

uniform float uTime;
uniform float uBands;
uniform vec2  uNoise;
uniform float uWarp;
uniform float uScroll;
uniform float uErode;
uniform float uGain;
uniform float uHead;
uniform float uTail;
uniform float uPlateau;
uniform float uSoft;
uniform float uAlpha;
uniform float uSeed;
uniform float uGlow;
uniform vec4  uPal[4];

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1, 0));
  float c = hash(i + vec2(0, 1)), d = hash(i + vec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return v;
}
vec4 pal(float t) {
  float s = clamp(t, 0.0, 1.0) * 3.0;
  int i = int(floor(s));
  if (i >= 3) return uPal[3];
  return mix(uPal[i], uPal[i + 1], fract(s));
}

void main() {
  float across = abs(vUV.y * 2.0 - 1.0);
  float head  = smoothstep(0.0, max(uHead, 0.001), vUV.x);
  float tail  = pow(clamp(1.0 - vUV.x, 0.0, 1.0), uTail);
  float wfall = 1.0 - smoothstep(uPlateau, 1.0, across);
  float shape = head * tail * wfall * uGain;

  vec2 p = vec2(vUV.x * uNoise.x - uTime * uScroll, vUV.y * uNoise.y + uSeed);
  p += (vec2(fbm(p * 1.7), fbm(p * 1.7 + 19.3)) - 0.5) * uWarp;
  float n = fbm(p);

  float d = shape - n * uErode;

  // Soft halo: a smoothstep-widened, low-exponent version of the PRE-erosion shape (not the
  // noise-eroded d the crisp body below is clipped to), so the glow bleeds past the cel body's ragged
  // noise-eaten edge as a soft bloom instead of being cut by the same hard silhouette/discard. Left
  // un-posterized (no band quantisation) so it stays smooth under the crisp cel core, and tinted by the
  // palette's brightest ("core") stop, uPal[3]. When uGlow is 0 this term is always 0, so the glow branch
  // contributes nothing and the discard/body math below is byte-for-byte the original look.
  float haloShape = clamp(shape / max(uGain, 0.001), 0.0, 1.0);
  float halo = pow(smoothstep(0.0, 1.0, haloShape), 0.5) * uGlow;

  if (d <= 0.0 && halo <= 0.001) discard;

  vec3 rgb = vec3(0.0);
  float a = 0.0;
  if (d > 0.0) {
    float q = clamp(d / max(uGain, 0.001), 0.0, 1.0);
    float b = floor(q * uBands) / max(uBands - 1.0, 1.0);
    vec4 c = pal(b);
    float aa = smoothstep(0.0, fwidth(d) * uSoft, d);
    float bodyA = c.a * aa * uAlpha;
    rgb += c.rgb * bodyA;
    a += bodyA;
  }

  vec4 glowCol = uPal[3];
  float glowA = glowCol.a * halo * uAlpha;
  rgb += glowCol.rgb * glowA;
  a += glowA;

  finalColor = vec4(rgb, a);
}
`;

/**
 * The param specs, declared once so the params type and the generated inspector are both derived from
 * this record (see `params.ts`). Grouped for the inspector: Style / Noise / Shape. Defaults were
 * established by measuring the prototype — see the per-param `help` text for the load-bearing ones.
 */
const SPECS = {
  bands: {
    kind: 'slider', label: 'Bands', group: 'Style', min: 1, max: 8, step: 1, default: 4, essential: true,
    help: 'The style knob — 3-4 is the reference look, 8 washes out to generic fire.',
  },
  plateau: {
    kind: 'slider', label: 'Plateau', group: 'Style', min: 0, max: 0.9, step: 0.01, default: 0.3,
    help: 'How wide the flat white-hot core running down the middle of the trail is — 0.3 is the reference look; at 0 the brightest colour shrinks to a hairline you will never see.',
  },
  palette: {
    kind: 'palette', label: 'Palette', group: 'Style', essential: true,
    default: paletteTuple('violet'), presets: PALETTE_PRESETS,
    help: 'The four colours the trail steps through, faint outer edge first and white-hot core last. A preset swaps all four at once; the last (core) colour is also what tints the Glow halo.',
  },
  blendMode: {
    kind: 'enum', label: 'Blend mode', group: 'Style', options: FX_BLEND_MODES, default: 'add',
    help: 'How the trail composites over what is behind it: add (the default) makes it glow and brighten whatever it crosses, normal paints it as solid opaque colour, screen is a gentler lift, and multiply/overlay stain what is behind rather than lighting it.',
  },
  glow: {
    kind: 'slider', label: 'Glow', group: 'Style', min: 0, max: 1, step: 0.01, default: 0.3,
    help: 'soft outer halo',
  },

  noiseAlong: {
    kind: 'slider', label: 'Noise (along)', group: 'Noise', min: 0.5, max: 12, step: 0.1, default: 3,
    // The whole Noise group is inert at Erode 0: RIBBON_FRAG consumes it only as `d = shape - n * uErode`,
    // and `uGain` then cancels out of BOTH `q = d / uGain` and the halo's `shape / uGain`.
    enabledWhen: { param: 'erode', above: 0 },
    help: 'How fine the mottling is along the trail (head → tail) — low gives a few long blotches, high a dense speckle. Does nothing while Erode is 0.',
  },
  noiseAcross: {
    kind: 'slider', label: 'Noise (across)', group: 'Noise', min: 1, max: 20, step: 0.1, default: 7,
    enabledWhen: { param: 'erode', above: 0 },
    help: 'How fine the mottling is across the trail\'s width — high values break it into thin lengthwise streaks. Does nothing while Erode is 0.',
  },
  warp: {
    kind: 'slider', label: 'Warp', group: 'Noise', min: 0, max: 1.5, step: 0.01, default: 0.35,
    enabledWhen: { param: 'erode', above: 0 },
    help: 'Curls the mottling into flowing, flame-like streaks instead of round blobs — 0 leaves it plain and lumpy, 0.35 is the reference look. Does nothing while Erode is 0.',
  },
  scroll: {
    kind: 'slider', label: 'Scroll', group: 'Noise', min: 0, max: 6, step: 0.05, default: 1.4,
    enabledWhen: { param: 'erode', above: 0 },
    help: 'How fast the mottling flows along the trail — this is what makes the fire churn instead of sitting frozen; 0 holds it still. Does nothing while Erode is 0.',
  },
  erode: {
    kind: 'slider', label: 'Erode', group: 'Noise', min: 0, max: 1.2, step: 0.01, default: 0.5, essential: true,
    help: 'How much the noise eats into the shape — higher gives a more tattered edge.',
  },

  gain: {
    kind: 'slider', label: 'Gain', group: 'Shape', min: 0.3, max: 2, step: 0.01, default: 1.5,
    enabledWhen: { param: 'erode', above: 0 },
    help: 'How well the trail resists Erode — raise it and the noise takes smaller bites so the body fills in solid, lower it and the same Erode chews it down to wisps. Does nothing while Erode is 0.',
  },
  head: {
    kind: 'slider', label: 'Head', group: 'Shape', min: 0.01, max: 0.5, step: 0.005, default: 0.06,
    help: 'How quickly the trail ramps up to full brightness at the head.',
  },
  tail: {
    kind: 'slider', label: 'Tail', group: 'Shape', min: 0.3, max: 4, step: 0.05, default: 1.6,
    help: 'Exponent of the tail fade — higher tapers off sooner.',
  },
  soft: {
    kind: 'slider', label: 'Soft', group: 'Shape', min: 0.5, max: 6, step: 0.1, default: 1.5,
    help: 'How crisp the trail\'s outline is — 0.5 is a hard cel cut-out, 6 feathers the edge out over several pixels. The Glow halo has its own soft edge and is unaffected.',
  },
  length: {
    kind: 'slider', label: 'Length', group: 'Shape', min: 60, max: 700, step: 5, default: 300, essential: true,
    help: 'Max spine arc length in px — how far back the trail reaches.',
  },
  width: {
    kind: 'slider', label: 'Width', group: 'Shape', min: 8, max: 160, step: 1, default: 54, essential: true,
    help: 'How thick the trail is in px at its fattest. Head pinch, Tail feather and the Width / length curve all scale it along the length, so this sets the ceiling rather than a constant width.',
  },
  alpha: {
    kind: 'slider', label: 'Alpha', group: 'Shape', min: 0, max: 1, step: 0.01, default: 1,
    help: 'Overall opacity of the whole trail, glow included — 1 is full strength, lower dials the entire effect back without changing its shape.',
  },
  headPinch: {
    kind: 'slider', label: 'Head pinch', group: 'Shape', min: 0.02, max: 0.5, step: 0.01, default: 0.12,
    help: 'Fraction of the length over which the ribbon geometry widens from a point at the head.',
  },
  tailFeather: {
    kind: 'slider', label: 'Tail feather', group: 'Shape', min: 0.1, max: 2, step: 0.05, default: 0.35,
    help: 'Exponent of the ribbon geometry\'s tail taper — higher feathers the mesh away sooner.',
  },
  widthCurve: {
    kind: 'curve', label: 'Width / length', group: 'Shape',
    // vMax 2 so the curve can BULGE past the base width, not only taper below it — without it the editor
    // clamps every control point at 1x and "fat in the middle" has to be faked by pulling both ends down
    // (which also thins the whole ribbon). The flat [[0,1],[1,1]] default still sits at exactly 1x, so this
    // only widens the range the editor offers; it changes nothing until a point is dragged above the 1x line.
    default: [[0, 1], [1, 1]], vMax: 2, presets: CURVE_PRESETS,
    help: 'Width multiplier along the trail (0 = head, 1 = tail). Flat 1 = a constant-width ribbon; drag above the 1x line to bulge, below to taper — anywhere along the length.',
  },
  waveAmp: {
    kind: 'slider', label: 'Wave amp', group: 'Shape', min: 0, max: 40, step: 0.5, default: 0,
    help: 'Amplitude (px) of a travelling sine that bends the ribbon\'s spine sideways, so the trail snakes. 0 = a straight-following ribbon (the default look).',
  },
  waveFreq: {
    kind: 'slider', label: 'Wave freq', group: 'Shape', min: 0.2, max: 8, step: 0.1, default: 2,
    enabledWhen: { param: 'waveAmp', above: 0 },
    help: 'Wave cycles along the trail\'s length. Only bites once Wave amp is above 0.',
  },
  waveSpeed: {
    kind: 'slider', label: 'Wave speed', group: 'Shape', min: 0, max: 12, step: 0.1, default: 3,
    enabledWhen: { param: 'waveAmp', above: 0 },
    help: 'How fast the wave travels (rad/sec); 0 freezes it in place. Only bites once Wave amp is above 0.',
  },
  segments: {
    kind: 'slider', label: 'Segments', group: 'Shape',
    min: RIBBON_MIN_SEGMENTS, max: RIBBON_MAX_SEGMENTS, step: 4, default: RIBBON_SEGMENTS,
    help: 'Spine resample resolution. Higher = smoother curves and waves; lower = cheaper, and chunky/angular on purpose.',
  },
} satisfies FxParamSpecs;

type RibbonParams = ParamsOf<typeof SPECS>;

/** Hard cap on spine history regardless of arc length, so a head that stalls (near-zero motion between
 *  frames) can't grow the array unbounded. */
const MAX_SPINE_POINTS = 200;

/**
 * How long (ms) after the workbench stops feeding the head a one-shot ribbon waits before reporting
 * completion. The workbench feeds `setHead` every frame for the fire's duration and then stops; the ribbon
 * can't visibly *drain* its spine without changing the look (the spine only ever shrinks on new head input,
 * via `pushSpineHead`'s arc-length trim), and the task requires the trail stay visually identical, so
 * one-shot only changes completion *reporting*. Completion is therefore defined by "the head has stopped
 * being fed for this long" — a robust signal that the fire ended, with the grace giving the frozen trail a
 * beat to read as settled before the player clears the layer.
 */
export const RIBBON_FIRE_GRACE_MS = 250;

/**
 * Pure completion predicate for a one-shot ribbon, split out so the completion timing is unit-testable
 * without a WebGL context (the rest of the instance is rendering). Complete once we're in one-shot mode,
 * the head has been fed at least once (so the effect actually started — guards a large first `update` dt
 * from completing before the first `setHead`), and the head hasn't been fed for `graceMs` (the fire ended).
 */
export function ribbonOneShotComplete(
  oneShot: boolean,
  headEverSet: boolean,
  msSinceHead: number,
  graceMs: number = RIBBON_FIRE_GRACE_MS,
): boolean {
  return oneShot && headEverSet && msSinceHead >= graceMs;
}

/**
 * Push a new head position onto `spine` (head-first, per `ribbonGeometry.ts`'s contract) and trim the
 * tail so the accumulated arc length stays within `maxLength` px. Exported standalone (rather than kept
 * as a private method) so it's unit-testable without a WebGL context: this is the one piece of the
 * primitive's logic that isn't rendering. Mutates and returns `spine`.
 */
export function pushSpineHead(
  spine: RibbonPoint[],
  head: RibbonPoint,
  maxLength: number,
  maxPoints: number = MAX_SPINE_POINTS,
): RibbonPoint[] {
  spine.unshift(head);
  if (spine.length > maxPoints) spine.length = maxPoints;
  let total = 0;
  for (let i = 1; i < spine.length; i++) {
    const a = spine[i - 1];
    const b = spine[i];
    total += Math.hypot(b.x - a.x, b.y - a.y);
    if (total >= maxLength) {
      spine.length = i + 1;
      break;
    }
  }
  return spine;
}

class RibbonInstance implements FxInstance<RibbonParams> {
  private readonly mesh: Mesh<MeshGeometry, Shader>;
  private readonly geometry: MeshGeometry;
  private readonly shader: Shader;
  private readonly positions: Float32Array;
  private readonly spine: RibbonPoint[] = [];
  private params: RibbonParams;
  private clockSec = 0;
  // Fixed at spawn: a given instance is either a one-shot Fire or a continuous-loop preview, never both.
  private readonly oneShot: boolean;
  // One-shot completion bookkeeping (see `ribbonOneShotComplete`). `msSinceHead` counts up in `update` and
  // resets to 0 on each `setHead`; `headEverSet` flips true on the first `setHead`. Both are harmless
  // no-op bookkeeping in continuous mode (isComplete returns false there).
  private msSinceHead = 0;
  private headEverSet = false;
  // Cached scratch object for writeRibbonPositions' `shape` arg — kept off the per-frame hot path
  // (update()) per the no-per-frame-allocation discipline established right next to it in
  // ribbonGeometry.ts. Mutated in place by setParams() (and, for `timeSec` only, by update()); never
  // reallocated. `widthCurve` holds the params array BY REFERENCE — the geometry only reads it.
  private readonly shape: {
    headPinch: number;
    tailFeather: number;
    widthCurve: ReadonlyArray<readonly [number, number]>;
    waveAmp: number;
    waveFreq: number;
    waveSpeed: number;
    timeSec: number;
    segments: number;
  };
  // The UV + index buffers backing the mesh. Both are allocated once at RIBBON_MAX_SEGMENTS capacity and
  // only ever REWRITTEN (never resized) when `segments` changes — see setParams.
  private readonly uvs: Float32Array;
  private readonly indices: Uint32Array;

  constructor(ctx: FxContext, params: RibbonParams) {
    this.params = params;
    this.oneShot = ctx.oneShot ?? false;
    this.shape = {
      headPinch: params.headPinch,
      tailFeather: params.tailFeather,
      widthCurve: params.widthCurve,
      waveAmp: params.waveAmp,
      waveFreq: params.waveFreq,
      waveSpeed: params.waveSpeed,
      timeSec: 0,
      segments: clampRibbonSegments(params.segments),
    };
    // Sized for the MAX segment count, not the current one: `segments` is a live knob, and a GPU buffer
    // that changes size mid-flight is both a reallocation and a Pixi re-upload we don't want. Surplus
    // vertices are collapsed onto the tail by writeRibbonPositions and their triangles are degenerated by
    // writeRibbonIndices, so they cost nothing but a few unused floats.
    this.positions = new Float32Array(ribbonVertexFloats(RIBBON_MAX_SEGMENTS));
    this.uvs = new Float32Array(ribbonVertexFloats(RIBBON_MAX_SEGMENTS));
    this.indices = buildRibbonIndices(RIBBON_MAX_SEGMENTS);
    writeRibbonUVs(this.uvs, this.shape.segments);
    writeRibbonIndices(this.indices, this.shape.segments);
    this.geometry = new MeshGeometry({
      positions: this.positions,
      uvs: this.uvs,
      indices: this.indices,
    });
    this.shader = Shader.from({
      gl: { vertex: RIBBON_VERT, fragment: RIBBON_FRAG },
      resources: {
        ribbonUniforms: {
          uTime: { value: 0, type: 'f32' },
          uBands: { value: params.bands, type: 'f32' },
          uNoise: { value: new Float32Array([params.noiseAlong, params.noiseAcross]), type: 'vec2<f32>' },
          uWarp: { value: params.warp, type: 'f32' },
          uScroll: { value: params.scroll, type: 'f32' },
          uErode: { value: params.erode, type: 'f32' },
          uGain: { value: params.gain, type: 'f32' },
          uHead: { value: params.head, type: 'f32' },
          uTail: { value: params.tail, type: 'f32' },
          uPlateau: { value: params.plateau, type: 'f32' },
          uSoft: { value: params.soft, type: 'f32' },
          uAlpha: { value: params.alpha, type: 'f32' },
          // A cosmetic per-instance phase offset into the noise field (same role as pixiFx.ts's
          // shield-bubble `uSeed`) — but it is what made the ribbon visibly re-roll its noise on EVERY
          // spawn, so a rebuild changed the look mid-tune. With a `ctx.seed` it is now DERIVED from that
          // seed (one draw off a seeded stream — stable for the instance, still well spread across
          // seeds), so the same tuning replays the same ribbon. Without one we keep the historical fresh
          // roll: `Math.random` is fine here, the UI layer being explicitly exempt from the
          // core/content/sim determinism ban (see eslint.config.mjs).
          uSeed: { value: (ctx.seed === undefined ? Math.random() : makeRng(ctx.seed)()) * 1000, type: 'f32' },
          uGlow: { value: params.glow, type: 'f32' },
          uPal: { value: tupleFloats(params.palette), type: 'vec4<f32>', size: 4 },
        },
      },
    });
    this.mesh = new Mesh({ geometry: this.geometry, shader: this.shader });
    this.mesh.blendMode = params.blendMode;
    this.mesh.visible = false;
    ctx.container.addChild(this.mesh);
  }

  private get uniforms(): Record<string, number | Float32Array> {
    return (this.shader.resources.ribbonUniforms as { uniforms: Record<string, number | Float32Array> }).uniforms;
  }

  /** Path-following hook (see `FxInstance.setHead`): the caller hands the head position once per frame,
   *  in whatever coordinate space `ctx.container` (passed to `spawn`) itself lives in — this instance
   *  applies no transform of its own, so it never converts between spaces. */
  setHead(x: number, y: number): void {
    pushSpineHead(this.spine, { x, y }, this.params.length);
    // The head is being fed — reset the "time since last head" counter. In one-shot mode this is what
    // keeps the effect from completing while the workbench is still driving the trail (see isComplete).
    this.msSinceHead = 0;
    this.headEverSet = true;
  }

  update(dtMs: number): void {
    this.clockSec += dtMs / 1000;
    this.msSinceHead += dtMs;
    this.uniforms.uTime = this.clockSec;
    // In-place field write on the cached shape object — this is what makes the wave travel, and it
    // allocates nothing (same discipline as the rest of this object; see the `shape` declaration).
    this.shape.timeSec = this.clockSec;
    const ok = writeRibbonPositions(this.positions, this.spine, this.params.width, this.shape);
    this.mesh.visible = ok;
    if (ok) this.geometry.getBuffer('aPosition').update();
  }

  /** One-shot completion: true once the fire ended (head stopped being fed) and the frozen trail has had
   *  its settle grace. Continuous instances always return false. See `ribbonOneShotComplete` for the full
   *  reasoning on why completion is grace-based rather than a visible spine drain. */
  isComplete(): boolean {
    return ribbonOneShotComplete(this.oneShot, this.headEverSet, this.msSinceHead);
  }

  setParams(next: RibbonParams): void {
    this.params = next;
    const u = this.uniforms;
    u.uBands = next.bands;
    u.uPlateau = next.plateau;
    u.uNoise = new Float32Array([next.noiseAlong, next.noiseAcross]);
    u.uWarp = next.warp;
    u.uScroll = next.scroll;
    u.uErode = next.erode;
    u.uGain = next.gain;
    u.uHead = next.head;
    u.uTail = next.tail;
    u.uSoft = next.soft;
    u.uAlpha = next.alpha;
    u.uGlow = next.glow;
    // setParams is not on the per-frame hot path (only fires on an inspector edit), so rebuilding uPal
    // unconditionally is cheap and sidesteps any reference-equality bugs from how the caller assembles
    // `next` — no risk of the palette silently going stale because the array happened to be re-used.
    u.uPal = tupleFloats(next.palette);
    this.mesh.blendMode = next.blendMode;
    this.shape.headPinch = next.headPinch;
    this.shape.tailFeather = next.tailFeather;
    this.shape.widthCurve = next.widthCurve;
    this.shape.waveAmp = next.waveAmp;
    this.shape.waveFreq = next.waveFreq;
    this.shape.waveSpeed = next.waveSpeed;
    // Resolution change: rewrite (never resize) the UV + index buffers in place and re-upload them. This
    // only fires on an inspector edit, never per frame — the buffers themselves are permanent.
    const segments = clampRibbonSegments(next.segments);
    if (segments !== this.shape.segments) {
      this.shape.segments = segments;
      writeRibbonUVs(this.uvs, segments);
      writeRibbonIndices(this.indices, segments);
      this.geometry.getBuffer('aUV').update();
      this.geometry.indexBuffer.update();
    }
  }

  destroy(): void {
    // `Mesh.destroy()` deliberately does NOT cascade to `geometry`/`shader` (it only conditionally
    // destroys a `texture`) because those are commonly shared across meshes. Ours never are — both are
    // built fresh in the constructor and held exclusively by this instance — so we must free them
    // ourselves or every spawn/destroy cycle (one per attack, several live at once) leaks GPU buffers and
    // a compiled program. Verified safe to call after mesh.destroy(): reading Mesh.destroy()'s source, it
    // only unhooks its own "update" listener and nulls its internal refs — it never touches
    // geometry.destroy()/shader.destroy() itself, so there is no double-free here.
    this.mesh.destroy();
    this.geometry.destroy(true); // true = also free the position/UV/index buffers; we own them exclusively
    this.shader.destroy(true); // true = also free the compiled GL program; not shared
  }
}

export const ribbonPrimitive: FxPrimitive<typeof SPECS> = {
  id: 'ribbon',
  params: SPECS,
  spawn: (ctx, params) => new RibbonInstance(ctx, params),
};

registerPrimitive(ribbonPrimitive as FxPrimitive);
