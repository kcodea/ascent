import { describe, expect, it } from 'vitest';
import {
  driveLayerHeads,
  FX_ANCHOR_IDS,
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
