import { describe, expect, it } from 'vitest';
import { makeRng } from './rng';
import {
  aimsLeft,
  reverseFrame,
  ropePoints,
  rollScatter,
  rollVariation,
  sheetFrameIndex,
  sheetFrameRects,
  tiltCorners,
  wobblePositions,
  type VariationOptions,
} from './customGeometry';

const OFF: VariationOptions = {
  variantRows: 1, frames: 8, randomStart: false, randomFlipX: false, randomFlipY: false, fpsJitter: 0, hueJitter: 0, randomReverse: false,
};

describe('rollVariation', () => {
  it('is the exact identity with everything off', () => {
    for (const r of rollVariation(makeRng(9), 4, OFF)) {
      expect(r).toEqual({ row: 0, startOffset: 0, flipX: false, flipY: false, fpsMul: 1, hueDeg: 0, reverse: false });
    }
  });
  it('is deterministic per seed', () => {
    const on: VariationOptions = { ...OFF, variantRows: 4, randomStart: true, randomFlipX: true, randomFlipY: true, fpsJitter: 0.5, hueJitter: 90, randomReverse: true };
    expect(rollVariation(makeRng(3), 6, on)).toEqual(rollVariation(makeRng(3), 6, on));
    expect(rollVariation(makeRng(3), 6, on)).not.toEqual(rollVariation(makeRng(4), 6, on));
  });
  it('turning ONE feature on never reshuffles the others (fixed seven-draw order per copy)', () => {
    const a = rollVariation(makeRng(5), 8, { ...OFF, randomFlipX: true, fpsJitter: 0.3 });
    const b = rollVariation(makeRng(5), 8, { ...OFF, randomFlipX: true, fpsJitter: 0.3, randomStart: true, variantRows: 3 });
    a.forEach((r, i) => {
      expect(b[i].flipX).toBe(r.flipX);
      expect(b[i].fpsMul).toBe(r.fpsMul);
    });
  });
  it('keeps every roll inside its range', () => {
    const on: VariationOptions = { ...OFF, variantRows: 3, frames: 5, randomStart: true, fpsJitter: 1, hueJitter: 180 };
    for (const r of rollVariation(makeRng(11), 50, on)) {
      expect(r.row).toBeGreaterThanOrEqual(0); expect(r.row).toBeLessThanOrEqual(2);
      expect(r.startOffset).toBeGreaterThanOrEqual(0); expect(r.startOffset).toBeLessThanOrEqual(4);
      expect(r.fpsMul).toBeGreaterThanOrEqual(0.05); expect(r.fpsMul).toBeLessThanOrEqual(2);
      expect(Math.abs(r.hueDeg)).toBeLessThanOrEqual(180);
    }
  });
});

describe('reverseFrame / aimsLeft', () => {
  it('mirrors a strip and clamps', () => {
    expect([0, 1, 2, 3].map((i) => reverseFrame(i, 4))).toEqual([3, 2, 1, 0]);
    expect(reverseFrame(0, 1)).toBe(0);
  });
  it('flags only the left half-plane', () => {
    expect(aimsLeft(0)).toBe(false);
    expect(aimsLeft(Math.PI / 2)).toBe(false);   // straight down: not left
    expect(aimsLeft(Math.PI)).toBe(true);
    expect(aimsLeft(-3 * Math.PI / 4)).toBe(true);
  });
});

describe('sheetFrameRects', () => {
  it('cuts a grid in reading order and honours a frame count smaller than the grid', () => {
    const r = sheetFrameRects(200, 100, 2, 2, 0);
    expect(r).toEqual([
      { x: 0, y: 0, w: 100, h: 50 }, { x: 100, y: 0, w: 100, h: 50 },
      { x: 0, y: 50, w: 100, h: 50 }, { x: 100, y: 50, w: 100, h: 50 },
    ]);
    expect(sheetFrameRects(200, 100, 2, 2, 3)).toHaveLength(3);
    expect(sheetFrameRects(64, 64, 1, 1, 0)).toEqual([{ x: 0, y: 0, w: 64, h: 64 }]);
  });
});

describe('sheetFrameIndex', () => {
  it('a single frame is always 0, and fps 0 freezes the fps modes on the start frame', () => {
    expect(sheetFrameIndex('loop', 1, 12, 5000, 0.5, 3)).toBe(0);
    expect(sheetFrameIndex('loop', 4, 0, 5000, 0.5, 2)).toBe(2);
  });
  it('loop wraps, once clamps, pingpong bounces', () => {
    // 4 frames @ 10 fps: 250 ms → tick 2
    expect(sheetFrameIndex('loop', 4, 10, 250, 0, 0)).toBe(2);
    expect(sheetFrameIndex('loop', 4, 10, 650, 0, 0)).toBe(2); // tick 6 → 6 % 4
    expect(sheetFrameIndex('once', 4, 10, 650, 0, 0)).toBe(3);
    // pingpong period 6: ticks 0..6 → 0 1 2 3 2 1 0
    expect([0, 100, 200, 300, 400, 500, 600].map((ms) => sheetFrameIndex('pingpong', 4, 10, ms, 0, 0))).toEqual([0, 1, 2, 3, 2, 1, 0]);
  });
  it('overLife maps life 0..1 across the whole strip exactly once, ending on the last frame', () => {
    expect(sheetFrameIndex('overLife', 4, 99, 0, 0, 0)).toBe(0);
    expect(sheetFrameIndex('overLife', 4, 99, 0, 0.5, 0)).toBe(2);
    expect(sheetFrameIndex('overLife', 4, 99, 0, 1, 0)).toBe(3);
  });
});

