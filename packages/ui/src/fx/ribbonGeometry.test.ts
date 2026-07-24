import { describe, expect, it } from 'vitest';
import { RIBBON_SEGMENTS, buildRibbonUVs, writeRibbonPositions } from './ribbonGeometry';

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
