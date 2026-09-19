/**
 * REPLAY V2 — free-cursor capture (2026-09-19): the throttle, the per-round simplification, the run cap and the
 * resume shift. Pure module state, driven headlessly (no window → fractions are taken over a 1×1 viewport, so
 * pixel inputs below 1 are already fractions).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { CURSOR_SAMPLE_MS, CURSOR_TRAIL_MAX, type CursorSample } from '@game/sim';
import {
  closeCursorWave, openCursorSampleCount, resetCursorTrail, sampleCursor, shiftCursorTrail, simplifyCursorTrail,
  takeCursorTrail,
} from './cursorTrace';

beforeEach(() => resetCursorTrail());

describe('sampleCursor — the ≤20 Hz throttle', () => {
  it('records at most one sample per CURSOR_SAMPLE_MS, on the replay clock, as [tMs, x, y]', () => {
    sampleCursor(0.1, 0.2, 0);
    sampleCursor(0.15, 0.25, 10);   // 10 ms later — dropped
    sampleCursor(0.2, 0.3, 49);     // still inside the window — dropped
    sampleCursor(0.3, 0.4, CURSOR_SAMPLE_MS); // exactly the window — kept
    expect(openCursorSampleCount()).toBe(2);
    expect(takeCursorTrail()).toEqual([[0, 0.1, 0.2], [CURSOR_SAMPLE_MS, 0.3, 0.4]]);
  });

  it('a 20-minute shop at 20 Hz cannot exceed the run cap — takeCursorTrail thins uniformly', () => {
    for (let i = 0; i < 24_000; i++) sampleCursor(Math.random(), Math.random(), i * 50);
    const trail = takeCursorTrail();
    expect(trail.length).toBeLessThanOrEqual(CURSOR_TRAIL_MAX);
    expect(trail[0]![0]).toBe(0);
    for (let i = 1; i < trail.length; i++) expect(trail[i]![0]).toBeGreaterThanOrEqual(trail[i - 1]![0]);
  });
});

describe('simplifyCursorTrail — RDP with timestamps kept, rests kept as their two endpoints', () => {
  it('drops the collinear middle of a straight sweep and keeps the survivors\' timestamps', () => {
    const line: CursorSample[] = Array.from({ length: 21 }, (_, i) => [i * 50, i / 20, 0.5]);
    const out = simplifyCursorTrail(line);
    expect(out).toEqual([[0, 0, 0.5], [1000, 1, 0.5]]);
  });

  it('keeps a corner', () => {
    const corner: CursorSample[] = [[0, 0, 0], [50, 0.5, 0], [100, 1, 0], [150, 1, 0.5], [200, 1, 1]];
    expect(simplifyCursorTrail(corner)).toEqual([[0, 0, 0], [100, 1, 0], [200, 1, 1]]);
  });

  it('a rest (the hand parked) collapses to its first and last sample, and both survive the cut', () => {
    const rest: CursorSample[] = [
      [0, 0, 0], [50, 0.5, 0.5],
      [100, 0.5, 0.5], [150, 0.5, 0.5], [200, 0.5, 0.5], [250, 0.5, 0.5], // parked for 200 ms
      [300, 1, 1],
    ];
    const out = simplifyCursorTrail(rest);
    expect(out).toEqual([[0, 0, 0], [50, 0.5, 0.5], [250, 0.5, 0.5], [300, 1, 1]]);
  });

  it('two or fewer samples pass through untouched', () => {
    expect(simplifyCursorTrail([])).toEqual([]);
    expect(simplifyCursorTrail([[0, 0, 0]])).toEqual([[0, 0, 0]]);
    expect(simplifyCursorTrail([[0, 0, 0], [50, 1, 1]])).toEqual([[0, 0, 0], [50, 1, 1]]);
  });
});

describe('the per-round fold and the resume shift', () => {
  it('closeCursorWave simplifies the open round ONCE into the history; the next round starts fresh', () => {
    for (let i = 0; i < 21; i++) sampleCursor(i / 20, 0.5, i * 50);
    closeCursorWave();
    expect(openCursorSampleCount()).toBe(0);
    expect(takeCursorTrail()).toEqual([[0, 0, 0.5], [1000, 1, 0.5]]);
    sampleCursor(0.2, 0.2, 5000);
    expect(takeCursorTrail()).toEqual([[0, 0, 0.5], [1000, 1, 0.5], [5000, 0.2, 0.2]]);
  });

  it('resetCursorTrail(restored) seeds a resumed run, and shiftCursorTrail moves everything along the clock', () => {
    resetCursorTrail([[0, 0.1, 0.1], [700, 0.2, 0.2]]);
    sampleCursor(0.3, 0.3, 1000);
    shiftCursorTrail(5000);
    expect(takeCursorTrail()).toEqual([[5000, 0.1, 0.1], [5700, 0.2, 0.2], [6000, 0.3, 0.3]]);
    // The throttle window moved with it: a sample inside the shifted window is still dropped.
    sampleCursor(0.9, 0.9, 6010);
    expect(takeCursorTrail()).toHaveLength(3);
  });
});
