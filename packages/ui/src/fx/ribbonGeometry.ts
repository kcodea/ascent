import { sampleCurve, type CurvePoint } from './curve';

/** Segments along the ribbon spine. 48 is enough for a smooth curve at trail lengths up to ~700px, and
 *  stays the DEFAULT so the `segments` param is a no-op until the owner moves it. */
export const RIBBON_SEGMENTS = 48;
/** Floor for the `segments` param — below ~8 the resample can't describe a curve at all. */
export const RIBBON_MIN_SEGMENTS = 8;
/** Ceiling for the `segments` param. Every buffer the primitive owns is sized for this, so raising
 *  `segments` at runtime never reallocates a GPU buffer — see `writeRibbonUVs`/`writeRibbonIndices`. */
export const RIBBON_MAX_SEGMENTS = 128;

/** Clamp a requested segment count into [`RIBBON_MIN_SEGMENTS`, `RIBBON_MAX_SEGMENTS`] and round it to an
 *  integer. Exported so the primitive sizes its buffers from exactly the same rule the geometry applies. */
export function clampRibbonSegments(segments: number): number {
  if (!Number.isFinite(segments)) return RIBBON_SEGMENTS;
  const n = Math.round(segments);
  return n < RIBBON_MIN_SEGMENTS ? RIBBON_MIN_SEGMENTS : n > RIBBON_MAX_SEGMENTS ? RIBBON_MAX_SEGMENTS : n;
}

/** Floats in a position/UV array able to hold `segments` segments (2 verts per sample, 2 floats each). */
export function ribbonVertexFloats(segments: number = RIBBON_MAX_SEGMENTS): number {
  return (segments + 1) * 4;
}

export interface RibbonPoint {
  x: number;
  y: number;
}

export interface RibbonShape {
  /** Fraction of the length over which the head widens from a point. Default 0.12. */
  headPinch?: number;
  /** Exponent of the tail taper — higher feathers away sooner. Default 0.35. */
  tailFeather?: number;
  /**
   * Width multiplier along the ribbon's LENGTH, sampled at normalized position (0 = head, 1 = tail) and
   * multiplied ON TOP of the headPinch/tailFeather profile (it shapes the body, it does not replace the
   * end-controls). Omitted — or a flat `[[0,1],[1,1]]`, for which `sampleCurve` returns exactly 1 — is a
   * byte-identical no-op, since `x * 1` is exact in IEEE-754.
   */
  widthCurve?: ReadonlyArray<CurvePoint>;
  /**
   * Amplitude (px) of a travelling sine displacement applied to the spine PERPENDICULAR to its tangent,
   * so the trail visibly snakes. Default 0 — and 0 short-circuits the whole wave pass, so the geometry is
   * bit-for-bit the un-waved ribbon.
   */
  waveAmp?: number;
  /** Wave cycles along the ribbon's length. Default 2. Irrelevant while `waveAmp` is 0. */
  waveFreq?: number;
  /** Wave travel speed in rad/sec. Default 3. Irrelevant while `waveAmp` is 0. */
  waveSpeed?: number;
  /** The caller's clock in seconds — what makes the wave travel. Default 0 (a frozen wave). */
  timeSec?: number;
  /** Spine resample resolution. Clamped to [`RIBBON_MIN_SEGMENTS`, `RIBBON_MAX_SEGMENTS`].
   *  Default `RIBBON_SEGMENTS`. */
  segments?: number;
}

const TAU = Math.PI * 2;

/** Static UVs: u runs 0 (head) → 1 (tail); v is 0 on one edge and 1 on the other. */
export function buildRibbonUVs(segments: number = RIBBON_SEGMENTS): Float32Array {
  const uvs = new Float32Array(ribbonVertexFloats(segments));
  writeRibbonUVs(uvs, segments);
  return uvs;
}

/**
 * Write the UVs for `segments` segments into `out` (which may be larger — sized for
 * `RIBBON_MAX_SEGMENTS` — so changing `segments` at runtime never reallocates). Samples past `segments`
 * are left as the tail's UV; they only ever back the degenerate triangles `writeRibbonIndices` emits.
 */
export function writeRibbonUVs(out: Float32Array, segments: number = RIBBON_SEGMENTS): void {
  const n = clampRibbonSegments(segments);
  const verts = out.length / 4;
  for (let i = 0; i < verts; i++) {
    const t = i >= n ? 1 : i / n;
    out[i * 4] = t;
    out[i * 4 + 1] = 0;
    out[i * 4 + 2] = t;
    out[i * 4 + 3] = 1;
  }
}

