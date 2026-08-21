/**
 * HERO SELECT CEREMONY — unit tests for the Pixi controller's PURE math (blueprint §21).
 *
 * Pixi itself can't run under node, so `HeroCeremonyPixi.ts` exports its geometry/budget/ease math as pure
 * functions and THOSE are covered here: perimeter spawn points lie on the rect perimeter, budgets flip at
 * the mobile threshold, eases are clamped monotone 0→1, and nothing returns NaN for degenerate rects.
 */
import { describe, expect, it } from 'vitest';
import type { RectSnapshot } from './heroCeremonyMachine';
import {
  budgetFor, CEREMONY_BUDGETS, easeInOutSine, easeInQuad, easeOutCubic, easeOutQuint,
  MOBILE_HOST_WIDTH, perimeterSpawnPoints, rectPerimeterPoint, ringRadiusAt,
  type CeremonyBudgetKey,
} from './HeroCeremonyPixi';

const CARD: RectSnapshot = { left: 100, top: 50, width: 220, height: 300 };
const EPS = 1e-9;

/** True when (x, y) sits ON the rect's perimeter (one of the four edges, within its span). */
function onPerimeter(r: RectSnapshot, x: number, y: number): boolean {
  const right = r.left + r.width;
  const bottom = r.top + r.height;
  const inX = x >= r.left - EPS && x <= right + EPS;
  const inY = y >= r.top - EPS && y <= bottom + EPS;
  const onH = (Math.abs(y - r.top) < EPS || Math.abs(y - bottom) < EPS) && inX;
  const onV = (Math.abs(x - r.left) < EPS || Math.abs(x - right) < EPS) && inY;
  return onH || onV;
}

describe('rectPerimeterPoint', () => {
  it('walks the four edges clockwise from the top-left corner', () => {
    expect(rectPerimeterPoint(CARD, 0)).toMatchObject({ x: 100, y: 50, nx: 0, ny: -1 });
    // perimeter = 2*(220+300) = 1040; top edge spans t in [0, 220/1040)
    expect(rectPerimeterPoint(CARD, 110 / 1040)).toMatchObject({ x: 210, y: 50 });            // mid-top
    expect(rectPerimeterPoint(CARD, (220 + 150) / 1040)).toMatchObject({ x: 320, y: 200, nx: 1, ny: 0 }); // mid-right
    expect(rectPerimeterPoint(CARD, (220 + 300 + 110) / 1040)).toMatchObject({ x: 210, y: 350, nx: 0, ny: 1 }); // mid-bottom
    expect(rectPerimeterPoint(CARD, (220 + 300 + 220 + 150) / 1040)).toMatchObject({ x: 100, y: 200, nx: -1, ny: 0 }); // mid-left
  });

  it('every sampled point lies on the perimeter with a unit outward normal', () => {
    for (let i = 0; i <= 200; i++) {
      const p = rectPerimeterPoint(CARD, i / 200);
      expect(onPerimeter(CARD, p.x, p.y)).toBe(true);
      expect(Math.hypot(p.nx, p.ny)).toBeCloseTo(1, 12);
    }
  });

  it('wraps t outside [0, 1) — t=1 and t=-0.25 land back on the perimeter', () => {
    expect(rectPerimeterPoint(CARD, 1)).toMatchObject({ x: 100, y: 50 });   // wraps to t=0
    const p = rectPerimeterPoint(CARD, -0.25);
    expect(onPerimeter(CARD, p.x, p.y)).toBe(true);
    const q = rectPerimeterPoint(CARD, 1.75);
    expect(p.x).toBeCloseTo(q.x, 9); // -0.25 and 1.75 are the same wrapped fraction
    expect(p.y).toBeCloseTo(q.y, 9);
  });

  it('never returns NaN for degenerate rects', () => {
    const degenerates: RectSnapshot[] = [
      { left: 10, top: 20, width: 0, height: 0 },
      { left: 10, top: 20, width: 0, height: 50 },   // vertical line
      { left: 10, top: 20, width: 50, height: 0 },   // horizontal line
      { left: 10, top: 20, width: -5, height: -5 },  // negative dims
      { left: NaN, top: NaN, width: NaN, height: NaN },
    ];
    for (const r of degenerates) {
      for (const t of [0, 0.3, 0.99, NaN, Infinity, -2]) {
        const p = rectPerimeterPoint(r, t);
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
        expect(Number.isFinite(p.nx)).toBe(true);
        expect(Number.isFinite(p.ny)).toBe(true);
      }
    }
  });

  it('a zero-size rect collapses to its origin point', () => {
    const p = rectPerimeterPoint({ left: 42, top: 7, width: 0, height: 0 }, 0.5);
    expect(p.x).toBe(42);
    expect(p.y).toBe(7);
  });
});

