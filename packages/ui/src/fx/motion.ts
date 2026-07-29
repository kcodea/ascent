/**
 * Pure, allocation-free motion helpers shared by the particle primitives (burst + emitter). These are the
 * "motion physics" layer on top of the base velocity/gravity/drag integration: a cheap pseudo-turbulence
 * field and a spawn-shape offset. Kept renderer-free (no Pixi, no WebGL) so they're unit-testable headlessly,
 * mirroring the precedent set by `sampleBurstAngle` / `advanceEmitBudget` / `moteAlpha` in the primitives.
 *
 * Every consumer wires these so their default contributes exactly zero (turbulence strength 0, emit shape
 * `point`), preserving the existing look byte-for-byte until a knob is turned.
 */

/**
 * Cheap layered-sine pseudo-turbulence — no noise library, no hashing, just two sines per axis. Deterministic
 * given `(x, y, tSec)` and bounded to roughly `[-1.5, 1.5]` (amplitudes 1 + 0.5). `turbulenceX` reads the
 * particle's `y` (and `turbulenceY` its `x`) so the two axes decorrelate and particles swirl rather than
 * slide along a single line. Two scalar functions (not an `{ax, ay}` object) so the per-particle hot loop
 * allocates nothing. `scale` is the spatial frequency of the field.
 */
export function turbulenceX(x: number, y: number, tSec: number, scale: number): number {
  return Math.sin(y * scale + tSec * 1.3) + 0.5 * Math.sin(y * scale * 2.1 - tSec * 0.7);
}

/** The `y`-axis mirror of {@link turbulenceX}: reads `x` and uses cosine so the two axes don't share a phase. */
export function turbulenceY(x: number, y: number, tSec: number, scale: number): number {
  return Math.cos(x * scale + tSec * 1.3) + 0.5 * Math.cos(x * scale * 2.1 - tSec * 0.7);
}

export type EmitShape = 'point' | 'ring' | 'disc' | 'box';
export const EMIT_SHAPES = ['point', 'ring', 'disc', 'box'] as const;

/**
 * Spawn-position offset (px) for an emission shape, written into the passed scratch `{ ox, oy }` to avoid a
 * per-spawn allocation (spawns are less hot than the per-frame advance loop, but the discipline is cheap to
 * keep). `randA`/`randB` are two uniform randoms in `[0, 1)`, passed in so the function stays pure and
 * deterministic/testable. Shapes:
 *   - `point` → always (0, 0) — the no-op default that preserves the current look.
 *   - `ring`  → a point on the circle of radius `radius` (`ox² + oy² ≈ radius²`).
 *   - `disc`  → uniform *inside* the circle of radius `radius` (√rand for area-uniform, not centre-biased).
 *   - `box`   → uniform in the square `[-radius, radius]²`.
 * `radius` 0 collapses every shape to (0, 0).
 */
export function emissionOffset(
  shape: EmitShape,
  radius: number,
  randA: number,
  randB: number,
  out: { ox: number; oy: number },
): void {
  switch (shape) {
    case 'ring': {
      const a = randA * Math.PI * 2;
      out.ox = Math.cos(a) * radius;
      out.oy = Math.sin(a) * radius;
      return;
    }
    case 'disc': {
      const a = randA * Math.PI * 2;
      const r = Math.sqrt(randB) * radius; // sqrt → area-uniform, not clustered at the centre
      out.ox = Math.cos(a) * r;
      out.oy = Math.sin(a) * r;
      return;
    }
    case 'box': {
      out.ox = (randA * 2 - 1) * radius;
      out.oy = (randB * 2 - 1) * radius;
      return;
    }
    case 'point':
    default:
      out.ox = 0;
      out.oy = 0;
  }
}
