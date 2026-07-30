import { Mesh, MeshGeometry, Shader } from 'pixi.js';
import type { FxParamSpecs, ParamsOf } from '../params';
import type { FxContext, FxInstance, FxPrimitive } from '../primitive';
import { PALETTE_PRESETS, paletteTuple, tupleFloats } from '../palettes';
import { FX_BLEND_MODES } from '../blendModes';
import { registerPrimitive } from '../registry';
import { NOISE_GLSL, POSTERIZE_PAL_GLSL } from '../shaderChunks';

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
 * offset (`k / uRings`), a band around `d == radius` of half-width `uThickness`, fading out as it expands
 * via `pow(1 - phase, uFade)`.
 *
 * Each ring's CROSS-SECTION is shaded with `ribbon.ts`'s validated material, ported into ring space: the
 * band distance is normalized to the ribbon's across-coordinate, run through the same plateau remap
 * (`1.0 - smoothstep(uPlateau, 1.0, across)` — the fat hot core, without which the top colour band never
 * fires), eroded by a domain-warped scrolling fbm, and posterized through the shared `posterizePal`
 * (`shaderChunks.ts`) so the ring reads as tattered cel-banded energy rather than a flat cartoon circle.
 * Do not soften either the plateau or the band quantisation — both are the style.
 *
 * SEAM: the noise coordinate is built from the fragment's *unit direction* (`p / length(p)`), never from
 * `atan(y, x)`. An angle jumps by 2π across the -x axis and would tear a visible seam down one side of
 * every ring; a normalized direction is a continuous function of position, so the field is seam-free by
 * construction. Scroll is applied as a *rotation* of that direction (periodic, so it stays seam-free).
 */
