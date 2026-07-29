import { describe, expect, it } from 'vitest';
import { defaultsOf, validateSpecs, type FxParamSpec, type FxParamSpecs } from '../params';
import { QUAD_SCALE, SHOCKWAVE_FRAG, shockwaveOneShotDurationSec, shockwavePrimitive } from './shockwave';

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
