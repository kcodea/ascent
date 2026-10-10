import type { CareerRun } from './careerData';
import { fetchMyRuns } from './remoteBoards';
import { useGame } from './store';

/**
 * CAREER LOAD (perf 2026-10-09, owner: "our social tab takes forever to load and is also laggy").
 *
 * Social opens the Career page, and the Career used to wait for ALL of its reads before painting a single row,
 * including the run_telemetry probe that took 0.6-3.3 s (sometimes a statement timeout, then a retry) to add the
 * Watch buttons. Measured cold open on the prod build: the shell at ~50 ms, the rows only at ~3.3-4.4 s. Now:
 *
 *  - PROGRESSIVE: `fetchMyRuns` hands the run_history rows over the moment they land (~0.25 s), and the page paints
 *    them; the telemetry join (Watch, run length, the APM line) lands behind them.
 *  - SHARED: one request per career key at a time, so the title's idle prefetch (`socialPrefetch.ts`) already in
 *    flight when Social opens is reused, never doubled.
 *  - CACHED: the finished rows go to the store's `careerCache` (as before) with the time they were read, so a reopen
 *    inside `CAREER_FRESH_MS` paints them and asks nothing, and an older or previous-version answer for the same player
 *    paints at once while the refresh runs.
 *
 * `key` is the Career's cache key (`userId|careerVersion`).
 */

/** Rows fetched light (scalars only) for the trends, the tiles and the Heroes tab — effectively every run the
 *  account has (a light row is ~200 bytes); the newest `CAREER_DETAIL_ROWS` of them also carry the board. The
 *  trends' "All time" window is therefore, precisely, the newest 1000 runs — honest today by a wide margin. */
export const CAREER_FETCH_LIMIT = 1000;
/** A cached career younger than this is shown without asking the server again. */
export const CAREER_FRESH_MS = 60_000;

interface Flight { promise: Promise<CareerRun[] | null>; partial: CareerRun[] | null; waiters: Set<(runs: CareerRun[]) => void> }
const flights = new Map<string, Flight>();
const readAt = new Map<string, number>();

/** The user id a career cache key belongs to. */
export const careerKeyUser = (key: string): string => key.slice(0, key.lastIndexOf('|'));

/** Is the cached answer for `key` young enough to show without a refetch? */
export function careerFresh(key: string): boolean {
  const at = readAt.get(key);
  const cache = useGame.getState().careerCache;
  return at !== undefined && !!cache && cache.key === key && Date.now() - at < CAREER_FRESH_MS;
}

/**
 * Load a career: one shared request per key. `onHistory` gets the run_history rows as soon as they land (before the
 * telemetry join); a caller that joins a flight already past that point gets them at once. Resolves with the joined
 * rows (null = couldn't ask), which are also written to the store's `careerCache`.
 */
export function loadCareer(key: string, opts: { userId?: string; onHistory?: (runs: CareerRun[]) => void } = {}): Promise<CareerRun[] | null> {
  let flight = flights.get(key);
  if (!flight) {
    const f: Flight = { promise: Promise.resolve(null), partial: null, waiters: new Set() };
    f.promise = fetchMyRuns(CAREER_FETCH_LIMIT, {
      ...(opts.userId ? { userId: opts.userId } : {}),
      onHistory: (runs) => { f.partial = runs; for (const w of f.waiters) w(runs); },
    }).then((rows) => {
      if (rows) { readAt.set(key, Date.now()); useGame.getState().setCareerCache(key, rows); }
      return rows;
    }).finally(() => { flights.delete(key); });
    flights.set(key, f);
    flight = f;
  }
  const onHistory = opts.onHistory;
  if (onHistory) {
    if (flight.partial) onHistory(flight.partial);
    else {
      flight.waiters.add(onHistory);
      void flight.promise.finally(() => flight!.waiters.delete(onHistory));
    }
  }
  return flight.promise;
}

/**
 * Carry the telemetry facts (Watch handle, length) of an older answer onto freshly read history rows that do not have
 * them yet, by run id, so a background refresh never blinks every Watch button off while its own probe is in flight.
 */
export function carryTelemetry(fresh: CareerRun[], prev: readonly CareerRun[] | null | undefined): CareerRun[] {
  if (!prev || prev.length === 0) return fresh;
  const byId = new Map<number, CareerRun>();
  for (const r of prev) if (r.id !== null) byId.set(r.id, r);
  return fresh.map((r) => {
    const p = r.id !== null ? byId.get(r.id) : undefined;
    if (!p || r.replayRowId !== null) return r;
    return { ...r, replayRowId: p.replayRowId, durationMs: r.durationMs ?? p.durationMs, lengthOverCap: p.lengthOverCap, placement: r.placement ?? p.placement };
  });
}

/** Tests: forget the read times and any flight. */
export function resetCareerLoadForTests(): void { flights.clear(); readAt.clear(); }