export const SHOCKWAVE_FRAG = /* glsl */ `#version 300 es
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
uniform float uPlateau;
uniform float uNoiseAlong;
uniform float uNoiseAcross;
uniform float uWarp;
uniform float uScroll;
uniform float uErode;
uniform float uGain;
uniform float uSquash;
uniform float uRingDelay;
uniform float uEase;
// How much bigger the QUAD is than the ring's own radius. The mesh used to be exactly +/-radius, so a ring
// at full expansion sat right on the quad's edge and its outer half -- band, soft edge and glow alike --
// was sliced off dead straight by the mesh boundary. That is the hard line where a glow meets its bounding
// box. The quad is now oversized and this scale puts d == 1.0 back at the true radius, so every existing
// tuning renders identically; there is simply room around it for the falloff to complete.
uniform float uQuadScale;
uniform vec4  uPal[4];

${NOISE_GLSL}
${POSTERIZE_PAL_GLSL}

// Constant loop bound (GLSL ES 3.0 fragment loops want a compile-time trip count to unroll cleanly);
// matches the 'rings' param spec's max of 5. The k >= n break makes the effective count the live uRings.
const int MAX_RINGS = 5;

void main() {
  vec2 p = (vUV * 2.0 - 1.0) * uQuadScale;
  // Vertical squash: scaling y BEFORE the length() turns the ring into an ellipse flattened along y, so
  // it reads as a circle lying on a ground plane seen at an angle. At uSquash 1.0 this divides by exactly
  // 1.0 - an exact IEEE no-op - so the default is the original true circle.
  p.y /= max(uSquash, 0.0001);
  float d = length(p);

  // Unit direction of this fragment: the seam-free basis for the noise coordinate (see the header).
  vec2 dir = p / max(d, 0.00001);
  // Scroll rotates that direction, i.e. the noise flows AROUND the ring (its 'along' axis is the angle),
  // which is inherently periodic and therefore still seam-free.
  float cs = cos(uTime * uScroll);
  float sn = sin(uTime * uScroll);
  vec2 sdir = vec2(dir.x * cs - dir.y * sn, dir.x * sn + dir.y * cs);

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
    // Extra per-ring stagger on top of the even k / uRings phasing. At uRingDelay 0.0 this term is
    // exactly 0.0 and the subtraction is an exact no-op, so the default timing is the original.
    float clock = uTime * uSpeed - float(k) * uRingDelay;
    float phase;
    if (uOneShot > 0.5) {
      // One-shot: ring k expands ONCE from the centre (phase 0 -> 1) then is done — no fract wrap. Rings
      // are staggered so ring k starts at t = (k / uRings) / uSpeed, giving a single sweep that reads as
      // "from centre to full radius, then gone". Skip a ring before it has started or after it has passed
      // phase 1 (fully faded). The branch is on uniforms only (uOneShot/uTime/uSpeed/uRings/k), so every
      // fragment in the draw takes the same path.
      phase = clock - float(k) / uRings;
      if (phase < 0.0 || phase > 1.0) continue;
    } else {
      // Continuous: the original repeating expansion, unchanged.
      phase = fract(clock + float(k) / uRings);
    }
    // Expansion easing: the ring's RADIUS is pow(phase, uEase), so below 1 it punches out and settles.
    // Guarded by an exact compare on the uniform (uniform control flow — every fragment takes the same
    // branch) because pow(x, 1.0) is not guaranteed bit-exact; at uEase 1.0 the radius is literally the
    // linear phase, exactly as before. The FADE stays on the linear phase, so a ring's lifetime — and the
    // one-shot completion time — is unaffected by easing.
    float rad = uEase == 1.0 ? phase : pow(max(phase, 0.0), uEase);
    float bandDist = abs(d - rad);
    float fadeAmt = pow(1.0 - phase, uFade);

    // --- ribbon.ts's material, in ring space ---
    // 0 at the ring crest, 1 at the edge of its band: the ribbon's across-the-width coordinate.
    float across = clamp(bandDist / max(uThickness, 0.0001), 0.0, 1.0);
    float wfall = 1.0 - smoothstep(uPlateau, 1.0, across);
    // Noise coordinate: a point on a circle of radius (uNoiseAlong + across * uNoiseAcross) in noise
    // space — periodic around the ring, and the across term shifts the sample radially so the band's
    // outer fringe tatters differently from its core. The per-ring offset keeps concentric rings from
    // wearing an identical pattern.
    vec2 np = sdir * (uNoiseAlong + across * uNoiseAcross) + float(k) * 17.3;
    np += (vec2(fbm(np * 1.7), fbm(np * 1.7 + 19.3)) - 0.5) * uWarp;
    float nz = fbm(np);
    float shape = wfall * uGain - nz * uErode;
    // clamp() takes an eroded-away fragment (shape <= 0) to exactly 0, so it contributes nothing.
    float q = clamp(shape / max(uGain, 0.001), 0.0, 1.0);
    e = max(e, q * fadeAmt);

    float haloRing = pow(1.0 - smoothstep(0.0, uThickness * 3.0, bandDist), 0.5);
    halo = max(halo, haloRing * fadeAmt);
  }
  halo *= uGlow;

  if (e <= 0.0 && halo <= 0.001) discard;

  // Colour is band-quantised (the cel look); the ALPHA stays on the raw, smooth e, which is what keeps
  // the silhouette antialiased now that the plateau ramp — not a fwidth() step — shapes the edge.
  vec4 col = posterizePal(e, uBands, uPal);
  float bodyA = col.a * e * uAlpha;

  vec4 glowCol = uPal[3];
  float glowA = glowCol.a * halo * uAlpha;

  vec3 rgb = col.rgb * bodyA + glowCol.rgb * glowA;
  float a = bodyA + glowA;

  finalColor = vec4(rgb, a);
}
`;

/**
 * The param specs, declared once (see `params.ts`). Grouped for the inspector: Ring / Style / Noise. The
 * Noise group is the ribbon's material ported into ring space — its ranges/defaults mirror `ribbon.ts`'s
 * equivalents so the two effects tune the same way (ribbon files `plateau` under Style and `gain` under
 * Shape; here they sit with the rest of the material knobs, since this primitive has no Shape group).
 */
