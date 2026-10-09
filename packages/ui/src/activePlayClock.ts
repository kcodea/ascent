/**
 * ACTIVE PLAY TIME (owner bug 2026-10-09, R-MATCH-LENGTH-01): "it should not count time outside of the game,
 * it should only count time while a player is actually in a game."
 *
 * A match's LENGTH used to be the replay recording's clock span (last frame − first frame). That clock adds the
 * real time between two actions with no ceiling, so a player who left a shop open for three hours came back to
 * a "246 min" game. This clock counts only the time the player is actually IN the game:
 *
 *  - the tab is visible AND the window has focus (Page Visibility + focus/blur),
 *  - a run is in progress and on screen (not the title/menus, not a replay, not the end screen),
 *  - and no single step counts for more than `ACTIVE_GAP_CAP_MS`. The owner of the clock ticks it on a short
 *    heartbeat while live, so a longer step can only mean the machine slept, the tab was frozen or throttled,
 *    or the process was suspended — none of which is play.
 *
 * Time the app was CLOSED never counts: the total rides in the save (`ascent.save`'s `activeMs`) and a resume
 * restores it with the clock paused, so the closed hours are simply never observed.
 *
 * Pure: no DOM, no clock of its own — the caller passes `now` (performance.now in the store, numbers in tests).
 * Wall-clock is a PRESENTATION fact; nothing here ever reaches `@game/core` / `@game/sim` or the RNG, so it
 * cannot affect simulation, snapshots or replay determinism.
 */

/** The longest single step the clock will ever count. The store's heartbeat (`ACTIVE_HEARTBEAT_MS`) is well
 *  inside it, so a real, live gap is never clipped; only a stall (sleep, suspend, a frozen tab) is. */
export const ACTIVE_GAP_CAP_MS = 60_000;
/** How often the store samples the clock while the app is open. */
export const ACTIVE_HEARTBEAT_MS = 15_000;

export interface ActivePlayClock {
  /** A new run: zero, known, and counting from `now` when `live`. */
  reset(now: number, live: boolean): void;
  /** A resumed run: continue from a saved total (null/undefined = an older save that never recorded one, so
   *  this run's active length is UNKNOWN and `total()` reports null for it). Starts PAUSED until the next tick. */
  restore(savedMs: number | null | undefined): void;
  /** Sample: count the step since the last sample (capped) if the clock was live, then adopt `live`. */
  tick(now: number, live: boolean): void;
  /** The accumulated active ms up to `now` (counting the open step, capped), or null when unknown. Read-only. */
  read(now: number): number | null;
  /** The run ended: fold the open step in, stop counting for good (until the next `reset`), return the total. */
  freeze(now: number): number | null;
}

export function createActivePlayClock(): ActivePlayClock {
  let total = 0;
  let known = false;
  let frozen = false;
  /** The time of the last sample while live; null while paused. */
  let liveSince: number | null = null;

  const step = (now: number): number => (liveSince === null ? 0 : Math.min(ACTIVE_GAP_CAP_MS, Math.max(0, now - liveSince)));

  return {
    reset(now, live) {
      total = 0;
      known = true;
      frozen = false;
      liveSince = live ? now : null;
    },
    restore(savedMs) {
      const ok = typeof savedMs === 'number' && Number.isFinite(savedMs) && savedMs >= 0;
      total = ok ? savedMs : 0;
      known = ok;
      frozen = false;
      liveSince = null; // the time since the save was written (the app closed) is never observed
    },
    tick(now, live) {
      if (frozen) return;
      total += step(now);
      liveSince = live ? now : null;
    },
    read(now) {
      if (!known) return null;
      return Math.round(total + (frozen ? 0 : step(now)));
    },
    freeze(now) {
      if (!frozen) { total += step(now); frozen = true; liveSince = null; }
      return known ? Math.round(total) : null;
    },
  };
}

/** Is the app on screen and in front of the player right now? Visibility AND focus (a minimised window, a
 *  background tab, or another app in front all pause the clock). Defaults to true outside a browser. */
export function documentIsActive(): boolean {
  if (typeof document === 'undefined') return true;
  if (document.visibilityState === 'hidden') return false;
  return typeof document.hasFocus === 'function' ? document.hasFocus() : true;
}

// ── Reading a stored length (every surface that prints "Length") ─────────────────────────────────────────

/**
 * A LEGACY length (a record from before the active clock: only the recording's wall-clock span exists) is
 * shown only while it is believable — at most this many ms per round played. A real round (shop turn + fight)
 * runs about two minutes, so five is generous; a span past it necessarily includes time away from the game,
 * and the row prints "—" instead of a number we know is wrong.
 */
export const LEGACY_MAX_MS_PER_ROUND = 5 * 60_000;

/**
 * The match length to PRINT, in ms, or null ("—"):
 *  - the recorded ACTIVE time when the record has one (every run finished on or after 2026-10-09);
 *  - otherwise the legacy recording span, but only when it is plausible for the rounds played;
 *  - null when neither is usable (no span, no round count to judge it by, or an implausible span).
 */
export function matchLengthMs(o: { activeMs?: number | null; spanMs?: number | null; rounds?: number | null }): number | null {
  const a = o.activeMs;
  if (typeof a === 'number' && Number.isFinite(a) && a >= 0) return a;
  const span = o.spanMs;
  if (typeof span !== 'number' || !Number.isFinite(span) || span < 0) return null;
  const rounds = o.rounds;
  if (typeof rounds !== 'number' || !Number.isFinite(rounds) || rounds <= 0) return null;
  return span <= rounds * LEGACY_MAX_MS_PER_ROUND ? span : null;
}
