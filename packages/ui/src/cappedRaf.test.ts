import { describe, it, expect } from 'vitest';
import { cappedRafDue, cappedRafSleepMs } from './cappedRaf';

const CAP = 1000 / 60;

describe('cappedRaf scheduling (R-PERF-FUSE-BURN-01)', () => {
  it('a display at or near the cap is a plain rAF loop: never sleeps, every frame runs', () => {
    for (const hz of [30, 60, 72]) {
      expect(cappedRafSleepMs(1, CAP, 1000 / hz)).toBe(0);
      expect(cappedRafDue(1000 / hz, CAP, 1000 / hz)).toBe(true);
    }
  });
  it('an unknown or misjudged display never sleeps, and still runs the callback at about the cap', () => {
    expect(cappedRafSleepMs(1, CAP, 0)).toBe(0);
    // A 360 Hz panel the estimate still calls 60 Hz: every display frame arrives, about one in five runs.
    for (const claimed of [0, 1000 / 60]) {
      const f = 1000 / 360;
      let last = 0; let runs = 0;
      for (let t = f; t <= 1000; t += f) if (cappedRafDue(t - last, CAP, claimed)) { last = t; runs++; }
      expect(runs).toBeLessThanOrEqual(75);
      expect(runs).toBeGreaterThanOrEqual(55);
    }
  });
  it('a fast display sleeps through the frames it skips and wakes one display frame before the target', () => {
    const f360 = 1000 / 360;
    expect(cappedRafSleepMs(0.5, CAP, f360)).toBeCloseTo(CAP - 0.5 - f360, 5);
    expect(cappedRafSleepMs(CAP - f360, CAP, f360)).toBe(0); // already inside the last frame: ask now
  });
  it('a fast display runs about 60 times a second, not once per display frame', () => {
    for (const hz of [144, 240, 360]) {
      const f = 1000 / hz;
      let last = 0; let runs = 0;
      for (let t = f; t <= 1000; t += f) if (cappedRafDue(t - last, CAP, f)) { last = t; runs++; }
      expect(runs).toBeGreaterThanOrEqual(55);
      expect(runs).toBeLessThanOrEqual(75);
    }
  });
});
