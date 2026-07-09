import { Application, Container, Graphics, Mesh, MeshGeometry, Rectangle, Shader, Sprite, Texture, type BLEND_MODES, type Ticker } from 'pixi.js';
import { getTauntConfig } from './tauntConfig';
import { getSmokeConfig } from './smokeConfig';
import { getTrailConfig } from './trailConfig';
import { sfx } from './sfx';

/**
 * Vertex shader for the shield Mesh (WebGL2 / GLSL ES 3.0). Pixi's GlMeshAdaptor binds the global-uniform
 * group (uProjectionMatrix, uWorldTransformMatrix) + the mesh's local-uniform group (uTransformMatrix), so
 * we just declare them and transform the quad; `aUV` (a clean 0..1 from the geometry) feeds the fragment.
 */
const SHIELD_VERT = /* glsl */ `#version 300 es
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
 * The divine-shield bubble fragment shader (WebGL, GLSL ES 3.0 via Pixi's `Filter.from`). Procedural — it
 * ignores the input texture and draws a glassy energy sphere over the filtered quad: a faked-3D sphere
 * normal drives a moving specular glint; a fresnel term lights the rim like curved glass; a scrolling,
 * aspect-corrected HEX force-field grid + drifting value-noise caustics give the "energy" read; everything
 * breathes on `uTime`. Output is premultiplied gold so it tints the unit behind it (see-through center,
 * bright rim). `uColor` lets the same shader serve the future blue Reborn shield.
 */
const SHIELD_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 finalColor;
uniform float uTime;
uniform float uAspect;   // card w/h, so the hex cells stay regular on a tall card
uniform vec3  uColor;    // shield tint (gold for Divine Shield)
uniform float uSeed;     // per-bubble phase offset so neighbours don't pulse in lockstep

// The card silhouette as a closed polygon (quad coords -1..1, y-down). The shield glass fills this MASK —
// replacing the old circular clip — so the bubble conforms to the ARCHED card. Sculpted in the shape editor;
// re-bake from there rather than hand-editing these numbers.
const int NP = 17;
const vec2 PTS[17] = vec2[17](
  vec2( 0.023,-0.795), vec2( 0.349,-0.820), vec2( 0.582,-0.702), vec2( 0.769,-0.509), vec2( 0.853,-0.214),
  vec2( 0.827, 0.140), vec2( 0.842, 0.477), vec2( 0.843, 0.753), vec2( 0.267, 0.840), vec2(-0.292, 0.833),
  vec2(-0.834, 0.803), vec2(-0.843, 0.467), vec2(-0.853, 0.189), vec2(-0.871,-0.164), vec2(-0.797,-0.492),
  vec2(-0.610,-0.702), vec2(-0.322,-0.820)
);
// Soft elliptical cutouts (centre, radius) carving the bubble off the badges: tier pill, attack, medallion, health.
const vec2 CP[4] = vec2[4]( vec2( 0.014,-0.786), vec2(-0.592, 0.761), vec2( 0.005, 0.820), vec2( 0.582, 0.778) );
const vec2 CR[4] = vec2[4]( vec2( 0.410, 0.260), vec2( 0.400, 0.390), vec2( 0.370, 0.360), vec2( 0.470, 0.480) );

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0,0.0)), c = hash(i + vec2(0.0,1.0)), d = hash(i + vec2(1.0,1.0));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
// distance to the nearest edge of a hex cell (flat-top), 0 at centre → ~0.5 at edge
float hexEdge(vec2 p){ p = abs(p); return max(dot(p, vec2(0.5, 0.8660254)), p.x); }
// signed distance to the polygon PTS: <0 inside, 0 on an edge, >0 outside (iq winding-number sdf)
float sdPoly(vec2 p){
  float d = 1e9, s = 1.0;
  for (int i = 0; i < NP; i++){
    int j = (i + NP - 1) % NP;
    vec2 a = PTS[i], b = PTS[j];
    vec2 e = b - a, w = p - a;
    vec2 bb = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    d = min(d, dot(bb, bb));
    bvec3 c = bvec3(p.y >= a.y, p.y < b.y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) s = -s;
  }
  return s * sqrt(d);
}

void main(){
  vec2 uv = vUV;               // clean 0..1 straight from the mesh geometry
  vec2 p = (uv - 0.5) * 2.0;   // -1..1 across the quad
  float sd = sdPoly(p) - 0.010;  // <0 inside the card silhouette; the small subtract rounds the corners

  // MASK: the glass fills the silhouette with a soft (edge-softness) feathered edge, minus the badge cutouts.
  float mask = smoothstep(0.0, -0.110, sd);
  for (int i = 0; i < 4; i++){
    vec2 dd = (p - CP[i]) / max(CR[i], vec2(0.0001));
    mask *= 1.0 - smoothstep(1.0, 0.0, length(dd));
  }
  if (mask <= 0.001) { finalColor = vec4(0.0); return; }

  // faked dome normal (radial proxy) → moving specular glint (sells the glass)
  float d = length(p);
  float z = sqrt(max(0.0, 1.0 - min(d * d, 1.0)));
  vec3 n = vec3(p, z);
  vec3 L = normalize(vec3(-0.45, -0.6, 0.65));
  float spec = pow(max(0.0, dot(reflect(-L, n), vec3(0.0, 0.0, 1.0))), 26.0) * 1.05;

  // fresnel RIM hugging the polygon edge (so it conforms to whatever silhouette is sculpted)
  float rim = exp(-abs(sd) * 5.0) * 1.10;

  // hex force-field: two offset lattices → honeycomb, scrolling + pulsing
  vec2 hp = p * vec2(uAspect, 1.0) * 4.4;
  vec2 cell = vec2(1.0, 1.7320508);
  vec2 h1 = mod(hp, cell) - cell * 0.5;
  vec2 h2 = mod(hp + cell * 0.5, cell) - cell * 0.5;
  vec2 hh = dot(h1, h1) < dot(h2, h2) ? h1 : h2;
  float edge = smoothstep(0.36, 0.5, hexEdge(hh));
  float hexPulse = 0.55 + 0.585 * sin(uTime * 2.08 + (uv.x + uv.y) * 6.0 + uSeed); // +30% speed + swing
  float hex = edge * (0.3 + 0.5 * hexPulse) * 0.40;   // hex opacity

  // drifting energy caustics feed the translucent interior — interior opacity tuned to 0, so the body drops
  // out and the shield reads as a hollow rim+hex+glint glass. (Kept wired so the interior is one dial away.)
  float e = vnoise(p * 3.0 + vec2(uTime * 0.30, -uTime * 0.22) + uSeed)
          + 0.5 * vnoise(p * 6.0 - vec2(uTime * 0.25, uTime * 0.30));
  float energy = 0.12 + 0.22 * e;
  float pulse = 0.85 + 0.195 * sin(uTime * 1.1 * 1.105 + uSeed);   // whole-bubble colour breathe (+30% speed + swing)

  float bodyA = (0.16 + energy * 0.5) * pulse * 0.00;   // translucent interior (tuned OFF)
  float alpha = clamp(bodyA + rim * 0.85 + hex * 0.5, 0.0, 0.92) * mask;

  vec3 col = uColor * (bodyA + rim * 1.3 + hex) * pulse;
  col += vec3(1.0, 0.96, 0.85) * spec * 1.5;              // white-gold specular glint
  col += uColor * rim * 0.6;                              // rim bloom

  finalColor = vec4(col * alpha, alpha);                  // premultiplied
}
`;

/**
 * The REBORN aura fragment shader — the wispy, wraith-spirit sibling of the shield shader. No glassy
 * fresnel rim or hex force-field; instead a hazy translucent body with slow DRIFTING fbm-noise wisps that
 * RISE (like a hovering spirit), brighter tendril streaks, a very soft feathered edge, and a gentle pulse.
 * Premultiplied; `uColor` is a spectral blue. Reuses the same quad + vUV as the shield mesh.
 */
const REBORN_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 finalColor;
uniform float uTime;
uniform float uAspect;
uniform vec3  uColor;
uniform float uSeed;

// The card silhouette traced as a closed polygon OUTLINE (quad coords -1..1, y-down; the quad is the card ×
// the reborn margin, so these points hug the ARCHED card edge — dome top, vertical sides, rounded bottom).
// Sculpted live in the in-chat shape editor; tweak there and re-bake rather than hand-editing these numbers.
const int NP = 15;
const vec2 PTS[15] = vec2[15](
  vec2( 0.021, -0.687), vec2( 0.335, -0.775), vec2( 0.685, -0.539), vec2( 0.804, -0.331),
  vec2( 0.827,  0.140), vec2( 0.842,  0.477), vec2( 0.812,  0.833), vec2( 0.267,  0.840),
  vec2(-0.292,  0.833), vec2(-0.821,  0.807), vec2(-0.843,  0.463), vec2(-0.851,  0.188),
  vec2(-0.851, -0.122), vec2(-0.761, -0.472), vec2(-0.374, -0.761)
);
// Soft elliptical cutouts (centre, radius) that carve the aura off the badges: tier pill, attack, medallion, health.
const vec2 CP[4] = vec2[4]( vec2( 0.014, -0.828), vec2(-0.590, 0.773), vec2(-0.001, 0.813), vec2( 0.566, 0.759) );
const vec2 CR[4] = vec2[4]( vec2( 0.490,  0.410), vec2( 0.600, 0.560), vec2( 0.490, 0.270), vec2( 0.670, 0.630) );

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0,0.0)), c = hash(i + vec2(0.0,1.0)), d = hash(i + vec2(1.0,1.0));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
float fbm(vec2 p){ float v = 0.0, a = 0.55; for (int i = 0; i < 4; i++){ v += a * vnoise(p); p = p * 2.0 + 7.3; a *= 0.5; } return v; }
// signed distance to the polygon PTS: <0 inside, 0 on an edge, >0 outside (iq's winding-number sdf)
float sdPoly(vec2 p){
  float d = 1e9, s = 1.0;
  for (int i = 0; i < NP; i++){
    int j = (i + NP - 1) % NP;
    vec2 a = PTS[i], b = PTS[j];
    vec2 e = b - a, w = p - a;
    vec2 bb = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    d = min(d, dot(bb, bb));
    bvec3 c = bvec3(p.y >= a.y, p.y < b.y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) s = -s;
  }
  return s * sqrt(d);
}

