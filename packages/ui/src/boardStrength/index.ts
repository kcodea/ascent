/**
 * The app's board-strength wiring (R-LOBBY-09, 2026-09-30): one background scorer for the session, the rank band
 * the player draws opponents from, and the frozen numbers a finished game records.
 */
import { STRENGTH_REF_LAST_ROUND, STRENGTH_REF_VERSION, loadStrengthReference, runLongEnough, type RunState, normalizePracticeRank, practiceStrengthBand, strengthBandForDivision, type LobbySeatOptions, type PlayerProfile, type PracticeConfig, type PracticeRank, type RunMode, type StrengthBand } from '@game/sim';
import { perfMonitor } from '../perfMonitor';
import { createStrengthScorer, STRENGTH_SLICE_TIMEOUT_MS, type StrengthScorer } from './strengthScorer';

export { createStrengthScorer } from './strengthScorer';

/** The longest the run-end uploads (and the end screen's "Calculating Score" lock) wait for the run's scores: its
 *  boards and, since strength v2 (2026-11-16), its final board's carried rounds, at most 8 x 160 fights. Owner
 *  2026-11-16: Continue is greyed out while this runs, and the design's safety limit is 5 seconds: after it the run
 *  goes up with what is ready (an incomplete run is unscored) and Continue unlocks. It must never stay locked. */
export const STRENGTH_RUN_END_WAIT_MS = 5000;

/**
 * Is this finished game SCORED IN FULL before it uploads (strength v2, owner 2026-11-16)? A lobby game (rated, or
 * unrated because no recorded player sat at the table: its boards go to the pool either way) that reached round 7,
 * the floor for a run to ever be an opponent. Its final board is then scored against every later reference round, and
 * the end screen holds Continue behind "Calculating Score" until that is done. Practice, the tutorial, Gauntlet,
 * Versus, a sandbox run and a game that ended before round 7 are never held.
 */
export function shouldScoreRunEnd(run: Pick<RunState, 'mode' | 'sandbox'>, boards: readonly { wave: number }[] | null | undefined): boolean {
  if (run.mode !== 'lobby' || run.sandbox || !boards?.length) return false;
  return runLongEnough(boards.reduce((m, b) => Math.max(m, b.wave), 0));
}

/** The run's final captured board (the first one of its highest round), or null. */
export function finalBoardOf<T extends { wave: number }>(boards: readonly T[] | null | undefined): T | null {
  let best: T | null = null;
  for (const b of boards ?? []) if (!best || b.wave > best.wave) best = b;
  return best;
}

/** What rides on the final board's row: its carried scores, ONLY when every round from its own + 1 to the last
 *  reference round is there (an incomplete map would make the run look complete to nobody: the SQL treats a run with
 *  a missing round as unscored either way, so send nothing). */
export function carriedUploadOf(lastWave: number, carried: ReadonlyMap<number, number>): { ref: string; rounds: Record<string, number> } | null {
  const rounds: Record<string, number> = {};
  for (let round = lastWave + 1; round <= STRENGTH_REF_LAST_ROUND; round++) {
    const raw = carried.get(round);
    if (typeof raw !== 'number') return null;
    rounds[String(round)] = raw;
  }
  return { ref: STRENGTH_REF_VERSION, rounds };
}

let scorer: StrengthScorer | null = null;

/** The session scorer (idle slices via requestIdleCallback; a timer fallback where there is none). */
export function boardStrengthScorer(): StrengthScorer {
  scorer ??= createStrengthScorer({
    loadReference: loadStrengthReference,
    requestSlice: (fn) => {
      if (typeof requestIdleCallback === 'function') {
        const id = requestIdleCallback((d) => fn(d), { timeout: STRENGTH_SLICE_TIMEOUT_MS });
        return () => cancelIdleCallback(id);
      }
      const t = setTimeout(() => fn(), 32);
      return () => clearTimeout(t);
    },
    // A zero timer, not requestAnimationFrame: it yields to rendering between slices and keeps working (slowly) in a
    // hidden tab, where rAF stops and the run would otherwise go up unscored.
    requestRush: (fn) => { const t = setTimeout(fn, 0); return () => clearTimeout(t); },
    setTimer: (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); },
    measure: (label, fn) => perfMonitor.measure(label, fn),
  });
  return scorer;
}

/** The matchmaking band a RATED lobby draws from, by the player's medal (Platinum: none). */
export function lobbyBandFor(profile: Pick<PlayerProfile, 'rank'> | null | undefined): StrengthBand | null {
  const division = profile?.rank?.position?.divisionIndex;
  return typeof division === 'number' ? strengthBandForDivision(division) : null;
}

/** What the launch seams read off the store: the mode a hero picker is open for, its Practice setup, the profile. */
export interface LaunchBandState {
  pendingMode: RunMode;
  heroChoices: readonly string[] | null;
  practiceDraft: Pick<PracticeConfig, 'rank' | 'godMode'>;
  profile: Pick<PlayerProfile, 'rank'> | null | undefined;
}

/** The Practice game an open hero picker is about to start: its Opponent Rank (R-PRACTICE-RANK-01). Null when no such
 *  game is pending: no picker open, another mode, or God Mode (which ignores the Sandbox options and keeps the pool
 *  on hand). */
export function pendingPracticeRank(s: Pick<LaunchBandState, 'pendingMode' | 'heroChoices' | 'practiceDraft'>): PracticeRank | null {
  if (s.pendingMode !== 'practice' || !s.heroChoices || s.practiceDraft.godMode === true) return null;
  return normalizePracticeRank(s.practiceDraft.rank);
}

/** The band the opponent pool is sampled for NOW: the Opponent Rank of the Practice game about to start, else the
 *  band of the player's own medal (a rated lobby, and every moment nothing is being launched). */
export function poolBandFor(s: LaunchBandState): StrengthBand | null {
  const rank = pendingPracticeRank(s);
  return rank !== null ? practiceStrengthBand(rank) : lobbyBandFor(s.profile);
}

/** Seat selection for a table of `band`: runs this session fetched only for another rank are not candidates
 *  (`LobbySeatOptions.excludeRuns`, see `PoolLoader.foreignRuns`). */
export function seatExclusionsFor(band: StrengthBand | null, loader: { foreignRuns(band: StrengthBand | null): Set<string> } | null | undefined): Pick<LobbySeatOptions, 'excludeRuns'> {
  const foreign = loader?.foreignRuns(band);
  return foreign && foreign.size > 0 ? { excludeRuns: foreign } : {};
}
