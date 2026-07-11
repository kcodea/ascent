import { Application, Container, Graphics, Mesh, MeshGeometry, Shader, Sprite, Texture, type BLEND_MODES, type Ticker } from 'pixi.js';
import { getSmokeConfig } from './smokeConfig';
import { getStrikeFxConfig } from './strikeFxConfig';
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

/** A live Echo (Deathrattle) skull "pop" — the purple glowing ☠ scaling in with an elastic overshoot over an
 *  additive glow sprite; when its pop+hold elapses it POOFS into smoke + embers (see `burstSkull`). */
interface SkullPop { sprite: Sprite; glow: Sprite; x: number; y: number; scale: number; age: number; }

// ── Echo (Deathrattle) skull-poof feel ──────────────────────────────────────────────────────────────
// Baked from the DEV preview (apps/web/public/fx/purple-skull-preview.html); tune there, paste here.
// No live tuner, by design.
const DR_SKULL_SCALE = 0.54;  // skull display width ÷ the dying unit's card width
const DR_POP_MS = 320;        // elastic pop-in duration
const DR_HOLD_MS = 130;       // jiggle hold before the poof
const DR_RISE = 12;           // px the skull drifts up during the pop
const DR_GLOW_ALPHA = 0.36;   // the additive glow sprite behind the skull
const DR_GLOW_SIZE = 1.7;     // glow diameter ÷ skull display long edge
const DR_DISSOLVE_MS = 150;   // the skull's own scale-up + fade — the "poof" the eye reads
const DR_DISSOLVE_GROW = 3;   // how much it scales up as it goes
const DR_FLASH_MS = 220;
const DR_FLASH_SIZE = 4;
const DR_SPREAD = 3.25;       // velocity multiplier for smoke + embers
const DR_SMOKE = 2.25;        // smoke count multiplier (base 28)
const DR_SMOKE_OUT = 1;       // 0 = rises like a campfire, 1 = blasts purely outward
const DR_SMOKE_LIFE = 300;
const DR_EMBERS = 3;          // ember count multiplier (base 14)
const DR_EMBER_LIFE = 470;

// Palette — the skull glyph + its glow are lifted from `.float.rally.sym` in styles.css, so the Pixi FX and
// the CSS Rally float read as one family.
const DR_FILL = '#cfa9fe';    // the ☠ glyph itself (baked into the texture, so the sprite draws untinted)
const DR_GLOW = 0xb478f0;     // the baked text-shadow, the glow sprite, and the flash
// Smoke reads on 'normal' blend (the one layer that can darken the board), so these are true mid-violets, not
// the near-black originals — the plume looks like PURPLE smoke, never a black cloud.
const DR_SMOKE_A = 0x7a5fa6;
const DR_SMOKE_B = 0x9d84c4;
const DR_EMBER_A = 0xcba6f0;
const DR_EMBER_B = 0xe0c4ff;

/** The skull silhouette — two filled paths, one colour, no strokes (from `apps/web/public/fx/skull-crossbones.svg`).
 *  Inlined so the texture builds with no runtime fetch. Fill + glow are applied in `buildSkullTex`, exactly as a
 *  glyph would be — the shape being vector art rather than a font character changes nothing downstream. */
const DR_SVG_W = 864, DR_SVG_H = 1048;
const DR_SVG_PATHS = [
  'M415.161 0.62099C465.652 -2.94079 532.087 9.12835 578.218 28.8911C698.628 80.4778 759.338 192.8 736.431 321.604C733.664 337.186 730.033 349.137 725.263 364.297C720.371 379.838 712.209 391.802 712.735 408.145C713.427 429.633 725.838 441.299 733.688 459.485C739.37 472.661 738.342 488.19 732.519 501.252C721.246 526.532 699.852 541.821 672.623 545.905C656.758 548.286 638.456 548.825 623.675 554.722C598.246 564.868 599.575 581.026 599.667 603.296L599.808 635.822C599.875 653.995 598.038 670.68 577.618 677.838C568.403 681.065 550.058 685.363 541.033 681.028C525.621 673.631 535.951 645.006 531.487 632.974C530.342 629.937 528.003 627.5 525.021 626.227C520.827 624.384 514.832 624.653 511.495 627.794C498.729 639.808 517.6 685.228 494.222 689.882C422.882 704.1 453.706 660.448 443.891 632.074C440.664 627.66 436.09 623.973 430.475 624.972C407.082 629.147 428.136 672.627 413.615 686.147C408.829 690.598 404.375 692 397.967 692.154C387.133 691.664 371.222 693.795 363.182 685.884C353.245 674.819 358.345 654.754 357.494 640.757C356.963 632.038 352.828 623.514 342.905 625.137C321.314 628.682 339.202 665.31 327.619 677.648C324.314 681.175 320.062 682.889 315.157 682.951C301.969 682.087 285.378 680.152 275.181 670.968C262.754 659.775 264.843 645.453 264.541 630.672C264.245 616.185 265.27 600.345 264.471 585.955C262.201 545.06 209.934 551.079 181.813 543.792C157.883 537.822 138.484 520.532 130.048 497.349C122.631 476.964 128 460.433 139.287 443.042C147.171 430.894 153.014 415.265 151.069 400.763C149.52 389.22 143.166 376.676 139.305 365.358C108.474 274.988 120.64 170.599 186.707 98.673C245.172 33.9628 328.774 5.05836 415.161 0.62099ZM301.744 455.699C354.876 440.193 396.86 401.535 379.763 341.433C375.37 325.991 365.064 313.638 350.968 306.432C335.181 297.954 300.554 293.502 282.796 295.735C273.3 296.735 265.839 297.749 256.56 300.242C214.222 311.617 201.905 352.145 206.665 391.693C213.922 451.989 244.332 469.738 301.744 455.699ZM582.48 459.516C600.389 461.127 618.881 460.768 633.08 448.395C650.801 432.953 656.17 408.05 658.111 386.38C662.936 332.62 634.005 297.15 579.51 295.686C573.173 295.516 566.339 295.102 559.794 295.748C537.494 297.585 511.446 301.282 496.163 319.522C483.494 334.645 479.582 355.218 481.082 374.493C485.007 425.101 536.771 453.825 582.48 459.516ZM433.23 531.809L433.867 532.336C441.454 538.71 448.63 549.413 459.615 547.925C477.733 545.47 476.465 516.34 473.912 503.517C469.895 483.383 460.882 459.888 444.754 446.488C440.756 443.398 436.457 442.102 431.498 441.983C424.817 443.069 419.772 445.119 415.047 450.333C396.741 470.548 386.177 502.836 389.687 529.868C391.084 540.62 398.249 549.327 409.362 547.723C419.374 546.762 425.717 532.207 433.23 531.809Z',
  'M89.4462 570.013C98.2128 568.537 110.914 571.648 118.832 575.102C135.433 582.162 147.388 596.265 150.956 613.001C152.652 620.613 152.807 627.208 155.704 634.691C164.38 657.098 187.177 664.9 208.42 674.012L257.807 695.01L432.273 768.69C488.209 744.404 544.903 721.189 601.114 697.404L651.919 675.653C662.585 671.06 674.331 666.314 684.389 660.956C695.696 654.936 706.572 642.511 709.654 630.558C712.526 619.443 712.081 610.197 718.115 599.492C725.705 586.045 736.66 577.251 752.279 572.505C766.63 568.029 782.308 569.198 795.723 575.745C824.214 589.37 836.3 621.752 821.296 648.464C838.957 653.767 853.314 664.734 860.132 681.293C871.761 709.529 856.187 741.22 825.758 751.44C809.19 757.006 790.593 755.102 775.307 747.025C769.646 744.036 764.568 739.223 758.45 736.847C749.223 733.259 736.758 732.42 727.027 734.986C710.367 739.37 693.275 747.851 677.413 754.465L588.988 792.052C572.616 799.07 553.881 807.558 537.319 813.73C579.663 831.036 622.138 848.078 664.731 864.839L698.431 878.133C704.811 880.644 713.953 884.698 720.457 886.229C753.601 894.049 755.316 872.659 777.931 861.471C791.914 854.533 808.28 853.118 823.376 857.552C838.388 862.193 850.808 872.236 857.894 885.463C867.599 903.32 865.596 926.688 852.875 942.787C845.599 951.991 838.1 956.946 827.309 961.961C832.04 969.762 835.168 976.137 836.503 985.115C838.787 999.793 834.547 1014.71 824.764 1026.39C814.516 1038.76 800.853 1045.24 784.474 1047.23C774.057 1048.48 762.573 1046.77 752.986 1042.82C739.205 1037.2 728.428 1026.62 723.068 1013.48C717.604 999.86 716.682 988.44 702.286 979.162C693.085 973.241 683.178 969.162 673.218 964.514C656.388 956.652 639.473 948.936 622.485 941.379C559.339 913.467 495.924 886.113 432.234 859.309C421.79 863.241 408.053 869.523 397.607 873.945L324.821 905.096C283.931 922.5 243.29 940.412 202.91 958.832C190.068 964.753 169.394 973.228 158.71 981.361C145.38 991.502 145.144 1006.21 138.292 1019.18C131.707 1031.65 118.406 1041.1 104.111 1045.19C88.4699 1049.6 71.6003 1048.01 57.2159 1040.76C43.698 1033.77 33.6645 1022.08 29.2874 1008.21C23.7567 990.516 28.001 977.288 36.9128 961.906C4.87425 947.98 -9.08868 915.984 6.22421 885.684C12.9282 872.714 24.8646 862.757 39.4079 858.017C59.7045 851.446 82.2161 855.812 98.0472 869.395C104.483 874.967 109.092 881.575 117.25 885.004C128.293 889.695 139.06 888.28 149.863 884.116C161.74 879.542 173.602 874.961 185.46 870.368C215.641 858.605 245.738 846.658 275.752 834.52C291.977 827.943 310.896 819.689 327.072 813.798C303.43 804.777 275.034 791.807 251.548 781.734L181.081 751.918C156.334 741.507 124.998 723.724 99.0399 740.356C92.256 744.704 86.8202 748.586 78.9586 751.262C64.2229 756.382 47.9173 755.812 33.6318 749.676C19.572 743.559 8.71016 732.432 3.46409 718.776C-1.75451 704.741 -0.683303 689.327 6.43427 676.045C14.1434 661.452 26.6739 653.663 42.6294 648.537C25.0903 612.162 46.9966 574.942 89.4462 570.013Z',
];

