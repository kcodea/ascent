/**
 * LIGHTNING geometry — the pure, deterministic bolt generator behind the `lightning` primitive, split out of
 * the Pixi code the way `ribbonGeometry.ts` is split out of `ribbon.ts`, so the maths is unit-testable with no
 * renderer. Two stages:
 *
 *   1. `buildStrike` — generate the bolt as a set of POLYLINES (a main path source→target, or N radiating arms,
 *      plus recursive branches) via midpoint displacement + a Laplacian smooth pass.
 *   2. `writeLightningMesh` — lay those polylines into a triangle-strip mesh (2 verts per point, quad indices),
 *      writing position / uv / born attributes the shader reads. Pre-sized buffers, never resized at runtime
 *      (same discipline as the ribbon: a fixed vertex cap keeps a live knob from reallocating a GPU buffer).
 *
 * DETERMINISM is load-bearing: the generator is seeded (mulberry32) and allocation is bounded, so the same
 * `(shape, endpoints, seed)` reproduces the exact bolt on every client — a combat replay needs that. The look
 * was locked in the Lightning Lab workshop reference; the defaults on the primitive match that lock.
 */

export interface LightningPoint { x: number; y: number }

/** One polyline of the bolt. `isMain` marks a primary path (the source→target arc, or a radiate arm); branches
 *  are false. `startFrac` is the fraction along the strike at which this polyline is "reached" during travel —
 *  0 for a main path, and the parent-relative birth fraction for a branch, so branches pop in as the leading
 *  edge passes them. */
export interface Bolt {
  pts: LightningPoint[];
  width: number;
  isMain: boolean;
  startFrac: number;
}

/** The geometry-affecting knobs. Every field optional with a workshop-locked default, so a bare `{}` yields the
 *  authored look. Render-only knobs (colours, glow, flicker, filters) live on the primitive, not here. */
export interface LightningShape {
  /** Displacement amount as a fraction of span — how jagged. Default 0.2. */
  chaos?: number;
  /** Laplacian smoothing (0 = raw fractal kinks, 1 = a flowing arcane arc). Default 0.47. */
  smooth?: number;
  /** Midpoint-subdivision passes: 2^detail segments on the main path. Default 5. */
  detail?: number;
  /** Chance per interior point to spawn a branch. Default 0.1. */
  branchChance?: number;
  /** Fork angle spread in DEGREES. Default 12. */
  branchSpread?: number;
  /** How many generations a branch may itself branch. Default 2. */
  branchDepth?: number;
  /** Mesh width (px) of a main path — the full GLOW envelope; the shader carves the bright core out of the
   *  middle of it. Branches inherit a fraction. Default 28. */
  width?: number;
  /** How much the core thins toward the tip (0 = even, 1 = feathered to a point). Default 0.22. */
  taper?: number;
  /** `travel` spans source→target; `radiate` fires `bolts` arms from the source outward to radius |source→target|. */
  mode?: 'travel' | 'radiate';
  /** Arm count in `radiate` mode. Default 6. */
  bolts?: number;
}

const TAU = Math.PI * 2;

/** Total polylines a single strike may hold — caps runaway branch recursion (a fractal fan-out would otherwise
 *  be unbounded), and sizes the vertex buffers below. Kept modest because the whole index buffer is drawn every
 *  frame (surplus degenerated), so the cap is a real per-frame GPU cost, not just memory. */
export const LIGHTNING_MAX_BOLTS = 60;
/** Points per polyline the mesh writer will honour — a main path is 2^detail+1 points, and `smooth` keeps the
 *  count fixed (Laplacian relax never adds points). The `detail` slider is capped at 7 → 129 points; +1 headroom. */
export const LIGHTNING_MAX_POINTS = 130;
/** Vertices the position buffer must hold: every point becomes 2 verts (left / right of the spine). The mesh is
 *  a triangle LIST (6 indices per quad), so polylines are naturally separate and need no bridging verts. */
export const LIGHTNING_MAX_VERTS = LIGHTNING_MAX_BOLTS * LIGHTNING_MAX_POINTS * 2;
/** Indices the buffer must hold: (points − 1) quads × 6 per polyline, at the cap. */
export const LIGHTNING_MAX_INDICES = LIGHTNING_MAX_BOLTS * (LIGHTNING_MAX_POINTS - 1) * 6;

