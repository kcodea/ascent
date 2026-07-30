import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultsOf, validateSpecs, type FxParamSpecs } from '../params';
import { makeRng } from '../rng';
import {
  RIBBON_FIRE_GRACE_MS,
  RIBBON_STALL_EPSILON_PX,
  drainSpineTail,
  pushSpineHead,
  ribbonOneShotComplete,
  ribbonPrimitive,
} from './ribbon';
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

  /**
   * Every param the inspector shows must explain itself. This is a hard gate rather than a convention
   * because the *least* guessable knobs here — Warp, Gain, Scroll, Plateau — are shader-math words whose
   * labels tell a newcomer nothing at all, and an unexplained one costs a whole tuning session of dragging
   * a slider to find out what it does. The sibling primitives each carry the same assertion over their own
   * SPECS, so a new param cannot ship unexplained on any of them.
   */
  it('gives every param non-empty help text', () => {
    const specs: FxParamSpecs = ribbonPrimitive.params;
    const missing = Object.keys(specs).filter((key) => (specs[key].help ?? '').trim() === '');
    expect(missing).toEqual([]);
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
    expect(specs.waveAmp).toMatchObject({ kind: 'slider', group: 'Shape', min: 0, max: 300, step: 0.5, default: 0 });
    expect(specs.waveFreq).toMatchObject({ kind: 'slider', group: 'Shape', min: 0.2, max: 24, step: 0.1, default: 2 });
    expect(specs.waveSpeed).toMatchObject({ kind: 'slider', group: 'Shape', min: 0, max: 60, step: 0.1, default: 3 });
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
    expect(ribbonOneShotComplete(true, true, 40, false, 50)).toBe(false);
    expect(ribbonOneShotComplete(true, true, 50, false, 50)).toBe(true);
  });

  /**
   * THE bug this predicate's input change fixes (owner: "when i fire once ... i want the ribbon to travel to
   * its target point and stop"). The counter used to be "ms since the head was FED", and both the workbench
   * and playDef feed the head EVERY FRAME for as long as the layer lives — so it never climbed, a one-shot
   * ribbon never completed, and the pass ran to the 10s safety cap with the trail alive throughout.
   * It is now "ms since the head MOVED", which does climb the moment the trail arrives.
   */
  it('completes while still being fed, so long as the head has stopped MOVING', () => {
    expect(ribbonOneShotComplete(true, true, RIBBON_FIRE_GRACE_MS)).toBe(true);
  });

  // A draining trail is mid-retraction after it arrives; completing there would have the player tear it
  // down halfway through the animation the drain exists to show.
  it('is never complete while the spine is still draining, however long it has been settled', () => {
    expect(ribbonOneShotComplete(true, true, 10_000, true)).toBe(false);
  });

  it('completes once the drain has emptied the spine', () => {
    expect(ribbonOneShotComplete(true, true, RIBBON_FIRE_GRACE_MS, false)).toBe(true);
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
    // The expression moved out of the `Shader.from({ resources })` literal when the shader became POOLED
    // (see `shaderPool.ts`): a pooled shader's uniforms are placeholders, so the phase is now computed in
    // the constructor — once per INSTANCE, before the acquire — and written by `writeAllUniforms`. Same
    // derivation, same single draw; only its position changed.
    expect(codeOf(RIBBON_SRC)).toContain(
      'const seedPhase = (ctx.seed === undefined ? Math.random() : makeRng(ctx.seed)()) * 1000;',
    );
    expect(codeOf(RIBBON_SRC)).toContain('u.uSeed = seedPhase;');
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

/**
 * The tail drain. Without it a ribbon whose head stops just FREEZES — the spine only ever shrinks when new
 * head input pushes the far end past `length` — so an effect that travels to a target hangs there as a
 * static streak, or blinks out whole when its layer expires. Draining lets the front stop while the back
 * keeps arriving.
 */
describe('drainSpineTail', () => {
  /** A straight horizontal spine, head at x=0, one point every 10px. */
  const line = (points: number): { x: number; y: number }[] =>
    Array.from({ length: points }, (_, i) => ({ x: i * 10, y: 0 }));

  const arcLength = (spine: { x: number; y: number }[]): number => {
    let total = 0;
    for (let i = 1; i < spine.length; i++) total += Math.hypot(spine[i].x - spine[i - 1].x, spine[i].y - spine[i - 1].y);
    return total;
  };

  it('removes exactly the requested arc length from the TAIL end', () => {
    const spine = line(5); // 40px of arc
    drainSpineTail(spine, 15);
    expect(arcLength(spine)).toBeCloseTo(25, 6);
  });

  it('leaves the HEAD untouched — the front is what has stopped', () => {
    const spine = line(5);
    drainSpineTail(spine, 15);
    expect(spine[0]).toEqual({ x: 0, y: 0 });
  });

  // Sliding the final point along its own segment is what makes the retraction smooth; popping whole points
  // only would make the tail jump 10px at a time here.
  it('slides the last point along its segment for a partial bite, rather than jumping point to point', () => {
    const spine = line(3); // 20px
    drainSpineTail(spine, 5);
    expect(spine).toHaveLength(3);
    expect(spine[2].x).toBeCloseTo(15, 6);
  });

  it('drops whole segments when the bite spans several', () => {
    const spine = line(5);
    drainSpineTail(spine, 25);
    expect(arcLength(spine)).toBeCloseTo(15, 6);
    expect(spine.length).toBeLessThan(5);
  });

  // One point is not a ribbon, and writeRibbonPositions already reports "nothing to draw" for it — leaving a
  // single stranded point would be a lingering invisible instance rather than a finished effect.
  it('empties the spine entirely once it is drained past the last segment', () => {
    const spine = line(3);
    drainSpineTail(spine, 999);
    expect(spine).toEqual([]);
  });

  it('is a no-op for a zero drop, and for an already-empty spine', () => {
    const spine = line(4);
    const before = spine.map((p) => ({ ...p }));
    drainSpineTail(spine, 0);
    expect(spine).toEqual(before);
    expect(drainSpineTail([], 50)).toEqual([]);
  });

  it('handles a spine of coincident points without spinning forever', () => {
    const spine = [{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }];
    drainSpineTail(spine, 10);
    expect(spine).toEqual([]); // zero-length segments are consumed, not looped on
  });
});

describe('RIBBON_STALL_EPSILON_PX', () => {
  // Deliberately not zero: a head pinned to a target still jitters sub-pixel, and an exactly-equal test
  // would leave the trail frozen forever in exactly the case the drain exists for.
  it('is a small positive tolerance', () => {
    expect(RIBBON_STALL_EPSILON_PX).toBeGreaterThan(0);
    expect(RIBBON_STALL_EPSILON_PX).toBeLessThan(2);
  });
});

describe('the drain param', () => {
  it('defaults to 0, so every existing def keeps its freeze-in-place behaviour', () => {
    expect(ribbonPrimitive.params.drain.default).toBe(0);
  });
});