/** The DEV preview integrates drag PER FRAME (`v *= drag^(dt·60)`); this engine integrates it PER SECOND
 *  (`v *= drag^dt`, see `update`). Raising the preview's dial to the 60th power makes the two identical at
 *  60fps — and unlike the preview, frame-rate independent. Keep preview dials here, converted, so the numbers
 *  the owner tuned are the numbers that ship. */
const perFrameDrag = (d: number): number => Math.pow(d, 60);
const DR_DRAG_DISSOLVE = perFrameDrag(0.86);
const DR_DRAG_SMOKE = perFrameDrag(0.6);
const DR_DRAG_EMBER = perFrameDrag(0.82);

/** `glowTex` is a radius-40 disc → 80px wide at scale 1, but the preview's stand-in glow sprite is 128px.
 *  Every glow-particle scale tuned in the preview is multiplied by this to land at the same on-screen size. */
const DR_GLOW_K = 128 / 80;

// ── Buff Tendril (empowerment FX) ───────────────────────────────────────────────────────────────────
// A unit that buffs ANOTHER unit shoots an energy "tendril" (quadratic curve + eased sine wobble, drawn as
// a tapered ribbon) that travels to the target, fires a strike flash + motes on arrival, then retracts.
// Ports the math from the owner-approved preview (apps/web/public/fx/buff-tendril-preview.html); every dial
// lives in `cfg` (a structural mirror of BuffPresetCfg) so any preset drives it. The owner tunes the LOOK on
// the preview rig; task 2.2 bakes the tuned numbers into the presets.

/** Renderer-facing tendril config (structural match of BuffPresetCfg — pixiFx stays import-light). */
export interface TendrilCfg {
  blend: 'add' | 'normal' | 'screen';
  curve: number; wobbleAmp: number; wobbleFreq: number; travelMs: number; retractMs: number;
  baseWidth: number; tipWidth: number; coreAlpha: number; glowWidth: number; glowAlpha: number;
  flashSize: number; flashMs: number; moteCount: number; moteSpeed: number; moteLife: number;
  pulseSize: number; pulseAlpha: number; pulseMs: number;
  colorCore: string; colorGlow: string; colorFlash: string; colorMote: string;
}

/** Renderer-facing pulse config (structural match of PulsePresetCfg — pixiFx stays import-light). */
export interface PulseCfg {
  style: 'ring' | 'shard' | 'nova';
  blend: 'add' | 'normal' | 'screen';
  ringCount: number; ringSize: number; ringWidth: number; ringSpeed: number; ringMs: number; ringStaggerMs: number;
  coreFlashSize: number; coreFlashMs: number;
  sparkCount: number; sparkSpeed: number; sparkLife: number; sparkSize: number;
  holdMs: number;
  colorRing: string; colorCore: string; colorSpark: string;
}

/** '#rrggbb' (or '#rgb') → 0xRRGGBB for the Pixi `tint` number. Defaults to white on a malformed string. */
const hexNum = (hex: string): number => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]! : h;
  const n = Number.parseInt(full, 16);
  return Number.isNaN(n) ? 0xffffff : n;
};

/** Ease-out cubic for the travelling ribbon head (matches the preview's `easeOut`). */
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

