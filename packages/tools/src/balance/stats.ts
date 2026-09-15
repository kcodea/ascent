/**
 * BALANCE BOT B5 — uncertainty helpers. Everything resamples at the LOBBY level (roadmap: "eight seats in one lobby
 * are not eight independent trials"): a statistic is expressed as per-lobby partial sums, and the bootstrap draws
 * whole lobbies with replacement. Seeded (`makeRng`) so a report regenerates byte-identical from the same records.
 */
import { makeRng, type Rng } from '@game/core';

export interface CI {
  /** The point estimate over the pooled units (undefined when there are none). */
  est: number | undefined;
  lo: number | undefined;
  hi: number | undefined;
  /** Units (runs / events) behind the estimate. */
  n: number;
  /** Independent lobbies behind the estimate — the resampling unit. */
  lobbies: number;
}

/** Per-lobby partial sums for a mean (or a proportion: `sum` = successes, `n` = trials). */
export interface LobbyPartial { sum: number; n: number }

export const EMPTY_CI: CI = { est: undefined, lo: undefined, hi: undefined, n: 0, lobbies: 0 };

function quantiles(sorted: number[], lo = 0.025, hi = 0.975): [number, number] {
  const at = (q: number): number => {
    if (!sorted.length) return NaN;
    const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
    return sorted[i];
  };
  return [at(lo), at(hi)];
}

/**
 * Bootstrap CI for a ratio-of-sums statistic (a mean or a proportion) from per-lobby partials. Lobbies with `n = 0`
 * carry nothing and are dropped before resampling. With one lobby the interval collapses to the point (no
 * resampling is possible) — the report labels that.
 */
export function bootstrapMean(partials: readonly LobbyPartial[], reps: number, rng: Rng): CI {
  const xs = partials.filter((p) => p.n > 0);
  const n = xs.reduce((a, p) => a + p.n, 0);
  if (!xs.length || n === 0) return EMPTY_CI;
  const est = xs.reduce((a, p) => a + p.sum, 0) / n;
  if (xs.length < 2) return { est, lo: est, hi: est, n, lobbies: xs.length };
  const draws: number[] = [];
  for (let r = 0; r < reps; r++) {
    let s = 0, c = 0;
    for (let i = 0; i < xs.length; i++) { const p = xs[rng.int(xs.length)]; s += p.sum; c += p.n; }
    if (c > 0) draws.push(s / c);
  }
  draws.sort((a, b) => a - b);
  const [lo, hi] = quantiles(draws);
  return { est, lo, hi, n, lobbies: xs.length };
}

/**
 * Bootstrap CI for the DIFFERENCE of two ratio-of-sums statistics (candidate − baseline).
 *  - `paired`: one entry per matched seed — both partials come from the same seed, resampled together.
 *  - `unpaired`: the two lobby sets are resampled independently.
 */
export function bootstrapDiff(
  paired: readonly { base: LobbyPartial; cand: LobbyPartial }[],
  unpaired: { base: readonly LobbyPartial[]; cand: readonly LobbyPartial[] },
  reps: number,
  rng: Rng,
): CI & { paired: number } {
  const pairs = paired.filter((p) => p.base.n > 0 || p.cand.n > 0);
  const ub = unpaired.base.filter((p) => p.n > 0);
  const uc = unpaired.cand.filter((p) => p.n > 0);
  const total = (ps: readonly LobbyPartial[]): LobbyPartial => ps.reduce((a, p) => ({ sum: a.sum + p.sum, n: a.n + p.n }), { sum: 0, n: 0 });
  const baseAll = total([...pairs.map((p) => p.base), ...ub]);
  const candAll = total([...pairs.map((p) => p.cand), ...uc]);
  if (baseAll.n === 0 || candAll.n === 0) return { ...EMPTY_CI, paired: pairs.length };
  const est = candAll.sum / candAll.n - baseAll.sum / baseAll.n;
  const lobbies = pairs.length + ub.length + uc.length;
  if (lobbies < 2) return { est, lo: est, hi: est, n: baseAll.n + candAll.n, lobbies, paired: pairs.length };
  const draws: number[] = [];
  for (let r = 0; r < reps; r++) {
    let bs = 0, bn = 0, cs = 0, cn = 0;
    for (let i = 0; i < pairs.length; i++) { const p = pairs[rng.int(pairs.length)]; bs += p.base.sum; bn += p.base.n; cs += p.cand.sum; cn += p.cand.n; }
    for (let i = 0; i < ub.length; i++) { const p = ub[rng.int(ub.length)]; bs += p.sum; bn += p.n; }
    for (let i = 0; i < uc.length; i++) { const p = uc[rng.int(uc.length)]; cs += p.sum; cn += p.n; }
    if (bn > 0 && cn > 0) draws.push(cs / cn - bs / bn);
  }
  draws.sort((a, b) => a - b);
  const [lo, hi] = quantiles(draws);
  return { est, lo, hi, n: baseAll.n + candAll.n, lobbies, paired: pairs.length };
}

/** Empirical-Bayes shrinkage of a sparse mean toward the population mean: (n·x̄ + k·μ) / (n + k). */
export const shrink = (mean: number, n: number, popMean: number, k: number): number => (n * mean + k * popMean) / (n + k);

/** A stable per-key RNG so table rows do not depend on iteration order. */
export function keyedRng(seed: number, key: string): Rng {
  let h = seed >>> 0;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return makeRng(h);
}

/** Does the interval exclude `value`? (Undefined when the CI is empty or degenerate.) */
export function excludes(ci: CI, value: number): boolean | undefined {
  if (ci.est === undefined || ci.lo === undefined || ci.hi === undefined) return undefined;
  if (ci.lobbies < 2) return undefined;
  return ci.lo > value || ci.hi < value;
}

/** FNV-1a hex digest of a string — the same function `stateHash` uses, for file checksums + report headers. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

export const mean = (xs: readonly number[]): number | undefined => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
export const stddev = (xs: readonly number[]): number | undefined => {
  if (xs.length < 2) return undefined;
  const m = mean(xs)!;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) * (x - m), 0) / (xs.length - 1));
};
/** Herfindahl concentration of a share distribution (1 = one entity has everything; 1/k = k equal shares). */
export const herfindahl = (counts: readonly number[]): number | undefined => {
  const t = counts.reduce((a, b) => a + b, 0);
  if (!t) return undefined;
  return counts.reduce((a, c) => a + (c / t) * (c / t), 0);
};
