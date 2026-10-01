import { makeRng, simulate } from '@game/core';
import { CARD_INDEX, poolFor, type SetId } from '@game/content';
import type { BoardSnapshot } from '../snapshot';
import { opponentBoard } from '../opponents';
import { sideFromSnapshot } from '../boardSide';
import { mixSeed } from '../state';

/**
 * BOARD STRENGTH (owner design 2026-09-30, R-LOBBY-09): "can we build an algorithm for board strength to get as
 * good of an idea of how strong a snapshot's run is, and assign it a 1-100 value?" and "72 would basically mean
 * like... a 72/100 aka 72nd percentile".
 *
 * Two numbers, kept apart on purpose:
 *
 *  - The RAW score of one board is its win rate (win 1, draw 0.5) against a FROZEN, VERSIONED reference set of
 *    real boards from the same wave, `fightsPerRef` seeded fights each (the board on each side once, so neither
 *    side's first-attack edge leaks into the number). Both sides fight through `sideFromSnapshot`, the builder a
 *    recorded lobby seat fights with, so runes, auras and spell power all count. It is a pure function of the
 *    board and the reference version: stored permanently (`boards.strength_raw`) and never recomputed.
 *  - The PERCENTILE (1-100) is where that raw score sits among every scored board at the same reference wave in
 *    the pool. It moves as the pool grows, so it is derived (server-side for the pool, from the server's
 *    histogram for the player's own board) and never stored on a board. `percentileOf` is the one definition;
 *    the SQL (`supabase/migrations/2026-09-30-board-strength.sql`) is parity-tested against it.
 *  - A RUN's strength is a true percentile among RUNS (owner-approved 2026-09-30): the ROUND-WEIGHTED average of its
 *    board percentiles (`runWeightedAverageOf`: rounds 1-5 share 20%, 6-9 share 35%, 10+ share 45%, owner 2026-09-30),
 *    ranked against every other run's average by the same rule (`runPercentileOf`).
 *
 * The reference set lives in `strengthReference.v1.json`, generated ONCE by `npm run strength -- ref` from the
 * live pool. It is loaded lazily (`loadStrengthReference`): it is ~0.5 MB of boards, and nothing on the menu or
 * shop path should pay for it.
 */

/** One wave's worth of reference boards, weakest to strongest by the generator's round robin. */
export interface StrengthReference {
  /** Stored with every raw score (`boards.strength_ref`); percentiles only ever compare the same version. */
  version: string;
  setId: SetId;
  fightsPerRef: number;
  /** Reference boards by wave (keys are wave numbers as strings, JSON-shaped). */
  waves: Record<string, BoardSnapshot[]>;
}

/** Scores against this reference version are comparable; bump the file (and this) to re-baseline. */
export const STRENGTH_REF_VERSION = 'set2-v1';

/** Lazy: the JSON is its own chunk in the web build. */
export async function loadStrengthReference(): Promise<StrengthReference> {
  const mod = await import('./strengthReference.v1.json');
  return ((mod as { default?: unknown }).default ?? mod) as StrengthReference;
}

/** The reference wave a board at `wave` is scored against: its own wave when the set has one, else the nearest
 *  wave below (the late waves are thin; the last reference wave covers everything past it). Null when the set
 *  has no reference wave at or below it. */
export function referenceWaveOf(ref: Pick<StrengthReference, 'waves'>, wave: number): number | null {
  const waves = Object.keys(ref.waves).map(Number).filter((w) => (ref.waves[String(w)]?.length ?? 0) > 0).sort((a, b) => a - b);
  let best: number | null = null;
  for (const w of waves) if (w <= wave) best = w;
  return best;
}

/** A string to a stable 32-bit int (the reference version seeds every fight). */
function hashString(s: string): number {
  let h = 0x811c9dc5 | 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h | 0;
}

/** The seed of fight `fight` against reference board `refIndex` at reference wave `wave`. The same for every
 *  board scored against that reference, so two boards meet identical dice (fairer comparisons). */
