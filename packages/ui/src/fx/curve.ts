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

/** Named starting shapes a curve picker can seed from. */
export const CURVE_PRESETS: Record<string, readonly CurvePoint[]> = {
  'fade out': [[0, 1], [1, 0]],
  'grow': [[0, 0], [1, 1]],
  'pop': [[0, 0], [0.15, 1], [1, 0]],
  'hold then drop': [[0, 1], [0.7, 1], [1, 0]],
  'ease out': [[0, 1], [0.4, 0.6], [1, 0]],
};
