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
    // The card trails the pointer — same direction, smaller step. That is the FEEL, not a fault.
    recordDragJank(frame({ t: 0, px: 0, cx: 0 }));
    recordDragJank(frame({ t: 16, px: 40, cx: 22 }));
    recordDragJank(frame({ t: 32, px: 80, cx: 55 }));
    expect(warn).not.toHaveBeenCalled();
  });

  it('flags the card moving BACKWARD against a forward pointer', () => {
    recordDragJank(frame({ t: 0, px: 200, cx: 190 }));
    recordDragJank(frame({ t: 16, px: 240, cx: 190 - SNAP_PX - 10 }));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('SNAP');
  });

  it('stays quiet while React owns the transform', () => {
    // A snap-back animation and a magnet slide are SUPPOSED to move the card against the pointer. Flagging
    // those would bury the real event in noise from the two cases we already understand.
    recordDragJank(frame({ t: 0, px: 200, cx: 190 }));
    recordDragJank(frame({ t: 16, px: 240, cx: 0, reactDriven: true }));
    expect(warn).not.toHaveBeenCalled();
  });

  it('ignores a still pointer — a settling card is not a snap', () => {
    // With the pointer parked, the card keeps easing in. Nothing has been contradicted.
    recordDragJank(frame({ t: 0, px: 200, cx: 100 }));
    recordDragJank(frame({ t: 16, px: 201, cx: 160 }));
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
