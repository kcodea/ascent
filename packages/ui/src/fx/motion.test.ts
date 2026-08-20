import { describe, expect, it } from 'vitest';
import {
  EMIT_SHAPES, emissionOffset, spawnVelocity, turbulenceX, turbulenceY,
  fieldPhaseOffset, FIELD_PHASE_SPAN,
  type EmissionParams, type EmitShape,
} from './motion';

describe('fieldPhaseOffset', () => {
  it('is an exact no-op at amount 0 (byte-identical to the old clockSec = 0 start)', () => {
    for (const seed of [0, 1, 12345, 0x7fffffff, -42, randomish(3), randomish(99)]) {
      expect(fieldPhaseOffset(seed, 0)).toBe(0);
      expect(fieldPhaseOffset(seed, -0.5)).toBe(0); // guarded on `amount > 0`
    }
  });

  it('is deterministic in the seed — a locked seed replays the same phase', () => {
    for (const seed of [1, 999, 0x1234abcd, randomish(7)]) {
      expect(fieldPhaseOffset(seed, 1)).toBe(fieldPhaseOffset(seed, 1));
      expect(fieldPhaseOffset(seed, 0.5)).toBe(fieldPhaseOffset(seed, 0.5));
    }
  });

  it('decorrelates: different seeds give different phases (a crowd of casts spreads out)', () => {
    const phases = new Set<number>();
    for (let s = 1; s <= 200; s++) phases.add(fieldPhaseOffset(s, 1));
    // No collisions across 200 distinct seeds — each simultaneous fire lands on its own field phase.
    expect(phases.size).toBe(200);
  });

  it('stays within [0, FIELD_PHASE_SPAN * amount] and scales with amount', () => {
    for (let s = 1; s <= 300; s++) {
      const full = fieldPhaseOffset(s, 1);
      expect(full).toBeGreaterThanOrEqual(0);
      expect(full).toBeLessThan(FIELD_PHASE_SPAN);
      // Same seed, half the amount → exactly half the phase (linear in amount).
      expect(fieldPhaseOffset(s, 0.5)).toBeCloseTo(full * 0.5, 10);
    }
  });
});

/** A cheap deterministic spread of seed inputs for the tests above — not `Math.random`, so the suite stays
 *  reproducible. */
