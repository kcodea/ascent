/**
 * REPLAY V2 — drag-path capture tests: the pure simplification (collinear drop, endpoint retention, the
 * point cap), the viewport-fraction encoding, and the take-and-clear / staleness contract that keeps an
 * aborted drag from ever labelling a later unrelated action.
 */
import { describe, expect, it } from 'vitest';
import {
  DRAG_MAX_PTS, DRAG_TRACE_STALE_MS,
  beginDragTrace, cancelDragTrace, endDragTrace, sampleDragTrace, simplifyDragPath, takeDragTrace, toFrac,
} from './dragTrace';

const nowMs = (): number => performance.now();

describe('simplifyDragPath', () => {
  it('drops near-collinear interior points, keeping the endpoints', () => {
    const line: [number, number][] = [[0, 0], [0.1, 0.1], [0.2, 0.2], [0.3, 0.3], [0.4, 0.4]];
    expect(simplifyDragPath(line)).toEqual([[0, 0], [0.4, 0.4]]);
  });

  it('keeps a real corner', () => {
    const corner: [number, number][] = [[0, 0], [0.25, 0], [0.5, 0], [0.5, 0.25], [0.5, 0.5]];
    expect(simplifyDragPath(corner)).toEqual([[0, 0], [0.5, 0], [0.5, 0.5]]);
  });

  it('a point barely off the line (below eps) is dropped; above eps it is kept', () => {
    const below: [number, number][] = [[0, 0], [0.5, 0.003], [1, 0]];
    expect(simplifyDragPath(below)).toEqual([[0, 0], [1, 0]]);
    const above: [number, number][] = [[0, 0], [0.5, 0.02], [1, 0]];
    expect(simplifyDragPath(above)).toHaveLength(3);
  });

  it('caps a pathological path at DRAG_MAX_PTS, endpoints pinned', () => {
    // A hard zigzag — nothing is collinear, so RDP keeps everything and the cap must bite.
    const zig: [number, number][] = [];
    for (let i = 0; i <= 500; i++) zig.push([i / 500, (i % 2) * 0.5]);
    const out = simplifyDragPath(zig);
    expect(out.length).toBe(DRAG_MAX_PTS);
    expect(out[0]).toEqual(zig[0]);
    expect(out[out.length - 1]).toEqual(zig[zig.length - 1]);
  });

  it('passes 0/1/2-point paths through untouched', () => {
    expect(simplifyDragPath([])).toEqual([]);
    expect(simplifyDragPath([[0.1, 0.1]])).toEqual([[0.1, 0.1]]);
    expect(simplifyDragPath([[0.1, 0.1], [0.9, 0.9]])).toEqual([[0.1, 0.1], [0.9, 0.9]]);
  });
});

describe('toFrac (viewport-fraction encoding)', () => {
  it('encodes at 3-decimal precision', () => {
    expect(toFrac(123, 1000)).toBe(0.123);
    expect(toFrac(1234.5678, 10000)).toBe(0.123);
    expect(toFrac(999.9, 1000)).toBe(1);
  });
  it('clamps outside-the-window coordinates into [0,1]', () => {
    expect(toFrac(-50, 1000)).toBe(0);
    expect(toFrac(1500, 1000)).toBe(1);
  });
  it('a zero span (degenerate window) encodes to 0, never NaN', () => {
    expect(toFrac(100, 0)).toBe(0);
  });
});

describe('the trace lifecycle — take-and-clear + staleness', () => {
  // Node test env has no `window`, so vw/vh fall back to 1 and raw 0..1 inputs pass through as fractions.

  it('begin → end → take yields the path once, then null (take-and-clear)', () => {
    beginDragTrace('imp', 0.1, 0.2);
    const parked = endDragTrace(0.5, 0.5);
    expect(parked).not.toBeNull();
    const taken = takeDragTrace(nowMs())!;
    expect(taken.cardId).toBe('imp');
    expect(taken.pts[0]).toEqual([0.1, 0.2]);
    expect(taken.pts[taken.pts.length - 1]).toEqual([0.5, 0.5]);
    expect(taken.durMs).toBeGreaterThanOrEqual(0);
    expect(takeDragTrace(nowMs()), 'a second take finds nothing').toBeNull();
  });

  it('a stale park (an aborted drag) is discarded on take', () => {
    beginDragTrace('imp', 0.1, 0.2);
    endDragTrace(0.5, 0.5);
    expect(takeDragTrace(nowMs() + DRAG_TRACE_STALE_MS + 1)).toBeNull();
    expect(takeDragTrace(nowMs()), 'the stale take also cleared it').toBeNull();
  });

  it('cancel discards everything — a plain click parks nothing', () => {
    beginDragTrace('imp', 0.1, 0.2);
    cancelDragTrace();
    expect(endDragTrace(0.5, 0.5), 'end after cancel records nothing').toBeNull();
    expect(takeDragTrace(nowMs())).toBeNull();
  });

  it('a new begin resets any previously parked path', () => {
    beginDragTrace('imp', 0.1, 0.2);
    endDragTrace(0.5, 0.5);
    beginDragTrace('wolf', 0.3, 0.3);
    expect(takeDragTrace(nowMs()), 'the old park is gone the moment a new drag starts').toBeNull();
    endDragTrace(0.7, 0.7);
    expect(takeDragTrace(nowMs())?.cardId).toBe('wolf');
  });

  it('move samples are self-throttled — a burst of same-instant samples records at most one', () => {
    beginDragTrace('imp', 0, 0);
    for (let i = 0; i < 100; i++) sampleDragTrace(0.5, i / 100);
    const p = endDragTrace(1, 1);
    // grab + (≤1 sample that beat the 33 ms throttle on a slow runner) + drop
    expect(p!.pts.length).toBeLessThanOrEqual(3);
    takeDragTrace(nowMs()); // consume the park — module state must not leak into the next test
  });

  it('end without begin is a no-op', () => {
    expect(endDragTrace(0.5, 0.5)).toBeNull();
    expect(takeDragTrace(nowMs())).toBeNull();
  });
});
