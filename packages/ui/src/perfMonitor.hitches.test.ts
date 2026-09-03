import { describe, it, expect } from 'vitest';
import { perfMonitor, HITCH_MS, HITCH_LOG_MAX } from './perfMonitor';

/** The hitch log is how "no first-use hitches" gets MEASURED rather than assumed — every long task with the
 *  phase it landed in. Fed directly here because node has no PerformanceObserver. */
describe('perfMonitor hitch log', () => {
  it('records a long task with the registered game context, and ignores sub-threshold ones', () => {
    perfMonitor.registerContext(() => ({ phase: 'combat', wave: 7 }));
    const before = perfMonitor.hitches().length;
    perfMonitor.recordLongTask({ startTime: 12345.6, duration: HITCH_MS - 1 });
    expect(perfMonitor.hitches().length).toBe(before);
    perfMonitor.recordLongTask({ startTime: 12345.6, duration: 181.4 });
    const last = perfMonitor.hitches()[perfMonitor.hitches().length - 1];
    expect(last).toMatchObject({ at: 12346, ms: 181, phase: 'combat', wave: 7 });
    expect(Array.isArray(last.marks)).toBe(true);
  });

  it('caps the log at HITCH_LOG_MAX entries, dropping the oldest', () => {
    for (let i = 0; i < HITCH_LOG_MAX + 25; i++) perfMonitor.recordLongTask({ startTime: i, duration: 100 + i });
    const log = perfMonitor.hitches();
    expect(log.length).toBe(HITCH_LOG_MAX);
    expect(log[log.length - 1].ms).toBe(100 + HITCH_LOG_MAX + 24);
  });
});
