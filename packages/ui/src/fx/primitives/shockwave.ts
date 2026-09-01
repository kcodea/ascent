import { Mesh, MeshGeometry, Shader, type Renderer } from 'pixi.js';
import { BLUR_PARAM_SPECS } from '../blurFilter';
import { FilterStack, filterLabSpecs } from '../filterStack';
import { FILTERS } from '../filterRegistry';
import { ContainerTransform, TRANSFORM_PARAM_SPECS } from '../transformEnvelope';
import type { FxParamSpecs, ParamsOf } from '../params';
import type { FxContext, FxInstance, FxPrimitive } from '../primitive';
import { PALETTE_PRESETS, paletteTuple, tupleFloats } from '../palettes';
import { FX_BLEND_MODES } from '../blendModes';
import { registerPrimitive } from '../registry';
import { NOISE_GLSL, POSTERIZE_PAL_GLSL } from '../shaderChunks';
import { bakeCurveLut, isIdentityCurve, CURVE_PRESETS } from '../curve';
import { acquireShader, linkShader, prewarmShaders, releaseShader } from '../shaderPool';

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
/**
 * Lookup-table resolution for the authored expansion curve (`radiusCurve`).
 *
 * 32 samples over a radius ramp: the ring's radius spans the quad, so a table step is ~3% of the sweep and
 * the shader interpolates linearly between entries — finer than the eye can separate on an expanding edge,
 * and the curve editor's own control points are far sparser than this anyway.
 *
 * Packed 4-per-`vec4` rather than declared `float[32]`: std140 pads every element of a scalar array out to a
 * full 16-byte slot, so a float array would spend 512 bytes to carry 128. As `vec4`s it is exactly 128.
 */
const RAD_LUT_N = 32;
const RAD_LUT_VEC4 = RAD_LUT_N / 4;

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
// The authored expansion curve, baked to a lookup table. 0 = not authored, and the ring takes the original
// pow(phase, uEase) path untouched. Branching on a UNIFORM, so every fragment in the draw agrees.
uniform float uRadCurveOn;
uniform vec4  uRadLut[${RAD_LUT_VEC4}];
// 1 = the ring contracts instead of expanding. Also a uniform branch.
uniform float uRevRing;

${NOISE_GLSL}
${POSTERIZE_PAL_GLSL}

// Constant loop bound (GLSL ES 3.0 fragment loops want a compile-time trip count to unroll cleanly);
// matches the 'rings' param spec's max of 5. The k >= n break makes the effective count the live uRings.
const int MAX_RINGS = 5;

const int RAD_LUT_N = ${RAD_LUT_N};

/** One packed LUT entry. The vec4 index is dynamic, which GLSL ES 3.00 permits on a uniform array; the
 *  COMPONENT is chosen by compare rather than by [] so this needs nothing beyond that. */
float radLutAt(int i) {
  vec4 v = uRadLut[i >> 2];
  int c = i & 3;
  return c == 0 ? v.x : (c == 1 ? v.y : (c == 2 ? v.z : v.w));
}

/** The authored expansion curve at t, linearly interpolated between LUT samples. Sample i sits at
 *  t = i / (RAD_LUT_N - 1), so the ends are exactly the curve's own endpoints. */
