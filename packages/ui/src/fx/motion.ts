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
 * The spawn fields {@link emissionOffset} reads. Taken as an OBJECT rather than positional arguments because
 * the caller already owns exactly this shape — a primitive's own `params` — so passing it allocates nothing
 * while keeping six related dials readable at the call site. (Nine positional args was the alternative.)
 *
 * Every dial past the shape is optional and defaults to its no-op, so a caller that predates one is correct
 * by construction rather than by remembering to pass a 1.
 */
export interface EmissionParams {
  emitShape: EmitShape;
  emitRadius: number;
  /** Horizontal scale of the spawn area. 1 = untouched. */
  squashX?: number;
  /** Vertical scale of the spawn area. 1 = untouched. */
  squashY?: number;
  /** Px the whole spawn area is shifted by, relative to the anchor. */
  offsetX?: number;
  offsetY?: number;
}

/**
 * Spawn-position offset (px) for an emission shape, written into the passed scratch `{ ox, oy }` to avoid a
 * per-spawn allocation (spawns are less hot than the per-frame advance loop, but the discipline is cheap to
 * keep). `randA`/`randB` are two uniform randoms in `[0, 1)`, passed in so the function stays pure and
 * deterministic/testable. Shapes:
 *   - `point` → the anchor itself (plus any offset) — the no-op default that preserves the current look.
 *   - `ring`  → a point on the circle of radius `emitRadius` (`ox² + oy² ≈ radius²`).
 *   - `disc`  → uniform *inside* that circle (√rand for area-uniform, not centre-biased).
 *   - `box`   → uniform in the square `[-radius, radius]²`.
 * `emitRadius` 0 collapses every shape to the anchor.
 *
 * `squashX`/`squashY` scale the two axes independently, turning each shape into its oval/rectangle
 * counterpart: a ring becomes an ellipse outline, a disc a filled ellipse, a box a rectangle. Below 1
 * flattens that axis, above 1 stretches it. They started life as one Y-only `squash` borrowed from the
 * shockwave primitive, and split when the owner asked for width and height independently (2026-08-08).
 *
 * `offsetX`/`offsetY` then TRANSLATE the whole thing. Placement rather than shape, applied last so it never
 * interacts with the squash — and applied to `point` too, which is the case where "just move the effect a
 * bit" is most often what is wanted.
 *
 * Both are applied AFTER the shape is solved rather than folded into it: at the defaults (1, 1, 0, 0) that is
 * an exact IEEE no-op, so every def written before they existed spawns bit-identical positions. (The
 * shockwave shader makes the same argument for its own divide-by-1.)
 *
 * The squash pair ALSO goes through {@link spawnVelocity} — shaping only the birth area is not enough on its
 * own, see that function's note.
 */
export function emissionOffset(
  p: EmissionParams,
  randA: number,
  randB: number,
  out: { ox: number; oy: number },
): void {
  const sx = p.squashX ?? 1;
  const sy = p.squashY ?? 1;
  const dx = p.offsetX ?? 0;
  const dy = p.offsetY ?? 0;
  const radius = p.emitRadius;
  switch (p.emitShape) {
    case 'ring': {
      const a = randA * Math.PI * 2;
      out.ox = Math.cos(a) * radius * sx + dx;
      out.oy = Math.sin(a) * radius * sy + dy;
      return;
    }
    case 'disc': {
      const a = randA * Math.PI * 2;
      const r = Math.sqrt(randB) * radius; // sqrt → area-uniform, not clustered at the centre
      out.ox = Math.cos(a) * r * sx + dx;
      out.oy = Math.sin(a) * r * sy + dy;
      return;
    }
    case 'box': {
      out.ox = (randA * 2 - 1) * radius * sx + dx;
      out.oy = (randB * 2 - 1) * radius * sy + dy;
      return;
    }
    case 'point':
    default:
      out.ox = dx;
      out.oy = dy;
  }
}

/**
 * A particle's spawn VELOCITY (px/sec) for a fire at `angle`, with the squash pair applied per axis. Written
 * into a caller-owned scratch for the same allocation reason as {@link emissionOffset}.
 *
 * ── why velocity, and not just the emit area ─────────────────────────────────────────────────────────
 * Squash first shipped (2026-08-07) touching only where particles are BORN, and it read as a perfect circle
 * on anything quick: the birth ellipse is a fixed number of px, while travel is `speed × life`, so the moment
 * a burst is fast the shape you see is entirely where particles FLEW, not where they started. A def at speed
 * 2635 over 1.9s travels thousands of px against a birth radius capped at 400.
 *
 * Scaling the fan itself is what makes the whole effect an oval, at any speed and for its whole life. It also
 * means squash is meaningful with `emitShape: point` — a single spawn spot throwing a flattened spray — which
 * is why the dials are not gated on having an emit area.
 *
 * The angle is NOT re-derived from the squashed vector: rotating a direction would change WHICH way each
 * particle goes and re-roll the visual seed, while scaling the components leaves every particle on its own
 * heading and merely reshapes the field. At (1, 1) it is an exact IEEE no-op, so every existing def keeps
 * bit-identical velocities.
 *
 * `inheritVel` is deliberately added by the CALLER, after this: that term is the anchor's own movement
 * through the world, not part of the burst's shape, so squashing it would tilt a moving emitter's trail.
 * `offsetX`/`offsetY` are placement, not motion, so they do NOT appear here.
 */
export function spawnVelocity(
  angle: number,
  speed: number,
  squashX: number,
  squashY: number,
  out: { vx: number; vy: number },
): void {
  out.vx = Math.cos(angle) * speed * squashX;
  out.vy = Math.sin(angle) * speed * squashY;
}