const SPECS = {
  rings: {
    kind: 'slider', label: 'Rings', group: 'Ring', min: 1, max: 5, step: 1, default: 2, essential: true,
    axis: 'intensity',
    help: 'Concurrent expanding rings.',
  },
  speed: {
    kind: 'slider', label: 'Speed', group: 'Ring', min: 0.1, max: 3, step: 0.05, default: 0.9, essential: true,
    help: 'Expansions per second.',
  },
  thickness: {
    kind: 'slider', label: 'Thickness', group: 'Ring', min: 0.01, max: 0.3, step: 0.005, default: 0.06, essential: true,
    help: 'Ring band width.',
  },
  fade: {
    kind: 'slider', label: 'Fade', group: 'Ring', min: 0.3, max: 3, step: 0.05, default: 1.2,
    help: 'How fast a ring fades as it grows.',
  },
  radius: {
    kind: 'slider', label: 'Radius', group: 'Ring', min: 40, max: 400, step: 5, default: 160, essential: true,
    axis: 'scale',
    help: 'Max ring radius, px.',
  },
  squash: {
    kind: 'slider', label: 'Squash', group: 'Ring', min: 0.2, max: 1, step: 0.01, default: 1,
    help: 'Vertical squash — 1 is a true circle, lower reads as a ring lying on the ground.',
  },
  ringDelay: {
    kind: 'slider', label: 'Ring delay', group: 'Ring', min: 0, max: 1, step: 0.01, default: 0,
    // The stagger is `- float(k) * uRingDelay`, so with a single ring (k is always 0) it is an exact no-op
    // no matter what this says.
    enabledWhen: { param: 'rings', above: 1 },
    help: 'Extra stagger between successive rings; 0 keeps them evenly phased (the default cadence).',
  },
  ease: {
    kind: 'slider', label: 'Ease', group: 'Ring', min: 0.3, max: 3, step: 0.05, default: 1,
    help: 'Expansion curve — below 1 punches out fast then settles, above 1 accelerates; 1 is linear.',
  },
  bands: {
    kind: 'slider', label: 'Bands', group: 'Style', min: 1, max: 6, step: 1, default: 3,
    help: 'Posterization levels (the cel look).',
  },
  palette: {
    kind: 'palette', label: 'Palette', group: 'Style', essential: true,
    default: paletteTuple('violet'), presets: PALETTE_PRESETS,
    help: 'The four colours each ring steps through, faint outer fringe first and white-hot crest last. A preset swaps all four at once; the last (core) colour is also what tints the Glow halo.',
  },
  alpha: {
    kind: 'slider', label: 'Alpha', group: 'Style', min: 0, max: 1, step: 0.01, default: 1,
    help: 'Overall opacity of the rings, glow included — 1 is full strength, lower fades the whole effect back without changing its shape or timing.',
  },
  blendMode: {
    kind: 'enum', label: 'Blend mode', group: 'Style', options: FX_BLEND_MODES, default: 'add',
    help: 'How the rings composite over what is behind them: add (the default) makes them glow and brighten whatever they cross, normal paints them as solid opaque colour, screen is a gentler lift, and multiply/overlay stain what is behind rather than lighting it.',
  },
  glow: {
    kind: 'slider', label: 'Glow', group: 'Style', min: 0, max: 1, step: 0.01, default: 0.3,
    help: 'soft outer halo',
  },

  plateau: {
    kind: 'slider', label: 'Plateau', group: 'Noise', min: 0, max: 0.9, step: 0.01, default: 0.3,
    help: 'Width of the flat hot core across the ring band — what gives the fat cel bands; at 0 the top colour band never fires.',
  },
  noiseAlong: {
    kind: 'slider', label: 'Noise (along)', group: 'Noise', min: 0.5, max: 12, step: 0.1, default: 3,
    // Inert at Erode 0: the band is `wfall * uGain - nz * uErode`, normalised straight back by
    // `shape / uGain` — so with no noise term uGain cancels and every noise knob feeds nothing.
    enabledWhen: { param: 'erode', above: 0 },
    help: 'How fine the tatter is around the ring — low takes a few big bites out of the band, high leaves a dense ragged fringe. Does nothing while Erode is 0.',
  },
  noiseAcross: {
    kind: 'slider', label: 'Noise (across)', group: 'Noise', min: 1, max: 20, step: 0.1, default: 7,
    enabledWhen: { param: 'erode', above: 0 },
    help: 'How fine the tatter is across the band (crest → edge), so the outer fringe frays differently from the bright middle. Does nothing while Erode is 0.',
  },
  warp: {
    kind: 'slider', label: 'Warp', group: 'Noise', min: 0, max: 1.5, step: 0.01, default: 0.35,
    enabledWhen: { param: 'erode', above: 0 },
    help: 'Curls the tatter into flowing, flame-like streaks instead of round blobs — 0 leaves it plain and lumpy, 0.35 is the reference look. Does nothing while Erode is 0.',
  },
  scroll: {
    kind: 'slider', label: 'Scroll', group: 'Noise', min: 0, max: 6, step: 0.05, default: 1.4,
    enabledWhen: { param: 'erode', above: 0 },
    help: 'How fast the tatter swirls around the ring — 0 freezes the pattern in place so the ring expands without churning. Does nothing while Erode is 0.',
  },
  erode: {
    kind: 'slider', label: 'Erode', group: 'Noise', min: 0, max: 1.2, step: 0.01, default: 0.5,
    help: 'How much the noise eats into the ring — higher gives a more tattered band.',
  },
  gain: {
    kind: 'slider', label: 'Gain', group: 'Noise', min: 0.3, max: 2, step: 0.01, default: 1.5,
    enabledWhen: { param: 'erode', above: 0 },
    help: 'How well a ring resists Erode — raise it and the noise takes smaller bites so the band reads solid, lower it and the same Erode chews it down to wisps. Does nothing while Erode is 0.',
  },
} satisfies FxParamSpecs;