describe('perimeterSpawnPoints', () => {
  it('returns exactly `count` points, all on the perimeter (deterministic rng)', () => {
    const pts = perimeterSpawnPoints(CARD, 50, 0.35, () => 0.5);
    expect(pts).toHaveLength(50);
    for (const p of pts) expect(onPerimeter(CARD, p.x, p.y)).toBe(true);
  });

  it('jittered points still lie on the perimeter (extreme rng values)', () => {
    for (const rng of [() => 0, () => 0.999999]) {
      for (const p of perimeterSpawnPoints(CARD, 24, 1, rng)) {
        expect(onPerimeter(CARD, p.x, p.y)).toBe(true);
      }
    }
  });

  it('spreads evenly: with zero jitter no two points share an edge position', () => {
    const pts = perimeterSpawnPoints(CARD, 20, 0, () => 0.5);
    const keys = new Set(pts.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`));
    expect(keys.size).toBe(20);
  });

  it('handles zero/negative/NaN counts without producing points', () => {
    expect(perimeterSpawnPoints(CARD, 0)).toHaveLength(0);
    expect(perimeterSpawnPoints(CARD, -3)).toHaveLength(0);
    expect(perimeterSpawnPoints(CARD, NaN)).toHaveLength(0);
  });
});

describe('budgetFor', () => {
  const KEYS = Object.keys(CEREMONY_BUDGETS) as CeremonyBudgetKey[];

  it('uses desktop budgets at and above the mobile threshold', () => {
    for (const k of KEYS) {
      expect(budgetFor(k, MOBILE_HOST_WIDTH)).toBe(CEREMONY_BUDGETS[k].desktop);
      expect(budgetFor(k, 1920)).toBe(CEREMONY_BUDGETS[k].desktop);
    }
  });

  it('uses mobile budgets below the threshold', () => {
    for (const k of KEYS) {
      expect(budgetFor(k, MOBILE_HOST_WIDTH - 1)).toBe(CEREMONY_BUDGETS[k].mobile);
      expect(budgetFor(k, 375)).toBe(CEREMONY_BUDGETS[k].mobile);
    }
  });

  it('falls back to desktop for an unmeasured host (0 / NaN width)', () => {
    for (const k of KEYS) {
      expect(budgetFor(k, 0)).toBe(CEREMONY_BUDGETS[k].desktop);
      expect(budgetFor(k, NaN)).toBe(CEREMONY_BUDGETS[k].desktop);
    }
  });

  it('every budget sits inside the blueprint §18 ranges', () => {
    const ranges: Record<CeremonyBudgetKey, { d: [number, number]; m: [number, number] }> = {
      arrivalSparks: { d: [40, 60], m: [20, 30] },
      runeFragments: { d: [8, 14], m: [4, 7] },
      ambientMotes: { d: [18, 28], m: [8, 14] },
      dissipationDust: { d: [50, 80], m: [25, 40] },
      launchPull: { d: [25, 40], m: [12, 20] },
    };
    for (const k of KEYS) {
      const { desktop, mobile } = CEREMONY_BUDGETS[k];
      expect(desktop).toBeGreaterThanOrEqual(ranges[k].d[0]);
      expect(desktop).toBeLessThanOrEqual(ranges[k].d[1]);
      expect(mobile).toBeGreaterThanOrEqual(ranges[k].m[0]);
      expect(mobile).toBeLessThanOrEqual(ranges[k].m[1]);
      expect(mobile).toBeLessThan(desktop);
    }
  });
});

describe('eases', () => {
  const EASES = { easeOutCubic, easeOutQuint, easeInQuad, easeInOutSine };

  it.each(Object.entries(EASES))('%s maps 0→0 and 1→1, monotone non-decreasing, output in [0,1]', (_name, ease) => {
    expect(ease(0)).toBeCloseTo(0, 12);
    expect(ease(1)).toBeCloseTo(1, 12);
    let prev = -Infinity;
    for (let i = 0; i <= 100; i++) {
      const v = ease(i / 100);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(v).toBeGreaterThanOrEqual(prev - EPS);
      prev = v;
    }
  });

  it.each(Object.entries(EASES))('%s clamps out-of-range and non-finite input', (_name, ease) => {
    expect(ease(-1)).toBeCloseTo(0, 12);
    expect(ease(2)).toBeCloseTo(1, 12);
    expect(Number.isFinite(ease(NaN))).toBe(true);
    expect(Number.isFinite(ease(Infinity))).toBe(true);
  });
});

describe('ringRadiusAt', () => {
  it('hits the endpoints exactly', () => {
    expect(ringRadiusAt(0, 30, 120)).toBeCloseTo(30, 9);
    expect(ringRadiusAt(1, 30, 120)).toBeCloseTo(120, 9);
  });

  it('expands monotonically when to > from', () => {
    let prev = -Infinity;
    for (let i = 0; i <= 60; i++) {
      const r = ringRadiusAt(i / 60, 30, 120);
      expect(r).toBeGreaterThanOrEqual(prev - EPS);
      expect(r).toBeGreaterThanOrEqual(30 - EPS);
      expect(r).toBeLessThanOrEqual(120 + EPS);
      prev = r;
    }
  });

  it('contracts monotonically when to < from (the materialization finish ring)', () => {
    let prev = Infinity;
    for (let i = 0; i <= 60; i++) {
      const r = ringRadiusAt(i / 60, 200, 60);
      expect(r).toBeLessThanOrEqual(prev + EPS);
      prev = r;
    }
  });

  it('never returns NaN for degenerate input', () => {
    for (const [t, from, to] of [[NaN, 10, 20], [0.5, NaN, 20], [0.5, 10, NaN], [Infinity, NaN, NaN]]) {
      expect(Number.isFinite(ringRadiusAt(t, from, to))).toBe(true);
    }
  });
});
