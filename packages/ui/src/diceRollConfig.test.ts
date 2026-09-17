import { describe, expect, it } from 'vitest';
import { flickDistanceScale, flickOf, throwLanding, towardBoard } from './diceRollConfig';

/** The Gamble die's throw geometry (owner asks 2026-09-17): direction from the mouse's flick before release (or
 *  toward the board centre when still), distance mildly scaled by flick speed, seeded wobble, clamped inside the
 *  viewport and above the hand row. Pure — every rect and sample is an input. */
const BOUNDS = { width: 1400, height: 900, handTop: 760, margin: 60 };
const UP = { x: 0, y: -1 };

describe('flickOf', () => {
  it('reads the direction from the sample ~120 ms before release to the release point, with its speed', () => {
    const samples = [0, 30, 60, 90, 120, 150].map((dt) => ({ x: 500 + dt, y: 700, t: 1000 + dt }));
    const f = flickOf(samples, { x: 660, y: 700, t: 1150 })!;
    expect(f.dir).toEqual({ x: 1, y: 0 });
    // Reference = the sample at t=1030 (120 ms back), x=530: 130 px over 120 ms.
    expect(f.speed).toBeCloseTo(130 / 120, 6);
  });
  it('uses the oldest sample in the window when the history is shorter than the look-back', () => {
    const f = flickOf([{ x: 600, y: 600, t: 1100 }, { x: 600, y: 580, t: 1130 }], { x: 600, y: 540, t: 1150 })!;
    expect(f.dir).toEqual({ x: 0, y: -1 });
    expect(f.speed).toBeCloseTo(60 / 50, 6);
  });
  it('is null when the pointer was still (under 8 px of travel) or the history is empty / stale', () => {
    expect(flickOf([{ x: 600, y: 600, t: 1040 }], { x: 603, y: 605, t: 1150 })).toBeNull();
    expect(flickOf([], { x: 600, y: 600, t: 1150 })).toBeNull();
    expect(flickOf([{ x: 100, y: 100, t: 500 }], { x: 600, y: 600, t: 1150 })).toBeNull(); // older than the window
  });
});

describe('flickDistanceScale', () => {
  it('1 px/ms is neutral; faster stretches, slower shortens, clamped to 0.6x-1.6x; 0 strength ignores speed', () => {
    expect(flickDistanceScale(1, 0.5)).toBe(1);
    expect(flickDistanceScale(2, 0.5)).toBe(1.5);
    expect(flickDistanceScale(0.2, 0.5)).toBeCloseTo(0.6, 6);
    expect(flickDistanceScale(9, 1)).toBe(1.6);
    expect(flickDistanceScale(0, 1)).toBe(0.6);
    expect(flickDistanceScale(5, 0)).toBe(1);
  });
});

describe('towardBoard', () => {
  it('points from the cast point to the board centre, never downward (away from the hand)', () => {
    expect(towardBoard({ x: 700, y: 800 }, { x: 700, y: 400 })).toEqual(UP);
    const high = towardBoard({ x: 600, y: 300 }, { x: 700, y: 500 });
    expect(high.y).toBeLessThan(0);
    expect(high.x).toBeGreaterThan(0);
    expect(towardBoard({ x: 700, y: 500 }, { x: 700, y: 500 })).toEqual(UP);
  });
});

describe('throwLanding', () => {
  it('travels `distance` px from the cast point along the direction', () => {
    expect(throwLanding({ x: 700, y: 800 }, UP, { distance: 220, jitterDeg: 10 }, 0, BOUNDS)).toEqual({ x: 700, y: 580 });
    const diag = throwLanding({ x: 400, y: 700 }, { x: Math.SQRT1_2, y: -Math.SQRT1_2 }, { distance: 100, jitterDeg: 0 }, 1, BOUNDS);
    expect(diag.x).toBeCloseTo(400 + 100 / Math.SQRT2, 6);
    expect(diag.y).toBeCloseTo(700 - 100 / Math.SQRT2, 6);
  });
  it('bends the throw by the seeded jitter, +/- jitterDeg at the extremes, and is deterministic', () => {
    const from = { x: 700, y: 800 };
    const left = throwLanding(from, UP, { distance: 200, jitterDeg: 10 }, -1, BOUNDS);
    const right = throwLanding(from, UP, { distance: 200, jitterDeg: 10 }, 1, BOUNDS);
    expect(left.x).toBeCloseTo(700 - 200 * Math.sin(Math.PI / 18), 6);
    expect(right.x).toBeCloseTo(700 + 200 * Math.sin(Math.PI / 18), 6);
    expect(throwLanding(from, UP, { distance: 200, jitterDeg: 10 }, 0.37, BOUNDS)).toEqual(throwLanding(from, UP, { distance: 200, jitterDeg: 10 }, 0.37, BOUNDS));
  });
  it('clamps inside the viewport margin and above the hand row (a downward flick lands above the hand)', () => {
    const far = throwLanding({ x: 1380, y: 100 }, { x: 1, y: -0.2 }, { distance: 500, jitterDeg: 0 }, 0, BOUNDS);
    expect(far.x).toBe(1340); expect(far.y).toBe(60);
    const down = throwLanding({ x: 700, y: 600 }, { x: 0, y: 1 }, { distance: 300, jitterDeg: 0 }, 0, BOUNDS);
    expect(down.y).toBe(700);
  });
});
