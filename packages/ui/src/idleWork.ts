/**
 * OFF-THE-FRAME WORK (perf 2026-09-17, `docs/perf-handoff-2026-09-17.md` PR 2).
 *
 * Two pieces of bookkeeping used to run INSIDE the Zustand `set` of every dispatch — the bug-report action
 * ring's `hashRunState` (a JSON round-trip + stable-stringify of the whole run, 5–15 ms late-game) and the
 * phase-boundary autosave (`serialize` + `localStorage.setItem`). Neither result is read in the same frame:
 * the ring is only read at Ctrl+B, the save only on a reload. So they are scheduled here instead, on the
 * browser's idle time with a hard timeout, and anything that DOES need the result synchronously calls
 * `flush()` first. Off the click's task means off the frame the click dropped.
 *
 * `requestIdleCallback` yields to input and rendering; the `timeout` guarantees a saturated main thread still
 * runs it within that many ms, as its own task. Where the API is missing (vitest, older WebKit) a `setTimeout`
 * stands in. Both paths are cancellable and coalesce: scheduling again before the callback ran REPLACES the
 * pending work (the latest arguments win), which is what makes a burst of dispatches cost one write.
 */
export interface IdleHandle { cancel(): void }

export interface IdleScheduler {
  schedule(fn: () => void, timeoutMs: number): IdleHandle;
}

/** The browser scheduler: rIC when present, a timer otherwise. `timeoutMs` bounds both. */
export const browserIdle: IdleScheduler = {
  schedule(fn, timeoutMs) {
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(() => fn(), { timeout: timeoutMs });
      return { cancel: () => { if (typeof cancelIdleCallback === 'function') cancelIdleCallback(id); } };
    }
    const id = setTimeout(fn, Math.min(timeoutMs, 50));
    return { cancel: () => clearTimeout(id) };
  },
};

export interface DeferredWriter<T> {
  /** Queue `args` for the next idle slot. A pending write is REPLACED — the burst collapses to one. */
  schedule(args: T): void;
  /** Run the pending write NOW (synchronously), if any — for the callers that need it durable this instant. */
  flush(): void;
  /** Drop the pending write without running it. */
  cancel(): void;
  /** Is a write waiting? */
  readonly pending: boolean;
}

/**
 * A single-slot deferred writer: `write(args)` runs once per idle slot with the LATEST scheduled args.
 * `timeoutMs` is the longest a write may wait on a busy thread before it runs as its own task.
 */
export function createDeferredWriter<T>(write: (args: T) => void, timeoutMs: number, scheduler: IdleScheduler = browserIdle): DeferredWriter<T> {
  let slot: { args: T } | null = null;
  let handle: IdleHandle | null = null;
  const run = (): void => {
    handle = null;
    const s = slot;
    slot = null;
    if (s) write(s.args);
  };
  return {
    schedule(args) {
      slot = { args };
      if (!handle) handle = scheduler.schedule(run, timeoutMs);
    },
    flush() {
      if (!handle) return;
      handle.cancel();
      run();
    },
    cancel() {
      handle?.cancel();
      handle = null;
      slot = null;
    },
    get pending() { return slot !== null; },
  };
}
