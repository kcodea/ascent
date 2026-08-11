/**
 * A value-over-life curve: control points sampled at normalized life (0 = birth, 1 = death) to yield a
 * multiplier. The `curve` param kind (see `params.ts`) stores its value as this list of points; the sampler
 * below turns a point list + a life fraction into the multiplier a primitive applies per-particle per-frame.
 * Kept pure + allocation-free in the hot path so it can run for every live particle every frame.
 */
export type CurvePoint = readonly [number, number];

/** Sample a value-over-life curve at normalized life `t` (clamped to [0,1]) via piecewise-linear
 *  interpolation between control points. Points must be sorted ascending by t (coerceParams guarantees
 *  this for stored params). Returns 1 (identity multiplier) for an empty curve. Pure + allocation-free so
 *  it can run per-particle per-frame. */
export function sampleCurve(points: ReadonlyArray<CurvePoint>, t: number): number {
  const n = points.length;
  if (n === 0) return 1;
  const tt = t < 0 ? 0 : t > 1 ? 1 : t;
  if (tt <= points[0][0]) return points[0][1];
  if (tt >= points[n - 1][0]) return points[n - 1][1];
  // Find the bracketing segment [i-1, i] (points are sorted ascending by t).
  for (let i = 1; i < n; i++) {
    const rt = points[i][0];
    if (tt <= rt) {
      const lt = points[i - 1][0];
      const lv = points[i - 1][1];
      const span = rt - lt;
      if (span < 1e-6) return lv; // zero-width segment — avoid a divide-by-zero, take the left value
      const f = (tt - lt) / span;
      return lv + (points[i][1] - lv) * f;
    }
  }
  // Unreachable (the tt >= last guard above covers it), but keeps the function total.
  return points[n - 1][1];
}

/**
 * The fewest control points a curve may have. `coerceParams` rejects a shorter list outright (see the
 * `curve` case in params.ts) — a one-point curve has no span to interpolate over — so an editor's remove
 * affordance must refuse to cross this rather than emit a value the param layer will silently discard.
 */
export const MIN_CURVE_POINTS = 2;

/**
 * How far apart two control points must stay on the t axis. Matches the editor's drag rule: an interior
 * point is kept strictly between its neighbours so points can never collide or reorder, which would break
 * `sampleCurve`'s sorted-ascending precondition.
 */
export const CURVE_T_EPSILON = 1e-3;

/**
 * Insert a control point at (`t`, `v`), returning a NEW list still sorted ascending by t.
 *
 * Pure so the editor's "add a point" affordance is testable without a DOM — the editor turns a click into
 * curve-space coordinates and everything else happens here.
 *
 * The point always lands in the INTERIOR: `t` is folded to sit strictly between whichever pair of existing
 * points brackets it (by `CURVE_T_EPSILON`), so it can never displace the first/last points, which stay
 * pinned to birth (t=0) and death (t=1). A click outside the existing t range is therefore snapped to the
 * nearest legal slot rather than dropped — adding a point should never silently do nothing. `v` is clamped
 * into [0, `vMax`].
 *
 * Returns an unchanged copy in the one case where there is genuinely no room: the bracketing points are
 * already closer together than 2 × `CURVE_T_EPSILON`, so no legal t exists between them.
 */
export function insertCurvePoint(
  points: ReadonlyArray<ReadonlyArray<number>>,
  t: number,
  v: number,
  vMax = 1,
): [number, number][] {
  const copy = points.map((p) => [p[0], p[1]] as [number, number]);
  if (copy.length < MIN_CURVE_POINTS) return copy; // nothing to bracket against; leave malformed input alone
  // First index whose t is beyond the click — the new point goes immediately before it. Clamped to
  // [1, length - 1] so the insert is always between two existing points, never outside the pinned ends.
  let at = copy.findIndex((p) => p[0] > t);
  if (at < 1) at = at === -1 ? copy.length - 1 : 1;
  const lo = copy[at - 1][0];
  const hi = copy[at][0];
  if (hi - lo <= 2 * CURVE_T_EPSILON) return copy; // no room between these two
  const clampedT = Math.min(hi - CURVE_T_EPSILON, Math.max(lo + CURVE_T_EPSILON, t));
  const clampedV = v < 0 ? 0 : v > vMax ? vMax : v;
  copy.splice(at, 0, [clampedT, clampedV]);
  return copy;
}

