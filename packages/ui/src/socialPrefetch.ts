import { careerFresh, loadCareer } from './careerLoad';
import { browserIdle, type IdleHandle } from './idleWork';
import { HALL_KEY, loadHall } from './Leaderboard';
import { RANKINGS_KEY, loadRankings } from './Rankings';
import { RECENT_RANKED_KEY, loadRecentRanked } from './RecentGames';
import { remoteEnabled, replayFactsState } from './remoteBoards';
import { loadSocial } from './socialCache';
import { useGame } from './store';

/**
 * SOCIAL PREFETCH (perf 2026-10-09). While the player sits on the title, the Social pages' reads are made on idle
 * time, so the first open of Social (and each sidebar hop) paints from the cache instead of a spinner. Every load is
 * the page's own loader through the shared caches, so a page opened mid-prefetch reuses the request in flight, and
 * an answer younger than the cache's freshness window is not asked again (coming back to the title does not
 * re-read everything).
 *
 * Kept light on the server: Recent Games is warmed only once the replay-facts columns are known to exist (the
 * Career's own probe finds out first). Without them that list makes Postgres open every listed replay, which is
 * work worth doing for a player who opens the page, not for every visit to the title.
 */

/** How long after the title settles before the prefetch is queued (the boot / page-close work goes first). */
const SETTLE_MS = 1200;
/** The longest the prefetch waits for an idle slot on a busy thread. */
const IDLE_TIMEOUT_MS = 4000;

export async function prefetchSocial(): Promise<void> {
  if (!remoteEnabled()) return;
  const s = useGame.getState();
  const tasks: Array<Promise<unknown>> = [];
  const userId = s.account.userId;
  if (userId) {
    const key = `${userId}|${s.careerVersion}`;
    if (!careerFresh(key)) tasks.push(loadCareer(key));
  }
  tasks.push(loadSocial(RANKINGS_KEY, loadRankings), loadSocial(HALL_KEY, loadHall));
  await Promise.allSettled(tasks);
  if (replayFactsState('run_telemetry') === true) await loadSocial(RECENT_RANKED_KEY, loadRecentRanked);
}

/** Queue `prefetchSocial` on idle time after the title settles. Returns a cancel (the title left first). */
export function schedulePrefetchSocial(): () => void {
  let idle: IdleHandle | null = null;
  const t = window.setTimeout(() => { idle = browserIdle.schedule(() => { void prefetchSocial(); }, IDLE_TIMEOUT_MS); }, SETTLE_MS);
  return () => { window.clearTimeout(t); idle?.cancel(); };
}
