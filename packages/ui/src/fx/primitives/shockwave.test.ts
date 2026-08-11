import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultsOf, validateSpecs, type FxParamSpec, type FxParamSpecs } from '../params';
import { isIdentityCurve } from '../curve';
import { QUAD_SCALE, SHOCKWAVE_FRAG, shockwaveOneShotDurationSec, shockwavePrimitive } from './shockwave';

const SHOCKWAVE_SRC = readFileSync(new URL('./shockwave.ts', import.meta.url), 'utf8');

describe('shockwave param specs', () => {
  it('has no self-contradictory defaults (registration-time invariant)', () => {
    expect(validateSpecs(shockwavePrimitive.params)).toEqual([]);
  });

  it('registers under the id "shockwave"', () => {
    expect(shockwavePrimitive.id).toBe('shockwave');
  });

  /** See ribbon.test.ts's copy for why every param must carry help — the same gate on shockwave's own SPECS. */
  it('gives every param non-empty help text', () => {
    const specs: FxParamSpecs = shockwavePrimitive.params;
    const missing = Object.keys(specs).filter((key) => (specs[key].help ?? '').trim() === '');
    expect(missing).toEqual([]);
  });

  it('defaults the three shaping extras to an exact no-op (the pre-existing look)', () => {
    // squash 1 divides y by exactly 1, ringDelay 0 subtracts exactly 0 from the ring clock, and ease 1
    // takes the shader's `uEase == 1.0` early-out straight to the linear phase. Anything else here would
    // silently change every saved shockwave def's appearance/timing.
    const d = defaultsOf(shockwavePrimitive.params);
    expect(d.squash).toBe(1);
    expect(d.ringDelay).toBe(0);
    expect(d.ease).toBe(1);
  });

  it('carries the ribbon material knobs, in the Noise group', () => {
    const specs: FxParamSpecs = shockwavePrimitive.params;
    for (const key of ['plateau', 'noiseAlong', 'noiseAcross', 'warp', 'scroll', 'erode', 'gain']) {
      const spec: FxParamSpec | undefined = specs[key];
      expect(spec, `missing material param '${key}'`).toBeDefined();
      expect(spec?.group).toBe('Noise');
    }
  });

  it('matches ribbon.ts\'s plateau spec exactly (the fat-hot-core knob is the same knob)', () => {
    expect(shockwavePrimitive.params.plateau).toMatchObject({
      kind: 'slider', min: 0, max: 0.9, step: 0.01, default: 0.3,
    });
  });
});

/**
 * GLSL can't be typechecked or compiled here (no WebGL context in vitest), so these guard the failure
 * modes that HAVE bitten this file: a stray backtick inside a shader comment silently terminating the
 * template literal, an undeclared uniform, unbalanced braces, and — new with the ribbon material — an
 * `atan()`-derived noise coordinate, which tears a visible seam down one side of every ring.
 */
