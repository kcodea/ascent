import { describe, expect, it } from 'vitest';
import { FBM_GLSL, HASH_GLSL, NOISE_GLSL, POSTERIZE_PAL_GLSL, VNOISE_GLSL } from './shaderChunks';

/**
 * These chunks are raw GLSL strings spliced into a larger shader source at runtime — there's no GLSL
 * compiler available in vitest to actually validate them (compiling requires a live GL context, which this
 * suite deliberately avoids — see burst.test.ts/ribbon.test.ts's own comments on the same constraint). What
 * IS testable without a GL context: that the extraction didn't produce empty/truncated strings, that each
 * chunk still declares the function it's named for, and — the one property this whole module exists to
 * guarantee — that `posterizePal`'s band-quantisation math is byte-for-byte the same expression as
 * `ribbon.ts`'s validated `RIBBON_FRAG` (`floor(q * uBands) / max(uBands - 1.0, 1.0)`, just with `intensity`
 * standing in for `q` and a local `bands` parameter standing in for the free uniform `uBands`).
 */
describe('shaderChunks', () => {
  it('exports non-empty GLSL for every chunk', () => {
    for (const chunk of [HASH_GLSL, VNOISE_GLSL, FBM_GLSL, NOISE_GLSL, POSTERIZE_PAL_GLSL]) {
      expect(chunk.trim().length).toBeGreaterThan(0);
    }
  });

  it('hash/vnoise/fbm each declare the function they are named for', () => {
    expect(HASH_GLSL).toMatch(/float hash\(vec2 p\)/);
    expect(VNOISE_GLSL).toMatch(/float vnoise\(vec2 p\)/);
    expect(FBM_GLSL).toMatch(/float fbm\(vec2 p\)/);
  });

  it('NOISE_GLSL concatenates hash, vnoise, and fbm in dependency order', () => {
    expect(NOISE_GLSL).toBe(HASH_GLSL + VNOISE_GLSL + FBM_GLSL);
    const hashIdx = NOISE_GLSL.indexOf('float hash(');
    const vnoiseIdx = NOISE_GLSL.indexOf('float vnoise(');
    const fbmIdx = NOISE_GLSL.indexOf('float fbm(');
    expect(hashIdx).toBeGreaterThanOrEqual(0);
    expect(vnoiseIdx).toBeGreaterThan(hashIdx);
    expect(fbmIdx).toBeGreaterThan(vnoiseIdx);
  });

  it('posterizePal takes (intensity, bands, pal[4]) and returns vec4', () => {
    expect(POSTERIZE_PAL_GLSL).toMatch(/vec4 posterizePal\(float intensity, float bands, vec4 pal\[4\]\)/);
  });

  it('posterizePal band-quantises with the exact ribbon.ts expression: floor(q * bands) / max(bands - 1.0, 1.0)', () => {
    // This is the one load-bearing line RIBBON_FRAG's own header comment calls out as the style signature
    // (hard cel bands, not a smooth ramp) — assert it survived the extraction unchanged in shape, just with
    // `bands`/`intensity` as parameters instead of `uBands`/`q` as free uniform + local.
    expect(POSTERIZE_PAL_GLSL).toMatch(/floor\(q \* bands\) \/ max\(bands - 1\.0, 1\.0\)/);
  });

  it('posterizePal has the same 4-stop mix/early-out shape as ribbon.ts\'s pal()', () => {
    // ribbon.ts: `if (i >= 3) return uPal[3]; return mix(uPal[i], uPal[i + 1], fract(s));`
    expect(POSTERIZE_PAL_GLSL).toMatch(/if \(i >= 3\) return pal\[3\];/);
    expect(POSTERIZE_PAL_GLSL).toMatch(/return mix\(pal\[i\], pal\[i \+ 1\], fract\(s\)\);/);
  });
});
