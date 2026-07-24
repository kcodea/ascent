import { describe, expect, it } from 'vitest';
import { pointOnTravel, resolveAnchor, type FxAnchors } from './anchors';

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

  it('interpolates travel from source to target by progress', () => {
    expect(resolveAnchor(ANCHORS, 'travel', 0.5)).toEqual({ x: 50, y: 0 });
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