function mulberry32(a: number): () => number {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Midpoint displacement: recursively split each segment and kick the new midpoint along the segment normal by
 *  a shrinking random amount. Endpoints are never touched, so the polyline always meets its two ends. */
function displace(ax: number, ay: number, bx: number, by: number, detail: number, chaos: number, rand: () => number): LightningPoint[] {
  let pts: LightningPoint[] = [{ x: ax, y: ay }, { x: bx, y: by }];
  let off = chaos * Math.hypot(bx - ax, by - ay) * 0.5;
  for (let g = 0; g < detail; g++) {
    const nx: LightningPoint[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!, b = pts[i + 1]!;
      nx.push(a);
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      const px = -dy / len, py = dx / len, d = (rand() * 2 - 1) * off;
      nx.push({ x: (a.x + b.x) / 2 + px * d, y: (a.y + b.y) / 2 + py * d });
    }
    nx.push(pts[pts.length - 1]!);
    pts = nx;
    off *= 0.5;
  }
  return pts;
}

/** Laplacian relax — pull each interior point toward the midpoint of its neighbours, `amount` per pass, so the
 *  harsh fractal kinks round into a flowing arc. Endpoints pinned (still connects). Point count unchanged, which
 *  is what lets the mesh buffers stay a fixed size. */
function relax(pts: LightningPoint[], amount: number, passes: number): LightningPoint[] {
  for (let p = 0; p < passes; p++) {
    const out = pts.map((q) => ({ x: q.x, y: q.y }));
    for (let i = 1; i < pts.length - 1; i++) {
      out[i]!.x = pts[i]!.x + ((pts[i - 1]!.x + pts[i + 1]!.x) / 2 - pts[i]!.x) * amount;
      out[i]!.y = pts[i]!.y + ((pts[i - 1]!.y + pts[i + 1]!.y) / 2 - pts[i]!.y) * amount;
    }
    pts = out;
  }
  return pts;
}

/**
 * Generate a strike as a list of polylines. `seed` makes it deterministic. A `travel` strike is one main path
 * source→target with recursive branches; a `radiate` strike is `bolts` main arms fired from the source out to
 * radius |source→target|, each with its own branches. Total polylines are capped at `LIGHTNING_MAX_BOLTS`.
 */
export function buildStrike(shape: LightningShape, ax: number, ay: number, bx: number, by: number, seed: number): Bolt[] {
  const {
    chaos = 0.2, smooth = 0.47, detail = 5,
    branchChance = 0.1, branchSpread = 12, branchDepth = 2,
    width = 28, mode = 'travel', bolts = 6,
  } = shape;
  const rand = mulberry32(seed >>> 0);
  const out: Bolt[] = [];
  const budget = { n: LIGHTNING_MAX_BOLTS };

  function grow(sx: number, sy: number, tx: number, ty: number, depth: number, width: number, isMain: boolean, bornAt: number): void {
    if (budget.n <= 0) return;
    budget.n--;
    let pts = displace(sx, sy, tx, ty, detail, chaos, rand);
    if (smooth > 0) pts = relax(pts, smooth, 2);
    out.push({ pts, width, isMain, startFrac: bornAt });
    if (depth <= 0) return;
    for (let i = 1; i < pts.length - 1; i++) {
      if (budget.n > 0 && rand() < branchChance) {
        const a = pts[i]!, b = pts[i + 1]!;
        let ang = Math.atan2(b.y - a.y, b.x - a.x);
        ang += (rand() < 0.5 ? -1 : 1) * (branchSpread * Math.PI / 180) * (0.5 + rand() * 0.5);
        const remain = Math.hypot(tx - a.x, ty - a.y), len = remain * (0.3 + rand() * 0.45);
        grow(a.x, a.y, a.x + Math.cos(ang) * len, a.y + Math.sin(ang) * len,
          depth - 1, Math.max(0.4, width * 0.6), false, isMain ? i / (pts.length - 1) : bornAt);
      }
    }
  }

  if (mode === 'travel') {
    grow(ax, ay, bx, by, branchDepth, width, true, 0);
  } else {
    const R = Math.max(40, Math.hypot(bx - ax, by - ay));
    const base = rand() * TAU;
    for (let k = 0; k < bolts; k++) {
      const ang = base + (k / bolts) * TAU + (rand() * 2 - 1) * 0.25;
      grow(ax, ay, ax + Math.cos(ang) * R, ay + Math.sin(ang) * R, branchDepth, width, true, 0);
    }
  }
  return out;
}

/** The interleaved-by-attribute buffers a lightning mesh is written into — one strip per polyline, all packed
 *  end to end. Sized once to the caps above and never reallocated; `writeLightningMesh` reports how much of each
 *  is live this frame and degenerates the index tail so the draw count can stay fixed. */
export interface LightningMeshBuffers {
  /** 2 floats per vertex — x, y in the container's local space. */
  position: Float32Array;
  /** 2 floats per vertex — u (0 at a polyline's head → 1 at its tip; drives the core→tip colour gradient) and
   *  v (0 on one edge, 1 on the other; the shader makes a soft bright core from it). */
  uv: Float32Array;
  /** 1 float per vertex — the strike fraction at which this vertex is "reached". The shader discards a fragment
   *  whose born > the current travel reach, so the bolt grows to the target and branches pop in behind the tip. */
  born: Float32Array;
  /** Triangle-list indices; the unused tail is filled with 0 (a zero-area triangle the rasteriser drops). */
  index: Uint32Array;
}

/** Allocate a full-capacity buffer set. Call once per instance; reuse every frame. */
export function makeLightningBuffers(): LightningMeshBuffers {
  return {
    position: new Float32Array(LIGHTNING_MAX_VERTS * 2),
    uv: new Float32Array(LIGHTNING_MAX_VERTS * 2),
    born: new Float32Array(LIGHTNING_MAX_VERTS),
    index: new Uint32Array(LIGHTNING_MAX_INDICES),
  };
}

/**
 * Lay `bolts` into `buf` as one triangle-list mesh: every polyline becomes a ribbon of `width` (thinning toward
 * its tip by `taper`), 2 verts per point offset along the smoothed normal. Returns how many vertices and indices
 * are live; the index tail is degenerated to 0 so the caller can draw a fixed count. Never writes past the caps
 * (a strike is already capped at `LIGHTNING_MAX_BOLTS` polylines of `LIGHTNING_MAX_POINTS` points, but the guard
 * keeps a future knob change from overrunning the GPU buffer).
 */
export function writeLightningMesh(buf: LightningMeshBuffers, bolts: Bolt[], taper: number): { vertexCount: number; indexCount: number } {
  let v = 0;   // next vertex slot
  let idx = 0; // next index slot
  for (const bolt of bolts) {
    const pts = bolt.pts;
    const n = pts.length;
    if (n < 2) continue;
    if (v + n * 2 > LIGHTNING_MAX_VERTS || idx + (n - 1) * 6 > LIGHTNING_MAX_INDICES) break;
    const base = v;
    for (let i = 0; i < n; i++) {
      let tx: number, ty: number;
      if (i === 0) { tx = pts[1]!.x - pts[0]!.x; ty = pts[1]!.y - pts[0]!.y; }
      else if (i === n - 1) { tx = pts[n - 1]!.x - pts[n - 2]!.x; ty = pts[n - 1]!.y - pts[n - 2]!.y; }
      else { tx = pts[i + 1]!.x - pts[i - 1]!.x; ty = pts[i + 1]!.y - pts[i - 1]!.y; }
      const m = Math.hypot(tx, ty) || 1;
      const nx = -ty / m, ny = tx / m;           // unit normal
      const u = i / (n - 1);
      const born = bolt.isMain ? u : bolt.startFrac;
      const hw = Math.max(0.2, bolt.width * 0.5 * (1 - taper * u));
      const px = pts[i]!.x, py = pts[i]!.y;
      // left edge (v = 0)
      buf.position[v * 2] = px - nx * hw; buf.position[v * 2 + 1] = py - ny * hw;
      buf.uv[v * 2] = u; buf.uv[v * 2 + 1] = 0; buf.born[v] = born; v++;
      // right edge (v = 1)
      buf.position[v * 2] = px + nx * hw; buf.position[v * 2 + 1] = py + ny * hw;
      buf.uv[v * 2] = u; buf.uv[v * 2 + 1] = 1; buf.born[v] = born; v++;
    }
    for (let i = 0; i < n - 1; i++) {
      const a = base + i * 2;
      buf.index[idx++] = a; buf.index[idx++] = a + 1; buf.index[idx++] = a + 2;
      buf.index[idx++] = a + 2; buf.index[idx++] = a + 1; buf.index[idx++] = a + 3;
    }
  }
  buf.index.fill(0, idx); // degenerate the surplus so a fixed index count never draws stale triangles
  return { vertexCount: v, indexCount: idx };
}
