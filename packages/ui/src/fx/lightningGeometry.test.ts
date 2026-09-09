import { describe, expect, it } from 'vitest';
import {
  buildStrike, writeLightningMesh, makeLightningBuffers,
  LIGHTNING_MAX_BOLTS, LIGHTNING_MAX_VERTS, LIGHTNING_MAX_INDICES,
  type LightningShape,
} from './lightningGeometry';

const A = { x: 100, y: 120 };
const B = { x: 520, y: 380 };
const strike = (shape: LightningShape, seed = 7) => buildStrike(shape, A.x, A.y, B.x, B.y, seed);

describe('buildStrike', () => {
  it('is deterministic — the same shape, endpoints and seed reproduce the identical bolt (a replay needs this)', () => {
    const a = strike({ chaos: 0.3, branchChance: 0.3, branchDepth: 3 }, 42);
    const b = strike({ chaos: 0.3, branchChance: 0.3, branchDepth: 3 }, 42);
    expect(a).toEqual(b);
  });

  it('a different seed gives a different bolt', () => {
    const a = strike({ chaos: 0.3, branchChance: 0.3, branchDepth: 3 }, 1);
    const b = strike({ chaos: 0.3, branchChance: 0.3, branchDepth: 3 }, 2);
    expect(a).not.toEqual(b);
  });

  it('a travel strike with no branches is a single main path from source to target', () => {
    const s = strike({ branchChance: 0, mode: 'travel' });
    expect(s.length).toBe(1);
    expect(s[0]!.isMain).toBe(true);
    const pts = s[0]!.pts;
    expect(pts[0]).toEqual(A);                       // pinned to source
    expect(pts[pts.length - 1]).toEqual(B);          // pinned to target
  });

  it('keeps its endpoints pinned even with heavy chaos + smoothing (the arc still meets both ends)', () => {
    const pts = strike({ branchChance: 0, chaos: 0.9, smooth: 0.8, detail: 6 })[0]!.pts;
    expect(pts[0]).toEqual(A);
    expect(pts[pts.length - 1]).toEqual(B);
  });

  it('has 2^detail + 1 points on the main path, and smoothing does not change the count', () => {
    const raw = strike({ branchChance: 0, detail: 5, smooth: 0 })[0]!.pts.length;
    const smoothed = strike({ branchChance: 0, detail: 5, smooth: 0.6 })[0]!.pts.length;
    expect(raw).toBe(2 ** 5 + 1);
    expect(smoothed).toBe(raw);
  });

  it('radiate fires `bolts` main arms, all starting at the source', () => {
    const s = strike({ mode: 'radiate', bolts: 5, branchChance: 0 });
    const mains = s.filter((b) => b.isMain);
    expect(mains.length).toBe(5);
    for (const m of mains) expect(m.pts[0]).toEqual(A);
  });

  it('branches are flagged non-main and carry a birth fraction in [0,1) for the travel reveal', () => {
    const s = strike({ branchChance: 0.5, branchDepth: 2, detail: 5 }, 3);
    const branches = s.filter((b) => !b.isMain);
    expect(branches.length).toBeGreaterThan(0);
    for (const br of branches) {
      expect(br.startFrac).toBeGreaterThanOrEqual(0);
      expect(br.startFrac).toBeLessThan(1);
      expect(br.width).toBeLessThan(s[0]!.width); // a branch is thinner than the trunk it forked from
    }
  });

  it('caps total polylines at LIGHTNING_MAX_BOLTS however hard branching is pushed', () => {
    const s = strike({ branchChance: 0.6, branchSpread: 60, branchDepth: 5, detail: 6 }, 99);
    expect(s.length).toBeLessThanOrEqual(LIGHTNING_MAX_BOLTS);
  });

  it('smoothing straightens the arc — less total turning than the raw fractal', () => {
    const turning = (pts: { x: number; y: number }[]): number => {
      let sum = 0;
      for (let i = 1; i < pts.length - 1; i++) {
        const a1 = Math.atan2(pts[i]!.y - pts[i - 1]!.y, pts[i]!.x - pts[i - 1]!.x);
        const a2 = Math.atan2(pts[i + 1]!.y - pts[i]!.y, pts[i + 1]!.x - pts[i]!.x);
        let d = Math.abs(a2 - a1); if (d > Math.PI) d = 2 * Math.PI - d;
        sum += d;
      }
      return sum;
    };
    const raw = turning(strike({ branchChance: 0, chaos: 0.5, smooth: 0, detail: 5 }, 11)[0]!.pts);
    const smoothed = turning(strike({ branchChance: 0, chaos: 0.5, smooth: 0.7, detail: 5 }, 11)[0]!.pts);
    expect(smoothed).toBeLessThan(raw);
  });
});

