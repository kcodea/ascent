import { describe, expect, it } from 'vitest';
import {
  RIBBON_MAX_SEGMENTS,
  RIBBON_MIN_SEGMENTS,
  RIBBON_SEGMENTS,
  buildRibbonIndices,
  buildRibbonUVs,
  clampRibbonSegments,
  ensureRibbonScratch,
  ribbonScratchSamples,
  ribbonVertexFloats,
  writeRibbonIndices,
  writeRibbonPositions,
  writeRibbonUVs,
} from './ribbonGeometry';

const straight = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
];

describe('buildRibbonUVs', () => {
  it('runs u from 0 at the head to 1 at the tail, with v on both edges', () => {
    const uvs = buildRibbonUVs();
    expect(uvs.length).toBe((RIBBON_SEGMENTS + 1) * 4);
    expect([uvs[0], uvs[1], uvs[2], uvs[3]]).toEqual([0, 0, 0, 1]);
    expect(uvs[uvs.length - 4]).toBeCloseTo(1);
    expect(uvs[uvs.length - 2]).toBeCloseTo(1);
  });
});

describe('writeRibbonPositions', () => {
  it('extrudes perpendicular to a horizontal spine', () => {
    const pos = new Float32Array((RIBBON_SEGMENTS + 1) * 4);
    expect(writeRibbonPositions(pos, straight, 40)).toBe(true);
    const mid = Math.floor(RIBBON_SEGMENTS / 2) * 4;
    expect(pos[mid]).toBeCloseTo(pos[mid + 2]);
    expect(pos[mid + 1]).toBeGreaterThan(pos[mid + 3]);
  });

  it('tapers to nothing at the tail', () => {
    const pos = new Float32Array((RIBBON_SEGMENTS + 1) * 4);
    writeRibbonPositions(pos, straight, 40);
    const last = RIBBON_SEGMENTS * 4;
    expect(Math.abs(pos[last + 1] - pos[last + 3])).toBeLessThan(0.5);
  });

  it('pinches the head so the ribbon comes to a point', () => {
    const pos = new Float32Array((RIBBON_SEGMENTS + 1) * 4);
    writeRibbonPositions(pos, straight, 40);
    expect(Math.abs(pos[1] - pos[3])).toBeLessThan(Math.abs(pos[4 * 8 + 1] - pos[4 * 8 + 3]));
  });

  it('reports false for a degenerate spine so the caller can hide the mesh', () => {
    const pos = new Float32Array((RIBBON_SEGMENTS + 1) * 4);
    expect(writeRibbonPositions(pos, [{ x: 5, y: 5 }], 40)).toBe(false);
    expect(writeRibbonPositions(pos, [{ x: 5, y: 5 }, { x: 5, y: 5 }], 40)).toBe(false);
  });

  it('resamples to even arc length regardless of input point spacing', () => {
    const clumped = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 100, y: 0 }];
    const a = new Float32Array((RIBBON_SEGMENTS + 1) * 4);
    const b = new Float32Array((RIBBON_SEGMENTS + 1) * 4);
    writeRibbonPositions(a, clumped, 40);
    writeRibbonPositions(b, straight, 40);
    for (let i = 0; i < a.length; i += 4) expect(a[i]).toBeCloseTo(b[i], 1);
  });

  it('smooths tangent across neighbors on sharp turns (L-shape spine)', () => {
    const lShape = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 50 },
    ];
    const pos = new Float32Array((RIBBON_SEGMENTS + 1) * 4);
    writeRibbonPositions(pos, lShape, 40);

    // Collect width vectors (perpendicular extrusion offsets)
    const widthVectors: { dx: number; dy: number }[] = [];
    for (let i = 0; i <= RIBBON_SEGMENTS; i++) {
      const left_x = pos[i * 4];
      const left_y = pos[i * 4 + 1];
      const right_x = pos[i * 4 + 2];
      const right_y = pos[i * 4 + 3];
      const dx = right_x - left_x;
      const dy = right_y - left_y;
      widthVectors.push({ dx, dy });
    }

    // Check that consecutive vectors differ by small increments (rotation is progressive)
    let maxAngleChange = 0;
    for (let i = 1; i < widthVectors.length; i++) {
      const v1 = widthVectors[i - 1];
      const v2 = widthVectors[i];
      // Compute angle between vectors
      const dot = v1.dx * v2.dx + v1.dy * v2.dy;
      const cross = v1.dx * v2.dy - v1.dy * v2.dx;
      const angle = Math.atan2(cross, dot);
      maxAngleChange = Math.max(maxAngleChange, Math.abs(angle));
    }

    // With smooth tangents, max angle change should be gradual across the turn
    // The L-shape makes a 90-degree turn; with smooth neighbor-based tangents, the rotation
    // should be distributed progressively, not snap between two fixed directions
    expect(maxAngleChange).toBeLessThan(Math.PI / 2.5); // ~72 degrees worst-case in the corner
  });

  it('applies parameterized head-pinch to delay widening', () => {
    const pos1 = new Float32Array((RIBBON_SEGMENTS + 1) * 4);
    const pos2 = new Float32Array((RIBBON_SEGMENTS + 1) * 4);
    writeRibbonPositions(pos1, straight, 40, { headPinch: 0.05 });
    writeRibbonPositions(pos2, straight, 40, { headPinch: 0.20 });

    // At an early index, the larger headPinch should have smaller width
    const idx = 4; // Check at segment 4
    const width1 = Math.abs(pos1[idx * 4 + 1] - pos1[idx * 4 + 3]);
    const width2 = Math.abs(pos2[idx * 4 + 1] - pos2[idx * 4 + 3]);
    expect(width2).toBeLessThan(width1);
  });

  it('applies parameterized tail-feather to feather the tail away sooner', () => {
    const pos1 = new Float32Array((RIBBON_SEGMENTS + 1) * 4);
    const pos2 = new Float32Array((RIBBON_SEGMENTS + 1) * 4);
    writeRibbonPositions(pos1, straight, 40, { tailFeather: 0.20 });
    writeRibbonPositions(pos2, straight, 40, { tailFeather: 0.50 });

    // At a late index, the larger tailFeather should have smaller width (feathered sooner)
    const idx = Math.floor(RIBBON_SEGMENTS * 0.85); // Check at 85% along the trail
    const width1 = Math.abs(pos1[idx * 4 + 1] - pos1[idx * 4 + 3]);
    const width2 = Math.abs(pos2[idx * 4 + 1] - pos2[idx * 4 + 3]);
    expect(width2).toBeLessThan(width1);
  });
});