export const strengthFightSeed = (version: string, wave: number, refIndex: number, fight: number): number =>
  mixSeed(hashString(version), wave, refIndex, fight, 0x5714e9);

export interface StrengthScore {
  /** Win rate against the reference wave, 0..1 (draws count half). */
  raw: number;
  /** The reference version it was scored against. */
  ref: string;
  /** The reference wave it was scored against (its percentile bucket). */
  wave: number;
  fights: number;
}

/** A resumable scorer, like the odds probe: `step(n)` runs up to `n` fights so the UI can spread the work over
 *  idle slices. The result after any slicing is identical to one uninterrupted run. */
export interface StrengthProbe {
  step(n: number): boolean;
  done(): boolean;
  progress(): number;
  total(): number;
  /** Null when the board cannot be scored (no reference wave, another set, no minions). */
  result(): StrengthScore | null;
}

/** Fights of the probe, and whether it can score at all. */
export function createStrengthProbe(board: BoardSnapshot, ref: StrengthReference): StrengthProbe {
  const wave = referenceWaveOf(ref, board.wave);
  const refs = wave === null ? [] : ref.waves[String(wave)] ?? [];
  const scorable = wave !== null && refs.length > 0 && (board.setId ?? 'set1') === ref.setId && (board.minions?.length ?? 0) > 0;
  const perRef = Math.max(1, ref.fightsPerRef);
  const total = scorable ? refs.length * perRef : 0;
  const poolIds = scorable ? poolFor(ref.setId).all.map((c) => c.id) : [];
  const mySide = scorable ? sideFromSnapshot(board, board.tier, poolIds) : null;
  let i = 0;
  let points = 0;
  const step = (n: number): boolean => {
    const end = Math.min(total, i + Math.max(0, n));
    for (; i < end; i++) {
      const refIndex = Math.floor(i / perRef);
      const fight = i % perRef;
      const other = refs[refIndex]!;
      const rng = makeRng(strengthFightSeed(ref.version, wave!, refIndex, fight));
      const otherSide = sideFromSnapshot(other, other.tier, poolIds);
      // Even fights: the scored board on the player side; odd fights: on the enemy side.
      if (fight % 2 === 0) {
        const r = simulate(opponentBoard(board), opponentBoard(other), rng, CARD_INDEX, mySide!, otherSide);
        points += r.result === 'win' ? 1 : r.result === 'draw' ? 0.5 : 0;
      } else {
        const r = simulate(opponentBoard(other), opponentBoard(board), rng, CARD_INDEX, otherSide, mySide!);
        points += r.result === 'lose' ? 1 : r.result === 'draw' ? 0.5 : 0;
      }
    }
    return i >= total;
  };
  return {
    step,
    done: () => i >= total,
    progress: () => i,
    total: () => total,
    result: () => (!scorable || i < total ? null : { raw: roundRaw(points / total), ref: ref.version, wave: wave!, fights: total }),
  };
}

/** Raw scores are stored with 4 decimals (the SQL column is numeric; equal boards must compare equal). */
export const roundRaw = (x: number): number => Math.round(x * 10000) / 10000;

/** One-shot scoring (tools, tests). */
export function scoreBoard(board: BoardSnapshot, ref: StrengthReference): StrengthScore | null {
  const p = createStrengthProbe(board, ref);
  p.step(p.total());
  return p.result();
}

// ── Percentiles ─────────────────────────────────────────────────────────────────────────────────────────────

/** How many boards of a reference wave hold each raw score (the server's histogram, one entry per value). */
export interface StrengthHistogramEntry { raw: number; count: number }
/** Keyed by reference wave. */
export type StrengthHistogram = Record<string, StrengthHistogramEntry[]>;

