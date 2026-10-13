/**
 * The app's board-strength wiring (R-LOBBY-09, 2026-09-30): one background scorer for the session, the rank band
 * the player draws opponents from, and the frozen numbers a finished game records.
 */
import { loadStrengthReference, normalizePracticeRank, practiceStrengthBand, strengthBandForDivision, type LobbySeatOptions, type PlayerProfile, type PracticeConfig, type PracticeRank, type RunMode, type StrengthBand } from '@game/sim';
import { perfMonitor } from '../perfMonitor';
import { createStrengthScorer, STRENGTH_SLICE_TIMEOUT_MS, type StrengthScorer } from './strengthScorer';

export { createStrengthScorer } from './strengthScorer';

/** The longest the run-end uploads wait for the last board's score. Normally zero: the last board is scored during
 *  its own combat animation. A resumed game may have a few boards to catch up (~30-50 ms of idle-sliced work each). */
export const STRENGTH_RUN_END_WAIT_MS = 1500;

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
