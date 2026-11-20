/**
 * MID-GAME ACHIEVEMENT UNLOCKS (owner ask 2026-11-20: "can we add something mid-game when it unlocks? so it shows when
 * you get achievements done mid game etc? this should prob span all achievements where possible").
 *
 * Which achievements a game in progress has ALREADY earned, so the client can announce them the moment they happen.
 * A forecast for presentation only: the server (`settle_progression`) stays the one authority and grants nothing
 * until the game settles. This file never decides a grant; it reuses `evaluateAchievements` / `achievementGatePasses`
 * so the rules cannot drift from the settlement's.
 *
 * WHAT CAN BE KNOWN MID-GAME. Only achievements that read a RUN metric whose value can only grow while the game goes
 * on (a per-turn or per-combat best, a lifetime counter for this game, a flag that never clears). Left out, because
 * only the finished game knows them:
 *   - a placement gate (Top 4, 1st);
 *   - server metrics (the game itself, the comeback bonus, rank, distinct heroes, streaks, completions so far);
 *   - the collection metric;
 *   - the END-STATE run metrics below (the final board, the last combat, "held at the end", "never lost a combat").
 * A lifetime (`sum`) achievement needs the account's stored progress; without it (`progress: null`) it is skipped.
 * Those all surface when the settlement answers instead (the client's end-of-game announcement).
 *
 * Pure and deterministic: no clock, no I/O.
 */
import {
  ACHIEVEMENTS, COLLECTION_METRIC, RUN_METRICS, evaluateAchievements, sanitizeRunMetrics,
  type AchievementDef, type AchievementProgressRow, type RunMetric,
} from './achievements';
import type { ProgressionMode } from './rules';

/** Run metrics only the FINISHED game knows (read off the final state, or able to go back down / clear). */
export const END_STATE_RUN_METRICS: ReadonlySet<RunMetric> = new Set<RunMetric>([
  'finalTribes', 'finalKobolds', 'finalDwarves', 'finalDragons', 'finalBeasts', 'finalDemons', 'finalDemonStatsMax',
  'finalCombatEchoes', 'menagerieRuneFinalTribes', 'tribalRunePair', 'undefeated',
]);

const isRunMetric = (m: string): m is RunMetric => Object.prototype.hasOwnProperty.call(RUN_METRICS, m);

/** Can this achievement complete while the game is still going (before its settlement)? */
export function achievementKnowableMidRun(d: Pick<AchievementDef, 'metric' | 'placementMax' | 'mode'>): boolean {
  if (d.placementMax !== null) return false;
  if (d.mode === 'account' || d.mode === 'tutorial') return false;
  if (d.metric === COLLECTION_METRIC || !isRunMetric(d.metric)) return false;
  return !END_STATE_RUN_METRICS.has(d.metric);
}

/** The game in progress, as its settlement will see it. */
export interface MidRunAchievementContext {
  mode: ProgressionMode;
  /** Ranked, or a standard Practice (Normal Health AND a turn timer): the `any` gate. */
  eligibleRun: boolean;
  setId: string | null;
  /** The hero played. Only a Ranked game counts toward a hero (the settlement reads the hero for Ranked only). */
  heroId: string | null;
}

/** What the account had before this game (the client's last read of it). */
export interface AchievementBaseline {
  /** Ids already completed. */
  completed: readonly string[];
  /** Stored progress by id; null = not known (lifetime `sum` achievements are then skipped). */
  progress: Readonly<Record<string, number>> | null;
  /** Ids the server switched off. */
  retired?: readonly string[];
}

/**
 * The achievements this game has already earned, by id, in the settlement's evaluation order, leaving out any in
 * `alreadyShown` (so each is announced once). `metrics` = the run observer's metrics right now (sanitized here, like
 * the server does). Never an id already completed, retired, gated out, or only knowable at the end.
 */
export function midRunUnlockedAchievements(
  metrics: Readonly<Partial<Record<string, number>>>,
  ctx: MidRunAchievementContext,
  baseline: AchievementBaseline,
  alreadyShown: Iterable<string> = [],
  defs: readonly AchievementDef[] = ACHIEVEMENTS,
): string[] {
  const done = new Set(baseline.completed);
  const skip = new Set<string>([...(baseline.retired ?? []), ...alreadyShown]);
  const candidates = defs.filter((d) => achievementKnowableMidRun(d) && !done.has(d.id) && !skip.has(d.id)
    && (d.agg !== 'sum' || baseline.progress !== null));
  if (candidates.length === 0) return [];
  const clean = sanitizeRunMetrics(metrics);
  for (const k of END_STATE_RUN_METRICS) delete clean[k];
  const prior: Record<string, AchievementProgressRow> = {};
  for (const d of candidates) {
    const p = baseline.progress?.[d.id];
    if (typeof p === 'number' && Number.isFinite(p) && p > 0) prior[d.id] = { progress: p, completed: false };
  }
  return evaluateAchievements(candidates, {
    mode: ctx.mode,
    eligibleRun: ctx.eligibleRun,
    setId: ctx.setId,
    heroId: ctx.mode === 'ranked' ? ctx.heroId : null,
    placement: null,
    metrics: clean as Record<string, number>,
  }, prior).completed;
}