export function buildRibbonIndices(segments: number = RIBBON_SEGMENTS): Uint32Array {
  const indices = new Uint32Array(clampRibbonSegments(segments) * 6);
  writeRibbonIndices(indices, segments);
  return indices;
}

/**
 * Write the triangle list for `segments` segments into `out` (which may be larger — sized for
 * `RIBBON_MAX_SEGMENTS`). The surplus is filled with index 0, i.e. zero-area degenerate triangles the
 * rasterizer drops, so the draw call's index count can stay fixed while `segments` changes. This is what
 * lets `segments` be a live knob without ever resizing a GPU buffer.
 */
export function writeRibbonIndices(out: Uint32Array, segments: number = RIBBON_SEGMENTS): void {
  const n = clampRibbonSegments(segments);
  for (let i = 0; i < n && i * 6 + 6 <= out.length; i++) {
    const a = i * 2;
    out[i * 6] = a;
    out[i * 6 + 1] = a + 1;
    out[i * 6 + 2] = a + 2;
    out[i * 6 + 3] = a + 2;
    out[i * 6 + 4] = a + 1;
    out[i * 6 + 5] = a + 3;
  }
  out.fill(0, n * 6);
}

// Scratch for the resample + wave passes, reused across calls. This runs once per frame per live trail,
// and the repo treats per-frame allocation as a defect — see CLAUDE.md. Safe to share: the function is
// synchronous and never yields, so two trails can never interleave inside it. Sized for the DEFAULT
// segment count and grown on demand by `ensureRibbonScratch` (monotonic: it never shrinks, so a steady
// state at any segment count allocates nothing).
let scratchSamples = RIBBON_SEGMENTS + 1;
let resampledX = new Float32Array(scratchSamples);
let resampledY = new Float32Array(scratchSamples);
let wavedX = new Float32Array(scratchSamples);
let wavedY = new Float32Array(scratchSamples);
// 2-slot scratch for the current unit tangent, so `writeTangent` can "return" a vector without allocating.
const tangent = new Float32Array(2);

/** Current capacity (in spine samples) of the shared resample scratch. Diagnostic/test accessor only. */
export function ribbonScratchSamples(): number {
  return scratchSamples;
}

/**
 * Grow the shared resample scratch so it can hold `samples` values. Returns true only when it actually
 * (re)allocated — i.e. the request exceeded the current capacity. Steady-state calls at any segment count
 * return false and allocate nothing, which is the invariant the hot path depends on.
 */
export function ensureRibbonScratch(samples: number): boolean {
  if (samples <= scratchSamples) return false;
  scratchSamples = samples;
  resampledX = new Float32Array(samples);
  resampledY = new Float32Array(samples);
  wavedX = new Float32Array(samples);
  wavedY = new Float32Array(samples);
  return true;
}

/**
 * Neighbour-smoothed unit tangent at sample `i` of a polyline held in `xs`/`ys` with last index `last`:
 * central difference in the middle, forward/backward at the ends. Writes into the shared `tangent`
 * scratch rather than returning an object, so it stays allocation-free per vertex.
 */
function writeTangent(xs: Float32Array, ys: Float32Array, i: number, last: number): void {
  let tx: number;
  let ty: number;
  if (i === 0) {
    tx = xs[1] - xs[0];
    ty = ys[1] - ys[0];
  } else if (i === last) {
    tx = xs[last] - xs[last - 1];
    ty = ys[last] - ys[last - 1];
  } else {
    tx = xs[i + 1] - xs[i - 1];
    ty = ys[i + 1] - ys[i - 1];
  }
  const m = Math.hypot(tx, ty) || 1;
  tangent[0] = tx / m;
  tangent[1] = ty / m;
}

/**
 * Lay the ribbon along `spine` (head first) and extrude it to `width`.
 *
 * Resamples to even arc length first: without that, a slow frame bunches spine points together and the
 * noise visibly swims along the trail. Tangents are computed from resampled neighbors (central difference
 * in the middle, forward/backward at the ends) so the ribbon rotates smoothly on tight curves.
 * Returns false for a degenerate spine so the caller hides the mesh rather than rendering a NaN triangle.
 *
 * Shaping (all no-ops at their defaults, see `RibbonShape`): `headPinch`/`tailFeather` end-controls, a
 * `widthCurve` multiplier along the length, and a travelling `wave` that displaces the spine itself.
 */
