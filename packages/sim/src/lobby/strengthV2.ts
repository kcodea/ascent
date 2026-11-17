import {
  STRENGTH_REF_VERSION, meanFromSum, percentileOf, rankAmongRuns, runWeightedAverageOf, type StrengthHistogramEntry,
} from './boardStrength';

/**
 * STRENGTH V2 RULES (owner design 2026-11-16, docs/superpowers/specs/2026-11-16-strength-v2-design.md).
 *
 * Pure definitions only, shared by the game, the SQL parity tests (`strengthV2.db.test.ts`: the database must rate
 * a pool exactly as `rateRunsV2` does) and the strength tools (`npm run strength -- measure --v2`).
 *
 *  - A run must reach round 7 (owner 2026-11-16: "we should never have any snapshots of boards that are below 7
 *    rounds"; on what happens to existing ones: "exclude them").
 *  - FIELDED ROUNDS: a recorded seat serves its final board once its recording has ended (repeatFinal), so a run
 *    is ranked at every round with the board it would really field: its own board, or its final board CARRIED.
 *  - EARLY is rounds 1-9, LATE is rounds 10-15, both over real and carried rounds, so every run has a LATE.
 *  - PEAK is the best REAL board from round 4 on (owner 2026-11-17: "best board should not include win rates for
 *    boards on rounds 1, 2, or 3"; it counted from round 3 for one day, when only rounds 1-2 were left out as too
 *    coarse to judge).
 */

/** The last round a run must reach to be in the pool at all. */
export const MIN_RUN_LAST_ROUND = 7;
/** The last round that counts for LATE (rounds 10..15). */
export const LATE_LAST_ROUND = 15;
/** The first round that counts for a run's peak. */
export const PEAK_FROM_ROUND = 4;
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

/** A run's PEAK: its highest board percentile from round 4 on (`PEAK_FROM_ROUND`). Pass REAL rounds only. Null with none. */
export function runPeakOf(realRounds: Iterable<RoundValue>): number | null {
  let peak: number | null = null;
  for (const r of realRounds) {
    if (!finite(r.value) || r.round < PEAK_FROM_ROUND) continue;
    const v = Math.round(r.value);
    if (peak === null || v > peak) peak = v;
  }
  return peak;
}

// ── Rating a pool (the definition the SQL is parity-tested against) ───────────────────────────────────────────

/** One fielded round of a run: its raw win rate there, and whether it is the final board carried forward. */
export interface RawRound { runKey: string; round: number; raw: number; carried: boolean }

export interface RunV2 {
  key: string;
  owner: string | null;
  rounds: { round: number; value: number; carried: boolean }[];
  /** EARLY (rounds 1-9) and LATE (10-15) over real and carried rounds, each ranked among the runs. */
  early: number | null;
  late: number | null;
  /** Game strength: the round-weighted average of REAL rounds, ranked among the runs. */
  strength: number | null;
  /** The best REAL board percentile from round 4 on. */
  peak: number | null;
}

/** A run's fielded rounds as raw scores. The first board of a round wins (a duplicate upload); an empty board is
 *  raw 0 and is never fought, real or carried. `score(boardWave, atRound)` fights the board recorded at
 *  `boardWave` against the reference of `atRound`. */
export function rawRoundsOfRun(
  run: { key: string; boards: readonly { wave: number; minions: number }[] }, lastRefRound: number,
  score: (boardWave: number, atRound: number) => number,
): RawRound[] {
  const minionsAt = new Map<number, number>();
  for (const b of run.boards) if (!minionsAt.has(b.wave)) minionsAt.set(b.wave, b.minions);
  return fieldedRoundsOf([...minionsAt.keys()], lastRefRound).map((f) => ({
    runKey: run.key, round: f.round, carried: f.carried,
    raw: (minionsAt.get(f.from) ?? 0) > 0 ? score(f.from, f.round) : 0,
  }));
}

/** Rank every round among the runs (one entry per run per round, ties half, 1..100), then rate each run.
 *  `bucketOf` maps a round to the reference round it was scored against: a round past the last reference
 *  round ranks AGAINST that last round's population without joining it, so every run still counts exactly once per
 *  round (a run that reached round 17 must not sit three times in round 15's population). */
export function rateRunsV2(raws: readonly RawRound[], owners: ReadonlyMap<string, string | null>, bucketOf: (round: number) => number = (r) => r): RunV2[] {
  const byRound = new Map<number, RawRound[]>();
  for (const r of raws) {
    const list = byRound.get(bucketOf(r.round)) ?? [];
    list.push(r);
    byRound.set(bucketOf(r.round), list);
  }
  const perRun = new Map<string, { round: number; value: number; carried: boolean }[]>();
  for (const list of byRound.values()) {
    const hist = new Map<number, number>();
    // The population is the round's OWN entries only; a later round sharing this reference round is a visitor.
    const member = (r: RawRound): boolean => r.round === bucketOf(r.round);
    for (const r of list) if (member(r)) hist.set(r.raw, (hist.get(r.raw) ?? 0) + 1);
    for (const r of list) {
      // The population without this board (when it is a member); `percentileOf` then counts it in (includeSelf).
      const others: StrengthHistogramEntry[] = [...hist].map(([raw, count]) => ({ raw, count: member(r) && raw === r.raw ? count - 1 : count }));
      const value = percentileOf(r.raw, others, true);
      if (value === null) continue;
      const rs = perRun.get(r.runKey) ?? [];
      rs.push({ round: r.round, value, carried: r.carried });
      perRun.set(r.runKey, rs);
    }
  }
  const base = [...perRun].map(([key, rs]) => {
    rs.sort((a, b) => a.round - b.round);
    const real = rs.filter((x) => !x.carried);
    return { key, rs, el: earlyLateV2Of(rs), avg: runWeightedAverageOf(real), peak: runPeakOf(real) };
  });
  const early = rankAmongRuns(base.map((b) => [b.key, b.el.early] as const));
  const late = rankAmongRuns(base.map((b) => [b.key, b.el.late] as const));
  const strength = rankAmongRuns(base.map((b) => [b.key, b.avg] as const));
  return base.map((b) => ({
    key: b.key, owner: owners.get(b.key) ?? null, rounds: b.rs,
    early: early.get(b.key) ?? null, late: late.get(b.key) ?? null, strength: strength.get(b.key) ?? null, peak: b.peak,
  }));
}

/**
 * Is a run SCORED under v2? Only when it is complete: every recorded round that has minions carries a score of the
 * current reference version, and its final board has a carried score for every round from its last round + 1 to
 * the last reference round. Anything less is an unscored run (never a low score): a run missing its strongest
 * board's score would otherwise slip under a cap. An empty board needs no score (it is raw 0).
 */
export function runCompleteV2(
  run: { realRounds: readonly { round: number; minions: number; ref: string | null }[]; carried: readonly number[] },
  lastRefRound: number,
): boolean {
  if (!run.realRounds.length) return false;
  if (run.realRounds.some((r) => r.minions > 0 && r.ref !== STRENGTH_REF_VERSION)) return false;
  const last = run.realRounds.reduce((m, r) => Math.max(m, r.round), 0);
  const have = new Set(run.carried);
  for (let round = last + 1; round <= lastRefRound; round++) if (!have.has(round)) return false;
  return true;
}
