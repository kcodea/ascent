/**
 * Strength against real results (strength v2 design 2026-11-16, section 6.E): does a higher board percentile
 * really win more often? Pure functions over `lobby_fights` rows; read-only, and no runtime behaviour reads it.
 */
import { LATE_LAST_ROUND } from '@game/sim';

/** One `lobby_fights` row (the columns the report reads). `outcome` is from side A. */
export interface FightRow { round: number; run_a: string; run_b: string; outcome: 'a' | 'b' | 'draw' }
/** A fight whose two boards both have a percentile at that round. */
export interface RatedFight { round: number; a: string; b: string; pa: number; pb: number; outcome: 'a' | 'b' | 'draw' }

const isGenerated = (key: string): boolean => key.startsWith('bot:');

/** Attach each side's board percentile at the fight's round. Skipped and counted: a fight with a generated seat, a
 *  fight with a run that was not measured at all (outside the live window), and a fight between measured runs at
 *  a round one of them has no percentile for. */
export function rateFights(
  fights: readonly FightRow[], percentileAt: (runKey: string, round: number) => number | null,
  isMeasured: (runKey: string) => boolean,
): { rated: RatedFight[]; skipped: { generated: number; runNotMeasured: number; roundNotMeasured: number } } {
  const rated: RatedFight[] = [];
  const skipped = { generated: 0, runNotMeasured: 0, roundNotMeasured: 0 };
  for (const f of fights) {
    if (isGenerated(f.run_a) || isGenerated(f.run_b)) { skipped.generated++; continue; }
    if (!isMeasured(f.run_a) || !isMeasured(f.run_b)) { skipped.runNotMeasured++; continue; }
    const pa = percentileAt(f.run_a, f.round);
    const pb = percentileAt(f.run_b, f.round);
    if (pa === null || pb === null) { skipped.roundNotMeasured++; continue; }
    rated.push({ round: f.round, a: f.run_a, b: f.run_b, pa, pb, outcome: f.outcome });
  }
  return { rated, skipped };
}

/** How often the higher-percentile board won, by the size of the gap (10-point buckets, a draw is half a win).
 *  Fights between equal percentiles are left out. Only buckets with fights are returned, ascending. */
export function gapCalibration(fights: readonly RatedFight[]): { bucket: string; fights: number; strongerWinRate: number }[] {
  const n = Array<number>(10).fill(0);
  const pts = Array<number>(10).fill(0);
  for (const f of fights) {
    const gap = Math.abs(f.pa - f.pb);
    if (gap === 0) continue;
    const i = Math.min(9, Math.floor(gap / 10));
    const strongerIsA = f.pa > f.pb;
    n[i]!++;
    pts[i]! += f.outcome === 'draw' ? 0.5 : (f.outcome === 'a') === strongerIsA ? 1 : 0;
  }
  return n.map((count, i) => ({ bucket: `${i * 10}-${i * 10 + 10}`, fights: count, strongerWinRate: count ? pts[i]! / count : 0 }))
    .filter((r) => r.fights > 0);
}

export interface HalfRecord { fights: number; points: number }

/** Each run's real record, split like the ratings: rounds 1-9 (early) and 10-15 (late). A draw is half a point;
 *  later rounds count for neither. */
export function runRecords(fights: readonly RatedFight[]): Map<string, { early: HalfRecord; late: HalfRecord }> {
  const out = new Map<string, { early: HalfRecord; late: HalfRecord }>();
  const add = (key: string, round: number, points: number): void => {
    if (round > LATE_LAST_ROUND) return;
    const rec = out.get(key) ?? { early: { fights: 0, points: 0 }, late: { fights: 0, points: 0 } };
    const half = round <= 9 ? rec.early : rec.late;
    half.fights++;
    half.points += points;
    out.set(key, rec);
  };
  for (const f of fights) {
    const pa = f.outcome === 'draw' ? 0.5 : f.outcome === 'a' ? 1 : 0;
    add(f.a, f.round, pa);
    add(f.b, f.round, 1 - pa);
  }
  return out;
}