/** The strike motes decelerate hard: the preview's per-frame `v *= 0.86` → per-second (see `perFrameDrag`). */
const TENDRIL_MOTE_DRAG = perFrameDrag(0.86);

/** glowTex natural radius (px) at scale 1 — px dials ÷ this = sprite scale — so preview px radii transfer 1:1. */
const TENDRIL_GLOW_R = 40;

/** One live buff tendril: a per-frame-rebuilt tapered ribbon `Graphics` travelling from `from`→`to` along a
 *  quadratic curve (`ctl` control point, `perp` = the from→to normal for the wobble), plus its `cfg`, an `age`
 *  (ms), and a `struck` latch so the strike flash + motes fire exactly once on arrival. Not pooled — the ribbon
 *  is a Graphics rebuilt each frame (canvas geometry, not a CSS paint prop), destroyed when the tendril ends. */
interface Tendril {
  g: Graphics;
  from: { x: number; y: number };
  to: { x: number; y: number };
  ctl: { x: number; y: number };
  perp: { x: number; y: number };
  cfg: TendrilCfg;
  age: number;
  struck: boolean;
}

/** One live pulse blast at a point. Rings are staggered, so a tiny state entry emits ring `i` when its stagger
 *  time elapses (the pooled particles then animate on their own); the core flash + sparks fire at birth. Removed
 *  once every ring has been emitted and its life has elapsed. */
interface PulseFx {
  x: number; y: number;
  cfg: PulseCfg;
  age: number;          // ms lived
  ringsSpawned: number; // how many rings have been emitted so far
}

/**
 * A persistent divine-shield bubble bound to one unit (by uid). Unlike particles (fire-and-forget),
 * it lives until the shield breaks or is cleared, breathing on the ticker and tracking the unit's
 * on-screen rect. The React layers measure the rect and push it via `setShield`; this stays DOM-agnostic.
 */
/** Which flavour of persistent aura — gold glassy Divine Shield or blue wispy Reborn spirit. (Taunt no
 *  longer has a Pixi aura — it signifies via a static grey card border; see `.card.taunt` in styles.css.) */
type AuraKind = 'shield' | 'reborn';

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
/** Per-kind aura config: the fragment shader, base colour, and footprint margin (shield sits INSIDE the
 *  card frame; reborn rides slightly PROUD of it). */
