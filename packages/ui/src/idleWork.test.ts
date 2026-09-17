import { describe, expect, it, vi } from 'vitest';
import { browserIdle, createDeferredWriter, type IdleScheduler } from './idleWork';

/** A hand-cranked scheduler: nothing runs until the test says so. */
function manual(): IdleScheduler & { run(): void; cancelled: number; scheduled: number } {
  let fn: (() => void) | null = null;
  const s = {
    cancelled: 0, scheduled: 0,
    schedule(f: () => void) { s.scheduled++; fn = f; return { cancel: () => { s.cancelled++; fn = null; } }; },
    run() { const f = fn; fn = null; f?.(); },
  };
  return s;
}

describe('createDeferredWriter', () => {
  it('a burst of schedules costs ONE write, with the latest arguments', () => {
    const writes: number[] = [];
    const sched = manual();
    const w = createDeferredWriter<number>((n) => writes.push(n), 1000, sched);
    w.schedule(1); w.schedule(2); w.schedule(3);
    expect(writes).toEqual([]);
    expect(sched.scheduled).toBe(1);
    expect(w.pending).toBe(true);
    sched.run();
    expect(writes).toEqual([3]);
    expect(w.pending).toBe(false);
  });

  it('flush writes synchronously and cancels the idle slot; a flush with nothing pending is a no-op', () => {
    const writes: string[] = [];
    const sched = manual();
    const w = createDeferredWriter<string>((s) => writes.push(s), 1000, sched);
    w.flush();
    expect(writes).toEqual([]);
    w.schedule('a');
    w.flush();
    expect(writes).toEqual(['a']);
    expect(sched.cancelled).toBe(1);
    sched.run(); // the cancelled slot never fires
    expect(writes).toEqual(['a']);
  });

  it('cancel drops the pending write', () => {
    const writes: string[] = [];
    const sched = manual();
    const w = createDeferredWriter<string>((s) => writes.push(s), 1000, sched);
    w.schedule('a');
    w.cancel();
    sched.run();
    expect(writes).toEqual([]);
    expect(w.pending).toBe(false);
  });

  it('the browser scheduler falls back to a timer where requestIdleCallback is missing (vitest)', () => {
    vi.useFakeTimers();
    try {
      const writes: number[] = [];
      const w = createDeferredWriter<number>((n) => writes.push(n), 1500, browserIdle);
      w.schedule(7);
      expect(writes).toEqual([]);
      vi.advanceTimersByTime(60);
      expect(writes).toEqual([7]);
    } finally {
      vi.useRealTimers();
    }
  });
});
