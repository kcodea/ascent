import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { SNAP_PX, beginDragJank, dragJankTrace, recordDragJank, type DragSample } from './dragJank';

/**
 * THE SNAP DETECTOR.
 *
 * A weighted lag eases the card TOWARD the pointer, so it can only ever move toward it. A frame where the
 * card moves the OTHER WAY, hard, is therefore not motion — it is a discontinuity, and it is the owner's
 * *"snap-back jank moment"*. That is the whole rule, and it is what makes the trace worth recording: it turns
 * "it feels kind of random" into a frame number with its own run-up.
 *
 * Tested because a detector that cries wolf is worse than none (it trains you to ignore the console), and one
 * that misses the event is a recorder that records nothing.
 */
const frame = (over: Partial<DragSample> = {}): DragSample => ({
  t: 0, dt: 16, px: 0, py: 0, cx: 0, cy: 0, dx: 0, dy: 0, reactDriven: false, ...over,
});

describe('drag jank recorder', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { beginDragJank(); warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { warn.mockRestore(); });

  it('says nothing for ordinary weighted motion', () => {
    // The card trails the pointer and CLOSES the gap each frame. That is the feel, not a fault.
    recordDragJank(frame({ t: 0, px: 100, cx: 0 }));   // 100px behind
    recordDragJank(frame({ t: 16, px: 140, cx: 60 }));  // 80px behind — closing
    recordDragJank(frame({ t: 32, px: 180, cx: 120 })); // 60px behind — closing
    expect(warn).not.toHaveBeenCalled();
  });

  it('says nothing when the gap GROWS because the pointer outran the card', () => {
    // A fast flick opens the gap without the card moving backwards at all — that is lag, which is authored.
    // The rule has to tolerate it, or every quick drag cries wolf.
    recordDragJank(frame({ t: 0, px: 100, cx: 60 }));
    recordDragJank(frame({ t: 16, px: 400, cx: 150 }));
    expect(warn, 'the card still moved toward the pointer').not.toHaveBeenCalled();
  });

  it('flags the card jumping AWAY from the pointer', () => {
    recordDragJank(frame({ t: 0, px: 400, cx: 380 }));       // 20px behind
    recordDragJank(frame({ t: 16, px: 405, cx: 200 }));      // 205px behind — it went backwards
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('SNAP');
  });

  it('flags a snap even while the hand is STILL — the blind spot in the first cut', () => {
    // The most likely moment to notice a snap is while pausing, and the original rule (opposite direction to
    // the pointer) skipped a still pointer outright.
    recordDragJank(frame({ t: 0, px: 400, cx: 395 }));
    recordDragJank(frame({ t: 16, px: 400, cx: 300 }));
    expect(warn, 'a still pointer must not excuse a 95px jump').toHaveBeenCalledTimes(1);
  });

  it('stays quiet while React owns the transform', () => {
    // A snap-back animation and a magnet slide are SUPPOSED to move the card away from the pointer. Flagging
    // them would bury the real event in noise from the two cases we already understand.
    recordDragJank(frame({ t: 0, px: 400, cx: 390 }));
    recordDragJank(frame({ t: 16, px: 400, cx: 0, reactDriven: true }));
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps a bounded trace, newest last', () => {
    for (let i = 0; i < 400; i++) recordDragJank(frame({ t: i, px: i, cx: i }));
    const trace = dragJankTrace();
    expect(trace.length, 'the ring buffer is capped').toBeLessThanOrEqual(240);
    expect(trace[trace.length - 1]!.t, 'and holds the most recent frames').toBe(399);
  });

  it('each drag gets its own trace', () => {
    recordDragJank(frame({ t: 1 }));
    beginDragJank();
    expect(dragJankTrace()).toEqual([]);
  });
});