function randomish(n: number): number {
  return (Math.imul(n, 0x9e3779b9) ^ (n << 13)) | 0;
}

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
  /** The params object the primitives hand in; every dial past the shape defaults to its no-op. */
  const P = (o: Partial<EmissionParams> = {}): EmissionParams => ({ emitShape: 'point', emitRadius: 0, ...o });

  it('covers every declared shape', () => {
    for (const shape of EMIT_SHAPES) {
      const s: EmitShape = shape;
      emissionOffset(P({ emitShape: s, emitRadius: 10 }), 0.3, 0.6, out);
      expect(Number.isFinite(out.ox)).toBe(true);
      expect(Number.isFinite(out.oy)).toBe(true);
    }
  });

  it('point sits on the anchor regardless of radius or randoms', () => {
    emissionOffset(P({ emitShape: 'point', emitRadius: 100 }), 0.1, 0.9, out);
    expect(out).toEqual({ ox: 0, oy: 0 });
  });

  it('ring points lie on the circle of radius r (ox² + oy² ≈ r²)', () => {
    for (let a = 0; a < 1; a += 0.05) {
      emissionOffset(P({ emitShape: 'ring', emitRadius: 37 }), a, 0, out);
      expect(Math.hypot(out.ox, out.oy)).toBeCloseTo(37);
    }
  });

  it('disc points lie within r, area-uniform (√rand: 1 reaches the rim, 0 the centre)', () => {
    for (let a = 0; a < 1; a += 0.1) {
      for (let b = 0; b < 1; b += 0.1) {
        emissionOffset(P({ emitShape: 'disc', emitRadius: 50 }), a, b, out);
        expect(Math.hypot(out.ox, out.oy)).toBeLessThanOrEqual(50 + 1e-9);
      }
    }
    emissionOffset(P({ emitShape: 'disc', emitRadius: 50 }), 0, 1, out);
    expect(Math.hypot(out.ox, out.oy)).toBeCloseTo(50);
    emissionOffset(P({ emitShape: 'disc', emitRadius: 50 }), 0.3, 0, out);
    expect(Math.hypot(out.ox, out.oy)).toBeCloseTo(0);
  });

  it('box points fill [-r, r]² and reach the corners at the extremes', () => {
    for (let a = 0; a < 1; a += 0.1) {
      for (let b = 0; b < 1; b += 0.1) {
        emissionOffset(P({ emitShape: 'box', emitRadius: 20 }), a, b, out);
        expect(Math.abs(out.ox)).toBeLessThanOrEqual(20 + 1e-9);
        expect(Math.abs(out.oy)).toBeLessThanOrEqual(20 + 1e-9);
      }
    }
    emissionOffset(P({ emitShape: 'box', emitRadius: 20 }), 1, 1, out);
    expect(out.ox).toBeCloseTo(20);
    expect(out.oy).toBeCloseTo(20);
  });

  it('a zero radius collapses every shape to the anchor', () => {
    for (const emitShape of ['ring', 'disc', 'box'] as const) {
      emissionOffset(P({ emitShape, emitRadius: 0 }), 0.4, 0.6, out);
      expect(out.ox).toBeCloseTo(0);
      expect(out.oy).toBeCloseTo(0);
    }
  });

  describe('squash', () => {
    it('defaults to an EXACT no-op, so every def written before it is bit-identical', () => {
      const before = { ox: 0, oy: 0 };
      const after = { ox: 0, oy: 0 };
      for (const emitShape of ['ring', 'disc', 'box'] as const) {
        for (let a = 0; a < 1; a += 0.13) {
          for (let b = 0; b < 1; b += 0.17) {
            emissionOffset(P({ emitShape, emitRadius: 40 }), a, b, before);
            emissionOffset(P({ emitShape, emitRadius: 40, squashX: 1, squashY: 1 }), a, b, after);
            expect(after.ox).toBe(before.ox);   // toBe, not toBeCloseTo — bit-identical
            expect(after.oy).toBe(before.oy);
          }
        }
      }
    });

    it('scales the two axes INDEPENDENTLY', () => {
      const round = { ox: 0, oy: 0 };
      for (let a = 0; a < 1; a += 0.05) {
        emissionOffset(P({ emitShape: 'ring', emitRadius: 100 }), a, 0, round);
        emissionOffset(P({ emitShape: 'ring', emitRadius: 100, squashX: 0.5, squashY: 2 }), a, 0, out);
        expect(out.ox).toBeCloseTo(round.ox * 0.5);
        expect(out.oy).toBeCloseTo(round.oy * 2);
      }
    });

    it('an ellipse ring satisfies (x/rx)² + (y/ry)² ≈ 1', () => {
      const r = 60, sx = 1.4, sy = 0.35;
      for (let a = 0; a < 1; a += 0.05) {
        emissionOffset(P({ emitShape: 'ring', emitRadius: r, squashX: sx, squashY: sy }), a, 0, out);
        expect((out.ox / (r * sx)) ** 2 + (out.oy / (r * sy)) ** 2).toBeCloseTo(1);
      }
    });

    it('equal values RESIZE rather than reshape', () => {
      emissionOffset(P({ emitShape: 'ring', emitRadius: 80, squashX: 0.5, squashY: 0.5 }), 0.125, 0, out);
      expect(Math.hypot(out.ox, out.oy)).toBeCloseTo(40);   // still a circle, half the size
    });

    it('leaves point alone — there is no area to squash', () => {
      emissionOffset(P({ emitShape: 'point', emitRadius: 100, squashX: 0.2, squashY: 3 }), 0.4, 0.6, out);
      expect(out).toEqual({ ox: 0, oy: 0 });
    });
  });

  describe('offset', () => {
    it('translates the whole shape without changing it', () => {
      const base = { ox: 0, oy: 0 };
      for (let a = 0; a < 1; a += 0.07) {
        emissionOffset(P({ emitShape: 'ring', emitRadius: 30 }), a, 0, base);
        emissionOffset(P({ emitShape: 'ring', emitRadius: 30, offsetX: 25, offsetY: -40 }), a, 0, out);
        expect(out.ox).toBeCloseTo(base.ox + 25);
        expect(out.oy).toBeCloseTo(base.oy - 40);
      }
    });

    /** The case the owner asked for: nudge an effect that spawns from a single spot. */
    it('moves a POINT spawn, which is the whole reason it applies there', () => {
      emissionOffset(P({ emitShape: 'point', offsetX: -18, offsetY: 12 }), 0.5, 0.5, out);
      expect(out).toEqual({ ox: -18, oy: 12 });
    });

    it('does not interact with squash — placement is applied last', () => {
      emissionOffset(P({ emitShape: 'ring', emitRadius: 100, squashY: 0.5, offsetY: 10 }), 0.25, 0, out);
      expect(out.oy).toBeCloseTo(100 * 0.5 + 10);   // squashed THEN moved, not (100 + 10) × 0.5
    });

    it('still displaces a zero-radius shape, so offset alone can place an effect', () => {
      emissionOffset(P({ emitShape: 'ring', emitRadius: 0, offsetX: 7, offsetY: -3 }), 0.4, 0.6, out);
      expect(out.ox).toBeCloseTo(7);
      expect(out.oy).toBeCloseTo(-3);
    });

    it('defaults to an exact no-op', () => {
      const bare = { ox: 0, oy: 0 };
      emissionOffset(P({ emitShape: 'box', emitRadius: 20, offsetX: 0, offsetY: 0 }), 0.9, 0.2, out);
      emissionOffset(P({ emitShape: 'box', emitRadius: 20 }), 0.9, 0.2, bare);
      expect(out).toEqual(bare);
    });
  });
});