/**
 * THE percentile definition: the share of the wave's boards this one is stronger than, with ties counted half,
 * as a whole number clamped to 1..100. `includeSelf` adds the board itself to the population, which is what the
 * server's per-board percentile does for a board already in the pool; the player's own fresh board is scored as
 * if it had been added. Null when there is nothing to compare against.
 *
 * SQL twin (`board_strength_pct` over `board_strength_cumulative`): the same counts over the same wave.
 */
export function percentileOf(raw: number, entries: readonly StrengthHistogramEntry[] | undefined, includeSelf = true): number | null {
  let below = 0;
  let equal = includeSelf ? 1 : 0;
  let n = includeSelf ? 1 : 0;
  const x = roundRaw(raw);
  for (const e of entries ?? []) {
    if (!(e.count > 0)) continue;
    n += e.count;
    const r = roundRaw(e.raw);
    if (r < x) below += e.count;
    else if (r === x) equal += e.count;
  }
  return pctFromCounts(below, equal, n);
}

/** 100 * (below + equal / 2) / n, rounded half up and clamped to 1..100, in exact integer arithmetic (the SQL
 *  `board_strength_pct` computes the same expression, so the two copies can never round differently). */
export function pctFromCounts(below: number, equal: number, n: number): number | null {
  if (!(n > 0)) return null;
  const num = 200 * below + 100 * equal; // 2 * 100 * (below + equal / 2)
  const den = 2 * n;
  return Math.min(100, Math.max(1, Math.floor((2 * num + den) / (2 * den))));
}

/** Round to a whole 1..100 (a percentile of 0 reads as "no score"; the weakest board is 1). */
export const clampPct = (x: number): number => Math.min(100, Math.max(1, Math.round(x)));

/** The PLAIN mean of a run's per-board percentiles, rounded (null with none). This was the run's average until the
 *  round weighting (2026-09-30); the run now uses `runWeightedAverageOf`. Kept for the measure tool's before/after. */
export function runAverageOf(percentiles: readonly (number | null | undefined)[]): number | null {
  const xs = percentiles.filter((p): p is number => typeof p === 'number' && Number.isFinite(p));
  if (!xs.length) return null;
  return clampPct(xs.reduce((a, b) => a + b, 0) / xs.length);
}

/**
 * ROUND WEIGHTS (owner 2026-09-30: "rounds 1-5 matter much less than 6-9 which matter less than 10+ ... like 20% ish
 * for 1-5, 35% for 6-9 and 45% for 10+?"). A run's average gives each round GROUP a share of the weight, split evenly
 * across the rounds the run has in that group. A group the run never reached (it ended before round 10, say) drops
 * out and the others are renormalised: a run that ended in round 8 weighs its rounds 1-5 as 20/55 and 6-9 as 35/55.
 */
export const STRENGTH_ROUND_GROUPS: readonly { readonly from: number; readonly to: number; readonly weight: number }[] = [
  { from: 1, to: 5, weight: 20 },
  { from: 6, to: 9, weight: 35 },
  { from: 10, to: Infinity, weight: 45 },
];

/** The index into `STRENGTH_ROUND_GROUPS` of a round (anything below 1 counts with the first group). */
export function strengthRoundGroup(round: number): number {
  for (let g = STRENGTH_ROUND_GROUPS.length - 1; g > 0; g--) if (round >= STRENGTH_ROUND_GROUPS[g]!.from) return g;
  return 0;
}

/**
 * A run's AVERAGE (2026-09-30): the round-weighted mean of its per-board percentiles, rounded half up to 1..100 (null
 * with none). Within a group every entry counts equally; a round with two boards counts twice, the convention the
 * plain average always had (the server averages every scored board of the run). Exact integer arithmetic, so the SQL
 * twin `board_strength_weighted_avg` cannot round differently:
 *   value = sum_g (W_g * S_g / n_g) / sum_g W_g  over the groups with n_g > 0  (S_g = sum, n_g = count of group g)
 * Averages pull toward 50 (a run is rarely the weakest in every round), so this is not yet the run's strength;
 * `runPercentileOf` ranks it among the runs.
 */
