import { describe, it, expect } from 'vitest';
import { msToPx, pxToMs, snapMs, beatRegionsPx, fitScale, holdFromDragPx, rulerTicks } from './timelineMath';
import type { ScheduledBeat } from './labSchedule';

/** BEAT SYSTEM PR 8 — pure timeline geometry. */
const beat: ScheduledBeat = {
  id: 't1', trigger: {} as never, consequences: [],
  startMs: 100, consequenceMs: 220, endMs: 640, nextMs: 810, // windup 120, hold 420, recovery 170
};

describe('timeline math', () => {
  it('msToPx / pxToMs round-trip', () => {
    expect(msToPx(500, 0.2)).toBe(100);
    expect(pxToMs(100, 0.2)).toBe(500);
    expect(pxToMs(50, 0)).toBe(0); // guard against div-by-zero
  });

  it('snapMs snaps to the step and floors at 0', () => {
    expect(snapMs(437, 50)).toBe(450);
    expect(snapMs(412, 25)).toBe(400);
    expect(snapMs(-30, 50)).toBe(0);
    expect(snapMs(437, 0)).toBe(437); // step<=0 disables snapping (still rounds)
  });

  it('beatRegionsPx lays out the three sub-regions and the hold-edge handle', () => {
    const r = beatRegionsPx(beat, 0.5);
    expect(r.startPx).toBe(50);        // 100ms * 0.5
    expect(r.windupPx).toBe(60);       // 120ms
    expect(r.holdPx).toBe(210);        // 420ms
    expect(r.recoveryPx).toBe(85);     // 170ms
    expect(r.holdEndPx).toBe(50 + 60 + 210); // start + windup + hold
  });

  it('holdFromDragPx converts a hold-edge drag back into a snapped holdMs', () => {
    // consequence at 220ms → 110px at 0.5 px/ms. Drag handle to 320px → 640ms - 220ms = 420ms hold-ish.
    const px = 320;
    const hold = holdFromDragPx(beat, px, 0.5, 50);
    expect(hold).toBe(snapMs((320 - 110) / 0.5, 50)); // (210px/0.5) = 420 → snaps to 400
    expect(hold).toBe(400);
    expect(holdFromDragPx(beat, 0, 0.5, 50)).toBe(0); // dragging past the consequence floors at 0
  });

  it('fitScale keeps totals legible within a width', () => {
    expect(fitScale(0, 100)).toBe(0.1);
    const s = fitScale(2000, 420);
    expect(s).toBeGreaterThan(0.02);
    expect(s).toBeLessThanOrEqual(2);
    expect(2000 * s).toBeLessThanOrEqual(420);
  });

  it('rulerTicks produces round, ascending gridlines up to the span', () => {
    const ticks = rulerTicks(1420, 6);
    expect(ticks[0]).toBe(0);
    const last = ticks[ticks.length - 1]!;
    expect(last).toBeLessThanOrEqual(1420);       // interior gridlines, standard ruler
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]! > ticks[i - 1]!).toBe(true); // strictly ascending
    }
    const step = ticks[1]! - ticks[0]!;
    expect(last + step).toBeGreaterThan(1420);     // …but they reach near the end
  });
});
