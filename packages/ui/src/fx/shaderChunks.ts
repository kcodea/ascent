/**
 * Shared GLSL ES 3.0 source fragments, extracted from `ribbon.ts`'s validated fragment shader so a second
 * shader (the posterized particle material — see `particleMaterial.ts`) can reuse the exact same math
 * instead of re-inlining a second, driftable copy. These are plain strings, `#include`'d into a larger
 * shader source by string concatenation/template interpolation — there is no GLSL preprocessor `#include`
 * in WebGL, so the caller just splices the string in above `main()`.
 *
 * `ribbon.ts` itself is intentionally left untouched (it's the validated reference — see its own header
 * comment); nothing here changes its behaviour or is imported by it.
 */

/** Cheap 2D hash, `[0, 1)`. The seed for `vnoise`/`fbm` below — verbatim from `ribbon.ts`'s `hash()`. */
export const HASH_GLSL = /* glsl */ `
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
`;

/** Value noise (smoothstep-interpolated lattice hash) — verbatim from `ribbon.ts`'s `vnoise()`. Depends on
 *  `hash()` above; callers must splice `HASH_GLSL` in before this. */
export const VNOISE_GLSL = /* glsl */ `
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1, 0));
  float c = hash(i + vec2(0, 1)), d = hash(i + vec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
`;

/** 3-octave fractal Brownian motion — verbatim from `ribbon.ts`'s `fbm()`. Depends on `vnoise()` above. */
export const FBM_GLSL = /* glsl */ `
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return v;
}
`;

/** `HASH_GLSL` + `VNOISE_GLSL` + `FBM_GLSL` concatenated in dependency order — the convenience import for a
 *  shader that wants the whole noise stack (a single `#include`-style splice instead of three). */
export const NOISE_GLSL = HASH_GLSL + VNOISE_GLSL + FBM_GLSL;

/**
 * Band-quantise `intensity` into `bands` hard cel steps, then look the result up in a 4-stop rim→core
 * palette (mixing between adjacent stops only inside a step's own [0,1] fractional remainder, exactly like
 * a gradient with `bands` flat plateaus). This is `ribbon.ts`'s `pal(b)` where
 * `b = floor(q * uBands) / max(uBands - 1.0, 1.0)`, combined into one function so a caller doesn't need a
 * second global `uPal` — the palette is a parameter here, not a free variable, so this chunk has no
 * dependency on any particular uniform name. Matches the ribbon's math exactly, including the `i >= 3`
 * early-out that avoids reading `pal[4]` (out of bounds) when `q` rounds up to exactly 1.0.
 */
export const POSTERIZE_PAL_GLSL = /* glsl */ `
vec4 posterizePal(float intensity, float bands, vec4 pal[4]) {
  float q = clamp(intensity, 0.0, 1.0);
  float b = floor(q * bands) / max(bands - 1.0, 1.0);
  float s = clamp(b, 0.0, 1.0) * 3.0;
  int i = int(floor(s));
  if (i >= 3) return pal[3];
  return mix(pal[i], pal[i + 1], fract(s));
}
`;