void main(){
  vec2 p = (vUV - 0.5) * 2.0;    // -1..1 over the quad (card edge ≈ the PTS ring; +y is down)
  // the card's arched border, traced as a glowing OUTLINE — hollow centre, the art stays clear.
  float sd = sdPoly(p) - 0.010;  // sd≈0 sits on the edge; the small subtract rounds the polygon corners

  // drifting fbm noise feeds the tendril licks (warp tuned to 0 here → the band itself stays steady)
  vec2 q = p * vec2(uAspect, 1.0);
  float t = uTime * 0.20;
  float n  = fbm(q * 2.6 + vec2(t * 0.5, -t) + uSeed);
  float n2 = fbm(q * 5.2 - vec2(t * 0.8, t * 0.5) + uSeed * 1.9);
  float band = sd;

  float core = exp(-abs(band) * 7.0);   // tight bright outline on the border
  float halo = exp(-abs(band) * 6.0);   // a snug glow hugging the line — hollow centre (far inside → 0)
  // tendrils: noise-driven licks, GATED to the border (exp on |band|) so they don't fill the centre
  float tend = smoothstep(0.46, 0.9, n + 0.25 * n2) * exp(-abs(band) * 3.0);

  float pulse = 0.85 + 0.15 * sin(uTime * 1.1 + uSeed);
  float lit = (core * 0.9 + halo * 0.45 + tend * 0.8) * pulse;
  float fade = smoothstep(0.99, 0.55, max(abs(p.x), abs(p.y))); // don't clip hard at the quad edge
  float alpha = clamp(lit * fade, 0.0, 0.40);

  // CARVE the aura away from each badge so it doesn't glow over them — soft elliptical cutouts in quad space.
  float cut = 0.0;
  for (int i = 0; i < 4; i++){
    vec2 dd = (p - CP[i]) / max(CR[i], vec2(0.0001));
    cut = max(cut, smoothstep(1.0, 0.0, length(dd)));
  }
  alpha *= 1.0 - cut;

  // stay SATURATED blue (uColor-dominant); only a soft bright core, not a white wash
  vec3 col = uColor * (core * 0.9 + halo * 0.85 + tend * 1.2);
  col += vec3(0.82, 0.92, 1.0) * core * 0.4;
  finalColor = vec4(col * alpha, alpha);                   // premultiplied
}
`;

/**
 * The Taunt bulwark fragment shader — a silver-metallic heater/kite shield drawn BEHIND the card (so its
 * rim + central gem peek out around the frame). Procedural: a heater silhouette SDF gives a beveled chrome
 * rim (faux-3D normal from the SDF gradient + a sweeping specular glint), a brushed-steel inner field, and
 * a faceted silver gem core. `uColor` is the silver tint (lets the look be retinted live in DEV). No
 * see-through center — it's solid metal — but it sits behind the card so only the border shows.
 */
const TAUNT_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 finalColor;
uniform float uTime;
uniform float uAspect;   // card w/h (kept for parity)
uniform vec3  uColor;    // silver tint (live-tunable in DEV)
uniform float uSeed;     // per-bubble phase offset
uniform float uTopY;     // heater silhouette: top edge
uniform float uBotY;     // heater silhouette: bottom point
uniform float uHalfW;    // heater silhouette: shoulder half-width
uniform float uWidthPow; // width taper exponent toward the bottom point
uniform float uRimW;     // bevel/rim band width
uniform float uGemSize;  // central gem size (0 = none)
uniform float uGlintSpeed; // glint sweep speed

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0,0.0)), c = hash(i + vec2(0.0,1.0)), d = hash(i + vec2(1.0,1.0));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
// Heater/kite shield silhouette. q: x in [-1,1], y UP (+1 top, -1 bottom). <0 inside. Shape from uniforms.
float shieldSDF(vec2 q){
  float topY = uTopY, botY = uBotY;
  float t = clamp((q.y - botY) / (topY - botY), 0.0, 1.0);   // 0 bottom → 1 top
  float hw = uHalfW * pow(t, uWidthPow);                      // 0 at the bottom point → wide shoulders
  hw *= 1.0 - 0.16 * smoothstep(0.72, 1.0, t);               // slight inward at the very top (rounded shoulders)
  float notch = (1.0 - smoothstep(0.0, 0.16, abs(q.x))) * 0.07; // central V dip in the top edge
  float top = topY - notch;
  float dx = abs(q.x) - hw;
  float dy = max(q.y - top, botY - q.y);
  return length(max(vec2(dx, dy), 0.0)) + min(max(dx, dy), 0.0);
}
void main(){
  vec2 p = (vUV - 0.5) * 2.0;
  vec2 q = vec2(p.x, -p.y);                 // y up
  float d = shieldSDF(q);
  if (d > 0.02) { finalColor = vec4(0.0); return; }

  // bevel: rim band from the outer edge inward; faux-3D normal from the SDF gradient
  float e = 0.004;
  vec2 grad = vec2(shieldSDF(q + vec2(e,0.0)) - shieldSDF(q - vec2(e,0.0)),
                   shieldSDF(q + vec2(0.0,e)) - shieldSDF(q - vec2(0.0,e)));
  float rimW = uRimW;
  float rim = smoothstep(0.0, rimW, -d);    // 0 at edge → 1 past the rim
  float bevel = 1.0 - rim;                   // 1 at the very edge
  vec3 n = normalize(vec3(grad * bevel * 2.4, 1.0));
  vec3 L = normalize(vec3(-0.5, 0.62, 0.6));
  float diff = clamp(dot(n, L), 0.0, 1.0);
  vec3 H = normalize(L + vec3(0.0,0.0,1.0));
  float spec = pow(max(dot(n, H), 0.0), 40.0);
  // a bright glint sweeping across the metal
  float sweep = smoothstep(0.07, 0.0, abs(fract(uTime * uGlintSpeed + uSeed) - (q.x * 0.5 + 0.5)));
  spec += sweep * bevel * 0.7;

  // brushed-steel inner field
  float brush = vnoise(vec2(q.x * 3.0, q.y * 42.0)) * 0.1;
  float field = 0.6 + brush;

  // faceted silver gem (a diamond in the centre)
  vec2 g = q * vec2(1.0, 1.3);
  float gemD = abs(g.x) + abs(g.y - 0.04) - uGemSize;
  float gem = smoothstep(0.02, -0.02, gemD);
  float ang = atan(g.y - 0.04, g.x);
  float facet = 0.5 + 0.5 * cos(floor(ang / 1.0472) * 1.0472);   // 6 facets
  float gemShade = mix(0.55, 1.1, facet);
  float gemGlint = pow(max(0.0, sin(ang * 3.0 + uTime * 0.6 + uSeed)), 8.0);

  vec3 silver = uColor;
  vec3 col = silver * (field * (0.5 + diff * 0.7));        // lit brushed field
  col += silver * bevel * (0.5 + diff * 0.9);              // chrome rim highlight
  col += vec3(1.0) * spec * 1.3;                           // white-hot glint
  col = mix(col, silver * gemShade + vec3(1.0) * gemGlint * 0.55, gem * 0.92); // gem core
  // dark groove between rim and field
  float groove = smoothstep(rimW * 0.9, rimW * 1.04, -d) - smoothstep(rimW * 1.04, rimW * 1.45, -d);
  col *= 1.0 - groove * 0.4;

  float alpha = smoothstep(0.02, -0.012, d);              // solid shield, AA edge
  finalColor = vec4(col * alpha, alpha);                  // premultiplied
}
`;

/**
 * The WebGL effects layer — a single transparent PixiJS overlay stretched over the whole
 * viewport, drawing the *juice* that DOM/CSS does poorly (particle bursts, impact flashes)
 * on the GPU compositor. It does NOT render the board, cards, or layout — React/DOM still
 * owns all of that. The overlay reads the same viewport coordinates the combat replay
 * already measures via `getBoundingClientRect`, so effects land exactly on units.
 *
 * This is the foundation a future Pixi combat arena grows out of (the `Application`/`stage`
 * is reused, not re-bootstrapped): effects first → combat sprites → full arena, each step
 * shippable. For now it's purely additive — `main` stays playable.
 *
 * Math.random is used freely here for spread/jitter — the engine RNG ban is `core`/`content`/
 * `sim` only; this is presentation.
 */

/** One live particle, pooled. Position is in CSS/viewport pixels (1:1 with the stage). */
interface Particle {
  sprite: Sprite;
  x: number;
  y: number;
  vx: number; // px/sec
  vy: number;
  drag: number; // velocity multiplier per second (<1 = decelerate)
  life: number; // ms remaining
  maxLife: number;
  fromScale: number;
  toScale: number;
  spin: number; // rad/sec
  peakAlpha: number; // opacity at birth; fades to 0 over life (smoke is semi-transparent)
  gravity: number;   // downward accel px/sec² (coins arc up then fall); 0 = none
  stretchX: number;  // X-axis scale multiplier (1 = uniform) — elongates streak wisps along their heading
}

/** A live Deathrattle skull "pop" — the whole bone skull-and-crossbones scaling in with an elastic
 *  overshoot; when its pop+hold elapses it BURSTS into fragment/splinter/smoke particles (see `burstSkull`). */
interface SkullPop { sprite: Sprite; x: number; y: number; scale: number; age: number; }

// Deathrattle skull-shatter feel — baked from the DEV preview (apps/web/public/fx/skull-shatter-preview.html);
// tune these constants directly (no live tuner, by design).
const DR_SKULL_SCALE = 0.375; // skull display width ÷ the dying unit's card width
const DR_POP = 0.45;        // pop bounce + duration
const DR_SPREAD = 1.85;     // how far fragments + splinters fly
const DR_SPLINTERS = 0.45;  // bone-splinter count multiplier (owner: less debris)
const DR_SMOKE = 0.75;      // smoke plume amount
const DR_GRID = 6;          // shatter fragment grid (cells per axis) — fewer, chunkier pieces (owner: less debris)

/**
 * A persistent divine-shield bubble bound to one unit (by uid). Unlike particles (fire-and-forget),
 * it lives until the shield breaks or is cleared, breathing on the ticker and tracking the unit's
 * on-screen rect. The React layers measure the rect and push it via `setShield`; this stays DOM-agnostic.
 */
/** Which flavour of persistent aura — gold glassy Divine Shield, blue wispy Reborn spirit, or the silver
 *  metal Taunt bulwark (the only one drawn BEHIND the card). */
type AuraKind = 'shield' | 'reborn' | 'taunt';

interface ShieldBubble {
  kind: AuraKind;        // picks the shader + break/pop colour
  container: Container;
  mesh: Mesh;            // a quad mesh the aura shader draws onto (clean 0..1 UVs)
  shader: Shader;        // the per-bubble aura shader (its uTime/uAspect animate each frame)
  cx: number; cy: number; // target center (viewport px)
  w: number; h: number;   // target footprint (the card's size)
  age: number;            // ms lived — drives the breathe phase + vein drift
  formIn: number;         // ms elapsed of the grow-in (clamped at FORM_MS)
  fadeOut: number;        // ms elapsed of a graceful clear (−1 = not fading)
  mini: boolean;          // true while the card is being dragged → shrink to a small trailing sparkle
  pop: number;            // ms elapsed of the coalesce/pop-in on placement (−1 = not popping)
  scaleMul: number;       // current size multiplier (lerps toward 1 or MINI_SCALE; the pop drives it directly)
  rot: number;            // current rotation (rad) — matches the card's live transform (lunge tilt) when tracking
  /** Optional live position source, called every FX frame right before render — lets the bubble measure its
   *  card in Pixi's OWN frame (after GSAP applies the lunge/recoil transform + rotation), so a fast-moving unit's
   *  aura never trails or un-rotates from the card. Returns null when the card isn't measurable (keeps the last). */
  track: (() => { cx: number; cy: number; w: number; h: number; rot: number } | null) | null;
}

// Shield-bubble feel (tunable live via window.__pixiFx in DEV). The shield shader draws into a quad of
// half-size BUBBLE_TEX_R; the container is scaled per-unit to fit the card's footprint.
const BUBBLE_TEX_R = 40;       // shader quad half-size (px) before per-unit scaling
const PULSE_TEX_R = 50;        // impact pulse-ring texture radius (px); callers scale wantedRadius / PULSE_TEX_R
const BREATHE_MS = 2600;       // slow pulse period (the shader also breathes on its own clock)
const FORM_MS = 260;           // grow-in when a shield is gained
const FADE_MS = 30;            // graceful fade when a shield is cleared without breaking (near-instant)
const MINI_SCALE = 0.3;        // bubble size while dragging (a small trailing sparkle of the card)
const POP_MS = 320;            // coalesce/pop-in duration when a dragged card is placed
const SHIELD_GOLD_RGB = [1.0, 0.89, 0.36]; // Divine-Shield shader tint, tuned in the shape editor
const REBORN_BLUE_RGB = [0.32, 0.59, 1.0]; // Reborn wisp tint (spectral blue), tuned in the shape editor
const TAUNT_SILVER_RGB = [0.80, 0.84, 0.90]; // Taunt bulwark — bright brushed silver/steel
/** Per-kind aura config: the fragment shader, base colour, and footprint margin (shield sits INSIDE the
 *  card frame; reborn rides slightly PROUD of it; taunt is BIGGER + drawn behind, so its heater silhouette
 *  peeks out around the card edges). `behind: true` routes the aura to the back FX layer. */
const AURA: Record<AuraKind, { frag: string; rgb: number[]; tint: number; rimTint: number; margin: number; behind?: boolean }> = {
  shield: { frag: SHIELD_FRAG, rgb: SHIELD_GOLD_RGB, tint: 0xffd24a, rimTint: 0xffe9a8, margin: 1.16 },
  reborn: { frag: REBORN_FRAG, rgb: REBORN_BLUE_RGB, tint: 0x6ab0ff, rimTint: 0xbfe2ff, margin: 1.16 },
  taunt: { frag: TAUNT_FRAG, rgb: TAUNT_SILVER_RGB, tint: 0xcfd6e2, rimTint: 0xeef2f8, margin: 1.28, behind: true },
};
const auraKey = (kind: AuraKind, uid: string): string => `${kind}|${uid}`;
/** Footprint margin for an aura — taunt's is live-tunable (DEV taunt tuner), the rest are static. */
const auraMargin = (kind: AuraKind): number => (kind === 'taunt' ? getTauntConfig().margin : AURA[kind].margin);

