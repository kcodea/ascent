import { describe, expect, it } from 'vitest';
import {
  driveLayerHeads,
  FX_ANCHOR_IDS,
  layerTravelProgress,
  pointOnTravel,
  resolveAnchor,
  type FxAnchors,
  type FxHeadSink,
} from './anchors';

const ANCHORS: FxAnchors = {
  source: { x: 0, y: 0 },
  target: { x: 100, y: 0 },
  cursor: { x: 50, y: 50 },
};

describe('resolveAnchor', () => {
  it('returns the named point', () => {
    expect(resolveAnchor(ANCHORS, 'target', 0)).toEqual({ x: 100, y: 0 });
  });

  it('falls back to the origin for an anchor the scenario did not stage', () => {
    expect(resolveAnchor({}, 'target', 0)).toEqual({ x: 0, y: 0 });
  });

  it('follows the bowed arc at the default bow', () => {
    const mid = resolveAnchor(ANCHORS, 'travel', 0.5);
    expect(mid.x).toBeCloseTo(50);
    expect(mid.y).toBeCloseTo(-14);
  });

  it('starts exactly at the source and ends exactly at the target along the arc', () => {
    expect(resolveAnchor(ANCHORS, 'travel', 0)).toEqual({ x: 0, y: 0 });
    expect(resolveAnchor(ANCHORS, 'travel', 1)).toEqual({ x: 100, y: 0 });
  });

  it('overrides the bow to run straight when bow is zero', () => {
    expect(resolveAnchor(ANCHORS, 'travel', 0.5, 0)).toEqual({ x: 50, y: 0 });
  });
});

/** Captures every `setHead` the loop makes, in order — the whole observable output of `driveLayerHeads`. */
function fakeSink(): FxHeadSink & { heads: { index: number; x: number; y: number }[] } {
  const heads: { index: number; x: number; y: number }[] = [];
  return { heads, setHead: (index, x, y) => { heads.push({ index, x, y }); } };
}

describe('FX_ANCHOR_IDS', () => {
  it('lists every anchor exactly once, and every one resolves', () => {
    expect(new Set(FX_ANCHOR_IDS).size).toBe(FX_ANCHOR_IDS.length);
    FX_ANCHOR_IDS.forEach((id) => {
      const pt = resolveAnchor(ANCHORS, id, 0.5);
      expect(Number.isFinite(pt.x), `${id}.x`).toBe(true);
      expect(Number.isFinite(pt.y), `${id}.y`).toBe(true);
    });
  });
});

describe('driveLayerHeads', () => {
  // THE regression this whole feature exists for: the workbench used to feed every layer one shared point,
  // so `FxLayer.anchor` was dead data and a composition could not be previewed as a composition.
  it('gives two differently-anchored layers DIFFERENT points', () => {
    const sink = fakeSink();
    driveLayerHeads(sink, [{ anchor: 'source' }, { anchor: 'target' }], ANCHORS, 0.5);
    expect(sink.heads).toEqual([
      { index: 0, x: 0, y: 0 },
      { index: 1, x: 100, y: 0 },
    ]);
    expect(sink.heads[0].x).not.toBe(sink.heads[1].x);
  });

  it('feeds each layer at its OWN index, in order', () => {
    const sink = fakeSink();
    driveLayerHeads(sink, [{ anchor: 'cursor' }, { anchor: 'source' }, { anchor: 'target' }], ANCHORS, 0);
    expect(sink.heads.map((h) => h.index)).toEqual([0, 1, 2]);
    expect(sink.heads[0]).toEqual({ index: 0, x: 50, y: 50 }); // the staged cursor
  });

  it('resolves `travel` along the arc when no custom head is supplied', () => {
    const sink = fakeSink();
    driveLayerHeads(sink, [{ anchor: 'travel' }], ANCHORS, 0.5);
    const expected = resolveAnchor(ANCHORS, 'travel', 0.5);
    expect(sink.heads[0].x).toBeCloseTo(expected.x);
    expect(sink.heads[0].y).toBeCloseTo(expected.y);
  });

  // A `headAt` scenario (bounce / pinned cursor / click) keeps working: its custom path IS the travel point.
  it('substitutes a custom head for `travel` ONLY, leaving other anchors staged', () => {
    const sink = fakeSink();
    const head = { x: 777, y: 333 };
    driveLayerHeads(sink, [{ anchor: 'travel' }, { anchor: 'target' }], ANCHORS, 0.5, head);
    expect(sink.heads[0]).toEqual({ index: 0, x: 777, y: 333 });
    expect(sink.heads[1]).toEqual({ index: 1, x: 100, y: 0 });
  });

  it('is a no-op for an empty layer list', () => {
    const sink = fakeSink();
    driveLayerHeads(sink, [], ANCHORS, 0.5);
    expect(sink.heads).toHaveLength(0);
  });
});