/**
 * Remove the control point at `index`, returning a NEW list.
 *
 * Refuses (returns an unchanged copy) for the three cases an editor must never produce:
 * - the list is already at `MIN_CURVE_POINTS` — a shorter curve is rejected by `coerceParams`, so removing
 *   would silently throw away the author's whole curve;
 * - `index` is the first or last point — those are pinned to t=0 / t=1 and define the curve's span;
 * - `index` is out of range.
 */
export function removeCurvePoint(
  points: ReadonlyArray<ReadonlyArray<number>>,
  index: number,
): [number, number][] {
  const copy = points.map((p) => [p[0], p[1]] as [number, number]);
  if (copy.length <= MIN_CURVE_POINTS) return copy;
  if (!Number.isInteger(index) || index <= 0 || index >= copy.length - 1) return copy;
  copy.splice(index, 1);
  return copy;
}

/**
 * The IDENTITY RAMP — `v = t`. The one curve that means "do nothing" for a curve whose output replaces a
 * quantity (a radius, a progress) rather than multiplying one, where the no-op is a flat 1 instead.
 */
export const IDENTITY_CURVE: readonly CurvePoint[] = [[0, 0], [1, 1]];

/**
 * Is this exactly the identity ramp?
 *
 * Deliberately a STRUCTURAL check on the two pinned end points, not a numeric probe of the sampled values.
 * A consumer uses this to take a fast path that must be BYTE-IDENTICAL to not having the curve at all — a
 * collinear three-point curve samples to the same values in exact arithmetic but need not survive a float
 * round-trip through a lookup table, so it is treated as authored and goes the ordinary way. Answering
 * "is it safe to skip the curve entirely", not "is it mathematically an identity".
 */
export function isIdentityCurve(points: ReadonlyArray<ReadonlyArray<number>>): boolean {
  return points.length === 2
    && points[0][0] === 0 && points[0][1] === 0
    && points[1][0] === 1 && points[1][1] === 1;
}

/**
 * Bake a curve into a uniformly-spaced lookup table, IN PLACE.
 *
 * For consumers that cannot call {@link sampleCurve} where they need it — a GPU shader being the motivating
 * case: a fragment program cannot walk a variable-length control-point list, but it can index a fixed array.
 * Sample `i` sits at `t = i / (out.length - 1)`, so the first and last entries are exactly the curve's
 * endpoints and a shader can map `t` onto the table with a plain multiply.
 *
 * Writes into the caller's buffer and allocates nothing: the caller owns one per shader for its lifetime and
 * re-bakes on edit, so this never runs per frame — but it must not add GC pressure when an inspector drag
 * re-bakes it on every pointer move.
 */
export function bakeCurveLut(points: ReadonlyArray<CurvePoint>, out: Float32Array): void {
  const n = out.length;
  if (n === 0) return;
  if (n === 1) { out[0] = sampleCurve(points, 0); return; }
  const last = n - 1;
  for (let i = 0; i < n; i++) out[i] = sampleCurve(points, i / last);
}

/** Named starting shapes a curve picker can seed from. */
export const CURVE_PRESETS: Record<string, readonly CurvePoint[]> = {
  'fade out': [[0, 1], [1, 0]],
  'grow': [[0, 0], [1, 1]],
  'pop': [[0, 0], [0.15, 1], [1, 0]],
  'hold then drop': [[0, 1], [0.7, 1], [1, 0]],
  'ease out': [[0, 1], [0.4, 0.6], [1, 0]],
};
