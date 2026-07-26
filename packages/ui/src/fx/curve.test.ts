import { describe, expect, it } from 'vitest';
import {
  sampleCurve,
  CURVE_PRESETS,
  CURVE_T_EPSILON,
  MIN_CURVE_POINTS,
  insertCurvePoint,
  removeCurvePoint,
  type CurvePoint,
} from './curve';

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

// The editor's add/remove affordances. Extracted here (rather than living inside CurveEditor's event
// handlers) because these ARE the rules a curve has to obey -- sorted ascending by t, endpoints pinned to
// birth/death, never fewer than MIN_CURVE_POINTS -- and `sampleCurve` above plus `coerceParams` both depend
// on them. Before this existed the editor could only move the points a curve already had, so a 2-point
// param could only ever be a straight line by direct manipulation.

describe('insertCurvePoint', () => {
  const LINE: CurvePoint[] = [[0, 1], [1, 0]];

  it('turns a 2-point straight line into a 3-point shape (the headline case)', () => {
    const next = insertCurvePoint(LINE, 0.5, 0.9);
    expect(next).toHaveLength(3);
    expect(next[1]).toEqual([0.5, 0.9]);
  });

  it('keeps the list sorted ascending by t wherever the click lands', () => {
    let pts: number[][] = LINE.map((p) => [p[0], p[1]]);
    for (const t of [0.8, 0.2, 0.55, 0.35, 0.95]) pts = insertCurvePoint(pts, t, 0.5);
    expect(pts.map((p) => p[0])).toEqual([...pts.map((p) => p[0])].sort((a, b) => a - b));
    expect(pts).toHaveLength(7);
  });

  it('inserts into the correct segment of a multi-point curve', () => {
    const pop: CurvePoint[] = [[0, 0], [0.5, 1], [1, 0]];
    expect(insertCurvePoint(pop, 0.25, 0.4)[1]).toEqual([0.25, 0.4]); // before the knot
    expect(insertCurvePoint(pop, 0.75, 0.4)[2]).toEqual([0.75, 0.4]); // after the knot
  });

  it('clamps t strictly between its neighbours so points can never collide or reorder', () => {
    const pts = insertCurvePoint([[0, 1], [0.5, 0.5], [1, 0]], 0.5, 0.2);
    expect(pts).toHaveLength(4);
    // A click exactly on an existing point's t is nudged into the segment after it, not onto it.
    expect(pts[2][0]).toBeGreaterThan(0.5);
    expect(pts[2][0]).toBeLessThan(1);
    expect(pts[2][0]).toBeCloseTo(0.5 + CURVE_T_EPSILON, 9);
  });

  it('never displaces the pinned endpoints — an out-of-range click folds into the interior', () => {
    const low = insertCurvePoint(LINE, -5, 0.5);
    expect(low[0]).toEqual([0, 1]); // t=0 endpoint untouched
    expect(low[1][0]).toBeGreaterThan(0);
    const high = insertCurvePoint(LINE, 5, 0.5);
    expect(high[2]).toEqual([1, 0]); // t=1 endpoint untouched
    expect(high[1][0]).toBeLessThan(1);
  });

  it('clamps v into [0, vMax] (default 1)', () => {
    expect(insertCurvePoint(LINE, 0.5, 99)[1][1]).toBe(1);
    expect(insertCurvePoint(LINE, 0.5, -3)[1][1]).toBe(0);
    expect(insertCurvePoint(LINE, 0.5, 99, 2)[1][1]).toBe(2); // spec with a raised ceiling
    expect(insertCurvePoint(LINE, 0.5, 1.5, 2)[1][1]).toBe(1.5);
  });

  it('refuses when there is no room between the bracketing points', () => {
    const crowded: CurvePoint[] = [[0, 1], [0.5, 0.5], [0.5 + CURVE_T_EPSILON, 0.4], [1, 0]];
    expect(insertCurvePoint(crowded, 0.5 + CURVE_T_EPSILON / 2, 0.9)).toHaveLength(crowded.length);
  });

  it('never mutates or aliases the input', () => {
    const src: number[][] = [[0, 1], [1, 0]];
    const next = insertCurvePoint(src, 0.5, 0.5);
    expect(src).toEqual([[0, 1], [1, 0]]);
    expect(next[0]).not.toBe(src[0]);
  });
});

describe('removeCurvePoint', () => {
  const THREE: CurvePoint[] = [[0, 1], [0.5, 0.5], [1, 0]];

  it('removes an interior point', () => {
    expect(removeCurvePoint(THREE, 1)).toEqual([[0, 1], [1, 0]]);
  });

  it('refuses to go below MIN_CURVE_POINTS (coerceParams would reject the result)', () => {
    const line: CurvePoint[] = [[0, 1], [1, 0]];
    expect(line).toHaveLength(MIN_CURVE_POINTS);
    expect(removeCurvePoint(line, 0)).toEqual(line);
    expect(removeCurvePoint(line, 1)).toEqual(line);
  });

  it('refuses the pinned first and last points', () => {
    expect(removeCurvePoint(THREE, 0)).toEqual(THREE);
    expect(removeCurvePoint(THREE, THREE.length - 1)).toEqual(THREE);
  });

  it('refuses an out-of-range or non-integer index', () => {
    expect(removeCurvePoint(THREE, -1)).toEqual(THREE);
    expect(removeCurvePoint(THREE, 99)).toEqual(THREE);
    expect(removeCurvePoint(THREE, 1.5)).toEqual(THREE);
  });

  it('round-trips with insertCurvePoint: 2 points -> 3 -> back to the original 2', () => {
    const line: CurvePoint[] = [[0, 1], [1, 0]];
    const three = insertCurvePoint(line, 0.4, 0.8);
    expect(three).toHaveLength(3);
    expect(removeCurvePoint(three, 1)).toEqual([[0, 1], [1, 0]]);
  });

  it('never mutates or aliases the input', () => {
    const src: number[][] = [[0, 1], [0.5, 0.5], [1, 0]];
    const next = removeCurvePoint(src, 1);
    expect(src).toHaveLength(3);
    expect(next[0]).not.toBe(src[0]);
  });

  it('leaves a curve the sampler can still read (sorted, >= 2 points) after repeated edits', () => {
    let pts: number[][] = [[0, 1], [1, 0]];
    for (const t of [0.3, 0.6, 0.45]) pts = insertCurvePoint(pts, t, 0.5);
    while (pts.length > MIN_CURVE_POINTS) pts = removeCurvePoint(pts, 1);
    expect(pts).toEqual([[0, 1], [1, 0]]);
    expect(sampleCurve(pts as CurvePoint[], 0.5)).toBeCloseTo(0.5, 10);
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
