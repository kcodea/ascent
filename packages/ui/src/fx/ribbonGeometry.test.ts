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
});
