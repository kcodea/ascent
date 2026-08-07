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

  /**
   * SQUASH — the owner's ask (2026-08-07): "so i can select ring and squash it to the shape of an oval".
   *
   * Deliberately the same name and contract as the shockwave primitive's `squash`: 1 is a true circle, and
   * scaling Y only is what turns each shape into its oval/rectangle counterpart.
   */
  describe('squash', () => {
    it('defaults to an EXACT no-op, so every def written before it is bit-identical', () => {
      const before = { ox: 0, oy: 0 };
      const after = { ox: 0, oy: 0 };
      for (const shape of ['ring', 'disc', 'box'] as const) {
        for (let a = 0; a < 1; a += 0.13) {
          for (let b = 0; b < 1; b += 0.17) {
            emissionOffset(shape, 40, a, b, before);          // the old 5-arg call
            emissionOffset(shape, 40, a, b, after, 1);        // explicitly at the default
            expect(after.ox).toBe(before.ox);                 // toBe, not toBeCloseTo — bit-identical
            expect(after.oy).toBe(before.oy);
          }
        }
      }
    });

    it('flattens a ring into an ellipse: X untouched, Y scaled', () => {
      const round = { ox: 0, oy: 0 };
      const oval = { ox: 0, oy: 0 };
      for (let a = 0; a < 1; a += 0.05) {
        emissionOffset('ring', 100, a, 0, round);
        emissionOffset('ring', 100, a, 0, oval, 0.5);
        expect(oval.ox).toBeCloseTo(round.ox);                // width is preserved…
        expect(oval.oy).toBeCloseTo(round.oy * 0.5);          // …only height is squashed
      }
    });

    it('an ellipse ring still satisfies (x/r)² + (y/(r·squash))² ≈ 1', () => {
      const r = 60;
      const sq = 0.35;
      for (let a = 0; a < 1; a += 0.05) {
        emissionOffset('ring', r, a, 0, out, sq);
        expect((out.ox / r) ** 2 + (out.oy / (r * sq)) ** 2).toBeCloseTo(1);
      }
    });

    it('above 1 makes the area TALLER than it is wide', () => {
      emissionOffset('ring', 50, 0.25, 0, out, 2);            // randA 0.25 → straight up
      expect(Math.abs(out.oy)).toBeCloseTo(100);
      expect(Math.abs(out.ox)).toBeCloseTo(0);
    });

    it('squashes disc and box on the same axis', () => {
      emissionOffset('disc', 80, 0.25, 1, out, 0.25);         // rim, straight up
      expect(Math.abs(out.oy)).toBeCloseTo(20);
      emissionOffset('box', 80, 1, 1, out, 0.25);             // the far corner
      expect(out.ox).toBeCloseTo(80);
      expect(out.oy).toBeCloseTo(20);
    });

    /** `point` has no area, so there is nothing to squash — it must stay pinned whatever the dial says. */
    it('leaves point alone', () => {
      emissionOffset('point', 100, 0.4, 0.6, out, 0.2);
      expect(out).toEqual({ ox: 0, oy: 0 });
    });

    /** A 0 radius collapses every shape to the anchor, squash or not — the existing contract.
     *  Compared numerically rather than with `toEqual`: `cos(0.4·2π) * 0` is NEGATIVE zero, which
     *  `toEqual` treats as distinct from +0. That predates squash (any radius of 0 does it) and means
     *  nothing to a spawn position, so the assertion should not care either. */
    it('cannot resurrect a zero radius', () => {
      emissionOffset('ring', 0, 0.4, 0.6, out, 3);
      expect(out.ox).toBeCloseTo(0);
      expect(out.oy).toBeCloseTo(0);
    });
  });

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
