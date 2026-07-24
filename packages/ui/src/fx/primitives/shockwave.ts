import { Mesh, MeshGeometry, Shader } from 'pixi.js';
import type { FxParamSpecs, ParamsOf } from '../params';
import type { FxContext, FxInstance, FxPrimitive } from '../primitive';
import { PALETTE_PRESETS, paletteTuple, tupleFloats } from '../palettes';
import { FX_BLEND_MODES } from '../blendModes';
import { registerPrimitive } from '../registry';

/**
 * An expanding posterized shockwave ring — several concentric rings expanding outward from an anchor
 * and fading as they grow, cel-banded rim→core like the ribbon. Built as a single quad `Mesh` with a
 * procedural fragment shader (no texture, no per-frame geometry rewrite), following the same GLSL ES
 * 3.0 / `Shader.from` house pattern established by `ribbon.ts`.
 */

/** Same MVP vertex shader as `ribbon.ts`'s `RIBBON_VERT` — Pixi's GlMeshAdaptor binds the global
 *  uniform group (uProjectionMatrix, uWorldTransformMatrix) + the mesh's local group (uTransformMatrix),
 *  so we just declare them and transform the geometry; `aUV` feeds the fragment. */
const SHOCKWAVE_VERT = /* glsl */ `#version 300 es
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
 * The ring field: `uRings` concentric rings, each cycling outward 0→1 on its own evenly-spaced phase
 * offset (`k / uRings`), a thin band around `d == phase` (width `uThickness`, antialiased via `fwidth`
 * on the band distance rather than a hard cutoff), fading out as it expands via `pow(1 - phase, uFade)`.
 * Posterized the same way as the ribbon (`floor(q * uBands) / (uBands - 1)` into `pal()`) for the hard
 * cel-band look rather than a soft gradient — do not soften this into a smooth glow.
 */
const SHOCKWAVE_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 finalColor;

uniform float uTime;
uniform float uRings;
uniform float uSpeed;
uniform float uThickness;
uniform float uFade;
uniform float uBands;
uniform float uAlpha;
uniform float uGlow;
uniform float uOneShot; // 0 = continuous repeating rings, 1 = a single expansion cycle (one-shot Fire)
uniform vec4  uPal[4];

vec4 pal(float t) {
  float s = clamp(t, 0.0, 1.0) * 3.0;
  int i = int(floor(s));
  if (i >= 3) return uPal[3];
  return mix(uPal[i], uPal[i + 1], fract(s));
}

// Constant loop bound (GLSL ES 3.0 fragment loops want a compile-time trip count to unroll cleanly);
// matches the 'rings' param spec's max of 5. The k >= n break makes the effective count the live uRings.
const int MAX_RINGS = 5;

void main() {
  vec2 p = vUV * 2.0 - 1.0;
  float d = length(p);

  int n = int(uRings);
  float e = 0.0;
  // Soft halo accumulator, one per ring like e above — a smoothstep-widened, low-exponent band around the
  // SAME bandDist field, several times wider than the crisp ring's uThickness. Left un-posterized (no
  // band quantisation, unlike e below) so it stays smooth. This does not soften the crisp cel ring
  // itself (see the header comment: the ring stays hard-banded) — it's a separate additive glow drawn
  // around it, tinted by the palette's brightest ("core") stop and scaled by uGlow. When uGlow is 0 this
  // term always contributes 0, so the discard/body math is byte-for-byte the original look.
  float halo = 0.0;
  for (int k = 0; k < MAX_RINGS; k++) {
    if (k >= n) break;
    float phase;
    if (uOneShot > 0.5) {
      // One-shot: ring k expands ONCE from the centre (phase 0 -> 1) then is done — no fract wrap. Rings
      // are staggered so ring k starts at t = (k / uRings) / uSpeed, giving a single sweep that reads as
      // "from centre to full radius, then gone". Skip a ring before it has started or after it has passed
      // phase 1 (fully faded). The branch is on uniforms only (uOneShot/uTime/uSpeed/uRings/k), so every
      // fragment in the draw takes the same path — the fwidth() below stays in uniform control flow.
      phase = uTime * uSpeed - float(k) / uRings;
      if (phase < 0.0 || phase > 1.0) continue;
    } else {
      // Continuous: the original repeating expansion, unchanged.
      phase = fract(uTime * uSpeed + float(k) / uRings);
    }
    float bandDist = abs(d - phase);
    float aa = fwidth(bandDist);
    float ring = 1.0 - smoothstep(uThickness - aa, uThickness + aa, bandDist);
    float fadeAmt = pow(1.0 - phase, uFade);
    e = max(e, ring * fadeAmt);

    float haloRing = pow(1.0 - smoothstep(0.0, uThickness * 3.0, bandDist), 0.5);
    halo = max(halo, haloRing * fadeAmt);
  }
  halo *= uGlow;

  if (e <= 0.0 && halo <= 0.001) discard;

  float b = floor(clamp(e, 0.0, 1.0) * uBands) / max(uBands - 1.0, 1.0);
  vec4 col = pal(b);
  float bodyA = col.a * e * uAlpha;

  vec4 glowCol = uPal[3];
  float glowA = glowCol.a * halo * uAlpha;

  vec3 rgb = col.rgb * bodyA + glowCol.rgb * glowA;
  float a = bodyA + glowA;

  finalColor = vec4(rgb, a);
}
`;

