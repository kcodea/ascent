/**
 * THE LIVE DIRECTORY'S ACTIVITY TALLY (R-OPS-HEALTH-01): how many NEW games were listed each UTC hour, by kind. The daily
 * health check reads it as "were games played?" and then demands the matching end-of-game rows in Supabase (a day with
 * lobby games listed and no `run_history` rows means the writes stopped arriving).
 *
 * Counts only: no player, no game id. One small value per hour (`act:<hour>` in the directory's storage), written only
 * when a game is listed for the first time, never on its keep-alive. Pure: the clock is handed in.
 */
import { ACTIVITY_KEEP_HOURS, emptyHour, hourKey, type ActivityHour, type HubActivity } from '../health/healthProtocol';
import type { LiveDirPut } from '../liveDirProtocol';

export const ACTIVITY_PREFIX = 'act:';

/** Which tally a listing counts in. */
export function activityKind(p: Pick<LiveDirPut, 'mode'>): Exclude<keyof ActivityHour, 'revs'> {
  switch (p.mode) {
    case null: return 'lobby';
    case 'casual': return 'casual';
    case 'practice': return 'practice';
    case 'duos': case 'ranked_duos': return 'duos';
    default: return 'versus';
  }
}

export class ActivityTally {
  readonly hours = new Map<string, ActivityHour>();

  /** A game listed for the first time: returns the hour key whose value changed (to persist). */
  note(p: Pick<LiveDirPut, 'mode' | 'live_host'>, now: number): string {
    const key = hourKey(now);
    const h = this.hours.get(key) ?? emptyHour();
    h[activityKind(p)] += 1;
    if (p.mode === null && typeof p.live_host === 'string' && /^cf:[0-9a-z]{1,40}$/.test(p.live_host)) {
      const rev = p.live_host.slice(3);
      h.revs[rev] = (h.revs[rev] ?? 0) + 1;
      // Bounded: a runaway writer can never grow one hour's value without limit.
      const keys = Object.keys(h.revs);
      if (keys.length > 16) delete h.revs[keys[0]!];
    }
    this.hours.set(key, h);
    return key;
  }

  /** Hours older than the keep window (to delete). */
  prune(now: number): string[] {
    const oldest = hourKey(now - (ACTIVITY_KEEP_HOURS - 1) * 3_600_000);
    const gone = [...this.hours.keys()].filter((k) => k < oldest);
    for (const k of gone) this.hours.delete(k);
    return gone;
  }

  snapshot(now: number): HubActivity {
    this.prune(now);
    return { hours: Object.fromEntries([...this.hours.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) };
  }
}

/** Sum of the hours at or after `sinceMs`, plus the most recent lobby revision seen (the live build's engine). */
export function activitySince(a: HubActivity, sinceMs: number): ActivityHour & { latestRev: string | null } {
  const since = hourKey(sinceMs);
  const sum = emptyHour();
  let latestRev: string | null = null;
  for (const [k, h] of Object.entries(a.hours).sort(([x], [y]) => (x < y ? -1 : 1))) {
    if (k < since) continue;
    sum.lobby += h.lobby; sum.casual += h.casual; sum.practice += h.practice; sum.versus += h.versus; sum.duos += h.duos;
    let best: [string, number] | null = null;
    for (const [rev, n] of Object.entries(h.revs ?? {})) {
      sum.revs[rev] = (sum.revs[rev] ?? 0) + n;
      if (!best || n > best[1]) best = [rev, n];
    }
    if (best) latestRev = best[0];
  }
  return { ...sum, latestRev };
}
