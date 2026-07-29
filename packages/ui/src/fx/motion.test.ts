import { describe, expect, it } from 'vitest';
import { EMIT_SHAPES, emissionOffset, turbulenceX, turbulenceY, type EmitShape } from './motion';

describe('turbulence', () => {
  it('is finite and bounded to ~[-1.5, 1.5] across a wide sample', () => {
    for (let x = -50; x <= 50; x += 3.3) {
      for (let y = -50; y <= 50; y += 3.3) {
        for (let t = 0; t < 6; t += 0.37) {
          const ax = turbulenceX(x, y, t, 0.05);
          const ay = turbulenceY(x, y, t, 0.05);
          expect(Number.isFinite(ax)).toBe(true);
          expect(Number.isFinite(ay)).toBe(true);
          expect(ax).toBeGreaterThanOrEqual(-1.5);
          expect(ax).toBeLessThanOrEqual(1.5);
          expect(ay).toBeGreaterThanOrEqual(-1.5);
          expect(ay).toBeLessThanOrEqual(1.5);
        }
      }
    }
  });

  it('is deterministic given the same inputs', () => {
    expect(turbulenceX(3, 7, 1.5, 0.02)).toBe(turbulenceX(3, 7, 1.5, 0.02));
    expect(turbulenceY(3, 7, 1.5, 0.02)).toBe(turbulenceY(3, 7, 1.5, 0.02));
  });

  it('actually varies with position and time (not a constant)', () => {
    // turbulenceX reads y and t; turbulenceY reads x and t.
    expect(turbulenceX(0, 0, 0, 0.05)).not.toBeCloseTo(turbulenceX(0, 40, 0, 0.05));
    expect(turbulenceX(0, 10, 0, 0.05)).not.toBeCloseTo(turbulenceX(0, 10, 3, 0.05));
    expect(turbulenceY(0, 0, 0, 0.05)).not.toBeCloseTo(turbulenceY(40, 0, 0, 0.05));
    expect(turbulenceY(10, 0, 0, 0.05)).not.toBeCloseTo(turbulenceY(10, 0, 3, 0.05));
  });
});

describe('emissionOffset', () => {
  const out = { ox: 0, oy: 0 };

  it('point is always (0, 0) regardless of radius or randoms', () => {
    emissionOffset('point', 100, 0.1, 0.9, out);
    expect(out).toEqual({ ox: 0, oy: 0 });
    emissionOffset('point', 0, 0.5, 0.5, out);
    expect(out).toEqual({ ox: 0, oy: 0 });
  });

  it('ring points lie on the circle of radius r (ox² + oy² ≈ r²)', () => {
    const r = 37;
    for (let a = 0; a < 1; a += 0.05) {
      emissionOffset('ring', r, a, 0, out);
      expect(Math.hypot(out.ox, out.oy)).toBeCloseTo(r);
    }
  });

  it('disc points lie within radius r (and use area-uniform sqrt sampling)', () => {
    const r = 50;
    for (let a = 0; a < 1; a += 0.1) {
      for (let b = 0; b < 1; b += 0.1) {
        emissionOffset('disc', r, a, b, out);
        expect(Math.hypot(out.ox, out.oy)).toBeLessThanOrEqual(r + 1e-9);
      }
    }
    // sqrt sampling: randB=1 reaches the rim, randB=0 sits at the centre.
    emissionOffset('disc', r, 0, 1, out);
    expect(Math.hypot(out.ox, out.oy)).toBeCloseTo(r);
    emissionOffset('disc', r, 0.3, 0, out);
    expect(Math.hypot(out.ox, out.oy)).toBeCloseTo(0);
  });

  it('box points lie within [-r, r]² and reach the corners at the extremes', () => {
    const r = 20;
    for (let a = 0; a < 1; a += 0.1) {
      for (let b = 0; b < 1; b += 0.1) {
        emissionOffset('box', r, a, b, out);
        expect(Math.abs(out.ox)).toBeLessThanOrEqual(r);
        expect(Math.abs(out.oy)).toBeLessThanOrEqual(r);
      }
    }
    emissionOffset('box', r, 0, 1, out);
    expect(out).toEqual({ ox: -r, oy: r });
  });

  it('radius 0 collapses every shape to (0, 0)', () => {
    // Magnitude check (not toEqual) so a harmless signed-zero from e.g. box's (rand*2-1)*0 still counts as
    // the origin — Math.hypot(-0, 0) === 0, and a -0 offset adds identically to a +0 one at the call site.
    for (const shape of EMIT_SHAPES as readonly EmitShape[]) {
      emissionOffset(shape, 0, 0.42, 0.73, out);
      expect(Math.hypot(out.ox, out.oy)).toBe(0);
    }
  });
});
