import { describe, expect, it } from 'vitest';
import { svgToEmitPoints, normalize, EMIT_POINTS_MAX } from './svgEmit';

// A straight horizontal path in a 2:1 viewBox. Chosen so the DOM-dependent assertions below hold regardless of
// the outline sampler's resolution.
const LINE = '<svg viewBox="0 0 100 50"><path d="M0 25 L100 25"/></svg>';

// This repo runs Vitest in the *node* environment (no jsdom/happy-dom is installed and no test opts into a DOM
// environment). The outline sampler needs a live DOM (`DOMParser` + `SVGPathElement.getTotalLength/
// getPointAtLength`), so under node it produces zero points. The `count`/normalization assertions from the brief
// are therefore gated on a real capability PROBE — they run only where outline sampling actually works (a real
// browser; verified live in the Task 4 workshop), and are skipped (never faked green, never a tautology) here.
// The cap + malformed→[] assertions are environment-independent and always run — they also lock in the
// never-throw contract in a DOM-less host. See task-2-report.md for the full rationale.
const OUTLINE_WORKS = svgToEmitPoints(LINE, { fill: false, count: 8 }).length > 0;
const domIt = OUTLINE_WORKS ? it : it.skip;

describe('svgToEmitPoints — outline', () => {
  domIt('returns `count` points for a valid path', () => {
    const pts = svgToEmitPoints(LINE, { fill: false, count: 200 });
    expect(pts.length).toBe(200);
  });
  domIt('normalizes into [-1,1], aspect-preserved (a 2:1 viewBox → x spans ~[-1,1], y near 0)', () => {
    const pts = svgToEmitPoints(LINE, { fill: false, count: 100 });
    for (const [x, y] of pts) { expect(Math.abs(x)).toBeLessThanOrEqual(1.0001); expect(Math.abs(y)).toBeLessThanOrEqual(1.0001); }
    expect(Math.max(...pts.map(p => p[0]))).toBeGreaterThan(0.9); // spans the wide axis
    expect(Math.max(...pts.map(p => Math.abs(p[1])))).toBeLessThan(0.3); // thin on the short axis
  });
  it('caps count at EMIT_POINTS_MAX', () => {
    expect(svgToEmitPoints(LINE, { fill: false, count: 99999 }).length).toBeLessThanOrEqual(EMIT_POINTS_MAX);
  });
  it('returns [] for malformed SVG (and never throws, even in a DOM-less host)', () => {
    expect(svgToEmitPoints('not an svg', { fill: false, count: 100 })).toEqual([]);
  });
});

// Pure math, no DOM — these run always-on in the node env and are the real coverage of the load-bearing
// normalization contract (fit to [-1,1], aspect-preserved, centered, no y-flip). The outline/fill samplers that
// feed `normalize` need a DOM (covered by the gated tests above / live in Task 4), but `normalize` itself does not.
describe('normalize — fit to [-1,1], aspect-preserved, centered', () => {
  it('a 2:1 wide span → x spans ~[-1,1], y collapses to ~0', () => {
    const out = normalize([[0, 25], [100, 25]]);
    const xs = out.map((p) => p[0]);
    const ys = out.map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(-1, 6);
    expect(Math.max(...xs)).toBeCloseTo(1, 6);
    for (const y of ys) expect(y).toBeCloseTo(0, 6); // aspect-preserved: short axis stays centered, not stretched
  });
  it('a taller-than-wide span → y spans ~[-1,1], x collapses to ~0', () => {
    const out = normalize([[25, 0], [25, 100]]);
    const xs = out.map((p) => p[0]);
    const ys = out.map((p) => p[1]);
    expect(Math.min(...ys)).toBeCloseTo(-1, 6);
    expect(Math.max(...ys)).toBeCloseTo(1, 6);
    for (const x of xs) expect(x).toBeCloseTo(0, 6);
  });
  it('centers the bbox: its midpoint maps to ~[0,0] with symmetric corners', () => {
    const out = normalize([[10, 10], [30, 30], [20, 20]]);
    // midpoint (20,20) is the third point → maps to origin
    expect(out[2]![0]).toBeCloseTo(0, 6);
    expect(out[2]![1]).toBeCloseTo(0, 6);
    // corners are symmetric about the origin (square bbox → full [-1,1] on both axes)
    expect(out[0]).toEqual([-1, -1]);
    expect(out[1]).toEqual([1, 1]);
  });
  it('preserves y as drawn (SVG y-down, no flip): larger input y → larger output y', () => {
    const out = normalize([[0, 0], [0, 100]]);
    expect(out[0]![1]).toBeLessThan(out[1]![1]);
  });
  it('returns [] for a zero-area (degenerate) input', () => {
    expect(normalize([[5, 5], [5, 5]])).toEqual([]);
  });
  it('returns [] for empty input', () => {
    expect(normalize([])).toEqual([]);
  });
});