/** Half-width at sample `i` — the two extruded edges are symmetric about the spine. */
function halfWidthAt(pos: Float32Array, i: number): number {
  return Math.hypot(pos[i * 4] - pos[i * 4 + 2], pos[i * 4 + 1] - pos[i * 4 + 3]) / 2;
}

describe('writeRibbonPositions — widthCurve', () => {
  it('is a byte-identical no-op for a flat [[0,1],[1,1]] curve', () => {
    const withCurve = new Float32Array((RIBBON_SEGMENTS + 1) * 4);
    const without = new Float32Array((RIBBON_SEGMENTS + 1) * 4);
    writeRibbonPositions(withCurve, straight, 40, { widthCurve: [[0, 1], [1, 1]] });
    writeRibbonPositions(without, straight, 40);
    // Exact equality, not toBeCloseTo: `x * 1` is exact in IEEE-754, so the current look must be
    // untouched to the last bit until the owner actually shapes the curve.
    expect(Array.from(withCurve)).toEqual(Array.from(without));
  });

  it('is a byte-identical no-op on a curved spine too (the tangents are unaffected)', () => {
    const lShape = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }];
    const withCurve = new Float32Array((RIBBON_SEGMENTS + 1) * 4);
    const without = new Float32Array((RIBBON_SEGMENTS + 1) * 4);
    writeRibbonPositions(withCurve, lShape, 40, { widthCurve: [[0, 1], [0.5, 1], [1, 1]] });
    writeRibbonPositions(without, lShape, 40);
    expect(Array.from(withCurve)).toEqual(Array.from(without));
  });

  it('scales the half-width by the sampled multiplier at the expected samples', () => {
    const base = new Float32Array((RIBBON_SEGMENTS + 1) * 4);
    const curved = new Float32Array((RIBBON_SEGMENTS + 1) * 4);
    writeRibbonPositions(base, straight, 40);
    // Full width at the head, half at the midpoint, full again at the tail — a waisted ribbon.
    writeRibbonPositions(curved, straight, 40, { widthCurve: [[0, 1], [0.5, 0.5], [1, 1]] });

    const mid = RIBBON_SEGMENTS / 2; // t = 0.5 exactly → multiplier 0.5
    expect(halfWidthAt(curved, mid)).toBeCloseTo(halfWidthAt(base, mid) * 0.5, 4);

    const quarter = RIBBON_SEGMENTS / 4; // t = 0.25 → halfway between 1 and 0.5 → 0.75
    expect(halfWidthAt(curved, quarter)).toBeCloseTo(halfWidthAt(base, quarter) * 0.75, 4);
  });

  it('multiplies ON TOP of headPinch/tailFeather rather than replacing them', () => {
    const pinched = new Float32Array((RIBBON_SEGMENTS + 1) * 4);
    writeRibbonPositions(pinched, straight, 40, {
      headPinch: 0.5,
      widthCurve: [[0, 1], [1, 1]],
    });
    // The head is still pinched to (nearly) a point even with a flat, full-width curve.
    expect(halfWidthAt(pinched, 0)).toBeLessThan(halfWidthAt(pinched, RIBBON_SEGMENTS / 4));
  });
});

