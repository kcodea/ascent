/**
 * The v2 measurement, as pure functions (strength v2 design 2026-11-16, sections 6.B, 6.C and the drift alarm of
 * 6.A). The CLI (`cliV2.ts`) feeds them raw win rates; nothing here touches the pool or the network.
 */
import {
  fieldedRoundsOf, earlyLateV2Of, runPeakOf, percentileOf, runWeightedAverageOf, rankAmongRuns, runInStrengthBand,
  MAX_SEATS_PER_PLAYER, type StrengthBand, type StrengthHistogramEntry,
} from '@game/sim';

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
  /** The best REAL board percentile from round 3 on. */
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

/** The drift alarm: a round's reference is outgrown when the median board beats it more than 60% of the time or the
 *  90th percentile more than 92%. */
export function driftOf(raws: readonly number[]): { median: number; p90: number; rebaseline: boolean } {
  const a = [...raws].sort((x, y) => x - y);
  if (!a.length) return { median: 0, p90: 0, rebaseline: false };
  const median = a[Math.floor(a.length / 2)]!;
  const p90 = a[Math.min(a.length - 1, Math.floor(0.9 * a.length))]!;
  return { median, p90, rebaseline: median > 0.6 || p90 > 0.92 };
}

/** Seats a set of runs can fill under the per-player cap (a run with no owner counts alone). */
export function seatsOf(runs: readonly Pick<RunV2, 'owner'>[]): number {
  const per = new Map<string, number>();
  let loose = 0;
  for (const r of runs) { if (r.owner === null) loose++; else per.set(r.owner, (per.get(r.owner) ?? 0) + 1); }
  let n = loose;
  for (const c of per.values()) n += Math.min(MAX_SEATS_PER_PLAYER, c);
  return n;
}

export const inBandV2 = (r: RunV2, band: StrengthBand | null): boolean =>
  runInStrengthBand({ strength: r.strength, early: r.early, late: r.late }, band);

/** For each candidate peak cap: the band's runs that stay (peak at or under the cap; a run with no peak stays),
 *  how many it removes, and the seats the rest can fill. */
export function peakCapRows(runs: readonly RunV2[], band: StrengthBand | null, caps: readonly number[]): { cap: number; runs: number; removed: number; seats: number }[] {
  const inBand = runs.filter((r) => inBandV2(r, band));
  return caps.map((cap) => {
    const kept = inBand.filter((r) => r.peak === null || r.peak <= cap);
    return { cap, runs: kept.length, removed: inBand.length - kept.length, seats: seatsOf(kept) };
  });
}
