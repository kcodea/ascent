import { describe, expect, it } from 'vitest';
import {
  MIN_LAYER_LIFE_MS,
  pointerToMs,
  resolveTimingDrag,
  spanOf,
  previewClock,
  spanToTrack,
  type TimelineDrag,
} from './timelineModel';

const DURATION = 1000;
const RECT = { left: 100, width: 500 };

describe('spanOf', () => {
  it('resolves a finite layer to at → at + life', () => {
    expect(spanOf({ at: 200, life: 300 }, DURATION)).toEqual({ startMs: 200, endMs: 500, full: false });
  });

  // `life: null` means "run to the composition's end", so it can only be resolved against a duration.
  it('resolves a full-life layer to at → duration', () => {
    expect(spanOf({ at: 200, life: null }, DURATION)).toEqual({ startMs: 200, endMs: 1000, full: true });
  });

  it('clamps a layer that reaches past the end (e.g. after the duration was shortened)', () => {
    expect(spanOf({ at: 900, life: 400 }, DURATION)).toEqual({ startMs: 900, endMs: 1000, full: false });
  });

  it('clamps a start beyond the end rather than going negative', () => {
    const span = spanOf({ at: 5000, life: 100 }, DURATION);
    expect(span.startMs).toBe(1000);
    expect(span.endMs).toBe(1000);
  });
});

describe('spanToTrack', () => {
  it('maps a span onto 0..1 fractions of the track', () => {
    expect(spanToTrack({ startMs: 250, endMs: 750, full: false }, DURATION)).toEqual({ left: 0.25, width: 0.5 });
  });

  it('never renders inside-out', () => {
    const { left, width } = spanToTrack({ startMs: 900, endMs: 100, full: false }, DURATION);
    expect(width).toBeGreaterThanOrEqual(0);
    expect(left).toBeLessThanOrEqual(1);
  });

  it('is inert for a zero duration instead of dividing by zero', () => {
    expect(spanToTrack({ startMs: 0, endMs: 100, full: false }, 0)).toEqual({ left: 0, width: 0 });
  });
});

describe('pointerToMs', () => {
  it('maps a pointer position across the track to 0..duration', () => {
    expect(pointerToMs(100, RECT, DURATION)).toBe(0);
    expect(pointerToMs(350, RECT, DURATION)).toBe(500);
    expect(pointerToMs(600, RECT, DURATION)).toBe(1000);
  });

  it('clamps outside the track, so dragging off either end just pins', () => {
    expect(pointerToMs(-999, RECT, DURATION)).toBe(0);
    expect(pointerToMs(9999, RECT, DURATION)).toBe(1000);
  });

  it('is inert for a zero-width rect', () => {
    expect(pointerToMs(50, { left: 0, width: 0 }, DURATION)).toBe(0);
  });
});

describe('resolveTimingDrag — move', () => {
  const drag = (over: Partial<TimelineDrag> = {}): TimelineDrag => ({
    index: 0,
    mode: 'move',
    startAt: 200,
    startLife: 300,
    grabMs: 300, // grabbed 100ms into the bar
    ...over,
  });

  it('slides by the pointer DELTA, not to the pointer — grabbing mid-bar does not teleport it', () => {
    expect(resolveTimingDrag(drag(), 400, DURATION)).toEqual({ at: 300, life: 300 });
  });

  it('preserves life exactly', () => {
    expect(resolveTimingDrag(drag(), 700, DURATION).life).toBe(300);
  });

  it('snaps to the 10ms grid the At slider also steps on', () => {
    expect(resolveTimingDrag(drag(), 407, DURATION).at).toBe(310);
  });

  it('cannot be dragged before the start', () => {
    expect(resolveTimingDrag(drag(), -500, DURATION).at).toBe(0);
  });

  it('cannot be dragged so far that the bar leaves the composition', () => {
    expect(resolveTimingDrag(drag(), 5000, DURATION).at).toBe(700); // 1000 - 300
  });

  // Moving a full-life layer must NOT quietly give it a fixed length — only a resize does that.
  it('keeps a full-life layer full', () => {
    const out = resolveTimingDrag(drag({ startLife: null, startAt: 0, grabMs: 0 }), 250, DURATION);
    expect(out).toEqual({ at: 250, life: null });
  });

  it('stops a full-life layer with at least the minimum life still inside', () => {
    const out = resolveTimingDrag(drag({ startLife: null, startAt: 0, grabMs: 0 }), 5000, DURATION);
    expect(out.at).toBe(DURATION - MIN_LAYER_LIFE_MS);
  });
});

describe('resolveTimingDrag — resize', () => {
  const drag = (over: Partial<TimelineDrag> = {}): TimelineDrag => ({
    index: 0,
    mode: 'resize',
    startAt: 200,
    startLife: 300,
    grabMs: 500, // the right edge
    ...over,
  });

  it('extends and shortens by the pointer delta, leaving the start put', () => {
    expect(resolveTimingDrag(drag(), 700, DURATION)).toEqual({ at: 200, life: 500 });
    expect(resolveTimingDrag(drag(), 400, DURATION)).toEqual({ at: 200, life: 200 });
  });

  it('cannot be inverted past its own start', () => {
    expect(resolveTimingDrag(drag(), 0, DURATION).life).toBe(MIN_LAYER_LIFE_MS);
  });

  it('cannot be extended past the end of the composition', () => {
    expect(resolveTimingDrag(drag(), 5000, DURATION).life).toBe(800); // 1000 - 200
  });

  // Dragging the right edge of a full-life bar is the ONE gesture that pins it to a fixed length — the
  // affordance and the conversion are deliberately the same action.
  it('converts a full-life layer to a finite one', () => {
    const out = resolveTimingDrag(drag({ startLife: null, grabMs: DURATION }), 600, DURATION);
    expect(out.life).toBe(400); // was 800 (1000 - 200), dragged 400 left
  });
});

describe('previewClock', () => {
  it('runs forward through the composition', () => {
    expect(previewClock(0, 800)).toEqual({ timeMs: 0, progress: 0 });
    expect(previewClock(400, 800)).toEqual({ timeMs: 400, progress: 0.5 });
    expect(previewClock(800, 800)).toEqual({ timeMs: 800, progress: 1 });
  });

  /**
   * THE regression. The workbench used to feed `timeMs % durationMs`, and a fire runs PAST the duration on
   * purpose — so crossing it wrapped the clock to 0, and a travelling head teleported back to the source and
   * flew the arc again, over and over. "Fire once" played forever.
   */
  it('does NOT wrap past the duration — a fire that overruns keeps running forward', () => {
    expect(previewClock(900, 800).timeMs).toBe(900);
    expect(previewClock(2400, 800).timeMs).toBe(2400);
  });

  it('CLAMPS progress at 1, so an arrived head stays arrived', () => {
    expect(previewClock(900, 800).progress).toBe(1);
    expect(previewClock(9999, 800).progress).toBe(1);
  });

  it('never goes negative, and survives a zero duration', () => {
    expect(previewClock(-50, 800).timeMs).toBe(0);
    expect(previewClock(100, 0)).toEqual({ timeMs: 100, progress: 1 });
  });
});