describe('writeRibbonPositions — wave', () => {
  it('is a byte-identical no-op at waveAmp 0, whatever the freq/speed/time', () => {
    const waved = new Float32Array((RIBBON_SEGMENTS + 1) * 4);
    const plain = new Float32Array((RIBBON_SEGMENTS + 1) * 4);
    writeRibbonPositions(waved, straight, 40, { waveAmp: 0, waveFreq: 7, waveSpeed: 11, timeSec: 3.7 });
    writeRibbonPositions(plain, straight, 40);
    expect(Array.from(waved)).toEqual(Array.from(plain));
  });

  it('displaces the spine perpendicular to the tangent', () => {
    const plain = new Float32Array((RIBBON_SEGMENTS + 1) * 4);
    const waved = new Float32Array((RIBBON_SEGMENTS + 1) * 4);
    writeRibbonPositions(plain, straight, 40);
    writeRibbonPositions(waved, straight, 40, { waveAmp: 20, waveFreq: 2, waveSpeed: 0, timeSec: 0 });

    // Centre-line displacement per sample, versus the (horizontal, tangent = +x) unwaved spine.
    let maxOffset = 0;
    for (let i = 0; i <= RIBBON_SEGMENTS; i++) {
      const cxPlain = (plain[i * 4] + plain[i * 4 + 2]) / 2;
      const cyPlain = (plain[i * 4 + 1] + plain[i * 4 + 3]) / 2;
      const cxWaved = (waved[i * 4] + waved[i * 4 + 2]) / 2;
      const cyWaved = (waved[i * 4 + 1] + waved[i * 4 + 3]) / 2;
      const dx = cxWaved - cxPlain;
      const dy = cyWaved - cyPlain;
      // Tangent is (1, 0) all along a horizontal spine → a perpendicular displacement has zero x.
      expect(Math.abs(dx)).toBeLessThan(1e-3);
      maxOffset = Math.max(maxOffset, Math.abs(dy));
    }
    // …and it actually moved: sin peaks at ±1 somewhere over 2 full cycles.
    expect(maxOffset).toBeGreaterThan(19);
    expect(maxOffset).toBeLessThan(20.001);
  });

  it('travels with time — the same geometry at a later timeSec differs', () => {
    const t0 = new Float32Array((RIBBON_SEGMENTS + 1) * 4);
    const t1 = new Float32Array((RIBBON_SEGMENTS + 1) * 4);
    writeRibbonPositions(t0, straight, 40, { waveAmp: 20, waveFreq: 2, waveSpeed: 3, timeSec: 0 });
    writeRibbonPositions(t1, straight, 40, { waveAmp: 20, waveFreq: 2, waveSpeed: 3, timeSec: 0.5 });
    expect(Array.from(t0)).not.toEqual(Array.from(t1));
  });

  it('holds still when waveSpeed is 0', () => {
    const t0 = new Float32Array((RIBBON_SEGMENTS + 1) * 4);
    const t1 = new Float32Array((RIBBON_SEGMENTS + 1) * 4);
    writeRibbonPositions(t0, straight, 40, { waveAmp: 20, waveFreq: 2, waveSpeed: 0, timeSec: 0 });
    writeRibbonPositions(t1, straight, 40, { waveAmp: 20, waveFreq: 2, waveSpeed: 0, timeSec: 9 });
    expect(Array.from(t0)).toEqual(Array.from(t1));
  });
});

