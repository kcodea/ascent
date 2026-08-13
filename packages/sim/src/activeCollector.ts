/**
 * BEAT SYSTEM PR 3 — the recruit-side active-collector holder.
 *
 * The recruit reducer builds its `RecruitContext` at dozens of call sites via `makeContext(state)`; threading
 * a collector parameter through every one of them would be a massive, high-conflict edit to the hottest file
 * in the repo. Instead the collector is set once around a single `reduce` call and read by `makeContext`.
 * This is safe because `reduce` is synchronous and non-reentrant per action — one action resolves fully before
 * the next begins, so a module-scoped "active collector" has exactly the lifetime of one resolution.
 *
 * Standalone (imports only `@game/core`) so neither `recruit.ts` (reader) nor `reducer.ts` (setter) gains a
 * new cycle. Defaults to `NOOP_COLLECTOR`, so any code path that runs without `withActiveCollector` — bots,
 * balance sims, the plain `reduce` used by tests — pays nothing.
 */
import { NOOP_COLLECTOR, type PresentationCollector } from '@game/core';

let active: PresentationCollector = NOOP_COLLECTOR;

/** The collector for the resolution in flight (NOOP outside a `withActiveCollector` scope). */
export const currentCollector = (): PresentationCollector => active;

/** Run `fn` with `collector` active, restoring the prior collector afterward (nesting-safe, exception-safe). */
export function withActiveCollector<T>(collector: PresentationCollector, fn: () => T): T {
  const prev = active;
  active = collector;
  try {
    return fn();
  } finally {
    active = prev;
  }
}