type ShockwaveParams = ParamsOf<typeof SPECS>;

/** Unit quad corners (centred, -1..1), scaled by `radius` px into `positions` on construct and whenever
 *  `radius` changes. UV order matches so the fragment shader's `vUV * 2.0 - 1.0` recovers this same
 *  -1..1 square regardless of the current radius. */
const UNIT_QUAD = [-1, -1, 1, -1, 1, 1, -1, 1] as const;

/**
 * How much bigger the quad is than the ring's radius.
 *
 * The mesh used to be exactly +/-radius, which put a fully expanded ring right on the quad's edge: the outer
 * half of the band, its antialiased edge and its glow halo were all clipped dead straight by the mesh
 * boundary, drawing a hard line where the glow met its bounding box.
 *
 * 1.45 covers the worst case with room to spare: the band is centred on `d == 1` with up to `thickness` 0.3
 * of half-width beyond it (1.3), plus the soft edge and the glow. `uQuadScale` feeds the shader so `d == 1`
 * still means "the radius", which is what keeps every already-tuned def rendering exactly as before.
 *
 * The cost is fragment area — 1.45^2 is ~2.1x the pixels — on a primitive that draws a handful of rings for
 * a few hundred ms. Cheaper than the alternative of fading the ring out early, which would have changed the
 * look of every def that uses one.
 */
export const QUAD_SCALE = 1.45;
const QUAD_UVS = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
const QUAD_INDICES = new Uint32Array([0, 1, 2, 0, 2, 3]);

/**
 * Wall-clock length (seconds) of a single one-shot expansion, matching the shader's staggered one-shot
 * phase: ring k runs `phase = uTime * uSpeed - k * ringDelay - k / rings` over [0, 1], so the last ring
 * (k = rings - 1) reaches phase 1 — fully faded, contributing nothing — at
 * `uTime = (2*rings - 1) / (rings * speed) + (rings - 1) * ringDelay / speed`. That instant is when the
 * whole effect is done. Pulled out as a pure function (no Pixi dependency) so the completion timing is
 * unit-testable without a WebGL context — this is the one piece of the one-shot logic that isn't
 * rendering. `speed` is in expansions/sec (the `speed` param); `rings` is rounded to a whole ring count
 * to mirror the shader's `int(uRings)`. `ringDelay` (the `ringDelay` param) defaults to 0, which is
 * exactly the original closed form — the extra stagger only ever lengthens the cycle.
 *
 * Note the shader's expansion `ease` deliberately does NOT appear here: easing reshapes a ring's radius
 * over its life, not its phase, so the ring still starts and finishes at the same instants.
 */
export function shockwaveOneShotDurationSec(rings: number, speed: number, ringDelay = 0): number {
  const n = Math.max(1, Math.round(rings));
  const s = Math.max(1e-4, speed);
  const delay = Math.max(0, ringDelay);
  return (2 * n - 1) / (n * s) + ((n - 1) * delay) / s;
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
          uPlateau: { value: params.plateau, type: 'f32' },
          uNoiseAlong: { value: params.noiseAlong, type: 'f32' },
          uNoiseAcross: { value: params.noiseAcross, type: 'f32' },
          uWarp: { value: params.warp, type: 'f32' },
          uScroll: { value: params.scroll, type: 'f32' },
          uErode: { value: params.erode, type: 'f32' },
          uGain: { value: params.gain, type: 'f32' },
          uSquash: { value: params.squash, type: 'f32' },
          // Constant for the instance's lifetime — the quad and this scale are written together (see
          // `QUAD_SCALE`), so they can never disagree about where `d == 1` is.
          uQuadScale: { value: QUAD_SCALE, type: 'f32' },
          uRingDelay: { value: params.ringDelay, type: 'f32' },
          uEase: { value: params.ease, type: 'f32' },
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
    for (let i = 0; i < 8; i++) this.positions[i] = UNIT_QUAD[i] * radius * QUAD_SCALE;
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
    return this.clockSec >= shockwaveOneShotDurationSec(
      this.params.rings,
      this.params.speed,
      this.params.ringDelay,
    );
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
    u.uPlateau = next.plateau;
    u.uNoiseAlong = next.noiseAlong;
    u.uNoiseAcross = next.noiseAcross;
    u.uWarp = next.warp;
    u.uScroll = next.scroll;
    u.uErode = next.erode;
    u.uGain = next.gain;
    u.uSquash = next.squash;
    u.uRingDelay = next.ringDelay;
    u.uEase = next.ease;
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