describe('rollScatter', () => {
  it('is the exact identity with radius 0 and no jitter (the Phase 1 look survives)', () => {
    const [r] = rollScatter(makeRng(7), 1, 0, 'circle', 0, 0, 0, 0);
    expect(r).toEqual({ dx: 0, dy: 0, rot: 0, scale: 1, alpha: 1, delayMs: 0 });
  });
  it('is deterministic per seed and differs across seeds', () => {
    const a = rollScatter(makeRng(42), 5, 100, 'circle', 45, 0.5, 0.5, 80);
    const b = rollScatter(makeRng(42), 5, 100, 'circle', 45, 0.5, 0.5, 80);
    const c = rollScatter(makeRng(43), 5, 100, 'circle', 45, 0.5, 0.5, 80);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
  it('stays inside the radius, staggers in order, and clamps scale/alpha', () => {
    const rolls = rollScatter(makeRng(1), 20, 100, 'circle', 180, 2, 1, 50);
    rolls.forEach((r, i) => {
      expect(Math.hypot(r.dx, r.dy)).toBeLessThanOrEqual(100 + 1e-9);
      expect(r.delayMs).toBe(i * 50);
      expect(r.scale).toBeGreaterThanOrEqual(0.05);
      expect(r.alpha).toBeGreaterThanOrEqual(0);
      expect(r.alpha).toBeLessThanOrEqual(1);
    });
    const sq = rollScatter(makeRng(1), 20, 100, 'square', 0, 0, 0, 0);
    sq.forEach((r) => { expect(Math.abs(r.dx)).toBeLessThanOrEqual(100); expect(Math.abs(r.dy)).toBeLessThanOrEqual(100); });
  });
});

describe('wobblePositions', () => {
  const base = new Float32Array([0, 0, 50, 0, 100, 0, 0, 40, 50, 40, 100, 40]);
  it('amp 0 copies the base through untouched', () => {
    const out = new Float32Array(base.length);
    wobblePositions(base, out, 100, 40, 0, 1, 0.3, 'both');
    expect([...out]).toEqual([...base]);
  });
  it('axis y moves only y; axis x moves only x', () => {
    const oy = new Float32Array(base.length);
    wobblePositions(base, oy, 100, 40, 10, 1, Math.PI / 2, 'y');
    for (let i = 0; i < base.length; i += 2) expect(oy[i]).toBe(base[i]);
    expect(oy[1]).not.toBe(base[1]);
    const ox = new Float32Array(base.length);
    wobblePositions(base, ox, 100, 40, 10, 1, Math.PI / 2, 'x');
    for (let i = 1; i < base.length; i += 2) expect(ox[i]).toBe(base[i]);
    expect(ox[0]).not.toBe(base[0]);
  });
});

describe('ropePoints', () => {
  it('spans the width centred on the origin, flat at the ends, `bend` at the middle', () => {
    const pts: { x: number; y: number }[] = [];
    ropePoints(5, 200, 30, 0, 1, 0, pts);
    expect(pts).toHaveLength(5);
    expect(pts[0]).toEqual({ x: -100, y: 0 });
    expect(pts[4]).toEqual({ x: 100, y: 0 });
    expect(pts[2]).toEqual({ x: 0, y: 30 });
  });
  it('reuses point objects so a rope can be mutated in place', () => {
    const pts: { x: number; y: number }[] = [];
    ropePoints(3, 100, 0, 0, 1, 0, pts);
    const first = pts[0];
    ropePoints(3, 100, 10, 0, 1, 0, pts);
    expect(pts[0]).toBe(first);
  });
});

describe('tiltCorners', () => {
  it('no tilt is the plain rectangle in TL, TR, BR, BL order', () => {
    expect(tiltCorners(100, 50, 0, 0, 600)).toEqual([0, 0, 100, 0, 100, 50, 0, 50]);
  });
  it('a Y tilt foreshortens one side (a trapezoid), symmetric top/bottom', () => {
    const c = tiltCorners(100, 50, 0, 40, 400);
    const leftHeight = c[7] - c[1];  // BL.y - TL.y
    const rightHeight = c[5] - c[3]; // BR.y - TR.y
    expect(leftHeight).not.toBeCloseTo(rightHeight, 3);
    expect(c[0]).toBeCloseTo(c[6], 6); // TL.x == BL.x
    expect(c[2]).toBeCloseTo(c[4], 6); // TR.x == BR.x
  });
  it('never produces NaN even at extreme tilt and tiny depth', () => {
    expect(tiltCorners(100, 50, 89, 89, 1).every(Number.isFinite)).toBe(true);
  });
});
