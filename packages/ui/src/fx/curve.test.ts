import { describe, expect, it } from 'vitest';
import { sampleCurve, CURVE_PRESETS, type CurvePoint } from './curve';

describe('sampleCurve', () => {
  it('returns 1 (identity) for an empty curve', () => {
    expect(sampleCurve([], 0)).toBe(1);
    expect(sampleCurve([], 0.5)).toBe(1);
    expect(sampleCurve([], 1)).toBe(1);
  });

  it('returns the single point value at every t', () => {
    const one: CurvePoint[] = [[0.3, 0.42]];
    expect(sampleCurve(one, 0)).toBe(0.42);
    expect(sampleCurve(one, 0.3)).toBe(0.42);
    expect(sampleCurve(one, 1)).toBe(0.42);
  });

  it('returns the exact endpoint values', () => {
    const c: CurvePoint[] = [[0, 1], [1, 0]];
    expect(sampleCurve(c, 0)).toBe(1);
    expect(sampleCurve(c, 1)).toBe(0);
  });

  it('lerps a midpoint', () => {
    expect(sampleCurve([[0, 1], [1, 0]], 0.5)).toBe(0.5);
    expect(sampleCurve([[0, 0], [1, 1]], 0.25)).toBe(0.25);
  });

  it('clamps out-of-range t to the endpoints', () => {
    const c: CurvePoint[] = [[0, 1], [1, 0]];
    expect(sampleCurve(c, -0.5)).toBe(1); // t < first t -> first v
    expect(sampleCurve(c, 2)).toBe(0); // t > last t -> last v
  });

  it('samples the correct segment of a multi-segment curve', () => {
    // pop-like: rises 0->1 over [0, 0.5], falls 1->0 over [0.5, 1]
    const c: CurvePoint[] = [[0, 0], [0.5, 1], [1, 0]];
    expect(sampleCurve(c, 0.25)).toBeCloseTo(0.5, 10); // first segment
    expect(sampleCurve(c, 0.5)).toBe(1); // shared knot
    expect(sampleCurve(c, 0.75)).toBeCloseTo(0.5, 10); // second segment
  });

  it('takes the left value across a zero-width segment (no divide-by-zero)', () => {
    // two points share t; a sample at that t should be finite, not NaN
    const c: CurvePoint[] = [[0, 1], [0.5, 0.8], [0.5, 0.2], [1, 0]];
    expect(Number.isFinite(sampleCurve(c, 0.5))).toBe(true);
  });

  it('reproduces the burst default identity: sampleCurve([[0,1],[1,0]], t) === 1 - t', () => {
    const c: CurvePoint[] = [[0, 1], [1, 0]];
    for (const t of [0, 0.1, 0.25, 0.5, 0.73, 0.9, 1]) {
      expect(sampleCurve(c, t)).toBeCloseTo(1 - t, 10);
    }
  });

  it('reproduces the emitter default identity: sampleCurve([[0,1],[1,0.75]], t) === 1 - 0.25*t', () => {
    const c: CurvePoint[] = [[0, 1], [1, 0.75]];
    for (const t of [0, 0.1, 0.25, 0.5, 0.73, 0.9, 1]) {
      expect(sampleCurve(c, t)).toBeCloseTo(1 - 0.25 * t, 10);
    }
  });
});

describe('CURVE_PRESETS', () => {
  it('every preset has at least 2 points, sorted ascending by t, all in [0,1]', () => {
    for (const [name, pts] of Object.entries(CURVE_PRESETS)) {
      expect(pts.length, name).toBeGreaterThanOrEqual(2);
      for (let i = 0; i < pts.length; i++) {
        expect(pts[i][0], name).toBeGreaterThanOrEqual(0);
        expect(pts[i][0], name).toBeLessThanOrEqual(1);
        expect(pts[i][1], name).toBeGreaterThanOrEqual(0);
        expect(pts[i][1], name).toBeLessThanOrEqual(1);
        if (i > 0) expect(pts[i][0], name).toBeGreaterThanOrEqual(pts[i - 1][0]);
      }
    }
  });
});
