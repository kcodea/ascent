import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultsOf, validateSpecs } from '../params';
import { makeRng } from '../rng';
import { RIBBON_FIRE_GRACE_MS, pushSpineHead, ribbonOneShotComplete, ribbonPrimitive } from './ribbon';
import {
  RIBBON_MAX_SEGMENTS,
  RIBBON_MIN_SEGMENTS,
  RIBBON_SEGMENTS,
  type RibbonPoint,
} from '../ribbonGeometry';

describe('ribbon param specs', () => {
  it('has no self-contradictory defaults (registration-time invariant)', () => {
    expect(validateSpecs(ribbonPrimitive.params)).toEqual([]);
  });

  it('registers under the id "ribbon"', () => {
    expect(ribbonPrimitive.id).toBe('ribbon');
  });
});

describe('ribbon shaping params', () => {
  const specs = ribbonPrimitive.params;

  it('exposes a width-over-length curve that defaults to a flat 1 (a no-op multiplier)', () => {
    const spec = specs.widthCurve;
    expect(spec.kind).toBe('curve');
    expect(spec.group).toBe('Shape');
    // Flat 1 across the whole length: sampleCurve returns exactly 1 everywhere, and `x * 1` is exact.
    expect(spec.default).toEqual([[0, 1], [1, 1]]);
  });

  it('exposes the wave triple, with amplitude 0 so the wave is off by default', () => {
    expect(specs.waveAmp).toMatchObject({ kind: 'slider', group: 'Shape', min: 0, max: 40, step: 0.5, default: 0 });
    expect(specs.waveFreq).toMatchObject({ kind: 'slider', group: 'Shape', min: 0.2, max: 8, step: 0.1, default: 2 });
    expect(specs.waveSpeed).toMatchObject({ kind: 'slider', group: 'Shape', min: 0, max: 12, step: 0.1, default: 3 });
  });

  it('exposes segments, defaulting to the geometry\'s own resample count', () => {
    expect(specs.segments).toMatchObject({
      kind: 'slider',
      group: 'Shape',
      min: RIBBON_MIN_SEGMENTS,
      max: RIBBON_MAX_SEGMENTS,
      step: 4,
      default: RIBBON_SEGMENTS,
    });
  });

  it('resolves defaults that are collectively an exact no-op on the existing look', () => {
    const d = defaultsOf(ribbonPrimitive.params);
    expect(d.widthCurve).toEqual([[0, 1], [1, 1]]);
    expect(d.waveAmp).toBe(0);
    expect(d.segments).toBe(RIBBON_SEGMENTS);
    // The pre-existing end-controls are untouched by this wave.
    expect(d.headPinch).toBe(0.12);
    expect(d.tailFeather).toBe(0.35);
  });
});

describe('pushSpineHead', () => {
  it('adds the new head to the front of the spine', () => {
    const spine: RibbonPoint[] = [{ x: 10, y: 0 }];
    pushSpineHead(spine, { x: 20, y: 0 }, 1000);
    expect(spine[0]).toEqual({ x: 20, y: 0 });
    expect(spine[1]).toEqual({ x: 10, y: 0 });
  });

  it('trims the tail once the accumulated arc length exceeds maxLength', () => {
    // Five points 10px apart, all head-first: total arc length 40px if kept whole.
    const spine: RibbonPoint[] = [
      { x: 30, y: 0 }, { x: 20, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 },
    ];
    pushSpineHead(spine, { x: 40, y: 0 }, 25); // now 5 points, 40px total untrimmed
    // Walking from the new head (40,0): 10 (->30) + 10 (->20) = 20 < 25, + 10 (->10) = 30 >= 25 → keep through that point.
    expect(spine.map((p) => p.x)).toEqual([40, 30, 20, 10]);
  });

  it('keeps at least two points even when maxLength is tiny, so the ribbon never degenerates below drawable', () => {
    const spine: RibbonPoint[] = [{ x: 0, y: 0 }];
    pushSpineHead(spine, { x: 1, y: 0 }, 0.001);
    expect(spine.length).toBeGreaterThanOrEqual(2);
  });

  it('never grows the spine past the hard cap regardless of maxLength', () => {
    const spine: RibbonPoint[] = [];
    // Every new point is right on top of the last (near-zero motion) — arc length never grows, so
    // only the hard cap can bound the array.
    for (let i = 0; i < 500; i++) pushSpineHead(spine, { x: 0, y: 0 }, 1000, 200);
    expect(spine.length).toBeLessThanOrEqual(200);
  });

  it('respects a custom maxPoints cap', () => {
    const spine: RibbonPoint[] = [];
    for (let i = 0; i < 50; i++) pushSpineHead(spine, { x: 0, y: 0 }, 1000, 10);
    expect(spine.length).toBeLessThanOrEqual(10);
  });
});

