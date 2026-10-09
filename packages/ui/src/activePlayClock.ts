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
 * shown as-is up to this cap; past it the row prints "35+ min" (owner 2026-10-09: "lets just default any games
 * over 35 minutes to 35+ historically"). An old span can include hours the game sat open in the background, so
 * a number beyond the cap is not trusted, but "35+" still says the game was a long one.
 */
export const LEGACY_LENGTH_CAP_MS = 35 * 60_000;

/** A match length ready to print: `ms` (null = no number) and `overCap` (a legacy span past the cap → "35+"). */
export interface MatchLength {
  ms: number | null;
  overCap: boolean;
}

/**
 * The match length to PRINT:
 *  - the recorded ACTIVE time when the record has one (every run finished on or after 2026-10-09);
 *  - otherwise the legacy recording span while it is at most `LEGACY_LENGTH_CAP_MS`;
 *  - a longer legacy span → `{ ms: null, overCap: true }` ("35+ min"; never a number, so APM stays "—");
 *  - nothing usable → `{ ms: null, overCap: false }` ("—").
 */
export function matchLength(o: { activeMs?: number | null; spanMs?: number | null }): MatchLength {
  const a = o.activeMs;
  if (typeof a === 'number' && Number.isFinite(a) && a >= 0) return { ms: a, overCap: false };
  const span = o.spanMs;
  if (typeof span !== 'number' || !Number.isFinite(span) || span < 0) return { ms: null, overCap: false };
  return span <= LEGACY_LENGTH_CAP_MS ? { ms: span, overCap: false } : { ms: null, overCap: true };
}

/** `matchLength(o).ms` — for the readers that only want a number (APM, the replay summary). */
export function matchLengthMs(o: { activeMs?: number | null; spanMs?: number | null }): number | null {
  return matchLength(o).ms;
}

/** "36 min" for a Length cell; "<1 min" under a minute; "35+ min" for a legacy span past the cap; "—" when
 *  unknown. The one formatter every Length surface prints through. */
export function lengthText(durationMs: number | null, overCap = false): string {
  if (overCap) return `${Math.round(LEGACY_LENGTH_CAP_MS / 60_000)}+ min`;
  if (durationMs === null || durationMs < 0) return '—';
  const mins = Math.round(durationMs / 60_000);
  return mins < 1 ? '<1 min' : `${mins} min`;
}
