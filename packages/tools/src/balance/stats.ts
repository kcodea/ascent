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

// ── findings (balance:findings): p-values + false-discovery control ─────────────────────────────────────────

export interface TestedCI extends CI {
  /** Two-sided bootstrap p-value against the null (the share of resampled statistics on the far side of it,
   *  doubled, floored at 1/reps). Undefined when the CI is empty or degenerate (< 2 lobbies). */
  p: number | undefined;
}

/** Two-sided p from sorted bootstrap draws vs a null value: 2·min(P(draw ≤ null), P(draw ≥ null)). */
function pFromDraws(draws: readonly number[], nullValue: number): number | undefined {
  if (!draws.length) return undefined;
  let le = 0, ge = 0;
  for (const d of draws) { if (d <= nullValue) le++; if (d >= nullValue) ge++; }
  const p = 2 * Math.min(le, ge) / draws.length;
  return Math.max(1 / draws.length, Math.min(1, p));
}

/** `bootstrapMean` plus a two-sided p-value against `nullValue` (e.g. the population mean placement). */
export function bootstrapMeanTest(partials: readonly LobbyPartial[], nullValue: number, reps: number, rng: Rng): TestedCI {
  const xs = partials.filter((p) => p.n > 0);
  const n = xs.reduce((a, p) => a + p.n, 0);
  if (!xs.length || n === 0) return { ...EMPTY_CI, p: undefined };
  const est = xs.reduce((a, p) => a + p.sum, 0) / n;
  if (xs.length < 2) return { est, lo: est, hi: est, n, lobbies: xs.length, p: undefined };
  const draws: number[] = [];
  for (let r = 0; r < reps; r++) {
    let s = 0, c = 0;
    for (let i = 0; i < xs.length; i++) { const p = xs[rng.int(xs.length)]; s += p.sum; c += p.n; }
    if (c > 0) draws.push(s / c);
  }
  draws.sort((a, b) => a - b);
  const [lo, hi] = quantiles(draws);
  return { est, lo, hi, n, lobbies: xs.length, p: pFromDraws(draws, nullValue) };
}

/**
 * Difference of two means (a − b) where both groups live in the SAME lobbies (owners vs non-owners of a rune, runs
 * that held a card vs runs that did not): each lobby carries an `a` and a `b` partial and is resampled as a unit —
 * a lobby holding both sides is a PAIRED observation (the seed's shared randomness cancels), a lobby holding one
 * side contributes to that side's pooled mean only. `paired` counts the lobbies with both. p is two-sided vs 0.
 */
export function pairedDiffTest(perLobby: readonly { a: LobbyPartial; b: LobbyPartial }[], reps: number, rng: Rng): TestedCI & { paired: number } {
  const L = perLobby.filter((x) => x.a.n > 0 || x.b.n > 0);
  const paired = L.filter((x) => x.a.n > 0 && x.b.n > 0).length;
  const tot = (sel: (x: { a: LobbyPartial; b: LobbyPartial }) => LobbyPartial): LobbyPartial => L.reduce((acc, x) => ({ sum: acc.sum + sel(x).sum, n: acc.n + sel(x).n }), { sum: 0, n: 0 });
  const A = tot((x) => x.a), B = tot((x) => x.b);
  if (!A.n || !B.n) return { ...EMPTY_CI, p: undefined, paired };
  const est = A.sum / A.n - B.sum / B.n;
  const n = A.n + B.n;
  if (L.length < 2) return { est, lo: est, hi: est, n, lobbies: L.length, p: undefined, paired };
  const draws: number[] = [];
  for (let r = 0; r < reps; r++) {
    let as = 0, an = 0, bs = 0, bn = 0;
    for (let i = 0; i < L.length; i++) { const x = L[rng.int(L.length)]; as += x.a.sum; an += x.a.n; bs += x.b.sum; bn += x.b.n; }
    if (an && bn) draws.push(as / an - bs / bn);
  }
  draws.sort((x, y) => x - y);
  const [lo, hi] = quantiles(draws);
  return { est, lo, hi, n, lobbies: L.length, p: pFromDraws(draws, 0), paired };
}

/**
 * Benjamini–Hochberg: which of `pvals` survive false-discovery control at level `q`. Sort ascending, find the
 * largest k with p(k) ≤ (k / m)·q, reject all of rank ≤ k. Entries with an undefined p are never rejected and do
 * not count toward m. Returns one boolean per input, in input order.
 */
export function benjaminiHochberg(pvals: readonly (number | undefined)[], q: number): boolean[] {
  const idx = pvals.map((p, i) => ({ p, i })).filter((x): x is { p: number; i: number } => x.p !== undefined).sort((a, b) => a.p - b.p);
  const m = idx.length;
  let k = 0;
  for (let r = 1; r <= m; r++) if (idx[r - 1].p <= (r / m) * q) k = r;
  const out = pvals.map(() => false);
  for (let r = 0; r < k; r++) out[idx[r].i] = true;
  return out;
}

/** Median of a list (undefined when empty). */
export const median = (xs: readonly number[]): number | undefined => {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