/**
 * The param specs, declared once (see `params.ts`). Grouped for the inspector: Ring / Style. Values
 * mirror the spec handed down for this primitive.
 */
const SPECS = {
  rings: {
    kind: 'slider', label: 'Rings', group: 'Ring', min: 1, max: 5, step: 1, default: 2,
    help: 'Concurrent expanding rings.',
  },
  speed: {
    kind: 'slider', label: 'Speed', group: 'Ring', min: 0.1, max: 3, step: 0.05, default: 0.9,
    help: 'Expansions per second.',
  },
  thickness: {
    kind: 'slider', label: 'Thickness', group: 'Ring', min: 0.01, max: 0.3, step: 0.005, default: 0.06,
    help: 'Ring band width.',
  },
  fade: {
    kind: 'slider', label: 'Fade', group: 'Ring', min: 0.3, max: 3, step: 0.05, default: 1.2,
    help: 'How fast a ring fades as it grows.',
  },
  radius: {
    kind: 'slider', label: 'Radius', group: 'Ring', min: 40, max: 400, step: 5, default: 160,
    help: 'Max ring radius, px.',
  },
  bands: {
    kind: 'slider', label: 'Bands', group: 'Style', min: 1, max: 6, step: 1, default: 3,
    help: 'Posterization levels (the cel look).',
  },
  palette: {
    kind: 'palette', label: 'Palette', group: 'Style',
    default: paletteTuple('violet'), presets: PALETTE_PRESETS,
  },
  alpha: { kind: 'slider', label: 'Alpha', group: 'Style', min: 0, max: 1, step: 0.01, default: 1 },
  blendMode: {
    kind: 'enum', label: 'Blend mode', group: 'Style', options: FX_BLEND_MODES, default: 'add',
  },
  glow: {
    kind: 'slider', label: 'Glow', group: 'Style', min: 0, max: 1, step: 0.01, default: 0.3,
    help: 'soft outer halo',
  },
} satisfies FxParamSpecs;

type ShockwaveParams = ParamsOf<typeof SPECS>;

/** Unit quad corners (centred, -1..1), scaled by `radius` px into `positions` on construct and whenever
 *  `radius` changes. UV order matches so the fragment shader's `vUV * 2.0 - 1.0` recovers this same
 *  -1..1 square regardless of the current radius. */
const UNIT_QUAD = [-1, -1, 1, -1, 1, 1, -1, 1] as const;
const QUAD_UVS = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
const QUAD_INDICES = new Uint32Array([0, 1, 2, 0, 2, 3]);

/**
 * Wall-clock length (seconds) of a single one-shot expansion, matching the shader's staggered one-shot
 * phase: ring k runs `phase = uTime * uSpeed - k / rings` over [0, 1], so the last ring (k = rings - 1)
 * reaches phase 1 — fully faded, contributing nothing — at `uTime = (2*rings - 1) / (rings * uSpeed)`.
 * That instant is when the whole effect is done. Pulled out as a pure function (no Pixi dependency) so
 * the completion timing is unit-testable without a WebGL context — this is the one piece of the
 * one-shot logic that isn't rendering. `speed` is in expansions/sec (the `speed` param); `rings` is
 * rounded to a whole ring count to mirror the shader's `int(uRings)`.
 */
export function shockwaveOneShotDurationSec(rings: number, speed: number): number {
  const n = Math.max(1, Math.round(rings));
  const s = Math.max(1e-4, speed);
  return (2 * n - 1) / (n * s);
}

