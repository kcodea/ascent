/** Segments along the ribbon spine. 48 is enough for a smooth curve at trail lengths up to ~700px. */
export const RIBBON_SEGMENTS = 48;

export interface RibbonPoint {
  x: number;
  y: number;
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

/**
 * Lay the ribbon along `spine` (head first) and extrude it to `width`.
 *
 * Resamples to even arc length first: without that, a slow frame bunches spine points together and the
 * noise visibly swims along the trail. Returns false for a degenerate spine so the caller hides the mesh
 * rather than rendering a NaN triangle.
 */
export function writeRibbonPositions(out: Float32Array, spine: RibbonPoint[], width: number): boolean {
  if (spine.length < 2) return false;

  const cum = [0];
  for (let i = 1; i < spine.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(spine[i].x - spine[i - 1].x, spine[i].y - spine[i - 1].y));
  }
  const total = cum[cum.length - 1];
  if (total < 1) return false;

  let seek = 1;
  for (let i = 0; i <= RIBBON_SEGMENTS; i++) {
    const t = i / RIBBON_SEGMENTS;
    const target = t * total;
    while (seek < cum.length - 1 && cum[seek] < target) seek++;
    const span = cum[seek] - cum[seek - 1] || 1;
    const f = (target - cum[seek - 1]) / span;
    const a = spine[seek - 1];
    const b = spine[seek];
    const x = a.x + (b.x - a.x) * f;
    const y = a.y + (b.y - a.y) * f;

    let tx = b.x - a.x;
    let ty = b.y - a.y;
    const m = Math.hypot(tx, ty) || 1;
    tx /= m;
    ty /= m;

    // Pinched at the head, full through the body, feathered at the tail.
    const w = width * 0.5 * Math.min(1, t / 0.12) * Math.pow(1 - t, 0.35);
    out[i * 4] = x - ty * w;
    out[i * 4 + 1] = y + tx * w;
    out[i * 4 + 2] = x + ty * w;
    out[i * 4 + 3] = y - tx * w;
  }
  return true;
}