class FxController {
  private app: Application | null = null;
  private layer: Container | null = null;
  private ready = false;
  private initing: Promise<void> | null = null;
  private sparkTex: Texture | null = null;
  private glowTex: Texture | null = null;
  private shardRectTex: Texture | null = null; // jagged spark: elongated rectangle
  private shardTriTex: Texture | null = null;   // jagged spark: triangle
  private coinTex: Texture | null = null;       // gold coin (sell sprinkle)
  private bubbleTex: Texture | null = null;     // soft translucent disc — shield body
  private rimTex: Texture | null = null;        // bright ring — shield rim highlight
  private pulseTex: Texture | null = null;      // thin bright ring — the combat impact energy pulse
  private veinTex: Texture | null = null;       // thin streak — shield energy vein
  private wispTex: Texture | null = null;
  private skullTex: Texture | null = null;         // the alpha-keyed bone skull-and-crossbones (Deathrattle FX)
  private skullSrcW = 1;
  private skullSrcH = 1;
  private skullFrags: { tex: Texture; dx: number; dy: number }[] = []; // grid sub-textures + px offset from center
  private readonly skullPops: SkullPop[] = [];
  private shieldLayer: Container | null = null; // holds the persistent bubbles, beneath the particle layer
  private shieldApp: Application | null = null;  // OPTIONAL 2nd canvas for the persistent bubbles, mounted at a
  private underParent: HTMLElement | null = null; // low z (below the card badges) so the chrome reads on top; the
  //                                                 break burst still fires on the main (z110) canvas, over them.
  private shieldGeo: MeshGeometry | null = null; // shared quad geometry (−R..R, uv 0..1) for every bubble mesh
  private readonly shields = new Map<string, ShieldBubble>();
  private readonly live: Particle[] = [];
  private readonly pool: Sprite[] = [];

  /** Mount the overlay canvas into `parent` (a fixed, full-viewport, pointer-events:none div).
   *  Lazily creates the PixiJS Application on first call and reuses it thereafter. */
  attach(parent: HTMLElement, underParent?: HTMLElement): Promise<void> {
    if (typeof window === 'undefined') return Promise.resolve(); // SSR guard
    if (this.app) {
      parent.appendChild(this.app.canvas); // re-mount the existing canvas (e.g. after a remount)
      if (this.shieldApp && underParent) underParent.appendChild(this.shieldApp.canvas);
      return Promise.resolve();
    }
    this.underParent = underParent ?? null;
    if (this.initing) return this.initing;
    this.initing = this.init(parent).catch((e) => {
      // A failed init (e.g. no WebGL context) otherwise fails silently and every impact() no-ops.
      console.error('[pixiFx] overlay init failed — effects disabled:', e);
    });
    return this.initing;
  }

  private async init(parent: HTMLElement): Promise<void> {
    const app = new Application();
    await app.init({
      resizeTo: window,
      backgroundAlpha: 0, // transparent — it's an overlay
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
      preference: 'webgl',
      powerPreference: 'high-performance',
    });
    // The replay may have remounted before init resolved; only attach if still wanted.
    const canvas = app.canvas;
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.pointerEvents = 'none';
    canvas.style.display = 'block';
    parent.appendChild(canvas);

    const shieldLayer = new Container();
    const layer = new Container();
    app.stage.addChild(layer);

    // If an under-parent was provided, the persistent bubbles render on a SEPARATE canvas mounted at a low
    // z-index (below the card badges), so attack/health/tier/effect chrome always reads over the shield —
    // while the break burst (shards/flash) stays on THIS main canvas (z110) and still draws over the chrome.
    // The bubble mesh is procedural (no textures), so it renders cleanly in the second GL context.
    if (this.underParent) {
      const sApp = new Application();
      await sApp.init({
        resizeTo: window, backgroundAlpha: 0, antialias: true, autoDensity: true,
        resolution: window.devicePixelRatio || 1, preference: 'webgl', powerPreference: 'high-performance',
      });
      const sc = sApp.canvas;
      sc.style.position = 'absolute'; sc.style.top = '0'; sc.style.left = '0';
      sc.style.pointerEvents = 'none'; sc.style.display = 'block';
      this.underParent.appendChild(sc);
      sApp.stage.addChild(shieldLayer);
      this.shieldApp = sApp;
    } else {
      // Single-canvas mode (e.g. the taunt back layer): bubbles beneath the particle layer on the same canvas.
      app.stage.addChildAt(shieldLayer, 0);
    }

    this.app = app;
    this.layer = layer;
    this.shieldLayer = shieldLayer;
    // shared centred quad (−R..R) with 0..1 UVs — every bubble mesh reuses it; the container scales it per-unit
    this.shieldGeo = new MeshGeometry({
      positions: new Float32Array([-BUBBLE_TEX_R, -BUBBLE_TEX_R, BUBBLE_TEX_R, -BUBBLE_TEX_R, BUBBLE_TEX_R, BUBBLE_TEX_R, -BUBBLE_TEX_R, BUBBLE_TEX_R]),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });
    this.sparkTex = this.makeSparkTexture(app);
    this.glowTex = this.makeGlowTexture(app);
    this.shardRectTex = this.makeShardRectTexture(app);
    this.shardTriTex = this.makeShardTriTexture(app);
    this.coinTex = this.makeCoinTexture(app);
    this.bubbleTex = this.makeBubbleTexture(app);
    this.rimTex = this.makeRimTexture(app);
    this.pulseTex = this.makePulseRingTexture(app);
    this.veinTex = this.makeVeinTexture(app);
    this.wispTex = this.makeWispTexture(app);
    void this.loadSkull(); // async: the Deathrattle bone skull, alpha-keyed + grid-sliced for the shatter
    app.ticker.add(this.update);
    this.ready = true;
  }

  /** Remove the canvas from the DOM and tear the app down. */
  detach(): void {
    if (!this.app) return;
    for (const p of this.live) p.sprite.destroy();
    this.live.length = 0;
    this.pool.length = 0;
    for (const s of this.skullPops) s.sprite.destroy();
    this.skullPops.length = 0;
    for (const f of this.skullFrags) f.tex.destroy();
    this.skullFrags.length = 0;
    this.skullTex?.destroy(true);
    this.skullTex = null;
    for (const b of this.shields.values()) { b.shader.destroy(); b.container.destroy({ children: true }); }
    this.shields.clear();
    this.shieldGeo?.destroy();
    this.shieldGeo = null;
    this.app.ticker.remove(this.update);
    this.app.destroy({ removeView: true, releaseGlobalResources: true }, { children: true });
    if (this.shieldApp) {
      this.shieldApp.destroy({ removeView: true, releaseGlobalResources: true }, { children: true });
      this.shieldApp = null;
    }
    this.app = null;
    this.layer = null;
    this.shieldLayer = null;
    this.sparkTex = null;
    this.glowTex = null;
    this.shardRectTex = null;
    this.shardTriTex = null;
    this.coinTex = null;
    this.bubbleTex = null;
    this.rimTex = null;
    this.pulseTex = null;
    this.veinTex = null;
    this.wispTex = null;
    this.ready = false;
    this.initing = null;
  }

  /**
   * A melee/projectile contact at viewport point (x, y): a white-hot flash plus a spray of
   * sparks fired outward, biased along the blow direction (dx, dy = attacker→defender vector,
   * any magnitude). No-op until the app has finished initialising.
   *
   * `power` scales the whole burst with the hit's weight (1 = the baseline look): flash size, spark
   * count/speed, smoke density — and past ~1.15 a crisp expanding RING ripples out, so a heavy swing
   * visibly lands harder than a 1-damage chip. Callers map damage → power (see `hitPower`).
   */
  impact(x: number, y: number, dx: number, dy: number, power = 1): void {
    if (!this.ready) return;
    // Blow direction (unit vector); fall back to "up" if attacker/defender coincide.
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;

    // A burst of saturated colour, NORMAL blend, so the impact reads on the light "Sunward" cream
    // board (additive would just brighten cream toward white — near-invisible). A bright additive
    // core layers on top for the hot-glow pop.

    // Hot core flash — additive, brief, for the white-hot glint at the moment of contact.
    this.spawn(this.glowTex!, {
      x, y, vx: 0, vy: 0, drag: 1, life: 220, fromScale: 0.5, toScale: 2.6 * power, spin: 0,
      tint: 0xffe6b0, blend: 'add',
    });
    // Coloured shockwave — normal blend, a saturated orange flash that actually paints over cream.
    this.spawn(this.glowTex!, {
      x, y, vx: 0, vy: 0, drag: 1, life: 300, fromScale: 0.3, toScale: 2.1 * power, spin: 0,
      tint: 0xff6a1e, blend: 'normal',
    });
    // Heavy hits (power ≳ 1.15) ripple a crisp expanding RING out of the contact — the "that one hurt"
    // punctuation a soft glow can't give. Ring size/opacity track the overage so it ramps, not toggles.
    if (power >= 1.15) {
      const over = Math.min(1, (power - 1.15) / 0.85); // 0 at threshold → 1 at max power
      this.spawn(this.rimTex!, {
        x, y, vx: 0, vy: 0, drag: 1, life: 340 + over * 140,
        fromScale: 0.25, toScale: 1.6 + over * 1.6, spin: 0,
        tint: 0xffb054, blend: 'add', peakAlpha: 0.55 + over * 0.4,
      });
    }

    // Sparks — jagged saturated shards (rectangles + triangles, not soft dots), fanning out within
    // ±63° of the blow direction and oriented ALONG their travel so they read as flung debris. Normal
    // blend + hot colours so they contrast the bright background. Size carries a +20% visibility boost.
    const VIS = 1.2; // +20% spark visibility (size)
    const count = Math.round(16 * (0.7 + 0.3 * power)); // more shrapnel on heavier hits
    for (let i = 0; i < count; i++) {
      const spread = (Math.random() - 0.5) * (Math.PI * 0.7);
      const cos = Math.cos(spread);
      const sin = Math.sin(spread);
      const dirX = ux * cos - uy * sin;
      const dirY = ux * sin + uy * cos;
      const speed = (320 + Math.random() * 620) * (0.85 + 0.15 * power); // px/sec — flung harder when heavy
      const warm = Math.random();
      const tint = warm < 0.45 ? 0xff5a14 : warm < 0.8 ? 0xff9d20 : 0xffd24a;
      // alternate shard shapes; orient along velocity with a little jitter so the burst looks ragged
      const tex = Math.random() < 0.5 ? this.shardRectTex! : this.shardTriTex!;
      const angle = Math.atan2(dirY, dirX) + (Math.random() - 0.5) * 0.5;
      this.spawn(tex, {
        x, y,
        vx: dirX * speed,
        vy: dirY * speed,
        drag: 0.1, // strong decel — sparks burst then settle
        life: 360 + Math.random() * 340,
        fromScale: (0.9 + Math.random() * 0.7) * VIS,
        toScale: 0.05,
        spin: (Math.random() - 0.5) * 8,
        rotation: angle,
        tint, blend: 'normal',
      });
    }

    // Smoke — a few soft warm-grey puffs that rise, expand, and fade. Normal blend + low peak alpha
    // so they tint the cream board like a wisp rather than blasting it; slow + long-lived so they
    // linger after the sparks have burned out.
    const sm = getSmokeConfig(); // live-tunable (DEV Smoke tuner); defaults reproduce the original look
    const puffs = Math.round(sm.smokeCount * (0.75 + 0.25 * power)); // a touch thicker on heavy hits
    for (let i = 0; i < puffs; i++) {
      const driftX = (Math.random() - 0.5) * sm.smokeDrift; // gentle horizontal spread
      const rise = -sm.smokeRise * (0.53 + Math.random() * 0.93); // drift upward, varied
      const grey = Math.random() < 0.5 ? 0x9c9088 : 0x847a70; // warm smoke greys
      this.spawn(this.glowTex!, {
        x: x + (Math.random() - 0.5) * 22,
        y: y + (Math.random() - 0.5) * 22,
        vx: driftX,
        vy: rise,
        drag: 0.5,                 // slows as it billows
        life: sm.smokeLife * (1 + Math.random() * 0.77),
        fromScale: 0.4 + Math.random() * 0.3,
        toScale: sm.smokeGrow * (0.81 + Math.random() * 0.38), // expands as it dissipates
        spin: (Math.random() - 0.5) * 1.5,
        tint: grey,
        blend: 'normal',
        peakAlpha: sm.smokeAlpha * (0.82 + Math.random() * 0.35), // wispy, semi-transparent
      });
    }
  }