const AURA: Record<AuraKind, { frag: string; rgb: number[]; tint: number; rimTint: number; margin: number }> = {
  shield: { frag: SHIELD_FRAG, rgb: SHIELD_GOLD_RGB, tint: 0xffd24a, rimTint: 0xffe9a8, margin: 1.16 },
  reborn: { frag: REBORN_FRAG, rgb: REBORN_BLUE_RGB, tint: 0x6ab0ff, rimTint: 0xbfe2ff, margin: 1.16 },
};
const auraKey = (kind: AuraKind, uid: string): string => `${kind}|${uid}`;
const auraMargin = (kind: AuraKind): number => AURA[kind].margin;

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
  private skullTex: Texture | null = null;         // the purple glowing ☠, glow baked in (Echo/Deathrattle FX)
  private skullSrcW = 1;
  private skullSrcH = 1;
  private readonly skullPops: SkullPop[] = [];
  private readonly tendrils: Tendril[] = []; // live buff tendrils — tapered ribbons advanced in `update`
  private readonly pulses: PulseFx[] = [];
  private shieldLayer: Container | null = null; // holds the persistent bubbles, beneath the particle layer
  private shieldApp: Application | null = null;  // OPTIONAL 2nd canvas for the persistent bubbles, mounted at a
  private underParent: HTMLElement | null = null; // low z (below the card badges) so the chrome reads on top; the
  //                                                 break burst still fires on the main (z110) canvas, over them.
  private shieldGeo: MeshGeometry | null = null; // shared quad geometry (−R..R, uv 0..1) for every bubble mesh
  private readonly shields = new Map<string, ShieldBubble>();
  private readonly live: Particle[] = [];
  private readonly pool: Sprite[] = [];
  private fadeRaf = 0; // in-flight setVisible fade (rAF) — cancelled if a new fade starts

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
      // Single-canvas mode: bubbles beneath the particle layer on the same canvas.
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
    this.buildSkullTex(); // the Echo skull: ☠ rendered purple with its glow baked into the texture
    app.ticker.add(this.update);
    this.ready = true;
  }

  /** Remove the canvas from the DOM and tear the app down. */
  detach(): void {
    if (!this.app) return;
    for (const p of this.live) p.sprite.destroy();
    this.live.length = 0;
    this.pool.length = 0;
    for (const s of this.skullPops) { s.sprite.destroy(); s.glow.destroy(); }
    this.skullPops.length = 0;
    for (const td of this.tendrils) { td.g.destroy(); }
    this.tendrils.length = 0;
    this.pulses.length = 0;
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
    const s = getStrikeFxConfig(); // live-tunable (DEV Lunge Strike Effects tuner)
    // Blow direction (unit vector); fall back to "up" if attacker/defender coincide.
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;

    // A burst of saturated colour, NORMAL blend, so the impact reads on the light "Sunward" cream
    // board (additive would just brighten cream toward white — near-invisible). A bright additive
    // core layers on top for the hot-glow pop.

    // Hot core flash — additive, brief, for the white-hot glint at the moment of contact.
    this.spawn(this.glowTex!, {
      x, y, vx: 0, vy: 0, drag: 1, life: 220, fromScale: 0.5, toScale: s.flashSize * power, spin: 0,
      tint: 0xffe6b0, blend: 'add',
    });
    // Coloured shockwave — normal blend, a saturated orange flash that actually paints over cream.
    this.spawn(this.glowTex!, {
      x, y, vx: 0, vy: 0, drag: 1, life: 300, fromScale: 0.3, toScale: s.shockwaveSize * power, spin: 0,
      tint: 0xff6a1e, blend: 'normal',
    });
    // Heavy hits (power ≳ 1.15) ripple a crisp expanding RING out of the contact — the "that one hurt"
    // punctuation a soft glow can't give. Ring size/opacity track the overage so it ramps, not toggles.
    if (power >= 1.15 && s.ringScale > 0) {
      const over = Math.min(1, (power - 1.15) / 0.85); // 0 at threshold → 1 at max power
      this.spawn(this.rimTex!, {
        x, y, vx: 0, vy: 0, drag: 1, life: 340 + over * 140,
        fromScale: 0.25, toScale: (1.6 + over * 1.6) * s.ringScale, spin: 0,
        tint: 0xffb054, blend: 'add', peakAlpha: 0.55 + over * 0.4,
      });
    }

    // Sparks — jagged saturated shards (rectangles + triangles, not soft dots), fanning out within the
    // configured cone of the blow direction and oriented ALONG their travel so they read as flung debris.
    // Normal blend + hot colours so they contrast the bright background.
    const VIS = s.sparkSize; // spark visibility (size)
    const count = Math.round(s.sparkCount * (0.7 + 0.3 * power)); // more shrapnel on heavier hits
    const cone = (s.sparkSpread * Math.PI) / 180;
    for (let i = 0; i < count; i++) {
      const spread = (Math.random() - 0.5) * cone;
      const cos = Math.cos(spread);
      const sin = Math.sin(spread);
      const dirX = ux * cos - uy * sin;
      const dirY = ux * sin + uy * cos;
      const speed = (320 + Math.random() * 620) * (0.85 + 0.15 * power) * s.sparkSpeed; // px/sec — flung harder when heavy
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
   * A procedural point-blast at (x, y) — the self-buff FX (owner-tuned per tribe on buff-pulse-preview.html).
   * `ringCount` expanding rings (staggered by `ringStaggerMs`, emitted from `update`), a core flash, and
   * `sparkCount` outward sparks. Sizes are px radii → ÷ the texture radius gives the sprite scale (1:1 with the
   * rig). Every dial lives in `cfg` (a structural mirror of PulsePresetCfg) so any preset drives it.
   */
  pulse(x: number, y: number, cfg: PulseCfg): void {
    if (!this.ready || !this.glowTex || !this.pulseTex || !this.layer) return;

    // Core flash — a soft glow disc that pops and fades.
    if (cfg.coreFlashMs > 0 && cfg.coreFlashSize > 0) {
      const s = cfg.coreFlashSize / TENDRIL_GLOW_R;
      this.spawn(this.glowTex, {
        x, y, vx: 0, vy: 0, drag: 1, life: cfg.coreFlashMs,
        fromScale: s * 0.3, toScale: s, spin: 0,
        tint: hexNum(cfg.colorCore), blend: cfg.blend, peakAlpha: 1,
      });
    }

    // Sparks — radial motes decelerating outward (glowTex, small).
    if (cfg.sparkCount > 0 && cfg.sparkSpeed > 0) {
      const sparkScale = cfg.sparkSize / TENDRIL_GLOW_R;
      for (let i = 0; i < cfg.sparkCount; i++) {
        const ang = (i / cfg.sparkCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
        const speed = cfg.sparkSpeed * (0.6 + Math.random() * 0.6);
        this.spawn(this.glowTex, {
          x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, drag: TENDRIL_MOTE_DRAG,
          life: cfg.sparkLife, fromScale: sparkScale, toScale: sparkScale * 0.2, spin: 0,
          tint: hexNum(cfg.colorSpark), blend: cfg.blend, peakAlpha: 0.9,
        });
      }
    }

    // Register the blast so `update` emits the staggered rings (ring 0 fires next frame at age ~0).
    this.pulses.push({ x, y, cfg, age: 0, ringsSpawned: 0 });
  }

  /** Emit ring index `i` of a pulse — a thin expanding ring (pulseTex) from ~0 out to `ringSize`. */
  private spawnPulseRing(p: PulseFx, i: number): void {
    if (!this.pulseTex) return;
    const cfg = p.cfg;
    const toScale = (cfg.ringSize / PULSE_TEX_R) * (1 - i * 0.12); // inner rings slightly smaller → concentric
    this.spawn(this.pulseTex, {
      x: p.x, y: p.y, vx: 0, vy: 0, drag: 1,
      life: cfg.ringMs / (cfg.ringSpeed > 0 ? cfg.ringSpeed : 1),
      fromScale: 0.15, toScale, spin: 0,
      tint: hexNum(cfg.colorRing), blend: cfg.blend, peakAlpha: 0.85,
    });
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
   * whole plume — both the ring spread and the puff sizes — for a bigger billow (callers may pass >1).
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
  setShield(uid: string, cx: number, cy: number, w: number, h: number, mini = false, kind: AuraKind = 'shield', track: ShieldBubble['track'] = null, instant = false): void {
    if (!this.ready || !this.shieldLayer) return;
    const key = auraKey(kind, uid);
    let b = this.shields.get(key);
    if (!b) {
      const container = new Container();
      // A quad mesh the aura shader draws onto. The geometry's UVs are a clean 0..1, so the fragment maps the
      // sphere/wisp exactly. The container scales it to the card footprint; the shader is chosen per kind.
      const uniforms: Record<string, { value: number | Float32Array; type: string }> = {
        uTime: { value: 0, type: 'f32' },
        uAspect: { value: w / Math.max(1, h), type: 'f32' },
        uColor: { value: new Float32Array(AURA[kind].rgb), type: 'vec3<f32>' },
        uSeed: { value: (this.shields.size % 7) * 1.3, type: 'f32' }, // de-sync neighbours' pulses
      };
      const shader = Shader.from({
        gl: { vertex: SHIELD_VERT, fragment: AURA[kind].frag },
        resources: { shieldUniforms: uniforms },
      });
      const mesh = new Mesh({ geometry: this.shieldGeo!, shader });
      container.addChild(mesh);
      // `instant` (a bubble re-created across a combat↔recruit transition, not a genuine recruit play) → born
      // fully-formed at full alpha, so it doesn't replay its deploy snap-in as the board swaps.
      container.alpha = instant ? 1 : 0;
      this.shieldLayer.addChild(container);
      b = { kind, container, mesh, shader, cx, cy, w, h, age: 0, formIn: instant ? 1e6 : 0, fadeOut: -1,
            mini, pop: -1, scaleMul: mini ? MINI_SCALE : 1, rot: 0, track };
      this.shields.set(key, b);
    } else {
      b.cx = cx; b.cy = cy; b.w = w; b.h = h; b.track = track;
      b.fadeOut = -1; // re-targeted while fading (re-gained) → cancel the fade
      if (instant) b.formIn = 1e6; // combat↔recruit swap: force fully-formed even if the bubble already exists (churn)
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

  /** The tracked center + footprint of `uid`'s aura bubble, or null if none — for a caller needing explicit
   *  coords rather than the bubble's own stored ones (breakShield reads the latter directly). */
  auraRect(uid: string, kind: AuraKind = 'shield'): { cx: number; cy: number; w: number; h: number } | null {
    const b = this.shields.get(auraKey(kind, uid));
    return b ? { cx: b.cx, cy: b.cy, w: b.w, h: b.h } : null;
  }

  /** Show/hide ALL shield bubbles at once — used to suppress them behind a board-covering modal (Discover /
   *  Choose One sit below the FX canvas with a translucent backdrop, so bubbles would otherwise show over it). */
  setShieldsVisible(visible: boolean): void {
    if (this.shieldLayer) this.shieldLayer.visible = visible;
  }

  /** Freeze/thaw ALL Pixi motion — stops the ticker, so every live particle + the bubble breathing holds its
   *  last frame in place. Used by the Skip-combat fade so nothing keeps moving while the board pauses + fades
   *  out (the canvas opacity is faded separately via CSS, which doesn't need the ticker running). */
  setPaused(paused: boolean): void {
    if (!this.app) return;
    if (paused) this.app.ticker.stop();
    else this.app.ticker.start();
  }

  /** Fade the WHOLE FX layer (both canvases) in/out over `ms` — used by the Skip transition so every particle +
   *  persistent aura bubble fades WITH the board. The canvases are mounted app-wide at BODY level (outside
   *  `.app`), so a CSS `.app.combatout` selector can't reach them; and a CSS *transition* never progresses on a
   *  live WebGL canvas (the render loop defeats it — an inline `opacity:0` stays computed `1` under a transition,
   *  but holds under `transition:none`). So we step the opacity ourselves each frame via rAF (which keeps running
   *  even while the Pixi/GSAP tickers are paused for the freeze). `ms = 0` = an instant set. */
  setVisible(visible: boolean, ms = 260): void {
    const canvases = [this.app?.canvas, this.shieldApp?.canvas].filter(Boolean) as HTMLCanvasElement[];
    if (!canvases.length) return;
    for (const c of canvases) c.style.transition = 'none'; // the fade is rAF-driven, not CSS
    cancelAnimationFrame(this.fadeRaf);
    const to = visible ? 1 : 0;
    if (ms <= 0) { for (const c of canvases) c.style.opacity = String(to); return; }
    const from = Number.parseFloat(canvases[0].style.opacity || '1');
    let start = 0;
    const step = (now: number): void => {
      if (!start) start = now;
      const k = Math.min(1, (now - start) / ms);
      const o = String(from + (to - from) * k);
      for (const c of canvases) c.style.opacity = o;
      if (k < 1) this.fadeRaf = requestAnimationFrame(step);
    };
    this.fadeRaf = requestAnimationFrame(step);
  }

  /** Instantly clear every TRANSIENT effect (dust, sparks, trails, skull pops) — recycled to the pool — so
   *  nothing lingers on the canvas mid-transition. Used by the Skip fade. Persistent aura bubbles are untouched
   *  (they fade with the canvas opacity, then re-resolve with the settled board). */
  clearParticles(): void {
    for (const p of this.live) { p.sprite.visible = false; this.layer?.removeChild(p.sprite); this.pool.push(p.sprite); }
    this.live.length = 0;
    for (const sp of this.skullPops) {
      for (const s of [sp.sprite, sp.glow]) { s.visible = false; this.layer?.removeChild(s); this.pool.push(s); }
    }
    this.skullPops.length = 0;
    // Tendril ribbons are Graphics (not pooled) — destroy them outright.
    for (const td of this.tendrils) { this.layer?.removeChild(td.g); td.g.destroy(); }
    this.tendrils.length = 0;
    this.pulses.length = 0;
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

    // NB: additive gold washes out to near-white on the light "Sunward" cream board (the burst was invisible —
    // see impact()'s same note). So the READABLE elements below use NORMAL blend with SATURATED gold that paints
    // over cream; a hot additive core/rim layers on top for the glassy glint.

    // 1) CRACK — a saturated-gold flash (normal, paints over cream) + a hot additive core glint.
    this.spawn(this.bubbleTex!, {
      x: cx, y: cy, vx: 0, vy: 0, drag: 1, life: 190, fromScale: rad / BUBBLE_TEX_R,
      toScale: (rad / BUBBLE_TEX_R) * 1.22, spin: 0, tint: 0xeca310, blend: 'normal', peakAlpha: 0.92,
    });
    this.spawn(this.bubbleTex!, {
      x: cx, y: cy, vx: 0, vy: 0, drag: 1, life: 150, fromScale: (rad / BUBBLE_TEX_R) * 0.5,
      toScale: (rad / BUBBLE_TEX_R) * 1.0, spin: 0, tint: 0xfff3c8, blend: 'add', // hot glint core
    });
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI;
      this.spawn(this.veinTex!, {
        x: cx, y: cy, vx: 0, vy: 0, drag: 1, life: 140, fromScale: (rad / 26) * 1.1, toScale: rad / 26,
        spin: 0, rotation: a, tint: 0xb87608, blend: 'normal', peakAlpha: 0.92, // dark-gold fracture lines
      });
    }

    // 2) SHOCKWAVE — a saturated-gold ring expanding past the bubble edge (normal, reads on cream) + a fainter
    //    hot additive rim for the glassy pop.
    this.spawn(this.rimTex!, {
      x: cx, y: cy, vx: 0, vy: 0, drag: 1, life: 460, fromScale: (rad / BUBBLE_TEX_R) * 0.85,
      toScale: (rad / BUBBLE_TEX_R) * 2.1, spin: 0, tint: 0xe09410, blend: 'normal', peakAlpha: 0.9,
    });
    this.spawn(this.rimTex!, {
      x: cx, y: cy, vx: 0, vy: 0, drag: 1, life: 360, fromScale: (rad / BUBBLE_TEX_R) * 0.85,
      toScale: (rad / BUBBLE_TEX_R) * 1.9, spin: 0, tint: 0xffe27a, blend: 'add', peakAlpha: 0.7,
    });

    // 3) SHRAPNEL — golden shards flung radially out of the rim (normal + saturated golds so they read as debris
    //    over the cream, not washed-out glints).
    const shards = 22;
    for (let i = 0; i < shards; i++) {
      const a = (i / shards) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const speed = 320 + Math.random() * 640;
      const tex = Math.random() < 0.5 ? this.shardRectTex! : this.shardTriTex!;
      const warm = Math.random();
      const tint = warm < 0.5 ? 0xd18a10 : warm < 0.85 ? 0xefac20 : 0xffcb4a;
      this.spawn(tex, {
        x: cx + Math.cos(a) * rad * 0.7, y: cy + Math.sin(a) * rad * 0.7,
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, drag: 0.12,
        life: 420 + Math.random() * 360, fromScale: 0.9 + Math.random() * 0.7, toScale: 0.05,
        spin: (Math.random() - 0.5) * 10, rotation: a, tint, blend: 'normal',
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
  /** Build the Echo skull texture: the vendored ☠ silhouette drawn purple with the `.float.rally.sym`
   *  `text-shadow` glow stack BAKED IN, so the glow travels with the sprite through the pop and the dissolve.
   *  Synchronous (no asset fetch) — a `deathrattle()` before it exists simply no-ops. The canvas keeps its glow
   *  padding, and `skullSrcW`/`skullSrcH` are the full padded box; the Pixi sprite scales uniformly, so the
   *  tall silhouette's aspect is preserved and display sizing tracks its width (see `deathrattle`). */
  private buildSkullTex(): void {
    if (typeof document === 'undefined') return;
    try {
      const box = 256, pad = Math.round(box * 0.42); // long edge, plus room for the blur to fall off
      const aspect = DR_SVG_W / DR_SVG_H;
      const cw = aspect < 1 ? box * aspect : box;
      const ch = aspect < 1 ? box : box / aspect;
      const c = document.createElement('canvas');
      c.width = Math.round(cw + pad * 2);
      c.height = Math.round(ch + pad * 2);
      const g = c.getContext('2d'); if (!g) return;
      g.fillStyle = DR_FILL;
      const paths = DR_SVG_PATHS.map((d) => new Path2D(d));
      const draw = (): void => {
        g.save();
        g.translate(pad, pad);
        g.scale(cw / DR_SVG_W, ch / DR_SVG_H);
        for (const p of paths) g.fill(p);
        g.restore();
      };
      const glow = `#${DR_GLOW.toString(16).padStart(6, '0')}`;
      // Three shadowed passes ≈ the text-shadow stack on `.float.rally.sym`, then a crisp core.
      const passes: [string, number, number][] = [[glow, box * 0.31, 0.95], [glow, box * 0.17, 0.9], [DR_FILL, box * 0.06, 1]];
      for (const [col, blur, a] of passes) {
        g.globalAlpha = a; g.shadowColor = col; g.shadowBlur = blur;
        draw();
      }
      g.globalAlpha = 1; g.shadowBlur = 0;
      draw();
      this.skullTex = Texture.from(c);
      this.skullSrcW = c.width;
      this.skullSrcH = c.height;
    } catch (e) {
      console.error('[pixiFx] skull texture build failed — Echo FX disabled:', e);
    }
  }

  /** Echo (Deathrattle) death FX: a purple glowing ☠ pops up over the dying unit, holds, then POOFS — the
   *  skull dissolves outward as a purple flash pulses, a smoke plume blasts out, and glowing embers scatter.
   *  `(x, y)` = the unit's viewport center; `size` ≈ its card width. No-op if the skull texture never built. */
  deathrattle(x: number, y: number, size: number): void {
    if (!this.ready || !this.skullTex || !this.glowTex || !this.layer) return;
    const scale = (size * DR_SKULL_SCALE) / this.skullSrcW; // maps the padded skull texture → display px
    const sprite = this.pool.pop() ?? new Sprite();
    sprite.texture = this.skullTex;
    sprite.anchor.set(0.5);
    sprite.rotation = 0; // ALWAYS upright — reset the pooled sprite's stale rotation from its prior particle life
    sprite.blendMode = 'normal';
    sprite.tint = 0xffffff; // the purple is baked into the texture
    sprite.alpha = 1;
    sprite.x = x; sprite.y = y;
    sprite.scale.set(0.001);
    sprite.visible = true;
    // an additive bloom behind it, so the skull glows against the dark board rather than sitting flat on it
    const glow = this.pool.pop() ?? new Sprite();
    glow.texture = this.glowTex;
    glow.anchor.set(0.5);
    glow.rotation = 0;
    glow.blendMode = 'add';
    glow.tint = DR_GLOW;
    glow.alpha = 0;
    glow.x = x; glow.y = y;
    glow.scale.set(0.001);
    glow.visible = true;
    this.layer.addChild(glow); // behind…
    this.layer.addChild(sprite); // …the skull
    this.skullPops.push({ sprite, glow, x, y, scale, age: 0 });
  }

  /** Fire the poof at the end of a skull's pop: the skull dissolves (scale-up + fade), a purple flash pulses,
   *  a purple smoke plume blasts outward, and glowing embers scatter — all fire-and-forget particles. No
   *  fragments, no splinters, no gravity: this is a magical poof, not a shatter. */
  private burstSkull(s: SkullPop): void {
    const { x, y, scale } = s, disp = scale * this.skullSrcW;
    const g = this.glowTex!;
    sfx.skullBurst(); // fired exactly as the skull goes

    // 1) the skull itself dissolves — scales up and fades. Without this it would simply vanish; THIS is the poof.
    this.spawn(this.skullTex!, {
      x, y, vx: 0, vy: -14, drag: DR_DRAG_DISSOLVE, life: DR_DISSOLVE_MS,
      fromScale: scale, toScale: scale * DR_DISSOLVE_GROW, spin: 0, tint: 0xffffff, blend: 'normal', peakAlpha: 1,
    });

    // 2) the flash at the moment it goes
    if (DR_FLASH_MS > 0) {
      this.spawn(g, {
        x, y, vx: 0, vy: 0, drag: 1, life: DR_FLASH_MS,
        fromScale: disp * 0.006 * DR_FLASH_SIZE * DR_GLOW_K, toScale: disp * 0.016 * DR_FLASH_SIZE * DR_GLOW_K,
        spin: 0, tint: DR_GLOW, blend: 'add', peakAlpha: 0.75,
      });
    }

    // 3) the purple smoke plume — `DR_SMOKE_OUT` blends between rising (0) and blasting outward (1)
    const nsm = Math.round(28 * DR_SMOKE), out = DR_SMOKE_OUT;
    for (let i = 0; i < nsm; i++) {
      const a = Math.random() * 6.28, sp = (55 + Math.random() * 95) * DR_SPREAD;
      this.spawn(g, {
        x: x + (Math.random() - 0.5) * disp * 0.5, y: y + (Math.random() - 0.5) * disp * 0.4,
        vx: Math.cos(a) * sp * out, vy: Math.sin(a) * sp * out - (1 - out) * (45 + Math.random() * 85),
        drag: DR_DRAG_SMOKE, gravity: 0, life: DR_SMOKE_LIFE * (0.75 + Math.random() * 0.5),
        fromScale: disp * 0.004 * (0.7 + Math.random() * 0.5) * DR_GLOW_K,
        toScale: disp * 0.012 * (0.7 + Math.random() * 0.6) * DR_GLOW_K,
        spin: (Math.random() - 0.5) * 1.2, tint: Math.random() < 0.5 ? DR_SMOKE_A : DR_SMOKE_B,
        blend: 'normal', peakAlpha: 0.34 * (0.8 + Math.random() * 0.4),
      });
    }

    // 4) glowing purple embers — radial, heavily dragged, shrinking to nothing (these carry the explosion)
    const nem = Math.round(14 * DR_EMBERS);
    for (let i = 0; i < nem; i++) {
      const a = Math.random() * 6.28, sp = (240 + Math.random() * 300) * DR_SPREAD;
      this.spawn(g, {
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        drag: DR_DRAG_EMBER, gravity: 0, life: DR_EMBER_LIFE * (0.7 + Math.random() * 0.6),
        fromScale: disp * 0.0045 * (0.6 + Math.random() * 0.8) * DR_GLOW_K, toScale: 0.001,
        spin: 0, tint: Math.random() < 0.5 ? DR_EMBER_A : DR_EMBER_B, blend: 'add', peakAlpha: 1,
      });
    }
  }

  /**
   * BUFF TENDRIL: a unit at `from` empowers a unit at `to` — a caster pulse fires at the source, then a
   * curved, tapered energy ribbon travels (head easing out over `cfg.travelMs`) to the target, strikes with a
   * flash + scattered motes on arrival, and retracts/fades over `cfg.retractMs`. Config-driven (all dials from
   * `cfg`), so any preset drives the look. Ports the preview's path/ribbon/strike math (see the block-comment
   * on `TendrilCfg`). No-op until the overlay is ready.
   *
   * NB (units): `flashSize`/`pulseSize` are PX RADII, 1:1 with the preview rig — a value ÷ `TENDRIL_GLOW_R`
   * (glowTex natural radius) is the sprite scale, so the owner's pasted preview JSON needs NO bake conversion.
   */
  buffTendril(from: { x: number; y: number }, to: { x: number; y: number }, cfg: TendrilCfg): void {
    if (!this.ready || !this.glowTex || !this.layer) return;

    // Caster pulse at the source, once per launch — an additive glow that blooms and fades (preview `pulse`).
    // `pulseSize` is a px radius → ÷ TENDRIL_GLOW_R gives the sprite scale.
    if (cfg.pulseMs > 0) {
      const pulseScale = cfg.pulseSize / TENDRIL_GLOW_R;
      this.spawn(this.glowTex, {
        x: from.x, y: from.y, vx: 0, vy: 0, drag: 1, life: cfg.pulseMs,
        fromScale: pulseScale, toScale: pulseScale, spin: 0,
        tint: hexNum(cfg.colorGlow), blend: cfg.blend, peakAlpha: cfg.pulseAlpha,
      });
    }

    // Quadratic control point: the midpoint pushed PERPENDICULAR to the from→to line by curve·dist·0.5 (preview
    // `controlPoint`). `perp` is reused for the sine wobble offset in `sampleTendril`.
    const mx = (from.x + to.x) / 2;
    const my = (from.y + to.y) / 2;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const perp = { x: -dy / len, y: dx / len };
    const off = len * cfg.curve * 0.5;
    const ctl = { x: mx + perp.x * off, y: my + perp.y * off };

    // The ribbon is a Graphics rebuilt each frame in `update` (additive, matching the preview's 'lighter'). It
    // is NOT drawn to full length now — `update` reveals it up to the travelling head.
    const g = new Graphics();
    g.blendMode = cfg.blend;
    this.layer.addChild(g);
    this.tendrils.push({
      g, from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, ctl, perp, cfg, age: 0, struck: false,
    });
  }

  /** Sample ~24 points along the tendril's quadratic curve, up to head fraction `head` (0..1). The sine wobble
   *  is enveloped by sin(π·t) so both ends pin. Mirrors the preview's `samplePath`/`tendrilPoint`. */
  private sampleTendril(td: Tendril, head: number): { x: number; y: number; t: number }[] {
    const { from, to, ctl, perp, cfg } = td;
    const N = 24;
    const upto = Math.max(0.0001, head);
    const pts: { x: number; y: number; t: number }[] = [];
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * upto;
      const mt = 1 - t;
      const bx = mt * mt * from.x + 2 * mt * t * ctl.x + t * t * to.x;
      const by = mt * mt * from.y + 2 * mt * t * ctl.y + t * t * to.y;
      const env = Math.sin(Math.PI * t);
      const w = Math.sin(t * cfg.wobbleFreq * Math.PI * 2) * cfg.wobbleAmp * env;
      pts.push({ x: bx + perp.x * w, y: by + perp.y * w, t });
    }
    return pts;
  }

  /** Offset each path point by ±halfWidth along its normal → a tapered ribbon polygon (base width at the
   *  source, tapering to `tipWidth/baseWidth` of it at the head). Returns a flat [x0,y0,x1,y1,…] point list. */
  private buildRibbonPoly(pts: { x: number; y: number }[], maxWidth: number, ratio: number): number[] {
    const n = pts.length;
    if (n < 2) return [];
    const left: number[] = [];
    const right: number[] = [];
    for (let i = 0; i < n; i++) {
      const prev = pts[Math.max(0, i - 1)]!;
      const next = pts[Math.min(n - 1, i + 1)]!;
      let tx = next.x - prev.x;
      let ty = next.y - prev.y;
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl; ty /= tl;
      const nx = -ty; // normal
      const ny = tx;
      const f = i / (n - 1);
      const hw = maxWidth * (1 + (ratio - 1) * f) * 0.5; // half-width, tapering base→tip
      const p = pts[i]!;
      left.push(p.x + nx * hw, p.y + ny * hw);
      right.push(p.x - nx * hw, p.y - ny * hw);
    }
    // left edge forward, then right edge backward → one closed ribbon polygon
    const poly = left.slice();
    for (let i = n - 1; i >= 0; i--) poly.push(right[i * 2]!, right[i * 2 + 1]!);
    return poly;
  }

  /** Rebuild a tendril's ribbon: a soft-glow underlay (`glowWidth`) beneath a bright core (`baseWidth`), both
   *  tapered by the same tip ratio. `fade` (0..1) fades the whole ribbon during retract. */
  private rebuildRibbon(g: Graphics, pts: { x: number; y: number; t: number }[], cfg: TendrilCfg, fade: number): void {
    g.clear();
    if (pts.length < 2 || fade <= 0) return;
    const ratio = cfg.tipWidth / Math.max(0.0001, cfg.baseWidth);
    const glow = this.buildRibbonPoly(pts, cfg.glowWidth, ratio);
    if (glow.length >= 6) g.poly(glow).fill({ color: hexNum(cfg.colorGlow), alpha: Math.max(0, cfg.glowAlpha * fade) });
    const core = this.buildRibbonPoly(pts, cfg.baseWidth, ratio);
    if (core.length >= 6) g.poly(core).fill({ color: hexNum(cfg.colorCore), alpha: Math.max(0, cfg.coreAlpha * fade) });
  }

  /** The strike on arrival: a radial bloom at the target + `moteCount` motes flung outward, shrinking to
   *  nothing (preview `strike`). Fired once per tendril when its head first reaches `to`. */
  private tendrilStrike(td: Tendril): void {
    const { to, cfg } = td;
    if (cfg.flashMs > 0) {
      // `flashSize` is a px radius → ÷ TENDRIL_GLOW_R gives the sprite scale; grows ×1.4 as it fades.
      const flashScale = cfg.flashSize / TENDRIL_GLOW_R;
      this.spawn(this.glowTex!, {
        x: to.x, y: to.y, vx: 0, vy: 0, drag: 1, life: cfg.flashMs,
        fromScale: flashScale, toScale: flashScale * 1.4, spin: 0, // grows a touch as it fades (preview grow 1.4)
        tint: hexNum(cfg.colorFlash), blend: cfg.blend, peakAlpha: 1,
      });
    }
    const n = Math.round(cfg.moteCount);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = cfg.moteSpeed * (0.5 + Math.random() * 0.7);
      this.spawn(this.glowTex!, {
        x: to.x, y: to.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        drag: TENDRIL_MOTE_DRAG, life: cfg.moteLife * (0.7 + Math.random() * 0.6),
        // ~7px-radius motes on the glowTex (preview mote base size 7), shrinking to nothing.
        fromScale: (7 / TENDRIL_GLOW_R) * (0.6 + Math.random() * 0.8), toScale: 0.02, spin: 0,
        tint: hexNum(cfg.colorMote), blend: cfg.blend, peakAlpha: 1,
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

    // Echo skulls: elastic pop-in (+ a tiny wind-up jiggle) over an additive glow, then POOF into smoke/embers.
    for (let i = this.skullPops.length - 1; i >= 0; i--) {
      const sp = this.skullPops[i]!;
      sp.age += dtMs;
      if (sp.age < DR_POP_MS + DR_HOLD_MS) {
        const k = Math.min(1, sp.age / DR_POP_MS);
        const e = k >= 1 ? 1 : Math.pow(2, -10 * k) * Math.sin((k - 0.075) * (2 * Math.PI / 0.32)) + 1; // elastic-out
        const jig = sp.age > DR_POP_MS ? 1 + Math.sin((sp.age - DR_POP_MS) / DR_HOLD_MS * Math.PI) * 0.03 : 1;
        const sc = sp.scale * (0.2 + 0.8 * e) * jig;
        const y = sp.y - k * DR_RISE; // pops upward a touch
        sp.sprite.scale.set(sc);
        sp.sprite.y = y;
        // the glow tracks the skull's display LONG edge (glowTex is 80px wide at scale 1), so a tall
        // silhouette still blooms evenly rather than being sized off its narrow width
        sp.glow.scale.set((Math.max(this.skullSrcW, this.skullSrcH) * sc * DR_GLOW_SIZE) / 80);
        sp.glow.y = y;
        sp.glow.alpha = DR_GLOW_ALPHA * Math.min(1, k * 1.5);
      } else {
        this.burstSkull({ ...sp, y: sp.y - DR_RISE }); // poof where the skull actually ended up
        for (const s of [sp.sprite, sp.glow]) { s.visible = false; this.layer?.removeChild(s); this.pool.push(s); }
        this.skullPops.splice(i, 1);
      }
    }

    // Buff tendrils: reveal the tapered ribbon up to the travelling head, strike on arrival, then retract+fade.
    for (let i = this.tendrils.length - 1; i >= 0; i--) {
      const td = this.tendrils[i]!;
      td.age += dtMs;
      const travel = Math.max(1, td.cfg.travelMs);
      const head = easeOutCubic(Math.min(1, td.age / travel));

      // Fire the strike ONCE the moment the head first reaches the target.
      if (!td.struck && td.age >= travel) { td.struck = true; this.tendrilStrike(td); }

      // Retract/dissolve after arrival: the tail slides toward the target and the whole ribbon fades out.
      let tail = 0;
      let fade = 1;
      if (td.struck) {
        const rt = Math.min(1, (td.age - travel) / Math.max(1, td.cfg.retractMs));
        tail = rt;
        fade = 1 - rt;
      }
      if (td.struck && td.age >= travel + td.cfg.retractMs) {
        this.layer?.removeChild(td.g);
        td.g.destroy();
        this.tendrils.splice(i, 1);
        continue;
      }

      let pts = this.sampleTendril(td, head);
      if (tail > 0) pts = pts.filter((p) => p.t >= tail * head); // drop points behind the retracting tail
      this.rebuildRibbon(td.g, pts, td.cfg, fade);
    }

    // Pulse blasts: emit each ring as its stagger time elapses; retire once all rings emitted + last life done.
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i]!;
      p.age += dtMs;
      while (p.ringsSpawned < p.cfg.ringCount && p.age >= p.ringsSpawned * p.cfg.ringStaggerMs) {
        this.spawnPulseRing(p, p.ringsSpawned);
        p.ringsSpawned++;
      }
      const lastRingBorn = (p.cfg.ringCount - 1) * p.cfg.ringStaggerMs;
      const ringLife = p.cfg.ringMs / (p.cfg.ringSpeed > 0 ? p.cfg.ringSpeed : 1);
      if (p.ringsSpawned >= p.cfg.ringCount && p.age >= lastRingBorn + ringLife) {
        this.pulses.splice(i, 1); // the spawned ring particles finish on their own in the pool
      }
    }

    // Persistent shield bubbles: advance the slow breathe + grow-in/fade, and sit on each unit's rect.
    for (const [uid, b] of this.shields) {
      b.age += dtMs;
      // Live-track the card in THIS frame (after GSAP's lunge/recoil transform) so the aura never trails it.
      if (b.track) { const r = b.track(); if (r) { b.cx = r.cx; b.cy = r.cy; b.w = r.w; b.h = r.h; b.rot = r.rot; } }
      else b.rot = 0;
      // grow-in (gain) and optional fade-out (graceful clear): shield/reborn fade in + settle gently.
      const formT = Math.min(1, b.formIn / FORM_MS);
      b.formIn += dtMs;
      const formEase = 1 - (1 - formT) * (1 - formT);
      let life = formEase;                                      // overall opacity envelope
      const extraScale = 1 + (1 - formEase) * 0.16;             // start a touch large, settle
      if (b.fadeOut >= 0) {
        const fT = Math.min(1, b.fadeOut / FADE_MS);
        b.fadeOut += dtMs;
        life *= 1 - fT;
        if (fT >= 1) { b.shader.destroy(); b.container.destroy({ children: true }); this.shields.delete(uid); continue; }
      }
      // a subtle container size-breathe — REBORN only. The divine shield holds a steady size (its colour/energy
      // pulse, owned by the shader, still breathes); only the wispy reborn bobs.
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
      const margin = AURA[b.kind].margin;
      const sx = (b.w * 0.5 * margin) / BUBBLE_TEX_R;
      const sy = (b.h * 0.5 * margin) / BUBBLE_TEX_R;
      const grow = breatheScale * extraScale * b.scaleMul;
      b.container.x = b.cx;
      b.container.y = b.cy;
      b.container.scale.set(sx * grow, sy * grow);
      b.container.rotation = b.rot; // ride the card's lunge tilt (0 for non-tracked / recruit auras)
      b.container.alpha = life; // form-in / fade / mini envelope; the shader owns its internal opacity
      // drive the shield shader
      const u = (b.shader.resources.shieldUniforms as { uniforms: Record<string, number | Float32Array> }).uniforms;
      u.uTime = b.age / 1000;
      u.uAspect = b.w / Math.max(1, b.h);
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

// DEV: expose for live effect tuning + manual firing from the console (mirrors the LungeTuner /
// SfxMixer dev affordances). Stripped from production by the static env check.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  const w = window as unknown as { __pixiFx: FxController; __discoverFx: FxController; __shieldDemo: (loops?: number) => void };
  w.__pixiFx = pixiFx;
  w.__discoverFx = discoverFx;
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