describe('writeRibbonPositions — segments', () => {
  it('defaults to RIBBON_SEGMENTS, so passing it explicitly is a byte-identical no-op', () => {
    const explicit = new Float32Array((RIBBON_SEGMENTS + 1) * 4);
    const implicit = new Float32Array((RIBBON_SEGMENTS + 1) * 4);
    writeRibbonPositions(explicit, straight, 40, { segments: RIBBON_SEGMENTS });
    writeRibbonPositions(implicit, straight, 40);
    expect(Array.from(explicit)).toEqual(Array.from(implicit));
  });

  it('writes more distinct samples at a higher segment count', () => {
    const lo = new Float32Array(ribbonVertexFloats(RIBBON_MAX_SEGMENTS));
    const hi = new Float32Array(ribbonVertexFloats(RIBBON_MAX_SEGMENTS));
    writeRibbonPositions(lo, straight, 40, { segments: 8 });
    writeRibbonPositions(hi, straight, 40, { segments: 96 });
    const distinctX = (a: Float32Array): number => {
      const xs = new Set<number>();
      for (let i = 0; i * 4 + 3 < a.length; i++) xs.add(a[i * 4]);
      return xs.size;
    };
    expect(distinctX(hi)).toBeGreaterThan(distinctX(lo));
    // Surplus samples collapse onto the tail vertex — never stale garbage that could widen the bounds.
    const tail = 8 * 4;
    expect(lo[tail + 4]).toBe(lo[tail]);
    expect(lo[lo.length - 4]).toBe(lo[tail]);
  });

  it('clamps a requested count into [min, max]', () => {
    expect(clampRibbonSegments(1)).toBe(RIBBON_MIN_SEGMENTS);
    expect(clampRibbonSegments(9999)).toBe(RIBBON_MAX_SEGMENTS);
    expect(clampRibbonSegments(64)).toBe(64);
    expect(clampRibbonSegments(Number.NaN)).toBe(RIBBON_SEGMENTS);
  });
});

describe('ribbon scratch capacity', () => {
  it('grows only when the request exceeds capacity, and never on a steady-state repeat', () => {
    // Ask for the max once — this may or may not allocate depending on what earlier tests already grew to.
    ensureRibbonScratch(RIBBON_MAX_SEGMENTS + 1);
    const capacity = ribbonScratchSamples();
    expect(capacity).toBeGreaterThanOrEqual(RIBBON_MAX_SEGMENTS + 1);
    // Every subsequent call at or below capacity must report "no allocation" — this is the per-frame path.
    for (let i = 0; i < 5; i++) {
      expect(ensureRibbonScratch(RIBBON_MAX_SEGMENTS + 1)).toBe(false);
      expect(ensureRibbonScratch(RIBBON_SEGMENTS + 1)).toBe(false);
    }
    expect(ribbonScratchSamples()).toBe(capacity);
  });

  it('never shrinks, so dropping back to a low segment count also allocates nothing', () => {
    ensureRibbonScratch(RIBBON_MAX_SEGMENTS + 1);
    const capacity = ribbonScratchSamples();
    const pos = new Float32Array(ribbonVertexFloats(RIBBON_MAX_SEGMENTS));
    writeRibbonPositions(pos, straight, 40, { segments: RIBBON_MIN_SEGMENTS });
    expect(ribbonScratchSamples()).toBe(capacity);
  });

  it('a repeated steady-state frame at a raised segment count allocates nothing', () => {
    const pos = new Float32Array(ribbonVertexFloats(RIBBON_MAX_SEGMENTS));
    writeRibbonPositions(pos, straight, 40, { segments: RIBBON_MAX_SEGMENTS });
    const capacity = ribbonScratchSamples();
    for (let frame = 0; frame < 10; frame++) {
      writeRibbonPositions(pos, straight, 40, { segments: RIBBON_MAX_SEGMENTS, timeSec: frame / 60 });
      expect(ribbonScratchSamples()).toBe(capacity);
    }
  });
});

describe('writeRibbonUVs / writeRibbonIndices (fixed-capacity buffers)', () => {
  it('writes u across the ACTIVE segment count and pins the surplus at the tail', () => {
    const uvs = new Float32Array(ribbonVertexFloats(RIBBON_MAX_SEGMENTS));
    writeRibbonUVs(uvs, 16);
    expect(uvs[0]).toBe(0);
    expect(uvs[16 * 4]).toBeCloseTo(1);
    expect(uvs[8 * 4]).toBeCloseTo(0.5);
    expect(uvs[uvs.length - 4]).toBe(1); // surplus pinned at the tail's u
  });

  it('degenerates every surplus triangle so the index count can stay fixed', () => {
    const indices = buildRibbonIndices(RIBBON_MAX_SEGMENTS);
    expect(indices.length).toBe(RIBBON_MAX_SEGMENTS * 6);
    writeRibbonIndices(indices, 12);
    expect(Array.from(indices.slice(0, 6))).toEqual([0, 1, 2, 2, 1, 3]);
    // Last real triangle is segment 11; everything after it is (0,0,0) → zero area.
    for (let i = 12 * 6; i < indices.length; i++) expect(indices[i]).toBe(0);
  });

  it('buildRibbonUVs still defaults to the classic exact-size array', () => {
    expect(buildRibbonUVs().length).toBe((RIBBON_SEGMENTS + 1) * 4);
    expect(buildRibbonIndices().length).toBe(RIBBON_SEGMENTS * 6);
  });
});