export function writeRibbonPositions(
  out: Float32Array,
  spine: RibbonPoint[],
  width: number,
  shape: RibbonShape = {},
): boolean {
  if (spine.length < 2) return false;

  const {
    headPinch = 0.12,
    tailFeather = 0.35,
    widthCurve,
    waveAmp = 0,
    waveFreq = 2,
    waveSpeed = 3,
    timeSec = 0,
  } = shape;
  const segments = clampRibbonSegments(shape.segments ?? RIBBON_SEGMENTS);
  ensureRibbonScratch(segments + 1);

  const cum = [0];
  for (let i = 1; i < spine.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(spine[i].x - spine[i - 1].x, spine[i].y - spine[i - 1].y));
  }
  const total = cum[cum.length - 1];
  if (total < 1) return false;

  // First pass: compute resampled positions along the spine into scratch buffers
  let seek = 1;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const target = t * total;
    while (seek < cum.length - 1 && cum[seek] < target) seek++;
    const span = cum[seek] - cum[seek - 1] || 1;
    const f = (target - cum[seek - 1]) / span;
    const a = spine[seek - 1];
    const b = spine[seek];
    resampledX[i] = a.x + (b.x - a.x) * f;
    resampledY[i] = a.y + (b.y - a.y) * f;
  }

  // Optional wave pass: displace each sample along its own normal (-ty, tx) by a travelling sine, into a
  // second scratch pair. Writing to a SEPARATE buffer (rather than in place) is what keeps the neighbour
  // differences honest — an in-place shift would feed already-displaced neighbours to later tangents. The
  // extrude pass below then reads the displaced spine, so its tangents follow the wave and the width stays
  // perpendicular to the WAVY centreline (a real snake, not a sheared band).
  // At waveAmp === 0 this pass is skipped entirely and the extrude reads the untouched resample, so the
  // default is bit-for-bit the original geometry.
  const waved = waveAmp !== 0;
  if (waved) {
    for (let i = 0; i <= segments; i++) {
      writeTangent(resampledX, resampledY, i, segments);
      const offset = waveAmp * Math.sin((i / segments) * waveFreq * TAU + timeSec * waveSpeed);
      wavedX[i] = resampledX[i] - tangent[1] * offset;
      wavedY[i] = resampledY[i] + tangent[0] * offset;
    }
  }
  const spineX = waved ? wavedX : resampledX;
  const spineY = waved ? wavedY : resampledY;

  // Second pass: compute extrusions using neighbor-based tangents
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const x = spineX[i];
    const y = spineY[i];

    writeTangent(spineX, spineY, i, segments);
    const tx = tangent[0];
    const ty = tangent[1];

    // Pinched at the head, full through the body, feathered at the tail — then shaped along the length by
    // widthCurve. `* 1` is exact, so an absent (or flat) curve leaves the original expression untouched.
    const curveMul = widthCurve === undefined ? 1 : sampleCurve(widthCurve, t);
    const w = width * 0.5 * Math.min(1, t / headPinch) * Math.pow(1 - t, tailFeather) * curveMul;
    out[i * 4] = x - ty * w;
    out[i * 4 + 1] = y + tx * w;
    out[i * 4 + 2] = x + ty * w;
    out[i * 4 + 3] = y - tx * w;
  }

  // `out` may be sized for RIBBON_MAX_SEGMENTS while `segments` is lower (that fixed sizing is what makes
  // the segments knob allocation-free). Collapse the surplus onto the tail vertex so no stale coordinate
  // from a previously-higher segment count can widen the mesh's computed bounds. Those vertices are never
  // rasterized — writeRibbonIndices degenerates their triangles — this is purely bounds hygiene, and it's
  // a no-op when `out` is exactly sized (the common case, and every existing caller).
  for (let i = segments + 1; i * 4 + 3 < out.length; i++) {
    out[i * 4] = out[segments * 4];
    out[i * 4 + 1] = out[segments * 4 + 1];
    out[i * 4 + 2] = out[segments * 4 + 2];
    out[i * 4 + 3] = out[segments * 4 + 3];
  }
  return true;
}