float radCurve(float t) {
  float x = clamp(t, 0.0, 1.0) * float(RAD_LUT_N - 1);
  int i = int(floor(x));
  int j = min(i + 1, RAD_LUT_N - 1);
  return mix(radLutAt(i), radLutAt(j), x - float(i));
}

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
    // Expansion shape: the ring's RADIUS as a function of its linear phase.
    //
    // Two paths, chosen on a uniform so every fragment takes the same one. The AUTHORED CURVE wins when one
    // has been drawn; uEase then applies as an exponent on top of it, so the two compose rather than
    // fight (leave Ease at 1 to get the curve alone). With no curve authored this is the original
    // expression, character for character — including the exact compare on uEase, which is there because
    // pow(x, 1.0) is not guaranteed bit-exact and every already-tuned def rests on the linear case.
    //
    // The FADE deliberately stays on the linear phase, so a ring's lifetime — and the one-shot completion
    // time shockwaveOneShotDurationSec computes — is unaffected by either control.
    float shaped = uRadCurveOn > 0.5 ? radCurve(phase) : phase;
    float eased = uEase == 1.0 ? shaped : pow(max(shaped, 0.0), uEase);
    // REVERSE — the ring CONTRACTS, sweeping from full radius in to the centre. Mirroring the shaped radius
    // rather than the phase is deliberate: fade and lifetime stay on the linear clock, so a reversed ring
    // still fades out as it arrives instead of appearing from nothing at the rim. At uRevRing 0.0 this is
    // exactly eased (1.0 - x is not free, so the branch keeps the default bit-exact).
    float rad = uRevRing > 0.5 ? 1.0 - eased : eased;
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
    kind: 'slider', label: 'Rings', group: 'Ring', min: 1, max: 12, step: 1, default: 2, essential: true,
    axis: 'intensity',
    help: 'How many rings are expanding at once. 1 is a single clean pulse; higher stacks them into a repeating ripple, evenly spaced unless Ring delay staggers them.',
  },
  speed: {
    kind: 'slider', label: 'Speed', group: 'Ring', min: 0.1, max: 12, step: 0.05, default: 0.9, essential: true,
    // The only `timeInverse` param in the library, and the reason that flavour exists. A shockwave has no
    // duration param at all: one expansion takes `1 / speed` seconds, so this IS the effect's clock. Left off
    // the time axis, a stretched layer window would hold an empty quad open long after the rings had finished
    // (or, looping, run extra cycles); ×1/time lengthens the period with everything else, which is exactly
    // what `impactPulse`'s per-call `life` multiplier meant.
    axis: 'timeInverse',
    help: 'How many times a ring expands per second — this is the effect’s whole clock, since a shockwave has no lifetime of its own. 0.9 is one unhurried expansion; higher pulses faster and tighter.',
  },
  thickness: {
    kind: 'slider', label: 'Thickness', group: 'Ring', min: 0.01, max: 0.3, step: 0.005, default: 0.06, essential: true,
    // DELIBERATELY left at 0.3 by the 2026-07-30 headroom pass, which widened `rings`, `radius`, `speed`,
    // `fade` and `ease` around it. This one has a real geometric ceiling: the band is centred on `d == 1`
    // with `thickness` of half-width beyond it, drawn on a quad only `QUAD_SCALE` (1.45) times the radius —
    // so past ~0.35 the band's outer half, its soft edge and its glow are clipped dead straight against the
    // mesh boundary (the exact artefact QUAD_SCALE exists to prevent, owner-reported with a screenshot). The
    // quad cannot simply grow either: fragment area scales with its square, and `shockwave.test.ts` caps it.
    // A thicker ring wants a bigger `radius` (now up to 2000) or a second ring, not a wider band.
    help: 'How thick the bright band of the ring is, as a fraction of its radius — thin reads as a sharp edge racing outward, thick as a heavy rolling wall. Past ~0.35 the outer half is clipped by the mesh it draws on, so reach for a bigger Radius or a second ring instead.',
  },
  fade: {
    kind: 'slider', label: 'Fade', group: 'Ring', min: 0.3, max: 8, step: 0.05, default: 1.2,
    help: 'How fast a ring fades as it grows. Low holds it bright all the way to full Radius; high snuffs it out early, so the ring reads as a flash near the impact rather than a wave that travels.',
  },
  radius: {
    kind: 'slider', label: 'Radius', group: 'Ring', min: 40, max: 2000, step: 5, default: 160, essential: true,
    axis: 'scale',
    help: 'How far out the ring reaches before it is done, in px. Roughly card-width (160) reads as a hit; several hundred reads as a blast that takes in the neighbours.',
  },
  squash: {
    kind: 'slider', label: 'Squash', group: 'Ring', min: 0.2, max: 1, step: 0.01, default: 1,
    help: 'Vertical squash — 1 is a true circle, lower reads as a ring lying on the ground.',
  },
  offsetX: {
    kind: 'slider', label: 'Offset X', group: 'Ring', min: -600, max: 600, step: 1, default: 0, axis: 'scale', essential: true,
    // The same pair `burst`/`emitter`/`smoke` carry, and for the same reason — but applied to the MESH
    // rather than to spawn positions, because a ring has no spawns: `setHead` is its entire placement.
    // `axis: 'scale'` for `burst`'s argument verbatim — this is a length, so it must ride the same resize as
    // `radius`, or a scaled-down ring keeps a full-size displacement and drifts off its anchor.
    // Range is 3x burst's ±200 because a ring is a 3x bigger object (radius reaches 2000 against burst's
    // emit radius of 400) and is routinely anchored to `camera`, where "move it to the shop row" is a
    // screen-scale distance, not a card-scale one.
    help: 'Shifts the ring sideways from its anchor, in px. Placement only — it moves where the ring sits without changing its size, shape or expansion.',
  },
  offsetY: {
    kind: 'slider', label: 'Offset Y', group: 'Ring', min: -600, max: 600, step: 1, default: 0, axis: 'scale', essential: true,
    help: 'Shifts the ring up or down from its anchor, in px. Negative is up. Placement only — it moves where the ring sits without changing its size, shape or expansion.',
  },
  ringDelay: {
    kind: 'slider', label: 'Ring delay', group: 'Ring', min: 0, max: 1, step: 0.01, default: 0,
    // The stagger is `- float(k) * uRingDelay`, so with a single ring (k is always 0) it is an exact no-op
    // no matter what this says.
    enabledWhen: { param: 'rings', above: 1 },
    help: 'Extra stagger between successive rings; 0 keeps them evenly phased (the default cadence).',
  },
  ease: {
    kind: 'slider', label: 'Ease', group: 'Ring', min: 0.3, max: 8, step: 0.05, default: 1,
    help: 'Expansion curve — below 1 punches out fast then settles, above 1 accelerates; 1 is linear. This is the one-dial version: it can only ever decelerate or only ever accelerate. Draw Expansion / life when you want a shape it cannot make, like hang-then-go. With a curve drawn, this stays live as an exponent on top of it, so leave it at 1 to get the curve alone.',
  },
  radiusCurve: {
    kind: 'curve', label: 'Expansion / life', group: 'Ring',
    // The IDENTITY ramp, not a flat line: this curve REPLACES the radius rather than multiplying it, so
    // "do nothing" is v = t. `isIdentityCurve` detects exactly this and skips the LUT entirely, which is
    // what keeps every already-tuned def on the original pow(phase, ease) expression.
    default: [[0, 0], [1, 1]], vMax: 1, presets: CURVE_PRESETS,
    help: 'How far out the ring has travelled across its life (0 = born at the centre, 1 = full Radius). The default diagonal is a steady sweep. Because it sets POSITION rather than speed, a flat stretch is a ring holding still and a steep one is a ring racing — so hold-then-drop reads as a ring that hangs and then snaps back inward. Fade is deliberately left on the linear clock, so reshaping this never changes how long a ring lives.',
  },
  reverse: {
    kind: 'toggle', label: 'Reverse', group: 'Ring', default: false,
    help: 'Turns the shockwave into an IMPLOSION: the ring starts at full Radius and sweeps inward to the centre. Fade and lifetime stay on the forward clock, so it still fades out as it arrives rather than appearing from nothing at the rim. Composes with everything else — Expansion / life and Ease shape the sweep, and this mirrors it.',
  },
  bands: {
    kind: 'slider', label: 'Bands', group: 'Style', min: 1, max: 6, step: 1, default: 3,
    help: 'How many flat colour steps the ring is cut into, instead of a smooth gradient — 3-4 gives the hand-drawn cel look, 1 is a single flat colour, 6 washes back toward a blur.',
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
    help: 'A soft halo bleeding outside the ring, tinted by the palette\'s core colour. 0 leaves a crisp band; higher sells heat and light spill.',
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
  ...BLUR_PARAM_SPECS,
  ...filterLabSpecs(FILTERS),
  ...TRANSFORM_PARAM_SPECS,
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

/** The shader pool's key for this primitive (see `shaderPool.ts`). */
const SHOCKWAVE_SHADER_KEY = 'fx-shockwave';

/** Build one shockwave material. Every uniform here is a PLACEHOLDER: `writeAllUniforms` overwrites all of
 *  them on every acquire, fresh or pooled, so this only has to satisfy `Shader.from`'s reflection pass. */
function makeShockwaveShader(): Shader {
  return Shader.from({
    gl: { vertex: SHOCKWAVE_VERT, fragment: SHOCKWAVE_FRAG },
    resources: {
      shockwaveUniforms: {
        uTime: { value: 0, type: 'f32' },
        uRings: { value: 1, type: 'f32' },
        uSpeed: { value: 1, type: 'f32' },
        uThickness: { value: 0.1, type: 'f32' },
        uFade: { value: 1, type: 'f32' },
        uBands: { value: 4, type: 'f32' },
        uAlpha: { value: 1, type: 'f32' },
        uGlow: { value: 0, type: 'f32' },
        uOneShot: { value: 0, type: 'f32' },
        uPlateau: { value: 0.5, type: 'f32' },
        uNoiseAlong: { value: 0, type: 'f32' },
        uNoiseAcross: { value: 0, type: 'f32' },
        uWarp: { value: 0, type: 'f32' },
        uScroll: { value: 0, type: 'f32' },
        uErode: { value: 0, type: 'f32' },
        uGain: { value: 1, type: 'f32' },
        uSquash: { value: 1, type: 'f32' },
        uQuadScale: { value: QUAD_SCALE, type: 'f32' },
        uRingDelay: { value: 0, type: 'f32' },
        uEase: { value: 0, type: 'f32' },
        uPal: { value: new Float32Array(16), type: 'vec4<f32>', size: 4 },
        uRadCurveOn: { value: 0, type: 'f32' },
        uRadLut: { value: new Float32Array(RAD_LUT_N), type: 'vec4<f32>', size: RAD_LUT_VEC4 },
        uRevRing: { value: 0, type: 'f32' },
      },
    },
  });
}

/** Build + GL-link the shockwave material at load, so the first ring of a session doesn't pay for the
 *  compile. See `primitives/index.ts`'s `prewarmFxMaterials`. */
export function prewarmShockwaveShaders(renderer: Renderer | null, count = 2): void {
  prewarmShaders(SHOCKWAVE_SHADER_KEY, count, renderer, makeShockwaveShader);
}

/** Link the shockwave program on `renderer` WITHOUT pooling — see `linkRibbonShaderOn`. */
export function linkShockwaveShaderOn(renderer: Renderer): Shader {
  const shader = makeShockwaveShader();
  linkShader(renderer, shader);
  return shader;
}

/**
 * The pool's mandatory ACQUIRE reset: write EVERY uniform this shader owns, unconditionally.
 *
 * Deliberately a superset of `setParams` — that one is an inspector-edit path and legitimately skips the
 * three uniforms a live instance never changes (`uTime`, `uOneShot`, `uQuadScale`). A pooled shader arrives
 * carrying the PREVIOUS fire's values for all three, so reusing `setParams` here would hand a one-shot ring
 * the last tenant's `uOneShot = 0` (it would never fade out) and its accumulated `uTime` (it would start
 * mid-expansion). That is exactly the intermittent, load-dependent pooling bug this function exists to
 * prevent — so it lists every uniform, and must keep doing so if one is added.
 */
function writeAllUniforms(shader: Shader, params: ShockwaveParams, oneShot: boolean): void {
  const u = (shader.resources.shockwaveUniforms as { uniforms: Record<string, number | Float32Array> })
    .uniforms;
  u.uTime = 0;
  u.uRings = params.rings;
  u.uSpeed = params.speed;
  u.uThickness = params.thickness;
  u.uFade = params.fade;
  u.uBands = params.bands;
  u.uAlpha = params.alpha;
  u.uGlow = params.glow;
  u.uOneShot = oneShot ? 1 : 0;
  u.uPlateau = params.plateau;
  u.uNoiseAlong = params.noiseAlong;
  u.uNoiseAcross = params.noiseAcross;
  u.uWarp = params.warp;
  u.uScroll = params.scroll;
  u.uErode = params.erode;
  u.uGain = params.gain;
  u.uSquash = params.squash;
  // Constant for every instance — the quad and this scale are written together (see `QUAD_SCALE`), so they
  // can never disagree about where `d == 1` is.
  u.uQuadScale = QUAD_SCALE;
  u.uRingDelay = params.ringDelay;
  u.uEase = params.ease;
  u.uPal = tupleFloats(params.palette);
  u.uRadCurveOn = isIdentityCurve(params.radiusCurve) ? 0 : 1;
  u.uRadLut = radLutFloats(params.radiusCurve);
  u.uRevRing = params.reverse ? 1 : 0;
}

/**
 * The expansion curve as a fresh LUT buffer, for the shader's packed `uRadLut`.
 *
 * A new array per write, matching `tupleFloats`' contract for `uPal`: the uniform group holds what it is
 * handed, so a shared scratch would alias every pooled shockwave onto one curve. This runs on acquire and on
 * an inspector edit — never per frame — so the allocation is not on a hot path.
 *
 * Baked even when the curve is the identity and `uRadCurveOn` is 0, because a pooled shader must never
 * inherit a previous tenant's buffer (see `writeAllUniforms`); an unread-but-correct LUT is cheaper to
 * reason about than a conditional one.
 */
function radLutFloats(points: ReadonlyArray<readonly [number, number]>): Float32Array {
  const out = new Float32Array(RAD_LUT_N);
  bakeCurveLut(points, out);
  return out;
}

class ShockwaveInstance implements FxInstance<ShockwaveParams> {
  private readonly mesh: Mesh<MeshGeometry, Shader>;
  private readonly geometry: MeshGeometry;
  private readonly shader: Shader;
  private readonly positions: Float32Array;
  private params: ShockwaveParams;
  private clockSec = 0;
  // The filter lab stack (core Blur + every toggle-gated pixi-filter). `clockSec` (starts at 0 here — no
  // field-phase offset) is its over-time clock, normalised by the one-shot ring duration.
  private readonly filters: FilterStack;
  private readonly transform: ContainerTransform;
  /** Last anchor `setHead` delivered, so an offset edit can re-place without waiting for the next frame.
   *  Starts at the container origin — the position the mesh would have held anyway before this existed. */
  private headX = 0;
  private headY = 0;
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
    // Pooled, not constructed. Building a Shader per fire re-compiled and re-linked the GLSL every time —
    // a ~68 ms main-thread block. See `particleLayerPool.ts`'s header for the full mechanism, and
    // `shaderPool.ts` for the pooling contract. `writeAllUniforms` is the mandatory total reset.
    this.shader = acquireShader(SHOCKWAVE_SHADER_KEY, makeShockwaveShader, (sh) =>
      writeAllUniforms(sh, params, this.oneShot),
    );
    this.mesh = new Mesh({ geometry: this.geometry, shader: this.shader });
    this.mesh.blendMode = params.blendMode;
    // Placed up front rather than waiting on the first `setHead`: the head defaults to the container
    // origin, and a layer that is never driven would otherwise ignore the offset dials entirely.
    this.place();
    ctx.container.addChild(this.mesh);
    this.filters = new FilterStack(ctx.container, FILTERS);
    this.transform = new ContainerTransform(ctx.container);
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
   *  its own beyond the `offsetX`/`offsetY` nudge, so the ring tracks the anchor as it moves along a
   *  travel path, carrying its offset with it. The anchor is REMEMBERED rather than only consumed, so
   *  `setParams` can re-place against it the instant an offset slider moves. */
  setHead(x: number, y: number): void {
    this.headX = x;
    this.headY = y;
    this.place();
  }

  /** The one place the mesh's position is written: the remembered anchor plus the placement offsets.
   *  At the (0, 0) defaults this is an exact IEEE no-op, so every def authored before the pair existed
   *  sits precisely where it always did (the same argument `emissionOffset` makes for the particle
   *  primitives, and `uSquash`'s divide-by-1 for this shader). */
  private place(): void {
    this.mesh.position.set(this.headX + this.params.offsetX, this.headY + this.params.offsetY);
  }

  update(dtMs: number): void {
    this.clockSec += dtMs / 1000;
    this.uniforms.uTime = this.clockSec;
    // The filter lab over the ring's own life: progress is elapsed / the one-shot duration (the same clock
    // `isComplete` reads). Handed to the stack, which owns every filter's create/retime/destroy.
    const p = this.params;
    const durSec = shockwaveOneShotDurationSec(p.rings, p.speed, p.ringDelay);
    const prog = durSec > 0 ? Math.min(1, this.clockSec / durSec) : 1;
    this.filters.frame(p, prog, dtMs / 1000);
    this.transform.frame(p, prog, dtMs / 1000, this.headX, this.headY);
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
    // Same reasoning as uPal: rebuilt unconditionally rather than diffed. A curve arrives as an array, so a
    // reference-equality check would miss an in-place edit and a deep compare would cost more than the bake.
    u.uRadCurveOn = isIdentityCurve(next.radiusCurve) ? 0 : 1;
    u.uRadLut = radLutFloats(next.radiusCurve);
    u.uRevRing = next.reverse ? 1 : 0;
    this.mesh.blendMode = next.blendMode;
    // Re-placed here and not left to the next `setHead`: dragging an offset slider must move the ring on
    // the same frame the value changes, or the dial reads as laggy — and a preview whose head is never
    // driven would never pick the edit up at all.
    this.place();
    if (radiusChanged) {
      this.writeQuad(next.radius);
      this.geometry.getBuffer('aPosition').update();
    }
  }

  destroy(): void {
    // `Mesh.destroy()` deliberately does NOT cascade to `geometry`/`shader` — it only nulls its own refs
    // (verified by reading its source), so there is no double-free either way. The geometry IS per-instance
    // (its quad is sized to this fire's `radius`) and is freed here. The SHADER goes back to the pool: its
    // GLSL is a module constant, and destroying it with `true` is what cost ~68 ms per fire.
    this.filters.destroy();
    this.mesh.destroy();
    this.geometry.destroy(true); // true = also free the position/UV/index buffers; we own them exclusively
    releaseShader(SHOCKWAVE_SHADER_KEY, this.shader);
  }
}

export const shockwavePrimitive: FxPrimitive<typeof SPECS> = {
  id: 'shockwave',
  params: SPECS,
  spawn: (ctx, params) => new ShockwaveInstance(ctx, params),
};

registerPrimitive(shockwavePrimitive as FxPrimitive);
