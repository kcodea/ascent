import { useEffect, useState } from 'react';
import { HALL_MIN_FIGHTS, HALL_ROWS, fetchHallRecords, remoteEnabled } from '../remoteBoards';

/**
 * THE HALL OF CHAMPIONS CROWN in Match details (owner ask 2026-09-28: "add a little crown emblem on the match
 * details screen if any of these boards is currently a hall of champions board").
 *
 * "Currently on the Hall" = the run key is in the Hall screen's own read (`fetchHallRecords(HALL_ROWS,
 * HALL_MIN_FIGHTS)`: the top runs of the `run_fight_records` view). ONE read, shared by every panel and cached for the
 * session once it answers; a failed or empty answer is not cached, so the next panel open asks again (at most one
 * read per open, never one per render). Offline or failing: an empty set, so no crown and no error.
 */
let cached: ReadonlySet<string> | null = null;
let inflight: Promise<ReadonlySet<string>> | null = null;
const EMPTY: ReadonlySet<string> = new Set();

export function loadHallKeys(): Promise<ReadonlySet<string>> {
  if (cached) return Promise.resolve(cached);
  if (!remoteEnabled()) return Promise.resolve(EMPTY);
  inflight ??= Promise.resolve().then(() => fetchHallRecords(HALL_ROWS, HALL_MIN_FIGHTS))
    .then((recs) => {
      if (!Array.isArray(recs)) return EMPTY;
      const keys = new Set(recs.map((r) => r.runKey));
      if (keys.size > 0) cached = keys;
      return keys as ReadonlySet<string>;
    })
    .catch(() => EMPTY)
    .finally(() => { inflight = null; });
  return inflight;
}

/** The Hall's run keys for a mounted panel: empty until the read answers (the panel never waits for it). `wanted` =
 *  the panel holds at least one seat with a run key (a bot-only table asks nothing). */
export function useHallKeys(wanted: boolean): ReadonlySet<string> {
  const [keys, setKeys] = useState<ReadonlySet<string>>(() => cached ?? EMPTY);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    void loadHallKeys().then((k) => { if (live) setKeys(k); });
    return () => { live = false; };
  }, [wanted]);
  return keys;
}

/** Test seam: forget the session cache. */
export function resetHallKeysForTests(): void { cached = null; inflight = null; }