describe('writeLightningMesh', () => {
  const straight = (shape: LightningShape = {}) =>
    buildStrike({ branchChance: 0, chaos: 0, smooth: 0, detail: 3, width: 20, ...shape }, 0, 100, 200, 100, 5);

  it('emits 2 verts per point and 6 indices per segment, summed over every polyline', () => {
    const bolts = buildStrike({ branchChance: 0.5, branchDepth: 2, detail: 5 }, 0, 0, 300, 200, 8);
    const buf = makeLightningBuffers();
    const { vertexCount, indexCount } = writeLightningMesh(buf, bolts, 0.2);
    const expVerts = bolts.reduce((s, b) => s + b.pts.length * 2, 0);
    const expIdx = bolts.reduce((s, b) => s + (b.pts.length - 1) * 6, 0);
    expect(vertexCount).toBe(expVerts);
    expect(indexCount).toBe(expIdx);
  });

  it('offsets the two edge verts perpendicular to a horizontal spine by half the width', () => {
    const buf = makeLightningBuffers();
    writeLightningMesh(buf, straight({ taper: 0 }), 0);
    // point 0 at (0,100): left edge (v=0) then right edge (v=1), offset ±10 in y (width 20 → half 10).
    expect(buf.position[0]).toBeCloseTo(0, 4);
    expect(buf.position[1]).toBeCloseTo(90, 4);   // left  = y - hw
    expect(buf.uv[0]).toBeCloseTo(0, 4); expect(buf.uv[1]).toBeCloseTo(0, 4);
    expect(buf.position[2]).toBeCloseTo(0, 4);
    expect(buf.position[3]).toBeCloseTo(110, 4);  // right = y + hw
    expect(buf.uv[2]).toBeCloseTo(0, 4); expect(buf.uv[3]).toBeCloseTo(1, 4);
  });

  it('runs u 0→1 and born 0→1 along a main path', () => {
    const buf = makeLightningBuffers();
    const bolts = straight({ taper: 0 });
    const n = bolts[0]!.pts.length;
    writeLightningMesh(buf, bolts, 0);
    expect(buf.uv[0]).toBeCloseTo(0, 4);                 // first vert u = 0
    expect(buf.born[0]).toBeCloseTo(0, 4);
    const lastVert = (n - 1) * 2;                          // left vert of the final point
    expect(buf.uv[lastVert * 2]).toBeCloseTo(1, 4);       // last u = 1
    expect(buf.born[lastVert]).toBeCloseTo(1, 4);
  });

  it('gives every vertex of a BRANCH the same born (its birth fraction) so it pops in behind the tip', () => {
    const bolts = buildStrike({ branchChance: 0.6, branchDepth: 1, detail: 5 }, 0, 0, 400, 0, 3);
    const branch = bolts.find((b) => !b.isMain)!;
    expect(branch).toBeTruthy();
    const buf = makeLightningBuffers();
    writeLightningMesh(buf, [branch], 0.2);
    for (let v = 0; v < branch.pts.length * 2; v++) expect(buf.born[v]).toBeCloseTo(branch.startFrac, 5);
  });

  it('thins the strip toward the tip when taper > 0', () => {
    const buf = makeLightningBuffers();
    const bolts = straight({ taper: 0.6 });
    const n = bolts[0]!.pts.length;
    writeLightningMesh(buf, bolts, 0.6);
    const headSpan = Math.abs(buf.position[1]! - buf.position[3]!);        // |left.y - right.y| at head
    const t = (n - 1) * 2;
    const tailSpan = Math.abs(buf.position[t * 2 + 1]! - buf.position[(t + 1) * 2 + 1]!);
    expect(tailSpan).toBeLessThan(headSpan);
  });

  it('degenerates the index tail past the live count to 0', () => {
    const buf = makeLightningBuffers();
    const { indexCount } = writeLightningMesh(buf, straight(), 0.2);
    expect(buf.index[indexCount]).toBe(0);
    expect(buf.index[LIGHTNING_MAX_INDICES - 1]).toBe(0);
  });

  it('never writes past the buffer caps, even for a maxed-out strike', () => {
    const bolts = buildStrike({ branchChance: 0.6, branchSpread: 60, branchDepth: 5, detail: 8 }, 0, 0, 500, 300, 99);
    const buf = makeLightningBuffers();
    const { vertexCount, indexCount } = writeLightningMesh(buf, bolts, 0.2);
    expect(vertexCount).toBeLessThanOrEqual(LIGHTNING_MAX_VERTS);
    expect(indexCount).toBeLessThanOrEqual(LIGHTNING_MAX_INDICES);
    expect(bolts.length).toBeLessThanOrEqual(LIGHTNING_MAX_BOLTS);
  });
});
