/**
 * The app's board-strength wiring (R-LOBBY-09, 2026-09-30): one background scorer for the session, the rank band
 * the player draws opponents from, and the frozen numbers a finished game records.
 */
import { loadStrengthReference, strengthBandForDivision, type PlayerProfile, type StrengthBand } from '@game/sim';
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

/** The matchmaking band a RATED lobby draws from, by the player's medal (every medal has one since 2026-10-03). */
export function lobbyBandFor(profile: Pick<PlayerProfile, 'rank'> | null | undefined): StrengthBand | null {
  const division = profile?.rank?.position?.divisionIndex;
  return typeof division === 'number' ? strengthBandForDivision(division) : null;
}
