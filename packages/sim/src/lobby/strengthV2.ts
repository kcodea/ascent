import { meanFromSum } from './boardStrength';

/**
 * STRENGTH V2 RULES (owner design 2026-11-16, docs/superpowers/specs/2026-11-16-strength-v2-design.md).
 *
 * Pure definitions only. NOTHING IN THE GAME CALLS THIS MODULE YET: today it is read by the strength tools
 * (`npm run strength -- measure --v2`), so the measurement and the later game change share one definition. The
 * live rules are still `boardStrength.ts` / `strengthBands.ts` (R-LOBBY-09, -12, -13, -15).
 *
 *  - A run must reach round 7 (owner 2026-11-16: "we should never have any snapshots of boards that are below 7
 *    rounds"; on what happens to existing ones: "exclude them").
 *  - FIELDED ROUNDS: a recorded seat serves its final board once its recording has ended (repeatFinal), so a run
 *    is ranked at every round with the board it would really field: its own board, or its final board CARRIED.
 *  - EARLY is rounds 1-9, LATE is rounds 10-15, both over real and carried rounds, so every run has a LATE.
 *  - PEAK is the best REAL board from round 3 on (rounds 1-2 are one or two minions, too coarse to judge).
 */

/** The last round a run must reach to be in the pool at all. */
export const MIN_RUN_LAST_ROUND = 7;
/** The last round that counts for LATE (rounds 10..15). */
export const LATE_LAST_ROUND = 15;
/** The first round that counts for a run's peak. */
export const PEAK_FROM_ROUND = 3;
const EARLY_LAST = 9;

/** Does a run whose recording ends on `lastRound` belong in the pool? */
export const runLongEnough = (lastRound: number): boolean => lastRound >= MIN_RUN_LAST_ROUND;

/** One round a run fields: `from` is the recorded round whose board is served (`round` itself when real). */
export interface FieldedRound { round: number; from: number; carried: boolean }

/** Every round a run fields up to the last reference round: its distinct recorded rounds, then its final board
 *  carried to each later round. A run that outlasts the reference carries nothing. */
export function fieldedRoundsOf(realRounds: readonly number[], lastRefRound: number): FieldedRound[] {
  const real = [...new Set(realRounds)].sort((a, b) => a - b);
  if (!real.length) return [];
  const out: FieldedRound[] = real.map((round) => ({ round, from: round, carried: false }));
  const last = real[real.length - 1]!;
  for (let round = last + 1; round <= lastRefRound; round++) out.push({ round, from: last, carried: true });
  return out;
}

type RoundValue = { round: number; value: number | null | undefined };
const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** EARLY (rounds 1-9) and LATE (rounds 10-15) means of board percentiles, rounded half up like every run average.
 *  Pass real AND carried rounds. A round past 15 counts for neither. */
export function earlyLateV2Of(rounds: Iterable<RoundValue>): { early: number | null; late: number | null } {
  let es = 0; let en = 0; let ls = 0; let ln = 0;
  for (const r of rounds) {
    if (!finite(r.value)) continue;
    const v = Math.round(r.value);
    if (r.round <= EARLY_LAST) { es += v; en++; } else if (r.round <= LATE_LAST_ROUND) { ls += v; ln++; }
  }
  return { early: meanFromSum(es, en), late: meanFromSum(ls, ln) };
}

/** A run's PEAK: its highest board percentile from round 3 on. Pass REAL rounds only. Null with none. */
export function runPeakOf(realRounds: Iterable<RoundValue>): number | null {
  let peak: number | null = null;
  for (const r of realRounds) {
    if (!finite(r.value) || r.round < PEAK_FROM_ROUND) continue;
    const v = Math.round(r.value);
    if (peak === null || v > peak) peak = v;
  }
  return peak;
}