describe('pointOnTravel', () => {
  it('bows the path so the trail curves instead of running dead straight', () => {
    const mid = pointOnTravel({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.5, 0.28);
    expect(mid.x).toBeCloseTo(50);
    expect(mid.y).not.toBeCloseTo(0);
  });

  it('starts exactly at the source and ends exactly at the target', () => {
    const a = { x: 3, y: 7 };
    const b = { x: 90, y: 40 };
    expect(pointOnTravel(a, b, 0, 0.28)).toEqual(a);
    expect(pointOnTravel(a, b, 1, 0.28)).toEqual(b);
  });

  it('runs straight when bow is zero', () => {
    expect(pointOnTravel({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.5, 0)).toEqual({ x: 50, y: 0 });
  });
});

/**
 * Per-layer travel. `travel` used to resolve against the WHOLE composition's progress, which made "fly to
 * the target, THEN detonate" inexpressible — a ribbon could not finish its arc before the def did, so a
 * burst timed to the arrival always fired while the trail was still mid-flight.
 */
describe('layerTravelProgress', () => {
  const DURATION = 800;

  // The compatibility property the whole change rests on: a layer spanning the composition is unchanged.
  it('is exactly def progress for a full-life layer starting at 0', () => {
    [0, 200, 400, 800].forEach((t) => {
      expect(layerTravelProgress({ anchor: 'travel', at: 0, life: null }, t, DURATION)).toBeCloseTo(t / DURATION, 9);
    });
  });

  it('treats missing timing as a full-composition layer', () => {
    expect(layerTravelProgress({ anchor: 'travel' }, 400, DURATION)).toBeCloseTo(0.5, 9);
  });

  // THE point: a 440ms layer completes its arc at 440ms, not at the def's 800ms.
  it('completes a short layer at the END OF ITS OWN LIFE', () => {
    const layer = { anchor: 'travel' as const, at: 0, life: 440 };
    expect(layerTravelProgress(layer, 220, DURATION)).toBeCloseTo(0.5, 9);
    expect(layerTravelProgress(layer, 440, DURATION)).toBe(1);
  });

  it('starts a delayed layer at 0 when it spawns, not part-way along', () => {
    const layer = { anchor: 'travel' as const, at: 200, life: 400 };
    expect(layerTravelProgress(layer, 200, DURATION)).toBe(0);
    expect(layerTravelProgress(layer, 400, DURATION)).toBeCloseTo(0.5, 9);
    expect(layerTravelProgress(layer, 600, DURATION)).toBe(1);
  });

  it('pins a full-life layer that starts late to its remaining span', () => {
    const layer = { anchor: 'travel' as const, at: 400, life: null };
    expect(layerTravelProgress(layer, 600, DURATION)).toBeCloseTo(0.5, 9); // half of the remaining 400ms
  });

  // A fire deliberately runs PAST duration (an unbounded layer plays to true completion), and time before a
  // layer spawns is real too — neither may push the head off the arc.
  it('clamps at both ends', () => {
    const layer = { anchor: 'travel' as const, at: 200, life: 200 };
    expect(layerTravelProgress(layer, 0, DURATION)).toBe(0);
    expect(layerTravelProgress(layer, 99999, DURATION)).toBe(1);
  });

  it('collapses a degenerate window to the arc END rather than NaN', () => {
    expect(layerTravelProgress({ anchor: 'travel', at: 0, life: 0 }, 100, 0)).toBe(1);
    expect(layerTravelProgress({ anchor: 'travel', at: 800, life: null }, 100, 800)).toBe(1);
    expect(Number.isFinite(layerTravelProgress({ anchor: 'travel', at: 0, life: null }, 100, Number.NaN))).toBe(true);
  });
});

describe('driveLayerHeads with a composition clock', () => {
  it("resolves each layer's travel against its OWN window", () => {
    const sink = fakeSink();
    const layers = [
      { anchor: 'travel' as const, at: 0, life: 400 }, // done travelling by 400ms
      { anchor: 'travel' as const, at: 0, life: 800 }, // half way at 400ms
    ];
    driveLayerHeads(sink, layers, ANCHORS, 0.5, null, { timeMs: 400, durationMs: 800 });
    // The short layer has arrived at the target; the long one is still mid-arc.
    expect(sink.heads[0].x).toBeCloseTo(100, 6);
    expect(sink.heads[1].x).toBeCloseTo(50, 6);
    expect(sink.heads[1].y).not.toBeCloseTo(sink.heads[0].y, 6);
  });

  // Without a clock every caller behaves exactly as it did before per-layer travel existed.
  it('falls back to composition progress when no clock is supplied', () => {
    const withClock = fakeSink();
    const without = fakeSink();
    const layers = [{ anchor: 'travel' as const, at: 0, life: null }];
    driveLayerHeads(withClock, layers, ANCHORS, 0.5, null, { timeMs: 400, durationMs: 800 });
    driveLayerHeads(without, layers, ANCHORS, 0.5);
    expect(withClock.heads).toEqual(without.heads);
  });

  // A scenario's custom path describes where the EFFECT is going, not any one layer, so it stays
  // composition-wide and keeps overriding `travel` outright.
  it('still substitutes a custom head for travel, clock or no clock', () => {
    const sink = fakeSink();
    const head = { x: 777, y: 333 };
    driveLayerHeads(sink, [{ anchor: 'travel', at: 0, life: 100 }], ANCHORS, 0.5, head, {
      timeMs: 400,
      durationMs: 800,
    });
    expect(sink.heads[0]).toEqual({ index: 0, x: 777, y: 333 });
  });

  it('leaves non-travel anchors alone', () => {
    const sink = fakeSink();
    driveLayerHeads(sink, [{ anchor: 'target', at: 0, life: 50 }], ANCHORS, 0, null, {
      timeMs: 400,
      durationMs: 800,
    });
    expect(sink.heads[0]).toEqual({ index: 0, x: 100, y: 0 });
  });
});