  /**
   * Combat impact DUST — a card-drop-style tan billow erupting radially from the corner clack point (x, y).
   * Same warm dry-dirt look as `dust()`, but sourced at a point (not a card perimeter) and driven by its own
   * `imp*` config so it can be tuned independently of the card-drop dust. `power` thickens it a touch on
   * heavy hits. Fired from the melee `contact` position (see `impact.ts`).
   */
  impactDust(x: number, y: number, power = 1): void {
    if (!this.ready) return;
    const sm = getSmokeConfig();
    const n = Math.round(sm.impDustCount * (0.8 + 0.2 * power));
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const speed = sm.impDustSpeed * (0.45 + Math.random() * 0.9);
      const tan = Math.random() < 0.5 ? 0xc9b48f : 0xb8a079; // dry-dirt tans (matches dust())
      const scale = (sm.impDustSize / 40) * (0.7 + Math.random() * 0.6); // glowTex natural radius ≈ 40px
      this.spawn(this.glowTex!, {
        x: x + (Math.random() - 0.5) * 8,
        y: y + (Math.random() - 0.5) * 8,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed * 0.7 - (4 + Math.random() * 12), // vertical damped + slight lift → stays flat
        drag: 0.2,       // dust slows quickly
        gravity: 130,    // gentle settle — no rising column
        life: sm.impDustLife * (0.8 + Math.random() * 0.5),
        fromScale: scale * 0.35,
        toScale: scale, // billow out as it fades
        spin: (Math.random() - 0.5) * 1.2,
        tint: tan,
        blend: 'normal',
        peakAlpha: 0.34 * (0.8 + Math.random() * 0.4),
      });
    }
  }

  /**
   * Combat impact PULSE — one or two thin bright energy rings that expand out of the clack point (x, y) and
   * fade, an additive "shock" punctuation on every hit. Radius / lifetime / ring-count are `imp*` config;
   * `power` nudges the radius on heavy hits. Fired from the melee `contact` position (see `impact.ts`).
   */
  impactPulse(x: number, y: number, power = 1): void {
    if (!this.ready || !this.pulseTex) return;
    const sm = getSmokeConfig();
    if (sm.impPulseRings < 1) return;
    const radius = sm.impPulseRadius * (0.9 + 0.1 * power);
    this.spawn(this.pulseTex, {
      x, y, vx: 0, vy: 0, drag: 1, life: sm.impPulseDur,
      fromScale: 0.2, toScale: radius / PULSE_TEX_R, spin: 0,
      tint: 0xfff0d0, blend: 'add', peakAlpha: 0.85, // warm white-hot energy
    });
    if (sm.impPulseRings >= 2) {
      this.spawn(this.pulseTex, {
        x, y, vx: 0, vy: 0, drag: 1, life: sm.impPulseDur * 0.9,
        fromScale: 0.15, toScale: (radius / PULSE_TEX_R) * 0.78, spin: 0,
        tint: 0xffd24a, blend: 'add', peakAlpha: 0.6,
      });
    }
  }

  /**
   * A sprinkle of gold coins bursting up out of point (x, y) and arcing back down under gravity —
   * the income flourish when a minion is sold (fired from the Gold counter's screen position).
   */
  coins(x: number, y: number): void {
    if (!this.ready) return;
    const count = 9;
    for (let i = 0; i < count; i++) {
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * 1.15; // up, fanned ±33°
      const speed = 380 + Math.random() * 320;                 // punchier upward launch
      const fs = 0.7 + Math.random() * 0.45;
      this.spawn(this.coinTex!, {
        x: x + (Math.random() - 0.5) * 18,
        y: y + (Math.random() - 0.5) * 8,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed, // negative → pops upward
        drag: 0.85,                // light air damping; gravity dominates the vertical
        gravity: 1700,             // pull the higher launch back down within its life
        life: 700 + Math.random() * 400,
        fromScale: fs,
        toScale: fs * 0.85,        // hold roughly its size (coins don't shrink to nothing)
        spin: (Math.random() - 0.5) * 18,
        tint: 0xffffff,            // the texture is already gold
        blend: 'normal',
      });
    }
  }

  /**
   * A puff of dry-dirt dust ringing a card's footprint (cx/cy = card center, w/h = its size) —
   * like a flat stone dropped into dust. Fired when a minion is placed on / moved across the board.
   * Puffs spawn around the card's perimeter and billow **outward** (away from the card), hugging the
   * ground (vertical motion damped, gentle gravity) and fading fast — dusty tan on normal blend, low
   * alpha so it stays subtle. The caller raises the landed card above the FX layer for the duration,
   * so the dust reads as escaping out from *under* the card on every side. `scale` (default 1) inflates the
   * whole plume — both the ring spread and the puff sizes — for a bigger billow (taunt deploy passes >1).
   * `density` (default 1) multiplies the puff COUNT for a thicker cloud without changing its size.
   */
  dust(cx: number, cy: number, w: number, h: number, scale = 1, density = 1): void {
    if (!this.ready) return;
    const sm = getSmokeConfig(); // live-tunable (DEV Smoke tuner); defaults reproduce the original look
    const halfW = w * 0.5 * scale;
    const halfH = h * 0.5 * scale;
    const puffs = Math.max(1, Math.round(sm.dustCount * density));
    for (let i = 0; i < puffs; i++) {
      const ang = (i / puffs) * Math.PI * 2 + (Math.random() - 0.5) * 0.4; // around the ring
      const dx = Math.cos(ang);
      const dy = Math.sin(ang);
      // project the direction onto the card's rectangular edge so puffs start at the card's border
      const edge = 1 / Math.max(Math.abs(dx) / halfW, Math.abs(dy) / halfH);
      const ex = cx + dx * edge;
      const ey = cy + dy * edge;
      const speed = sm.dustSpeed * (0.42 + Math.random());
      const tan = Math.random() < 0.5 ? 0xc9b48f : 0xb8a079; // dry-dirt tans
      this.spawn(this.glowTex!, {
        x: ex + (Math.random() - 0.5) * 8,
        y: ey + (Math.random() - 0.5) * 8,
        vx: dx * speed,
        vy: dy * speed * 0.45 - (4 + Math.random() * 14), // vertical damped + a slight lift → stays flat
        drag: 0.2,                                         // dust slows quickly
        gravity: 130,                                      // gentle settle — no rising column
        life: sm.dustLife * (1 + Math.random() * 0.68),
        fromScale: (0.3 + Math.random() * 0.2) * scale,
        toScale: sm.dustGrow * (0.75 + Math.random() * 0.42) * scale, // billow as it dissipates
        spin: (Math.random() - 0.5) * 1.2,
        tint: tan,
        blend: 'normal',
        peakAlpha: sm.dustAlpha * (0.78 + Math.random() * 0.47),
      });
    }
  }

  /**
   * A tiny dust puff at a single point (x, y) — the dry-dirt motes kicked up where the mouse taps the
   * empty board. A much smaller sibling of `dust()`: a handful of tan puffs burst outward from the point,
   * hug the ground (vertical motion damped, gentle gravity), and fade fast. Purely tactile feedback.
   */
  clickPuff(x: number, y: number): void {
    if (!this.ready) return;
    const SIZE = 1.2; // puff size (1.0 = base); +20% per owner request
    const puffs = 7;
    for (let i = 0; i < puffs; i++) {
      const ang = (i / puffs) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const dx = Math.cos(ang);
      const dy = Math.sin(ang);
      const speed = 26 + Math.random() * 46; // gentle — a small kick, not a billow
      const tan = Math.random() < 0.5 ? 0xc9b48f : 0xb8a079; // dry-dirt tans (match the card-landing dust)
      this.spawn(this.glowTex!, {
        x: x + (Math.random() - 0.5) * 4,
        y: y + (Math.random() - 0.5) * 4,
        vx: dx * speed,
        vy: dy * speed * 0.5 - (3 + Math.random() * 7), // vertical damped + a slight lift → stays flat
        drag: 0.18,                                      // settles quickly
        gravity: 120,
        life: 260 + Math.random() * 180,
        fromScale: (0.14 + Math.random() * 0.1) * SIZE,
        toScale: (0.5 + Math.random() * 0.28) * SIZE,    // billow a touch but stay small
        spin: (Math.random() - 0.5) * 1.2,
        tint: tan,
        blend: 'normal',
        peakAlpha: 0.16 + Math.random() * 0.1,           // subtle
      });
    }
  }

  /**
   * One step of a motion trail behind a moving card — a wind-whoosh wisp left at (x, y), oriented along
   * the movement vector (dx, dy). Callers distance-gate on `getTrailConfig().emitSpacing` (the drag rAF
   * handler + the combat lunge's onUpdate), so emission density tracks speed — no movement, no trail.
   * `variant` picks the look: `'wind'` = pale cream (normal blend); `'gold'` = Divine Shield; `'blue'` =
   * Reborn — both tinted + additive with an occasional glint mote. The variant replaces the wind, never layers.
   */
  trail(x: number, y: number, dx: number, dy: number, variant: 'wind' | 'gold' | 'blue'): void {
    if (!this.ready) return;
    const c = getTrailConfig();
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const angle = Math.atan2(uy, ux) + (Math.random() - 0.5) * 0.16;
    // left behind the card: a touch of backward velocity + lateral drift (displaced air swirling off)
    const back = 30 + Math.random() * 40;
    const side = (Math.random() - 0.5) * 2 * c.drift;
    const special = variant !== 'wind'; // gold/blue are tinted + additive with a glint; wind is pale + normal
    const tint = variant === 'gold' ? 0xffe9a8 : variant === 'blue' ? 0x8ec7ff : 0xf5efe0;
    const peak = variant === 'gold' ? c.goldAlpha : variant === 'blue' ? c.blueAlpha : c.alpha;
    this.spawn(this.wispTex!, {
      x: x - ux * 8 + (Math.random() - 0.5) * 6,
      y: y - uy * 8 + (Math.random() - 0.5) * 6,
      vx: -ux * back + -uy * side,
      vy: -uy * back + ux * side,
      drag: 0.3, // the whoosh settles quickly
      life: c.lifeMs * (0.8 + Math.random() * 0.4),
      fromScale: c.size * (0.85 + Math.random() * 0.3),
      toScale: 0.05,
      spin: 0,
      rotation: angle,
      stretchX: c.stretch,
      tint,
      blend: special ? 'add' : 'normal',
      peakAlpha: peak * (0.85 + Math.random() * 0.3),
    });
    // gold/blue only: an occasional tiny glint mote, mimicking the aura's glassy sparkle
    if (special && Math.random() < c.sparkChance) {
      this.spawn(this.sparkTex!, {
        x: x + (Math.random() - 0.5) * 14,
        y: y + (Math.random() - 0.5) * 14,
        vx: -ux * back * 0.5 + (Math.random() - 0.5) * 30,
        vy: -uy * back * 0.5 + (Math.random() - 0.5) * 30,
        drag: 0.3,
        life: c.lifeMs * 0.8,
        fromScale: 0.5 + Math.random() * 0.4,
        toScale: 0.05,
        spin: 0,
        tint: variant === 'blue' ? 0xdfefff : 0xffd24a,
        blend: 'add',
        peakAlpha: 0.9,
      });
    }
  }

  /**
   * A blast bolt streaking from (fromX, fromY) to (toX, toY) — a comet of glow motes that all travel to
   * the target, tightening into a head, so it reads as a hurled projectile with a trail. Used for the
   * loss-damage blast (the assembled damage number hurled into the Resolve bar). The caller fires
   * `damageBurst` at the target when the bolt arrives (travel ≈ `blastTravelMs` below).
   */
  blastBolt(fromX: number, fromY: number, toX: number, toY: number): void {
    if (!this.ready) return;
    const dx = toX - fromX;
    const dy = toY - fromY;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist;
    const uy = dy / dist;
    const nx = -uy; // perpendicular, for trail spread
    const ny = ux;
    const TRAVEL = 0.34; // seconds to reach the target (no drag, so dist = speed × life)
    const head = dist / TRAVEL; // px/sec to arrive in TRAVEL
    const motes = 16;
    for (let i = 0; i < motes; i++) {
      const t = i / motes; // 0 = head, 1 = tail
      const speed = head * (1 - t * 0.35); // tail lags → a streak
      const off = (Math.random() - 0.5) * 26 * t; // tail spreads wider
      const warm = Math.random();
      const tint = warm < 0.4 ? 0xffffff : warm < 0.8 ? 0xffd24a : 0xff7a2a;
      this.spawn(this.glowTex!, {
        x: fromX + nx * off,
        y: fromY + ny * off,
        vx: ux * speed,
        vy: uy * speed,
        drag: 1,
        life: TRAVEL * 1000 * (1 - t * 0.25),
        fromScale: (0.6 - t * 0.35) * 1.1,
        toScale: 0.15,
        spin: 0,
        tint,
        blend: 'add',
        peakAlpha: 1 - t * 0.5,
      });
    }
  }

  /** Travel time (ms) of a `blastBolt` — the caller schedules `damageBurst` + the impact for this delay. */
  readonly blastTravelMs = 340;

  /**
   * A crimson impact burst at (x, y) — the damage landing on the Resolve bar. A hot white core + a red
   * shockwave + a spray of red/orange shards, additive so it punches over the UI. Pairs with `blastBolt`.
   */
  damageBurst(x: number, y: number): void {
    if (!this.ready) return;
    // white-hot core
    this.spawn(this.glowTex!, {
      x, y, vx: 0, vy: 0, drag: 1, life: 240, fromScale: 0.5, toScale: 3, spin: 0,
      tint: 0xffd9c0, blend: 'add',
    });
    // crimson shockwave
    this.spawn(this.glowTex!, {
      x, y, vx: 0, vy: 0, drag: 1, life: 360, fromScale: 0.4, toScale: 3.4, spin: 0,
      tint: 0xe23b2e, blend: 'add',
    });
    // shards flung in all directions
    const shards = 22;
    for (let i = 0; i < shards; i++) {
      const a = (i / shards) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const speed = 380 + Math.random() * 620;
      const tex = Math.random() < 0.5 ? this.shardRectTex! : this.sparkTex!;
      const warm = Math.random();
      const tint = warm < 0.45 ? 0xff3b2e : warm < 0.8 ? 0xff8a3a : 0xffffff;
      this.spawn(tex, {
        x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, drag: 0.12,
        life: 360 + Math.random() * 360, fromScale: 0.7 + Math.random() * 0.8, toScale: 0.05,
        spin: (Math.random() - 0.5) * 12, rotation: a, tint, blend: 'add',
      });
    }
  }

  /**
   * The Discover flourish: golden, white-hot magic + sparkles erupt from screen center (cx, cy) and
   * shoot outward off every edge. Additive (reads white-hot over the dimmed board), ≤3s. Rendered on
   * the discover overlay's own burst layer — behind the cards/UI, above the dark backdrop.
   */
  discoverBurst(cx: number, cy: number): void {
    if (!this.ready) return;
    // central bloom — a big white-gold flash at the origin
    this.spawn(this.glowTex!, {
      x: cx, y: cy, vx: 0, vy: 0, drag: 1, life: 700, fromScale: 0.5, toScale: 5.5, spin: 0,
      tint: 0xfff1c0, blend: 'add',
    });
    // glow motes — large soft orbs drifting outward, long-lived (the "magic")
    const motes = 16;
    for (let i = 0; i < motes; i++) {
      const a = (i / motes) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const sp = 220 + Math.random() * 340;
      this.spawn(this.glowTex!, {
        x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.72,
        life: 1500 + Math.random() * 900, fromScale: 0.6 + Math.random() * 0.8, toScale: 0.1,
        spin: 0, tint: Math.random() < 0.5 ? 0xffe9a8 : 0xfff6d8, blend: 'add', peakAlpha: 0.85,
      });
    }
    // sparkles — many fast shards flung radially, fast enough to reach the page edges
    const sparks = 50;
    for (let i = 0; i < sparks; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 650 + Math.random() * 900; // fast → shoot off the sides
      const tex = Math.random() < 0.5 ? this.shardRectTex! : this.sparkTex!;
      const warm = Math.random();
      const tint = warm < 0.4 ? 0xffffff : warm < 0.8 ? 0xffe79a : 0xffc23a;
      this.spawn(tex, {
        x: cx + (Math.random() - 0.5) * 40,
        y: cy + (Math.random() - 0.5) * 40,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.86,
        life: 900 + Math.random() * 1500, fromScale: 0.5 + Math.random() * 0.9, toScale: 0.05,
        spin: (Math.random() - 0.5) * 10, rotation: a, tint, blend: 'add',
      });
    }
  }

  /**
   * Create or update the divine-shield bubble for `uid`, centered at (cx, cy) and sized to a unit
   * footprint of w×h (the card's rect). Idempotent: the first call spawns the bubble (with a grow-in);
   * later calls just retarget it (so it tracks the unit as it moves). The React layers call this for
   * every shielded unit whenever the shielded set or any position changes. No-op until the app is ready.
   * `mini` = the card is being dragged → shrink to a small trailing sparkle; when a `mini` bubble is next
   * set with `mini=false` (the card is placed), it coalesces/pops back to full size.
   */
  setShield(uid: string, cx: number, cy: number, w: number, h: number, mini = false, kind: AuraKind = 'shield', track: ShieldBubble['track'] = null): void {
    if (!this.ready || !this.shieldLayer) return;
    const key = auraKey(kind, uid);
    let b = this.shields.get(key);
    if (!b) {
      const container = new Container();
      // A quad mesh the aura shader draws onto. The geometry's UVs are a clean 0..1, so the fragment maps the
      // sphere/wisp exactly. The container scales it to the card footprint; the shader is chosen per kind.
      const tc = getTauntConfig();
      const isTaunt = kind === 'taunt';
      const uniforms: Record<string, { value: number | Float32Array; type: string }> = {
        uTime: { value: 0, type: 'f32' },
        uAspect: { value: w / Math.max(1, h), type: 'f32' },
        uColor: { value: new Float32Array(isTaunt ? [tc.colorR, tc.colorG, tc.colorB] : AURA[kind].rgb), type: 'vec3<f32>' },
        uSeed: { value: (this.shields.size % 7) * 1.3, type: 'f32' }, // de-sync neighbours' pulses
      };
      if (isTaunt) {
        // Shape/look uniforms — driven LIVE from the taunt config each frame (DEV tuner edits show instantly).
        uniforms.uTopY = { value: tc.topY, type: 'f32' };
        uniforms.uBotY = { value: tc.botY, type: 'f32' };
        uniforms.uHalfW = { value: tc.halfW, type: 'f32' };
        uniforms.uWidthPow = { value: tc.widthPow, type: 'f32' };
        uniforms.uRimW = { value: tc.rimW, type: 'f32' };
        uniforms.uGemSize = { value: tc.gemSize, type: 'f32' };
        uniforms.uGlintSpeed = { value: tc.glintSpeed, type: 'f32' };
      }
      const shader = Shader.from({
        gl: { vertex: SHIELD_VERT, fragment: AURA[kind].frag },
        resources: { shieldUniforms: uniforms },
      });
      const mesh = new Mesh({ geometry: this.shieldGeo!, shader });
      container.addChild(mesh);
      container.alpha = 0;
      this.shieldLayer.addChild(container);
      b = { kind, container, mesh, shader, cx, cy, w, h, age: 0, formIn: 0, fadeOut: -1,
            mini, pop: -1, scaleMul: mini ? MINI_SCALE : 1, rot: 0, track };
      this.shields.set(key, b);
    } else {
      b.cx = cx; b.cy = cy; b.w = w; b.h = h; b.track = track;
      b.fadeOut = -1; // re-targeted while fading (re-gained) → cancel the fade
      // Dragged (mini) → placed (full): coalesce/pop the bubble back into existence (inverse of the break).
      if (b.mini && !mini) { b.pop = 0; this.shieldPop(cx, cy, w, h, kind); }
      b.mini = mini;
    }
  }

  /** The placement coalesce: a bright central flash + a ring of sparkles rushing INWARD to the center —
   *  the inverse of the break's outward shrapnel. Fired when a dragged shield is set down. */
  private shieldPop(cx: number, cy: number, w: number, h: number, kind: AuraKind = 'shield'): void {
    if (!this.ready) return;
    const rad = Math.max(w, h) * 0.5 * auraMargin(kind);
    const c = AURA[kind];
    // central flash that blooms as the bubble snaps in
    this.spawn(this.bubbleTex!, {
      x: cx, y: cy, vx: 0, vy: 0, drag: 1, life: 240, fromScale: (rad / BUBBLE_TEX_R) * 0.35,
      toScale: (rad / BUBBLE_TEX_R) * 1.05, spin: 0, tint: c.rimTint, blend: 'add', peakAlpha: 0.8,
    });
    // sparkles starting on a ring and rushing inward to coalesce at the center
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const r0 = rad * 1.4;
      const speed = 360 + Math.random() * 260;
      this.spawn(this.sparkTex!, {
        x: cx + Math.cos(a) * r0, y: cy + Math.sin(a) * r0,
        vx: -Math.cos(a) * speed, vy: -Math.sin(a) * speed, // inward
        drag: 0.05, // decelerate hard as they reach the middle
        life: 240 + Math.random() * 120, fromScale: 0.8 + Math.random() * 0.5, toScale: 0.05,
        spin: 0, tint: c.rimTint, blend: 'add', peakAlpha: 0.95,
      });
    }
  }

  /** Gracefully fade out and remove an aura that was removed WITHOUT breaking (sold / left the field). */
  clearShield(uid: string, kind: AuraKind = 'shield'): void {
    const b = this.shields.get(auraKey(kind, uid));
    if (b && b.fadeOut < 0) b.fadeOut = 0;
  }

  /** True if a persistent aura bubble of this kind is currently registered for `uid` (the choreographer's
   *  aura channel consults this to decide which of a dying unit's auras to burst — pixiFx's registry is the
   *  source of truth for which auras a unit carries; the Score decides when). */
  hasAura(uid: string, kind: AuraKind = 'shield'): boolean {
    return this.shields.has(auraKey(kind, uid));
  }

  /** The tracked center + footprint of `uid`'s aura bubble, or null if none — used by the aura channel to
   *  position the taunt burst (which draws on the FRONT layer and needs explicit coords, unlike breakShield
   *  which reads the bubble's own stored coords). */
  auraRect(uid: string, kind: AuraKind = 'shield'): { cx: number; cy: number; w: number; h: number } | null {
    const b = this.shields.get(auraKey(kind, uid));
    return b ? { cx: b.cx, cy: b.cy, w: b.w, h: b.h } : null;
  }

  /** Show/hide ALL shield bubbles at once — used to suppress them behind a board-covering modal (Discover /
   *  Choose One sit below the FX canvas with a translucent backdrop, so bubbles would otherwise show over it). */
  setShieldsVisible(visible: boolean): void {
    if (this.shieldLayer) this.shieldLayer.visible = visible;
  }

  /**
   * The shield SHATTERS (a hit absorbed): a quick crack-flash + fracture lines, then a small explosion —
   * an energy shockwave ring, a spray of golden shrapnel shards, and a few energy motes. The persistent
   * bubble is removed immediately; the burst is fire-and-forget on the particle layer.
   */
  breakShield(uid: string, kind: AuraKind = 'shield'): void {
    const key = auraKey(kind, uid);
    const b = this.shields.get(key);
    if (!b) return;
    const { cx, cy, w, h } = b;
    b.shader.destroy();
    b.container.destroy({ children: true });
    this.shields.delete(key);
    if (!this.ready) return;
    if (kind === 'reborn') { this.rebornShatter(cx, cy, w, h); return; } // wispy spirit release, not shards
    const rad = Math.max(w, h) * 0.5 * AURA[kind].margin;

    // 1) CRACK — a bright white-gold flash at the bubble's footprint + a few fracture lines snapping across.
    this.spawn(this.bubbleTex!, {
      x: cx, y: cy, vx: 0, vy: 0, drag: 1, life: 150, fromScale: rad / BUBBLE_TEX_R,
      toScale: (rad / BUBBLE_TEX_R) * 1.18, spin: 0, tint: 0xfff3c8, blend: 'add',
    });
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI;
      this.spawn(this.veinTex!, {
        x: cx, y: cy, vx: 0, vy: 0, drag: 1, life: 130, fromScale: (rad / 26) * 1.1, toScale: rad / 26,
        spin: 0, rotation: a, tint: 0xffffff, blend: 'add', peakAlpha: 0.95,
      });
    }

    // 2) SHOCKWAVE — two additive rings expanding past the bubble edge and fading (a bigger pop).
    this.spawn(this.rimTex!, {
      x: cx, y: cy, vx: 0, vy: 0, drag: 1, life: 460, fromScale: (rad / BUBBLE_TEX_R) * 0.85,
      toScale: (rad / BUBBLE_TEX_R) * 2.1, spin: 0, tint: 0xffe27a, blend: 'add', peakAlpha: 0.95,
    });
    this.spawn(this.bubbleTex!, {
      x: cx, y: cy, vx: 0, vy: 0, drag: 1, life: 300, fromScale: (rad / BUBBLE_TEX_R),
      toScale: (rad / BUBBLE_TEX_R) * 1.6, spin: 0, tint: 0xfff0c0, blend: 'add', peakAlpha: 0.7,
    });

    // 3) SHRAPNEL — golden shards flung radially out of the rim (reuses the pooled shard textures).
    const shards = 22;
    for (let i = 0; i < shards; i++) {
      const a = (i / shards) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const speed = 320 + Math.random() * 640;
      const tex = Math.random() < 0.5 ? this.shardRectTex! : this.shardTriTex!;
      const warm = Math.random();
      const tint = warm < 0.5 ? 0xffd24a : warm < 0.85 ? 0xffe9a8 : 0xfff6d8;
      this.spawn(tex, {
        x: cx + Math.cos(a) * rad * 0.7, y: cy + Math.sin(a) * rad * 0.7,
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, drag: 0.12,
        life: 420 + Math.random() * 360, fromScale: 0.9 + Math.random() * 0.7, toScale: 0.05,
        spin: (Math.random() - 0.5) * 10, rotation: a, tint, blend: 'add',
      });
    }

    // 4) ENERGY MOTES — soft glints drifting out, longer-lived, for the "energy" feel.
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 110 + Math.random() * 240;
      this.spawn(this.sparkTex!, {
        x: cx, y: cy, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, drag: 0.5,
        life: 500 + Math.random() * 400, fromScale: 0.9 + Math.random() * 0.8, toScale: 0.05,
        spin: 0, tint: 0xffe9a8, blend: 'add', peakAlpha: 0.95,
      });
    }
  }

  /** The REBORN aura SHATTERS — the wraith spirit EXPLODES free (owner: aura deaths should pop like the
   *  ward break, not sigh out): a bright blue crack-flash + an expanding shockwave ring, then the spirit
   *  release — outward/RISING smoke wisps + bright motes streaking up. Still no hard shards (it's a spirit,
   *  not glass), but the flash/ring/speed put it in the same punch class as the gold shatter. */
  private rebornShatter(cx: number, cy: number, w: number, h: number): void {
    const rad = Math.max(w, h) * 0.5 * AURA.reborn.margin;
    // CRACK — a hot white-blue flash at the moment the spirit tears free.
    this.spawn(this.glowTex!, {
      x: cx, y: cy, vx: 0, vy: 0, drag: 1, life: 170, fromScale: 0.5, toScale: (rad / 40) * 2.4,
      spin: 0, tint: 0xeaf4ff, blend: 'add', peakAlpha: 0.95,
    });
    // SHOCKWAVE — a crisp spectral-blue ring expanding past the aura edge (the ward-break punctuation).
    this.spawn(this.rimTex!, {
      x: cx, y: cy, vx: 0, vy: 0, drag: 1, life: 420, fromScale: (rad / BUBBLE_TEX_R) * 0.7,
      toScale: (rad / BUBBLE_TEX_R) * 2.2, spin: 0, tint: 0x7ab8ff, blend: 'add', peakAlpha: 0.9,
    });
    // soft blue bloom that swells + fades under the flash
    this.spawn(this.bubbleTex!, {
      x: cx, y: cy, vx: 0, vy: 0, drag: 1, life: 300, fromScale: (rad / BUBBLE_TEX_R) * 0.8,
      toScale: (rad / BUBBLE_TEX_R) * 2.0, spin: 0, tint: 0x9ccbff, blend: 'add', peakAlpha: 0.8,
    });
    // smoke wisps — soft blobs BLASTED outward (faster than the old sigh) that bias UPWARD (spirits rising)
    const wisps = 18;
    for (let i = 0; i < wisps; i++) {
      const a = (i / wisps) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
      const speed = 110 + Math.random() * 220;
      this.spawn(this.glowTex!, {
        x: cx + (Math.random() - 0.5) * rad, y: cy + (Math.random() - 0.5) * rad,
        vx: Math.cos(a) * speed * 0.7, vy: Math.sin(a) * speed * 0.5 - (70 + Math.random() * 140), // rise
        drag: 0.4, life: 600 + Math.random() * 520, fromScale: 0.5 + Math.random() * 0.5,
        toScale: 1.4 + Math.random() * 0.8, spin: (Math.random() - 0.5) * 1.0,
        tint: Math.random() < 0.5 ? 0x6ab0ff : 0xbfe2ff, blend: 'add', peakAlpha: 0.5 + Math.random() * 0.2,
      });
    }
    // bright spirit motes streaking up — more of them, flung harder
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.4;
      const speed = 260 + Math.random() * 320;
      this.spawn(this.sparkTex!, {
        x: cx + (Math.random() - 0.5) * rad * 0.6, y: cy,
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, drag: 0.35,
        life: 500 + Math.random() * 400, fromScale: 0.8 + Math.random() * 0.6, toScale: 0.05,
        spin: 0, tint: 0xdfeeff, blend: 'add', peakAlpha: 0.9,
      });
    }
  }

  /**
   * The TAUNT bulwark SHATTERS — fired when a taunt minion DIES in combat (a sold/removed taunt still just
   * fades). The metal heater breaks like metal, not glass: a white-hot crack flash, a silver shockwave ring,
   * steel shards flung radially (chunky, slower than the ward's glass), white glints, and a puff of grey
   * smoke. Fired on the FRONT (viewport) canvas so the debris flies OVER the cards, mirroring the ward break
   * (whose bubble also lives on another canvas); `cx/cy/w/h` is the dying card's measured rect.
   */
  tauntBurst(cx: number, cy: number, w: number, h: number): void {
    if (!this.ready) return;
    const rad = Math.max(w, h) * 0.5 * getTauntConfig().margin;
    // CRACK — white-hot flash at the break point.
    this.spawn(this.glowTex!, {
      x: cx, y: cy, vx: 0, vy: 0, drag: 1, life: 180, fromScale: 0.5, toScale: (rad / 40) * 2.2,
      spin: 0, tint: 0xf4f7fc, blend: 'add', peakAlpha: 0.95,
    });
    // SHOCKWAVE — a silver ring ripping outward.
    this.spawn(this.rimTex!, {
      x: cx, y: cy, vx: 0, vy: 0, drag: 1, life: 420, fromScale: (rad / BUBBLE_TEX_R) * 0.7,
      toScale: (rad / BUBBLE_TEX_R) * 2.1, spin: 0, tint: 0xdfe6f0, blend: 'add', peakAlpha: 0.85,
    });
    // STEEL SHARDS — chunky fragments flung radially; a touch slower/heavier than the ward's glass.
    const shards = 18;
    for (let i = 0; i < shards; i++) {
      const a = (i / shards) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const speed = 260 + Math.random() * 520;
      const tex = Math.random() < 0.5 ? this.shardRectTex! : this.shardTriTex!;
      const cold = Math.random();
      const tint = cold < 0.5 ? 0xcfd6e2 : cold < 0.85 ? 0xeef2f8 : 0x9aa4b4; // silvers + a dark steel
      this.spawn(tex, {
        x: cx + Math.cos(a) * rad * 0.6, y: cy + Math.sin(a) * rad * 0.6,
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, drag: 0.14,
        life: 420 + Math.random() * 360, fromScale: 1.0 + Math.random() * 0.7, toScale: 0.05,
        spin: (Math.random() - 0.5) * 9, rotation: a, tint, blend: 'normal', // normal → reads solid on cream
      });
    }
    // GLINTS — white-hot sparks off the breaking metal.
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 140 + Math.random() * 260;
      this.spawn(this.sparkTex!, {
        x: cx, y: cy, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, drag: 0.4,
        life: 420 + Math.random() * 320, fromScale: 0.8 + Math.random() * 0.7, toScale: 0.05,
        spin: 0, tint: 0xffffff, blend: 'add', peakAlpha: 0.95,
      });
    }
    // grey smoke — the dust of a felled bulwark.
    for (let i = 0; i < 4; i++) {
      this.spawn(this.glowTex!, {
        x: cx + (Math.random() - 0.5) * 24, y: cy + (Math.random() - 0.5) * 24,
        vx: (Math.random() - 0.5) * 70, vy: -30 - Math.random() * 50,
        drag: 0.5, life: 600 + Math.random() * 400, fromScale: 0.4 + Math.random() * 0.3,
        toScale: 1.6 + Math.random() * 0.7, spin: (Math.random() - 0.5) * 1.4,
        tint: Math.random() < 0.5 ? 0x9aa4b4 : 0x848e9c, blend: 'normal', peakAlpha: 0.3,
      });
    }
  }

  /** The REBORN rebirth — the unit re-forms from the spirit: blue wisps CONVERGE inward + rise into the
   *  reborn unit + a soft blue flash. The wispy counterpart of a summon poof (fired on the `reborn` beat). */
  rebornSummon(cx: number, cy: number, w: number, h: number): void {
    if (!this.ready) return;
    const rad = Math.max(w, h) * 0.5 * AURA.reborn.margin;
    // soft blue flash as the body knits back together
    this.spawn(this.bubbleTex!, {
      x: cx, y: cy, vx: 0, vy: 0, drag: 1, life: 320, fromScale: (rad / BUBBLE_TEX_R) * 0.3,
      toScale: (rad / BUBBLE_TEX_R) * 1.2, spin: 0, tint: 0xcfe6ff, blend: 'add', peakAlpha: 0.65,
    });
    // wisps starting below + around, rising and converging into the unit
    const n = 16;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const r0 = rad * (1.1 + Math.random() * 0.4);
      const speed = 220 + Math.random() * 220;
      this.spawn(this.glowTex!, {
        x: cx + Math.cos(a) * r0, y: cy + Math.sin(a) * r0 + rad * 0.4, // start a touch low → rise in
        vx: -Math.cos(a) * speed * 0.6, vy: -Math.abs(Math.sin(a)) * speed - 40, // inward + up
        drag: 0.12, life: 360 + Math.random() * 220, fromScale: 0.6 + Math.random() * 0.5, toScale: 0.05,
        spin: 0, tint: Math.random() < 0.5 ? 0x6ab0ff : 0xdfeeff, blend: 'add', peakAlpha: 0.7,
      });
    }
  }

  /**
   * DEV: fire a big, slow, unmissable burst at the center of the screen and log full
   * diagnostics — proves the layer is alive + visible without needing a combat. Logged
   * fields tell us where it breaks if you still see nothing.
   */
  test(): void {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const c = this.app?.canvas;
    console.log('[pixiFx.test]', {
      ready: this.ready,
      hasApp: !!this.app,
      center: { cx, cy },
      win: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
      drawingBuffer: c ? { w: c.width, h: c.height } : null,
      canvasCss: c ? { w: c.style.width, h: c.style.height } : null,
      screen: this.app ? { w: this.app.screen.width, h: this.app.screen.height } : null,
      hidden: document.hidden,
    });
    if (!this.ready) {
      console.warn('[pixiFx.test] not ready — overlay not initialised yet. Refresh the page.');
      return;
    }
    // A huge, slow flash so it's impossible to miss even if the normal effect is too subtle.
    this.spawn(this.glowTex!, {
      x: cx, y: cy, vx: 0, vy: 0, drag: 1, life: 1400, fromScale: 0.5, toScale: 6, spin: 0,
      tint: 0xffffff,
    });
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const speed = 300;
      this.spawn(this.sparkTex!, {
        x: cx, y: cy, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, drag: 0.3,
        life: 1200, fromScale: 2.5, toScale: 0.2, spin: 0, tint: 0xffd24a,
      });
    }
  }

  /** Pull a sprite from the pool (or make one), configure it as a live particle. */
  /** Load + alpha-key the painted skull-and-crossbones (`/fx/skull-crossbones.png`, drawn on black) into a
   *  tight texture + a grid of fragment sub-textures for the Deathrattle shatter. Fire-and-forget from init;
   *  a `deathrattle()` before it resolves simply no-ops. */
  private async loadSkull(): Promise<void> {
    if (typeof document === 'undefined') return;
    try {
      const img = new Image();
      img.src = '/fx/skull-crossbones.png';
      await new Promise<void>((resolve, reject) => {
        if (img.complete && img.naturalWidth) return resolve();
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('skull image failed to load'));
      });
      const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
      const g = c.getContext('2d'); if (!g) return;
      g.drawImage(img, 0, 0, S, S);
      const d = g.getImageData(0, 0, S, S), p = d.data;
      let minX = S, minY = S, maxX = 0, maxY = 0;
      for (let i = 0; i < S * S; i++) {
        const r = p[i * 4]!, gg = p[i * 4 + 1]!, b = p[i * 4 + 2]!, m = Math.max(r, gg, b);
        let a = Math.max(0, Math.min(1, (m - 14) / 46));   // key the black background → alpha
        if (b > r && m < 80) a *= 0.3;                      // suppress the faint purple rim glow
        p[i * 4 + 3] = a * 255;
        if (a > 0.5) { const px = i % S, py = (i / S) | 0; if (px < minX) minX = px; if (px > maxX) maxX = px; if (py < minY) minY = py; if (py > maxY) maxY = py; }
      }
      g.putImageData(d, 0, 0);
      // crop to the content bounding box (small pad) → a tight skull, so display sizing tracks the visible art
      const pad = 6, bx = Math.max(0, minX - pad), by = Math.max(0, minY - pad);
      const bw = Math.min(S, maxX + pad) - bx, bh = Math.min(S, maxY + pad) - by;
      if (bw <= 0 || bh <= 0) return;
      const tight = document.createElement('canvas'); tight.width = bw; tight.height = bh;
      const tg = tight.getContext('2d'); if (!tg) return;
      tg.drawImage(c, bx, by, bw, bh, 0, 0, bw, bh);
      const base = Texture.from(tight);
      this.skullTex = base; this.skullSrcW = bw; this.skullSrcH = bh;
      // grid-slice into fragment sub-textures (only cells that carry ink), each with its offset from center
      const G = DR_GRID, cw = bw / G, ch = bh / G, td = tg.getImageData(0, 0, bw, bh).data;
      this.skullFrags = [];
      for (let cy = 0; cy < G; cy++) for (let cx = 0; cx < G; cx++) {
        let ink = 0;
        for (let y = cy * ch | 0; y < (cy + 1) * ch && y < bh; y += 3) for (let x = cx * cw | 0; x < (cx + 1) * cw && x < bw; x += 3) if (td[((y * bw) + x) * 4 + 3]! > 60) ink++;
        if (ink < 3) continue;
        const fx = cx * cw, fy = cy * ch, fw = Math.min(cw, bw - fx), fh = Math.min(ch, bh - fy);
        const tex = new Texture({ source: base.source, frame: new Rectangle(fx, fy, fw, fh) });
        this.skullFrags.push({ tex, dx: fx + fw / 2 - bw / 2, dy: fy + fh / 2 - bh / 2 });
      }
    } catch (e) {
      console.error('[pixiFx] skull load failed — Deathrattle FX disabled:', e);
    }
  }

  /** Deathrattle death FX: a painted bone skull-and-crossbones pops up over the dying unit, then EXPLODES —
   *  the skull image shatters into bone fragments (gravity + spin), splinters scatter, and smoke blooms.
   *  `(x, y)` = the unit's viewport center; `size` ≈ its card width. No-op until the skull texture loads. */
  deathrattle(x: number, y: number, size: number): void {
    if (!this.ready || !this.skullTex || !this.layer) return;
    const scale = (size * DR_SKULL_SCALE) / this.skullSrcW; // maps the tight skull texture → display px
    const sprite = this.pool.pop() ?? new Sprite();
    sprite.texture = this.skullTex;
    sprite.anchor.set(0.5);
    sprite.rotation = 0; // ALWAYS upright — reset the pooled sprite's stale rotation from its prior particle life
    sprite.blendMode = 'normal';
    sprite.tint = 0xffffff;
    sprite.alpha = 1;
    sprite.x = x; sprite.y = y;
    sprite.scale.set(0.001);
    sprite.visible = true;
    this.layer.addChild(sprite);
    this.skullPops.push({ sprite, x, y, scale, age: 0 });
  }

  /** Fire the shatter at the end of a skull's pop: grid fragments flung with gravity/spin, bone splinters,
   *  a smoke bloom, and a hot flash — all on the fire-and-forget particle system. */
  private burstSkull(s: SkullPop): void {
    const { x, y, scale } = s, disp = scale * this.skullSrcW;
    sfx.skullBurst(); // the magical bone-shatter, fired exactly as the skull explodes
    // hot flash at the moment of the burst
    this.spawn(this.glowTex!, { x, y, vx: 0, vy: 0, drag: 1, life: 180, fromScale: disp * 0.006, toScale: disp * 0.014, spin: 0, tint: 0xffe6b0, blend: 'add', peakAlpha: 0.7 });
    // the skull image breaking into chunks
    for (const f of this.skullFrags) {
      const wx = x + f.dx * scale, wy = y + f.dy * scale, ddx = wx - x, ddy = wy - y, dl = Math.hypot(ddx, ddy) || 1;
      const sp = (150 + Math.random() * 180) * DR_SPREAD;
      this.spawn(f.tex, {
        x: wx, y: wy, vx: ddx / dl * sp + (Math.random() - 0.5) * 80, vy: ddy / dl * sp - (90 + Math.random() * 100),
        drag: 0.9, gravity: 1000, life: 820 + Math.random() * 560, fromScale: scale, toScale: scale,
        spin: (Math.random() - 0.5) * 10, tint: 0xffffff, blend: 'normal', peakAlpha: 1,
      });
    }
    // sharp bone splinters
    const nspl = Math.round(15 * DR_SPLINTERS);
    for (let i = 0; i < nspl; i++) {
      const a = Math.random() * 6.28, sp = (280 + Math.random() * 280) * DR_SPREAD;
      this.spawn(this.shardRectTex!, {
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 70, drag: 0.85, gravity: 1100, life: 620 + Math.random() * 540,
        fromScale: 0.9 + Math.random() * 0.9, toScale: 0.1, spin: (Math.random() - 0.5) * 16, rotation: a,
        tint: 0xece0c4, blend: 'normal', peakAlpha: 1,
      });
    }
    // smoke bloom rising through it
    const nsm = Math.round(28 * DR_SMOKE);
    for (let i = 0; i < nsm; i++) {
      const a = Math.random() * 6.28;
      this.spawn(this.glowTex!, {
        x: x + (Math.random() - 0.5) * disp * 0.5, y: y + (Math.random() - 0.5) * disp * 0.4,
        vx: Math.cos(a) * 40 * Math.random(), vy: -(45 + Math.random() * 85), drag: 0.6, gravity: 0,
        life: 840 + Math.random() * 660, fromScale: disp * 0.004 * (0.7 + Math.random() * 0.5),
        toScale: disp * 0.011 * (0.7 + Math.random() * 0.6), spin: (Math.random() - 0.5) * 1.2,
        tint: Math.random() < 0.5 ? 0x514741 : 0x6b6058, blend: 'normal', peakAlpha: 0.34 * (0.8 + Math.random() * 0.4),
      });
    }
  }

  private spawn(
    tex: Texture,
    // `maxLife` is derived (spawn sets it to cfg.life) — omitting it here is what lets every call site skip it.
    cfg: Omit<Particle, 'sprite' | 'peakAlpha' | 'gravity' | 'stretchX' | 'maxLife'> &
      { tint: number; blend?: BLEND_MODES; peakAlpha?: number; rotation?: number; gravity?: number; stretchX?: number },
  ): void {
    const layer = this.layer;
    if (!layer) return;
    const peakAlpha = cfg.peakAlpha ?? 1;
    const sprite = this.pool.pop() ?? new Sprite();
    sprite.texture = tex;
    sprite.anchor.set(0.5);
    sprite.blendMode = cfg.blend ?? 'add';
    sprite.tint = cfg.tint;
    sprite.alpha = peakAlpha;
    sprite.x = cfg.x;
    sprite.y = cfg.y;
    sprite.scale.set(cfg.fromScale * (cfg.stretchX ?? 1), cfg.fromScale);
    sprite.rotation = cfg.rotation ?? 0;
    sprite.visible = true;
    layer.addChild(sprite);
    this.live.push({
      sprite, x: cfg.x, y: cfg.y, vx: cfg.vx, vy: cfg.vy, drag: cfg.drag,
      life: cfg.life, maxLife: cfg.life, fromScale: cfg.fromScale, toScale: cfg.toScale, spin: cfg.spin, peakAlpha,
      gravity: cfg.gravity ?? 0,
      stretchX: cfg.stretchX ?? 1,
    });
  }

  /** Per-frame: advance every live particle, recycle the dead. Bound method for ticker.add/remove. */
  private update = (ticker: Ticker): void => {
    const dtMs = ticker.deltaMS;
    const dt = dtMs / 1000;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i]!;
      p.life -= dtMs;
      if (p.life <= 0) {
        p.sprite.visible = false;
        this.layer?.removeChild(p.sprite);
        this.pool.push(p.sprite);
        this.live.splice(i, 1);
        continue;
      }
      const t = 1 - p.life / p.maxLife; // 0 → 1 over the particle's life
      // frame-rate-independent exponential drag
      const dragF = Math.pow(p.drag, dt);
      p.vx *= dragF;
      p.vy *= dragF;
      p.vy += p.gravity * dt; // gravity after drag so it isn't damped the same frame (coins fall)
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const s = p.sprite;
      s.x = p.x;
      s.y = p.y;
      s.rotation += p.spin * dt;
      const sc = p.fromScale + (p.toScale - p.fromScale) * t;
      s.scale.set(sc * p.stretchX, sc);
      s.alpha = p.peakAlpha * (1 - t * t); // ease-out fade from its peak (lingers, then drops)
    }

    // Deathrattle skulls: elastic pop-in (+ a tiny wind-up jiggle), then BURST into the shatter particles.
    for (let i = this.skullPops.length - 1; i >= 0; i--) {
      const sp = this.skullPops[i]!;
      sp.age += dtMs;
      const POP = 320 * (0.6 + 0.4 * DR_POP), HOLD = 130;
      if (sp.age < POP + HOLD) {
        const k = Math.min(1, sp.age / POP);
        const e = k >= 1 ? 1 : Math.pow(2, -10 * k) * Math.sin((k - 0.075) * (2 * Math.PI / 0.32)) + 1; // elastic-out
        const jig = sp.age > POP ? 1 + Math.sin((sp.age - POP) / HOLD * Math.PI) * 0.03 : 1;
        sp.sprite.scale.set(sp.scale * (0.2 + 0.8 * e) * jig);
        sp.sprite.y = sp.y - Math.min(1, sp.age / POP) * 12; // pops upward a touch
      } else {
        this.burstSkull(sp);
        sp.sprite.visible = false;
        this.layer?.removeChild(sp.sprite);
        this.pool.push(sp.sprite);
        this.skullPops.splice(i, 1);
      }
    }

    // Persistent shield bubbles: advance the slow breathe + grow-in/fade, and sit on each unit's rect.
    for (const [uid, b] of this.shields) {
      b.age += dtMs;
      // Live-track the card in THIS frame (after GSAP's lunge/recoil transform) so the aura never trails it.
      if (b.track) { const r = b.track(); if (r) { b.cx = r.cx; b.cy = r.cy; b.w = r.w; b.h = r.h; b.rot = r.rot; } }
      else b.rot = 0;
      // grow-in (gain) and optional fade-out (graceful clear). Taunt "deploys" RIGID — it grows out to full
      // width and LOCKS (it's metal: no overshoot, no bob); shield/reborn fade in + settle gently.
      const tcfg = b.kind === 'taunt' ? getTauntConfig() : null;
      const formT = Math.min(1, b.formIn / (tcfg ? tcfg.deployMs : FORM_MS));
      b.formIn += dtMs;
      let life: number;
      let extraScale: number;
      if (b.kind === 'taunt') {
        const inv = 1 - formT;
        extraScale = 1 - inv * inv * inv * inv;                 // ease-out-quart: 0 → 1, fast then locks at max (no overshoot)
        life = Math.min(1, formT * 3.5);                        // snap into view fast (deploy from nothing)
      } else {
        const formEase = 1 - (1 - formT) * (1 - formT);
        life = formEase;                                        // overall opacity envelope
        extraScale = 1 + (1 - formEase) * 0.16;                 // start a touch large, settle
      }
      if (b.fadeOut >= 0) {
        const fT = Math.min(1, b.fadeOut / FADE_MS);
        b.fadeOut += dtMs;
        life *= 1 - fT;
        if (fT >= 1) { b.shader.destroy(); b.container.destroy({ children: true }); this.shields.delete(uid); continue; }
      }
      // a subtle container size-breathe — REBORN only. The divine shield and the taunt bulwark hold a steady
      // size (the shield's colour/energy pulse, owned by the shader, still breathes); only the wispy reborn bobs.
      const breatheScale = b.kind === 'reborn' ? 1 + Math.sin((b.age / BREATHE_MS) * Math.PI * 2) * 0.04 : 1;
      // drag-mini / placement-pop size: the pop drives an ease-out-back overshoot from mini → full; otherwise
      // the size eases toward its target (full=1, dragging=MINI_SCALE) so pickup/drop shrink+grow smoothly.
      if (b.pop >= 0) {
        const popT = Math.min(1, b.pop / POP_MS);
        const k = popT - 1;
        const back = 1 + 3.6 * k * k * k + 2.6 * k * k; // ease-out-back — peaks ~+13% then settles to 1 (a clear snap)
        b.scaleMul = MINI_SCALE + (1 - MINI_SCALE) * back;
        b.pop += dtMs;
        if (popT >= 1) { b.pop = -1; b.scaleMul = 1; }
      } else {
        const target = b.mini ? MINI_SCALE : 1;
        b.scaleMul += (target - b.scaleMul) * Math.min(1, dt * 14);
      }
      // fit the BUBBLE_TEX_R quad to the unit footprint (non-uniform → ellipse), per-kind margin
      const margin = tcfg ? tcfg.margin : AURA[b.kind].margin;
      const sx = (b.w * 0.5 * margin) / BUBBLE_TEX_R;
      const sy = (b.h * 0.5 * margin) / BUBBLE_TEX_R;
      const grow = breatheScale * extraScale * b.scaleMul;
      b.container.x = b.cx + (tcfg ? tcfg.offsetX : 0); // taunt: live nudge from the DEV tuner
      b.container.y = b.cy + (tcfg ? tcfg.offsetY : 0);
      b.container.scale.set(sx * grow, sy * grow);
      b.container.rotation = b.rot; // ride the card's lunge tilt (0 for non-tracked / recruit auras)
      b.container.alpha = life; // form-in / fade / mini envelope; the shader owns its internal opacity
      // drive the shield shader
      const u = (b.shader.resources.shieldUniforms as { uniforms: Record<string, number | Float32Array> }).uniforms;
      u.uTime = b.age / 1000;
      u.uAspect = b.w / Math.max(1, b.h);
      // Taunt: push the live config into the shape/look uniforms each frame, so DEV tuner edits show instantly.
      if (tcfg) {
        const col = u.uColor as Float32Array;
        col[0] = tcfg.colorR; col[1] = tcfg.colorG; col[2] = tcfg.colorB;
        u.uTopY = tcfg.topY;
        u.uBotY = tcfg.botY;
        u.uHalfW = tcfg.halfW;
        u.uWidthPow = tcfg.widthPow;
        u.uRimW = tcfg.rimW;
        u.uGemSize = tcfg.gemSize;
        u.uGlintSpeed = tcfg.glintSpeed;
      }
    }
  };

  /** A small bright dot with a soft edge — the spark. Generated once, tinted per particle. */
  private makeSparkTexture(app: Application): Texture {
    const g = new Graphics();
    // stacked translucent circles → a soft radial falloff (no per-pixel gradient needed)
    for (let r = 8; r >= 1; r--) g.circle(0, 0, r).fill({ color: 0xffffff, alpha: 0.18 });
    const tex = app.renderer.generateTexture({ target: g, resolution: 2 });
    g.destroy();
    return tex;
  }

  /** A larger, softer glow — the impact flash. */
  private makeGlowTexture(app: Application): Texture {
    const g = new Graphics();
    for (let r = 40; r >= 2; r -= 2) g.circle(0, 0, r).fill({ color: 0xffffff, alpha: 0.05 });
    const tex = app.renderer.generateTexture({ target: g, resolution: 2 });
    g.destroy();
    return tex;
  }

  /** A jagged spark shard: an elongated rectangle. Drawn pointing +X so a spawn rotation aligns it
   *  along the particle's travel direction (it streaks outward like flung debris). */
  private makeShardRectTexture(app: Application): Texture {
    const g = new Graphics();
    g.rect(-9, -2, 18, 4).fill({ color: 0xffffff }); // sharp-edged, no soft falloff
    const tex = app.renderer.generateTexture({ target: g, resolution: 2 });
    g.destroy();
    return tex;
  }

  /** A jagged spark shard: a triangle, also pointing +X. */
  private makeShardTriTexture(app: Application): Texture {
    const g = new Graphics();
    g.poly([8, 0, -6, 5, -6, -5]).fill({ color: 0xffffff });
    const tex = app.renderer.generateTexture({ target: g, resolution: 2 });
    g.destroy();
    return tex;
  }

  /** A gold coin — dark rim, bright face, a light inner ring + a shine. Drawn opaque (normal blend)
   *  so it reads as a solid coin on the light board. */
  private makeCoinTexture(app: Application): Texture {
    const g = new Graphics();
    g.circle(0, 0, 11).fill({ color: 0x9a6a12 });                          // dark rim
    g.circle(0, 0, 9).fill({ color: 0xffc928 });                           // gold face
    g.circle(0, 0, 9).stroke({ width: 1.5, color: 0xfff0a8, alpha: 0.9 }); // bright inner ring
    g.ellipse(-3, -3.5, 3.2, 2).fill({ color: 0xfff6d0, alpha: 0.85 });    // shine highlight
    const tex = app.renderer.generateTexture({ target: g, resolution: 2 });
    g.destroy();
    return tex;
  }

  /** The shield BODY — a soft translucent disc with a radial falloff (brightest mid, fading to the edge),
   *  tinted gold + drawn at low alpha per-sprite so the unit reads through it. Radius ~BUBBLE_TEX_R. */
  private makeBubbleTexture(app: Application): Texture {
    const g = new Graphics();
    for (let r = BUBBLE_TEX_R; r >= 2; r -= 2) g.circle(0, 0, r).fill({ color: 0xffffff, alpha: 0.03 });
    const tex = app.renderer.generateTexture({ target: g, resolution: 2 });
    g.destroy();
    return tex;
  }

  /** The shield RIM — a bright soft ring near the bubble's edge (the glassy highlight), additive per-sprite. */
  private makeRimTexture(app: Application): Texture {
    const g = new Graphics();
    g.circle(0, 0, BUBBLE_TEX_R - 3).stroke({ width: 7, color: 0xffffff, alpha: 0.22 }); // soft halo
    g.circle(0, 0, BUBBLE_TEX_R - 3).stroke({ width: 3, color: 0xffffff, alpha: 0.6 });  // bright core ring
    const tex = app.renderer.generateTexture({ target: g, resolution: 2 });
    g.destroy();
    return tex;
  }

  /** The combat impact PULSE ring — a thin bright ring with a soft feather, additive. Natural radius
   *  PULSE_TEX_R so a caller scales `toScale = wantedRadius / PULSE_TEX_R` to hit an exact on-screen radius. */
  private makePulseRingTexture(app: Application): Texture {
    const g = new Graphics();
    g.circle(0, 0, PULSE_TEX_R).stroke({ width: 9, color: 0xffffff, alpha: 0.16 }); // soft outer feather
    g.circle(0, 0, PULSE_TEX_R).stroke({ width: 3, color: 0xffffff, alpha: 0.95 }); // crisp bright core
    const tex = app.renderer.generateTexture({ target: g, resolution: 2 });
    g.destroy();
    return tex;
  }

  /** A shield energy VEIN — a thin soft streak (bright core + halo), drawn pointing +X so a rotation fans
   *  it across the bubble. Half-length ~26 so the break's fracture-line scaling (rad/26) reads right. */
  private makeVeinTexture(app: Application): Texture {
    const g = new Graphics();
    g.ellipse(0, 0, 26, 2.4).fill({ color: 0xffffff, alpha: 0.4 }); // soft halo
    g.ellipse(0, 0, 22, 1.1).fill({ color: 0xffffff, alpha: 0.95 }); // bright core
    const tex = app.renderer.generateTexture({ target: g, resolution: 2 });
    g.destroy();
    return tex;
  }

  /** A wind wisp — a soft, heavily feathered horizontal streak (layered ellipses → airy falloff), drawn
   *  pointing +X so a spawn rotation aligns it along the card's motion. Softer sibling of the vein. */
  private makeWispTexture(app: Application): Texture {
    const g = new Graphics();
    g.ellipse(0, 0, 26, 5).fill({ color: 0xffffff, alpha: 0.10 }); // outer haze
    g.ellipse(0, 0, 22, 3.2).fill({ color: 0xffffff, alpha: 0.18 });
    g.ellipse(-2, 0, 16, 1.8).fill({ color: 0xffffff, alpha: 0.30 }); // brighter core, biased to the tail
    const tex = app.renderer.generateTexture({ target: g, resolution: 2 });
    g.destroy();
    return tex;
  }
}

