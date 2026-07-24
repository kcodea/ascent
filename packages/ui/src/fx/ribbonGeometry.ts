/** Segments along the ribbon spine. 48 is enough for a smooth curve at trail lengths up to ~700px. */
export const RIBBON_SEGMENTS = 48;

export interface RibbonPoint {
  x: number;
  y: number;
}

export interface RibbonShape {
  /** Fraction of the length over which the head widens from a point. Default 0.12. */
  headPinch?: number;
  /** Exponent of the tail taper — higher feathers away sooner. Default 0.35. */
  tailFeather?: number;
}

/** Static UVs: u runs 0 (head) → 1 (tail); v is 0 on one edge and 1 on the other. */
export function buildRibbonUVs(): Float32Array {
  const uvs = new Float32Array((RIBBON_SEGMENTS + 1) * 4);
  for (let i = 0; i <= RIBBON_SEGMENTS; i++) {
    const t = i / RIBBON_SEGMENTS;
    uvs[i * 4] = t;
    uvs[i * 4 + 1] = 0;
    uvs[i * 4 + 2] = t;
    uvs[i * 4 + 3] = 1;
  }
  return uvs;
}

export function buildRibbonIndices(): Uint32Array {
  const indices = new Uint32Array(RIBBON_SEGMENTS * 6);
  for (let i = 0; i < RIBBON_SEGMENTS; i++) {
    const a = i * 2;
    indices.set([a, a + 1, a + 2, a + 2, a + 1, a + 3], i * 6);
  }
  return indices;
}

// Scratch for the resample pass, reused across calls. This runs once per frame per live trail, and the
// repo treats per-frame allocation as a defect — see CLAUDE.md. Safe to share: the function is synchronous
// and never yields, so two trails can never interleave inside it.
const resampledX = new Float32Array(RIBBON_SEGMENTS + 1);
const resampledY = new Float32Array(RIBBON_SEGMENTS + 1);

/**
 * Lay the ribbon along `spine` (head first) and extrude it to `width`.
 *
 * Resamples to even arc length first: without that, a slow frame bunches spine points together and the
 * noise visibly swims along the trail. Tangents are computed from resampled neighbors (central difference
 * in the middle, forward/backward at the ends) so the ribbon rotates smoothly on tight curves.
 * Returns false for a degenerate spine so the caller hides the mesh rather than rendering a NaN triangle.
 */
export function writeRibbonPositions(
  out: Float32Array,
  spine: RibbonPoint[],
  width: number,
  shape: RibbonShape = {},
): boolean {
  if (spine.length < 2) return false;

  const { headPinch = 0.12, tailFeather = 0.35 } = shape;

  const cum = [0];
  for (let i = 1; i < spine.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(spine[i].x - spine[i - 1].x, spine[i].y - spine[i - 1].y));
  }
  const total = cum[cum.length - 1];
  if (total < 1) return false;

  // First pass: compute resampled positions along the spine into scratch buffers
  let seek = 1;
  for (let i = 0; i <= RIBBON_SEGMENTS; i++) {
    const t = i / RIBBON_SEGMENTS;
    const target = t * total;
    while (seek < cum.length - 1 && cum[seek] < target) seek++;
    const span = cum[seek] - cum[seek - 1] || 1;
    const f = (target - cum[seek - 1]) / span;
    const a = spine[seek - 1];
    const b = spine[seek];
    resampledX[i] = a.x + (b.x - a.x) * f;
    resampledY[i] = a.y + (b.y - a.y) * f;
  }

  // Second pass: compute extrusions using neighbor-based tangents
  for (let i = 0; i <= RIBBON_SEGMENTS; i++) {
    const t = i / RIBBON_SEGMENTS;
    const x = resampledX[i];
    const y = resampledY[i];

    // Compute tangent using resampled neighbors
    let tx: number, ty: number;
    if (i === 0) {
      // Forward difference at head
      tx = resampledX[1] - x;
      ty = resampledY[1] - y;
    } else if (i === RIBBON_SEGMENTS) {
      // Backward difference at tail
      tx = x - resampledX[i - 1];
      ty = y - resampledY[i - 1];
    } else {
      // Central difference in the middle
      tx = resampledX[i + 1] - resampledX[i - 1];
      ty = resampledY[i + 1] - resampledY[i - 1];
    }

    const m = Math.hypot(tx, ty) || 1;
    tx /= m;
    ty /= m;

    // Pinched at the head, full through the body, feathered at the tail.
    const w = width * 0.5 * Math.min(1, t / headPinch) * Math.pow(1 - t, tailFeather);
    out[i * 4] = x - ty * w;
    out[i * 4 + 1] = y + tx * w;
    out[i * 4 + 2] = x + ty * w;
    out[i * 4 + 3] = y - tx * w;
  }
  return true;
}