describe('emissionOffset — svg', () => {
  const base = { emitShape: 'svg' as const, emitRadius: 10, squashX: 1, squashY: 1, offsetX: 0, offsetY: 0 };
  it('picks a baked point by randA and scales by emitRadius', () => {
    const out = { ox: 0, oy: 0 };
    // two points; randA=0.6 → floor(0.6*2)=1 → the second point (1, -0.5), scaled by radius 10
    emissionOffset({ ...base, emitPoints: [[-1, 0], [1, -0.5]] }, 0.6, 0.3, out);
    expect(out).toEqual({ ox: 10, oy: -5 });
  });
  it('applies squash and offset like the other shapes', () => {
    const out = { ox: 0, oy: 0 };
    emissionOffset({ ...base, emitPoints: [[1, 1]], squashX: 2, squashY: 0.5, offsetX: 3, offsetY: -4 }, 0, 0, out);
    expect(out).toEqual({ ox: 1 * 10 * 2 + 3, oy: 1 * 10 * 0.5 - 4 });
  });
  it('falls back to the anchor (plus offset) when there are no baked points', () => {
    const out = { ox: 9, oy: 9 };
    emissionOffset({ ...base, emitPoints: [], offsetX: 2, offsetY: 5 }, 0.5, 0.5, out);
    expect(out).toEqual({ ox: 2, oy: 5 });
  });
});

/**
 * SPAWN VELOCITY — the other half of squash.
 *
 * Squashing only the birth area reads as a perfect circle on anything fast: the birth ellipse is a fixed
 * number of px while travel is `speed × life`, so the shape you see is where particles FLEW (owner report
 * 2026-08-07).
 */
describe('spawnVelocity', () => {
  const out = { vx: 0, vy: 0 };

  it('is an EXACT no-op at (1, 1), so every existing def keeps bit-identical velocities', () => {
    for (let a = 0; a < Math.PI * 2; a += 0.21) {
      spawnVelocity(a, 640, 1, 1, out);
      expect(out.vx).toBe(Math.cos(a) * 640);   // toBe, not toBeCloseTo
      expect(out.vy).toBe(Math.sin(a) * 640);
    }
  });

  it('scales each axis independently', () => {
    for (let a = 0; a < Math.PI * 2; a += 0.21) {
      spawnVelocity(a, 500, 1, 1, out);
      const rvx = out.vx;
      const rvy = out.vy;
      spawnVelocity(a, 500, 1.5, 0.4, out);
      expect(out.vx).toBeCloseTo(rvx * 1.5);
      expect(out.vy).toBeCloseTo(rvy * 0.4);
    }
  });

  /** The whole point as a number: at combat speeds the FAN is the shape, not the spawn ring. */
  it('flattens the swept FIELD, which is what a fast burst actually shows', () => {
    const speed = 2600;
    const secs = 1.9;
    const sy = 0.25;
    let maxX = 0;
    let maxY = 0;
    for (let a = 0; a < Math.PI * 2; a += 0.05) {
      spawnVelocity(a, speed, 1, sy, out);
      maxX = Math.max(maxX, Math.abs(out.vx * secs));
      maxY = Math.max(maxY, Math.abs(out.vy * secs));
    }
    expect(maxX).toBeGreaterThan(4000);        // travel dwarfs any emit radius (max 400)
    expect(maxY / maxX).toBeCloseTo(sy, 2);    // …and the field carries the squash
  });

  /** Directions are SCALED, never re-derived: a particle fired left still goes exactly left. */
  it('leaves a purely horizontal shot on its heading', () => {
    spawnVelocity(Math.PI, 800, 1, 0.2, out);
    expect(out.vx).toBeCloseTo(-800);
    expect(out.vy).toBeCloseTo(0);
  });
});