/** The singleton effects layer. The React `PixiFxLayer` drives its mount; the combat replay
 *  calls `pixiFx.impact(...)` at contact points. */
export const pixiFx = new FxController();

/** A second, independent FX layer mounted INSIDE the Discover overlay (behind the cards, above the dark
 *  backdrop) — so the discover burst reads white-hot over the dim without covering the UI. Its own app +
 *  canvas; attached when Discover opens, its canvas re-appended on each subsequent open. */
export const discoverFx = new FxController();

/** The Taunt bulwark layer — a third independent FX instance whose canvas mounts INSIDE the board, behind
 *  the card rows, so the silver heater shield renders BEHIND the cards (unlike the front-layer divine
 *  shield / reborn auras, which sit over them). Taunt auras route here via `setShield(uid, …, 'taunt')`. */
export const tauntFx = new FxController();

// DEV: expose for live effect tuning + manual firing from the console (mirrors the LungeTuner /
// SfxMixer dev affordances). Stripped from production by the static env check.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  const w = window as unknown as { __pixiFx: FxController; __discoverFx: FxController; __tauntFx: FxController; __shieldDemo: (loops?: number) => void; __tauntDemo: () => void };
  w.__pixiFx = pixiFx;
  w.__discoverFx = discoverFx;
  w.__tauntFx = tauntFx;
  // DEV: deploy a Taunt bulwark behind a card-sized footprint at screen center (on the back layer), so the
  // silver shield + deploy thwap can be eyeballed/tuned. Clears after a few seconds.
  w.__tauntDemo = (): void => {
    const cx = window.innerWidth / 2, cy = window.innerHeight / 2, cw = 150, ch = 190;
    tauntFx.setShield('__taunt', cx, cy, cw, ch, false, 'taunt');
    window.setTimeout(() => tauntFx.clearShield('__taunt', 'taunt'), 4000);
  };
  // DEV: drop a shield bubble at screen center (card-sized), hold it, then break it — repeats `loops`
  // times so the bubble look + the crack/explosion can be eyeballed and tuned without a real combat.
  w.__shieldDemo = (loops = 3): void => {
    const cx = window.innerWidth / 2, cy = window.innerHeight / 2, cw = 150, ch = 190;
    let n = 0;
    const cycle = (): void => {
      pixiFx.setShield('__demo', cx, cy, cw, ch);
      window.setTimeout(() => {
        pixiFx.breakShield('__demo');
        if (++n < loops) window.setTimeout(cycle, 900);
      }, 2600);
    };
    cycle();
  };
}