class ShockwaveInstance implements FxInstance<ShockwaveParams> {
  private readonly mesh: Mesh<MeshGeometry, Shader>;
  private readonly geometry: MeshGeometry;
  private readonly shader: Shader;
  private readonly positions: Float32Array;
  private params: ShockwaveParams;
  private clockSec = 0;
  // Fixed at spawn: a given instance is either a one-shot Fire or a continuous-loop preview, never both.
  private readonly oneShot: boolean;

  constructor(ctx: FxContext, params: ShockwaveParams) {
    this.params = params;
    this.oneShot = ctx.oneShot ?? false;
    this.positions = new Float32Array(8);
    this.writeQuad(params.radius);
    this.geometry = new MeshGeometry({
      positions: this.positions,
      uvs: QUAD_UVS,
      indices: QUAD_INDICES,
    });
    this.shader = Shader.from({
      gl: { vertex: SHOCKWAVE_VERT, fragment: SHOCKWAVE_FRAG },
      resources: {
        shockwaveUniforms: {
          uTime: { value: 0, type: 'f32' },
          uRings: { value: params.rings, type: 'f32' },
          uSpeed: { value: params.speed, type: 'f32' },
          uThickness: { value: params.thickness, type: 'f32' },
          uFade: { value: params.fade, type: 'f32' },
          uBands: { value: params.bands, type: 'f32' },
          uAlpha: { value: params.alpha, type: 'f32' },
          uGlow: { value: params.glow, type: 'f32' },
          uOneShot: { value: this.oneShot ? 1 : 0, type: 'f32' },
          uPal: { value: tupleFloats(params.palette), type: 'vec4<f32>', size: 4 },
        },
      },
    });
    this.mesh = new Mesh({ geometry: this.geometry, shader: this.shader });
    this.mesh.blendMode = params.blendMode;
    ctx.container.addChild(this.mesh);
  }

  private get uniforms(): Record<string, number | Float32Array> {
    return (this.shader.resources.shockwaveUniforms as { uniforms: Record<string, number | Float32Array> })
      .uniforms;
  }

  private writeQuad(radius: number): void {
    for (let i = 0; i < 8; i++) this.positions[i] = UNIT_QUAD[i] * radius;
  }

  /** Anchor hook (see `FxInstance.setHead`): position the mesh at the caller's anchor each frame, in
   *  whatever coordinate space `ctx.container` itself lives in — this instance applies no transform of
   *  its own, so the ring tracks the anchor as it moves along a travel path. */
  setHead(x: number, y: number): void {
    this.mesh.position.set(x, y);
  }

  update(dtMs: number): void {
    this.clockSec += dtMs / 1000;
    this.uniforms.uTime = this.clockSec;
  }

  /** One-shot completion: true once the single expansion's last ring has finished fading (elapsed past
   *  the single-cycle duration). Continuous instances always return false — their rings never stop. */
  isComplete(): boolean {
    if (!this.oneShot) return false;
    return this.clockSec >= shockwaveOneShotDurationSec(this.params.rings, this.params.speed);
  }

  setParams(next: ShockwaveParams): void {
    const radiusChanged = next.radius !== this.params.radius;
    this.params = next;
    const u = this.uniforms;
    u.uRings = next.rings;
    u.uSpeed = next.speed;
    u.uThickness = next.thickness;
    u.uFade = next.fade;
    u.uBands = next.bands;
    u.uAlpha = next.alpha;
    u.uGlow = next.glow;
    // setParams is not on the per-frame hot path (only fires on an inspector edit), so rebuilding uPal
    // unconditionally is cheap and sidesteps any reference-equality bugs from how the caller assembles
    // `next`.
    u.uPal = tupleFloats(next.palette);
    this.mesh.blendMode = next.blendMode;
    if (radiusChanged) {
      this.writeQuad(next.radius);
      this.geometry.getBuffer('aPosition').update();
    }
  }

  destroy(): void {
    // `Mesh.destroy()` deliberately does NOT cascade to `geometry`/`shader` (see `ribbon.ts`'s
    // `RibbonInstance.destroy` for the full reasoning) — both are built fresh in the constructor and
    // held exclusively by this instance, so we must free them ourselves or every spawn/destroy cycle
    // leaks GPU buffers and a compiled program.
    this.mesh.destroy();
    this.geometry.destroy(true); // true = also free the position/UV/index buffers; we own them exclusively
    this.shader.destroy(true); // true = also free the compiled GL program; not shared
  }
}

export const shockwavePrimitive: FxPrimitive<typeof SPECS> = {
  id: 'shockwave',
  params: SPECS,
  spawn: (ctx, params) => new ShockwaveInstance(ctx, params),
};

registerPrimitive(shockwavePrimitive as FxPrimitive);