describe('ribbonOneShotComplete', () => {
  it('is never complete in continuous mode, however long the head has been idle', () => {
    expect(ribbonOneShotComplete(false, true, 10_000)).toBe(false);
  });

  it('is not complete until the head has been fed at least once (guards a large first-frame dt)', () => {
    // headEverSet false: even a huge msSinceHead must not complete before the effect ever started.
    expect(ribbonOneShotComplete(true, false, 10_000)).toBe(false);
  });

  it('stays incomplete while the head is still being fed (msSinceHead below the grace)', () => {
    expect(ribbonOneShotComplete(true, true, RIBBON_FIRE_GRACE_MS - 1)).toBe(false);
  });

  it('completes once one-shot, the head was fed, and it has been idle for the grace period', () => {
    expect(ribbonOneShotComplete(true, true, RIBBON_FIRE_GRACE_MS)).toBe(true);
    expect(ribbonOneShotComplete(true, true, RIBBON_FIRE_GRACE_MS + 500)).toBe(true);
  });

  it('honours a custom grace period', () => {
    expect(ribbonOneShotComplete(true, true, 40, 50)).toBe(false);
    expect(ribbonOneShotComplete(true, true, 50, 50)).toBe(true);
  });
});

/**
 * `uSeed` — the ribbon's per-instance noise phase offset. It used to be a bare `Math.random() * 1000`
 * re-rolled on EVERY spawn, so any rebuild (a param edit that respawns, a Fire) visibly changed the noise
 * mid-tune. It is now derived from `ctx.seed` when one is supplied, and only falls back to a fresh roll
 * when it isn't. `RibbonInstance` needs a real WebGL context to construct, so the wiring is asserted over
 * the module source and the derivation itself is exercised directly through `makeRng`.
 */
const RIBBON_SRC = readFileSync(new URL('./ribbon.ts', import.meta.url), 'utf8');

/** The module source with its comments stripped. The prose in these files legitimately NAMES
 *  `Math.random()` (explaining what the seeding replaced), so the regression assertion below has to look at
 *  CODE only or it would fail on its own documentation. */
function codeOf(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}


describe('ribbon uSeed', () => {
  it('derives from ctx.seed when given, and keeps the fresh roll when not', () => {
    expect(RIBBON_SRC).toContain(
      "uSeed: { value: (ctx.seed === undefined ? Math.random() : makeRng(ctx.seed)()) * 1000, type: 'f32' },",
    );
    // Exactly one Math.random left in this module, and it is that documented no-seed fallback.
    expect(codeOf(RIBBON_SRC).match(/Math\.random\(/g)).toHaveLength(1);
  });

  it('is stable for a given seed and spread across seeds (what stops the look re-rolling mid-tune)', () => {
    const derive = (seed: number): number => makeRng(seed)() * 1000;
    expect(derive(9)).toBe(derive(9));
    expect(derive(9)).not.toBe(derive(10));
    const values = Array.from({ length: 200 }, (_, i) => derive(i));
    expect(new Set(values).size).toBe(values.length);
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1000);
    }
  });
});