describe('SHOCKWAVE_FRAG source', () => {
  it('contains no backtick (which would truncate the template literal)', () => {
    expect(SHOCKWAVE_FRAG).not.toContain('`');
  });

  it('has balanced braces and parentheses', () => {
    const count = (ch: string): number => SHOCKWAVE_FRAG.split(ch).length - 1;
    expect(count('{')).toBe(count('}'));
    expect(count('(')).toBe(count(')'));
  });

  it('declares every u-prefixed uniform it references', () => {
    const declared = new Set(
      [...SHOCKWAVE_FRAG.matchAll(/uniform\s+\w+\s+(u[A-Z]\w*)/g)].map((m) => m[1]),
    );
    const used = new Set([...SHOCKWAVE_FRAG.matchAll(/\bu[A-Z]\w*/g)].map((m) => m[0]));
    expect([...used].filter((name) => !declared.has(name))).toEqual([]);
  });

  it('samples the noise seamlessly — from a normalized direction, never from atan()', () => {
    expect(SHOCKWAVE_FRAG).not.toContain('atan');
    expect(SHOCKWAVE_FRAG).toContain('vec2 dir = p / max(d, 0.00001);');
  });

  it('runs the ribbon chain: plateau remap → domain-warped fbm erosion → posterizePal', () => {
    expect(SHOCKWAVE_FRAG).toContain('1.0 - smoothstep(uPlateau, 1.0, across)');
    expect(SHOCKWAVE_FRAG).toContain('np += (vec2(fbm(np * 1.7), fbm(np * 1.7 + 19.3)) - 0.5) * uWarp;');
    expect(SHOCKWAVE_FRAG).toContain('posterizePal(e, uBands, uPal)');
    // The shared chunks must actually be spliced in, or none of the above would compile.
    expect(SHOCKWAVE_FRAG).toMatch(/float fbm\(vec2 p\)/);
    expect(SHOCKWAVE_FRAG).toMatch(/vec4 posterizePal\(/);
  });
});

// The instance's isComplete() is a thin `clockSec >= shockwaveOneShotDurationSec(...)` check over a real
// Mesh/Shader that needs a WebGL context to render, so the completion *timing* is unit-tested here through
// the pure helper it delegates to; the actual single-expansion visual is browser-verified by the
// coordinator.
describe('shockwaveOneShotDurationSec', () => {
  it('matches the closed form (2*rings - 1) / (rings * speed) for the single staggered sweep', () => {
    // rings=1: one ring goes 0->1 over 1/speed seconds.
    expect(shockwaveOneShotDurationSec(1, 1)).toBeCloseTo(1);
    // rings=2, speed=1: last ring starts at t=0.5, finishes at t=1.5.
    expect(shockwaveOneShotDurationSec(2, 1)).toBeCloseTo(1.5);
    // rings=2 at the default speed 0.9.
    expect(shockwaveOneShotDurationSec(2, 0.9)).toBeCloseTo(3 / 1.8);
    // rings=5, speed=2: (2*5-1)/(5*2) = 9/10.
    expect(shockwaveOneShotDurationSec(5, 2)).toBeCloseTo(0.9);
  });

  it('shortens as speed rises (faster expansions finish sooner)', () => {
    expect(shockwaveOneShotDurationSec(3, 2)).toBeLessThan(shockwaveOneShotDurationSec(3, 1));
  });

  it('rounds a fractional ring count to a whole ring, mirroring the shader int(uRings)', () => {
    expect(shockwaveOneShotDurationSec(2.4, 1)).toBeCloseTo(shockwaveOneShotDurationSec(2, 1));
  });

  it('never divides by zero for a degenerate speed', () => {
    expect(Number.isFinite(shockwaveOneShotDurationSec(2, 0))).toBe(true);
  });

  it('is unchanged by the default ringDelay of 0 (an exact no-op, not an approximation)', () => {
    for (const [rings, speed] of [[1, 1], [2, 0.9], [3, 2], [5, 0.35]]) {
      expect(shockwaveOneShotDurationSec(rings, speed, 0)).toBe(shockwaveOneShotDurationSec(rings, speed));
    }
  });

  it('lengthens by (rings - 1) * ringDelay / speed when the rings are staggered', () => {
    // rings=3, speed=1, delay=0.5: the last ring starts 2 * 0.5s later than it otherwise would.
    expect(shockwaveOneShotDurationSec(3, 1, 0.5)).toBeCloseTo(shockwaveOneShotDurationSec(3, 1) + 1);
    // A single ring has nothing to stagger against, so the delay can't move its finish.
    expect(shockwaveOneShotDurationSec(1, 1, 0.9)).toBeCloseTo(shockwaveOneShotDurationSec(1, 1));
  });

  it('clamps a negative ringDelay rather than shortening the cycle below the shader truth', () => {
    expect(shockwaveOneShotDurationSec(3, 1, -5)).toBe(shockwaveOneShotDurationSec(3, 1));
  });
});

/**
 * The quad is deliberately BIGGER than the ring's radius. At exactly +/-radius a fully expanded ring sat on
 * the mesh boundary, and the outer half of the band — its soft edge and its glow with it — was clipped dead
 * straight, drawing a hard line where the glow met its bounding box (owner report, with a screenshot).
 */
describe('quad oversizing', () => {
  it('leaves room beyond the widest band the params can produce', () => {
    const thickness = shockwavePrimitive.params.thickness as { max: number };
    // The band is centred on d == 1 with `thickness` of half-width beyond it; the scale has to clear that
    // AND leave room for the soft edge and glow. If someone raises the thickness ceiling, this fails rather
    // than the clipping quietly coming back.
    expect(QUAD_SCALE).toBeGreaterThan(1 + thickness.max);
    expect(QUAD_SCALE - (1 + thickness.max)).toBeGreaterThanOrEqual(0.1);
  });

  // Fragment area scales with the square, so this can't just be raised "to be safe".
  it('is not so large that it wastes fragment area', () => {
    expect(QUAD_SCALE).toBeLessThanOrEqual(1.6);
  });

  // The shader must undo the oversizing, or every existing def's ring would render 1.45x too small.
  it('is applied in the shader so d == 1 still means the true radius', () => {
    expect(SHOCKWAVE_FRAG).toContain('uniform float uQuadScale;');
    expect(SHOCKWAVE_FRAG).toContain('(vUV * 2.0 - 1.0) * uQuadScale');
  });
});

/** Every `uniform <type> uName` the fragment shader declares. */
function declaredUniforms(): string[] {
  return [...SHOCKWAVE_FRAG.matchAll(/uniform\s+\w+\s+(u\w+)/g)].map((m) => m[1]);
}

/**
 * THE POOLING GUARD, promoted from a comment to a test.
 *
 * `writeAllUniforms` carries a doc comment insisting it writes EVERY uniform the shader owns, because a
 * pooled shader arrives holding the previous tenant's values — the intermittent, load-dependent class of bug
 * where an effect looks right alone and wrong in a busy fight. That instruction was prose, so adding a
 * uniform and forgetting it here was a silent mistake. Adding `uRadLut` is exactly that situation, so the
 * instruction becomes enforceable now rather than after it has been missed once.
 */
describe('writeAllUniforms covers the shader', () => {
  const body = (): string => {
    const start = SHOCKWAVE_SRC.indexOf('function writeAllUniforms');
    expect(start).toBeGreaterThan(-1);
    const end = SHOCKWAVE_SRC.indexOf('\n}', start);
    return SHOCKWAVE_SRC.slice(start, end);
  };

  it('writes every uniform the fragment shader declares', () => {
    const missing = declaredUniforms().filter((name) => !body().includes(`u.${name} =`));
    expect(missing).toEqual([]);
  });

  /** A shader that declares nothing would pass the test above vacuously. */
  it('found a non-trivial set of uniforms to check', () => {
    expect(declaredUniforms().length).toBeGreaterThan(15);
  });
});

/**
 * THE EXPANSION CURVE. A ring's radius used to be `pow(phase, ease)` — a single family of shapes that can
 * only ever decelerate (ease < 1) or only ever accelerate (ease > 1). It cannot hold, stall, or pulse, which
 * is what an authored curve is for.
 *
 * The curve is evaluated on the GPU, so it reaches the shader as a baked lookup table. That is the only
 * reason this needs machinery at all, and it is why the DEFAULT must not go through it: 18 of 29 shipped defs
 * use shockwave and `ease` is genuinely tuned across them, so the un-authored case takes the original
 * expression, guarded by a uniform branch.
 */
describe('shockwave expansion curve', () => {
  it('exposes a radiusCurve param defaulting to the IDENTITY ramp, not a flat line', () => {
    const spec = shockwavePrimitive.params.radiusCurve;
    expect(spec).toBeDefined();
    expect(spec.kind).toBe('curve');
    expect(spec.group).toBe('Ring');
    // v = t. A curve that REPLACES a quantity has the identity as its no-op; a flat 1 would pin every ring
    // at full radius for its whole life.
    expect(spec.default).toEqual([[0, 0], [1, 1]]);
  });

  /** The default has to be the value that makes the CPU take the skip-the-LUT path, or the fast path is
   *  unreachable and every shipped def quietly starts sampling a table. */
  it('defaults to a curve that isIdentityCurve accepts, so the LUT is skipped', () => {
    expect(isIdentityCurve(shockwavePrimitive.params.radiusCurve.default as number[][])).toBe(true);
  });

  it('keeps the original pow(phase, uEase) expression for the un-authored case', () => {
    // Both halves of the pre-existing behaviour survive: the exact compare on uEase (pow(x, 1.0) is not
    // guaranteed bit-exact) and the pow itself.
    expect(SHOCKWAVE_FRAG).toContain('uEase == 1.0 ? shaped : pow(max(shaped, 0.0), uEase)');
    expect(SHOCKWAVE_FRAG).toContain('uRadCurveOn > 0.5 ? radCurve(phase) : phase');
  });

  it('branches on a uniform, so every fragment in a draw takes the same path', () => {
    expect(SHOCKWAVE_FRAG).toContain('uniform float uRadCurveOn;');
  });

  /** The LUT is packed 4-per-vec4; a size that isn't a multiple of 4 would silently drop the tail. */
  it('packs the LUT into exactly enough vec4s to hold every sample', () => {
    const n = Number(/const int RAD_LUT_N = (\d+);/.exec(SHOCKWAVE_FRAG)?.[1]);
    const vec4s = Number(/uniform\s+vec4\s+uRadLut\[(\d+)\]/.exec(SHOCKWAVE_FRAG)?.[1]);
    expect(Number.isInteger(n)).toBe(true);
    expect(n % 4).toBe(0);
    expect(vec4s).toBe(n / 4);
  });

  /** The CPU allocates the buffer; the shader indexes it. A mismatch reads uninitialised tail samples. */
  it('sizes the CPU-side buffer to the shader\'s sample count', () => {
    const n = Number(/const int RAD_LUT_N = (\d+);/.exec(SHOCKWAVE_FRAG)?.[1]);
    expect(SHOCKWAVE_SRC).toContain(`const RAD_LUT_N = ${n};`);
    expect(SHOCKWAVE_SRC).toContain('const RAD_LUT_VEC4 = RAD_LUT_N / 4;');
  });

  /** Fade rides the linear phase deliberately, so reshaping expansion never changes how long a ring lives —
   *  which is what keeps `shockwaveOneShotDurationSec` (and every def's timing) valid. */
  it('leaves the fade on the linear phase, not the shaped radius', () => {
    expect(SHOCKWAVE_FRAG).toContain('float fadeAmt = pow(1.0 - phase, uFade);');
  });
});

/**
 * REVERSE — an implosion. Mirrors the SHAPED RADIUS rather than the phase, which is what keeps fade and
 * lifetime on the forward clock: a contracting ring still fades out as it reaches the centre instead of
 * appearing from nothing at the rim.
 */
describe('shockwave reverse', () => {
  it('exposes a reverse toggle defaulting to off', () => {
    const spec = shockwavePrimitive.params.reverse;
    expect(spec).toBeDefined();
    expect(spec.kind).toBe('toggle');
    expect(spec.default).toBe(false);
    expect(spec.group).toBe('Ring');
  });

  it('mirrors the shaped radius, behind a uniform branch that is exact when off', () => {
    expect(SHOCKWAVE_FRAG).toContain('uniform float uRevRing;');
    expect(SHOCKWAVE_FRAG).toContain('float rad = uRevRing > 0.5 ? 1.0 - eased : eased;');
  });

  /** Composition is the point: reverse mirrors whatever the curve and Ease produced, rather than replacing
   *  them. If it ever reads `phase` directly it has stopped composing. */
  it('mirrors the result of the curve and Ease, not the raw phase', () => {
    expect(SHOCKWAVE_FRAG).toContain('float eased = uEase == 1.0 ? shaped : pow(max(shaped, 0.0), uEase);');
    expect(SHOCKWAVE_FRAG).not.toContain('uRevRing > 0.5 ? 1.0 - phase');
  });
});