export function runWeightedAverageOf(rounds: Iterable<{ round: number; value: number | null | undefined }>): number | null {
  const sum = STRENGTH_ROUND_GROUPS.map(() => 0);
  const count = STRENGTH_ROUND_GROUPS.map(() => 0);
  for (const r of rounds) {
    if (typeof r.value !== 'number' || !Number.isFinite(r.value)) continue;
    const g = strengthRoundGroup(r.round);
    sum[g]! += Math.round(r.value);
    count[g]!++;
  }
  return weightedAvgFromGroups(sum, count);
}

/** sum_g W_g S_g / n_g over sum_g W_g, as num / den over the common denominator prod(max(n_g, 1)), rounded half up and
 *  clamped to 1..100. Every product stays far below 2^53 (100 * 100 * 60^3), so this is exact. */
export function weightedAvgFromGroups(sum: readonly number[], count: readonly number[]): number | null {
  const m = count.map((n) => Math.max(1, n));
  const prod = m.reduce((a, b) => a * b, 1);
  let num = 0;
  let w = 0;
  STRENGTH_ROUND_GROUPS.forEach((grp, g) => {
    if (!(count[g]! > 0)) return;
    num += grp.weight * sum[g]! * (prod / m[g]!);
    w += grp.weight;
  });
  if (w === 0) return null;
  const den = w * prod;
  return Math.min(100, Math.max(1, Math.floor((2 * num + den) / (2 * den))));
}

/** How many runs of the set hold each average (the server's `run_strength_histogram`). */
export interface RunStrengthHistogramEntry { avg: number; count: number }

/**
 * A RUN's strength (owner-approved 2026-09-30): its average ranked among the pool's run averages with the same
 * tie-halving 1..100 rule as a board, so 30 means the bottom 30% of runs and every band holds about its nominal share.
 * `includeSelf` counts the run itself in the population (the player's finished game, not uploaded yet). SQL twin: the
 * rank window in `pool_strength_refresh`.
 */
export function runPercentileOf(avg: number, runs: readonly RunStrengthHistogramEntry[] | null | undefined, includeSelf = true): number | null {
  return percentileOf(avg, (runs ?? []).map((r) => ({ raw: r.avg, count: r.count })), includeSelf);
}

/** A stored board strength (a history entry, a replay result, a JSON-path text scalar) back to 1..100, or null for
 *  anything else: absent, older records, garbage. The UI prints nothing for null. */
export function parseBoardStrength(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 1 && n <= 100 ? Math.round(n) : null;
}

/**
 * The player's own run: each round's percentile against the pool's board histogram (the board counted as if it were
 * already in the pool), their round-weighted average (`runWeightedAverageOf`), and the run's strength (that average ranked among the pool's runs). `value`
 * is null without the run histogram, and the whole result null without the board histogram (the server cannot give
 * one yet): the UI then shows nothing rather than a guess. Scores against another reference version are skipped.
 */
export function runStrengthFromScores(
  scores: Iterable<readonly [number, StrengthScore]>, hist: StrengthHistogram | null | undefined,
  runs: readonly RunStrengthHistogramEntry[] | null | undefined, ref: string = STRENGTH_REF_VERSION,
): { value: number | null; average: number | null; rounds: { round: number; value: number }[] } | null {
  if (!hist) return null;
  const rounds: { round: number; value: number }[] = [];
  for (const [round, score] of scores) {
    if (score.ref !== ref) continue;
    const entries = hist[String(score.wave)];
    if (!entries?.length) continue; // nothing to compare against at that wave yet
    const value = percentileOf(score.raw, entries, true);
    if (value !== null) rounds.push({ round, value });
  }
  rounds.sort((a, b) => a.round - b.round);
  const average = runWeightedAverageOf(rounds);
  const value = average !== null && runs?.length ? runPercentileOf(average, runs, true) : null;
  return { value, average, rounds };
}
