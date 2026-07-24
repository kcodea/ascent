import { Mesh, MeshGeometry, Shader } from 'pixi.js';
import type { FxParamSpecs, ParamsOf } from '../params';
import type { FxContext, FxInstance, FxPrimitive } from '../primitive';
import { PALETTE_PRESETS, paletteTuple, tupleFloats } from '../palettes';
import { registerPrimitive } from '../registry';
import {
  RIBBON_SEGMENTS,
  buildRibbonIndices,
  buildRibbonUVs,
  writeRibbonPositions,
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
  if (d <= 0.0) discard;

  float q = clamp(d / max(uGain, 0.001), 0.0, 1.0);
  float b = floor(q * uBands) / max(uBands - 1.0, 1.0);
  vec4 c = pal(b);

  float aa = smoothstep(0.0, fwidth(d) * uSoft, d);
  finalColor = vec4(c.rgb, 1.0) * (c.a * aa * uAlpha);
}
`;

/**
 * The param specs, declared once so the params type and the generated inspector are both derived from
 * this record (see `params.ts`). Grouped for the inspector: Style / Noise / Shape. Defaults were
 * established by measuring the prototype — see the per-param `help` text for the load-bearing ones.
 */
const SPECS = {
  bands: {
    kind: 'slider', label: 'Bands', group: 'Style', min: 1, max: 8, step: 1, default: 4,
    help: 'The style knob — 3-4 is the reference look, 8 washes out to generic fire.',
  },
  plateau: {
    kind: 'slider', label: 'Plateau', group: 'Style', min: 0, max: 0.9, step: 0.01, default: 0.3,
    help: 'Width of the flat hot core; at 0 the top colour band never fires.',
  },
  palette: {
    kind: 'palette', label: 'Palette', group: 'Style',
    default: paletteTuple('violet'), presets: PALETTE_PRESETS,
  },
  additive: { kind: 'toggle', label: 'Additive', group: 'Style', default: false },

  noiseAlong: {
    kind: 'slider', label: 'Noise (along)', group: 'Noise', min: 0.5, max: 12, step: 0.1, default: 3,
    help: 'Noise frequency along the trail (head → tail).',
  },
  noiseAcross: {
    kind: 'slider', label: 'Noise (across)', group: 'Noise', min: 1, max: 20, step: 0.1, default: 7,
    help: 'Noise frequency across the trail width.',
  },
  warp: { kind: 'slider', label: 'Warp', group: 'Noise', min: 0, max: 1.5, step: 0.01, default: 0.35 },
  scroll: { kind: 'slider', label: 'Scroll', group: 'Noise', min: 0, max: 6, step: 0.05, default: 1.4 },
  erode: {
    kind: 'slider', label: 'Erode', group: 'Noise', min: 0, max: 1.2, step: 0.01, default: 0.5,
    help: 'How much the noise eats into the shape — higher gives a more tattered edge.',
  },

  gain: { kind: 'slider', label: 'Gain', group: 'Shape', min: 0.3, max: 2, step: 0.01, default: 1.5 },
  head: {
    kind: 'slider', label: 'Head', group: 'Shape', min: 0.01, max: 0.5, step: 0.005, default: 0.06,
    help: 'How quickly the trail ramps up to full brightness at the head.',
  },
  tail: {
    kind: 'slider', label: 'Tail', group: 'Shape', min: 0.3, max: 4, step: 0.05, default: 1.6,
    help: 'Exponent of the tail fade — higher tapers off sooner.',
  },
  soft: { kind: 'slider', label: 'Soft', group: 'Shape', min: 0.5, max: 6, step: 0.1, default: 1.5 },
  length: {
    kind: 'slider', label: 'Length', group: 'Shape', min: 60, max: 700, step: 5, default: 300,
    help: 'Max spine arc length in px — how far back the trail reaches.',
  },
  width: { kind: 'slider', label: 'Width', group: 'Shape', min: 8, max: 160, step: 1, default: 54 },
  alpha: { kind: 'slider', label: 'Alpha', group: 'Shape', min: 0, max: 1, step: 0.01, default: 1 },
  headPinch: {
    kind: 'slider', label: 'Head pinch', group: 'Shape', min: 0.02, max: 0.5, step: 0.01, default: 0.12,
    help: 'Fraction of the length over which the ribbon geometry widens from a point at the head.',
  },
  tailFeather: {
    kind: 'slider', label: 'Tail feather', group: 'Shape', min: 0.1, max: 2, step: 0.05, default: 0.35,
    help: 'Exponent of the ribbon geometry\'s tail taper — higher feathers the mesh away sooner.',
  },
} satisfies FxParamSpecs;

type RibbonParams = ParamsOf<typeof SPECS>;

/** Hard cap on spine history regardless of arc length, so a head that stalls (near-zero motion between
 *  frames) can't grow the array unbounded. */
const MAX_SPINE_POINTS = 200;

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
  // Cached scratch object for writeRibbonPositions' `shape` arg — kept off the per-frame hot path
  // (update()) per the no-per-frame-allocation discipline established right next to it in
  // ribbonGeometry.ts. Mutated in place by setParams(); never reallocated.
  private readonly shape: { headPinch: number; tailFeather: number };

  constructor(ctx: FxContext, params: RibbonParams) {
    this.params = params;
    this.shape = { headPinch: params.headPinch, tailFeather: params.tailFeather };
    this.positions = new Float32Array((RIBBON_SEGMENTS + 1) * 4);
    this.geometry = new MeshGeometry({
      positions: this.positions,
      uvs: buildRibbonUVs(),
      indices: buildRibbonIndices(),
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
          // Math.random is fine here: the UI layer is explicitly exempt from the core/content/sim
          // determinism ban (see eslint.config.mjs) — this is a cosmetic per-instance phase offset only,
          // same role as pixiFx.ts's shield-bubble `uSeed`.
          uSeed: { value: Math.random() * 1000, type: 'f32' },
          uPal: { value: tupleFloats(params.palette), type: 'vec4<f32>', size: 4 },
        },
      },
    });
    this.mesh = new Mesh({ geometry: this.geometry, shader: this.shader });
    this.mesh.blendMode = params.additive ? 'add' : 'normal';
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
  }

  update(dtMs: number): void {
    this.clockSec += dtMs / 1000;
    this.uniforms.uTime = this.clockSec;
    const ok = writeRibbonPositions(this.positions, this.spine, this.params.width, this.shape);
    this.mesh.visible = ok;
    if (ok) this.geometry.getBuffer('aPosition').update();
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
    // setParams is not on the per-frame hot path (only fires on an inspector edit), so rebuilding uPal
    // unconditionally is cheap and sidesteps any reference-equality bugs from how the caller assembles
    // `next` — no risk of the palette silently going stale because the array happened to be re-used.
    u.uPal = tupleFloats(next.palette);
    this.mesh.blendMode = next.additive ? 'add' : 'normal';
    this.shape.headPinch = next.headPinch;
    this.shape.tailFeather = next.tailFeather;
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
