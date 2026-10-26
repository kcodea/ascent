/**
 * BACKOFF FOR POLLING LOOPS (R-NET-BACKOFF-01, perf/supabase-egress-audit 2026-10-26).
 *
 * A loop that asks the server "anything due?" must not ask at the same pace forever when the answer keeps being
 * "nothing changed" or an error: a tab left on a paused match used to call `versus_reconcile` twice a second for hours
 * (~10 MB an hour of egress, and a hidden tab still made ~3,600 calls an hour). A gate is KEYED by what the loop is
 * waiting on (a match revision, a round, a deadline): a new key is a new situation and is asked at once; the same key
 * is asked at `base` pace for the first `fastTries` tries (so a deadline still lands on the same tick as before), then
 * at a doubling delay up to `max`. Pure: the caller passes the clock, so it is unit-testable.
 */
export interface BackoffOptions {
  /** The delay between tries while the key is fresh (ms). */
  base: number;
  /** Tries at `base` pace before the delay starts doubling. */
  fastTries: number;
  /** The longest delay (ms). */
  max: number;
  /** A hidden tab never asks faster than this once past the fast tries (ms). */
  hiddenFloor?: number;
}

export interface KeyedBackoff {
  /** May the loop ask now about `key`? A new key is always ready. */
  ready(key: string, now: number, hidden?: boolean): boolean;
  /** The ask went out (call when `ready` said yes). */
  asked(key: string, now: number, hidden?: boolean): void;
  /** The current key's tries so far (tests). */
  tries(): number;
  /** Forget everything (a new session). */
  reset(): void;
}

export function keyedBackoff(o: BackoffOptions): KeyedBackoff {
  let key: string | null = null;
  let tries = 0;
  let nextAt = 0;
  const delayAfter = (n: number, hidden: boolean): number => {
    if (n <= o.fastTries) return o.base;
    const d = Math.min(o.max, o.base * 2 ** (n - o.fastTries));
    return hidden && o.hiddenFloor ? Math.max(d, o.hiddenFloor) : d;
  };
  return {
    ready(k, now) {
      if (k !== key) return true;
      return now >= nextAt;
    },
    asked(k, now, hidden = false) {
      if (k !== key) { key = k; tries = 0; }
      tries++;
      nextAt = now + delayAfter(tries, hidden);
    },
    tries: () => tries,
    reset() { key = null; tries = 0; nextAt = 0; },
  };
}

/** Is the page hidden (a background tab)? False where there is no document (tests). */
export const pageHidden = (): boolean => typeof document !== 'undefined' && document.visibilityState === 'hidden';
