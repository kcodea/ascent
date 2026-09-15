/**
 * BALANCE BOT B4 — LINE SELECTION: which package(s) a run should pursue.
 *
 * A LINE is a primary package plus an optional secondary. Given the run's hero and rolled tribes, every package
 * is scored for FIT = tribe availability × hero affinity × pool depth, and the ranked list is the menu:
 * `exploration 0` takes the best fit, `exploration k` the k-th best (wrapping over the VIABLE entries), so a
 * 30-run matrix on one hero rotates through the lines the content actually supports while always choosing
 * something playable. Deterministic in `(heroId, tribes, seed, exploration)`; the seed only breaks exact ties.
 *
 * Fit is a CONSTRUCTION prior, not a strength estimate — it says "this run can build this", never "this wins".
 */
import type { Tribe } from '@game/core';
import type { SetId } from '@game/content';
import { makeRng } from '@game/core';
import { mixSeed } from '../../state';
import { STRATEGY_PACKAGES, packageMembers, type StrategyPackage } from './packages';

export interface LineChoice {
  primary: string;
  secondary?: string;
  /** 0 = the best fit for this run; k = the k-th best. */
  fitRank: number;
  /** The primary's fit score (for traces / reports). */
  fit: number;
}

export interface PackageFit {
  id: string;
  fit: number;
  tribeAvailability: number;
  heroAffinity: number;
  poolDepth: number;
}

/** Fraction of the package's tribes the run rolled (1 for tribe-agnostic). A `requiresTribe` package with none
 *  of its tribes is unavailable (0); one that merely PREFERS a tribe keeps a floor, since its neutral core plays. */
export function tribeAvailability(pkg: StrategyPackage, tribes: readonly Tribe[]): number {
  if (pkg.tribes.length === 0) return 1;
  const have = pkg.tribes.filter((t) => tribes.includes(t)).length;
  if (have === 0) return pkg.requiresTribe ? 0 : 0.35;
  return have / pkg.tribes.length;
}

/** Drawable depth: engines + payoffs count double (a line with pieces to find), saturating at ~12 weighted members. */
export function poolDepth(pkg: StrategyPackage, setId: SetId): number {
  const members = packageMembers(pkg, setId);
  if (members.length === 0) return 0;
  const weighted = members.reduce((n, m) => n + (m.score >= 2 ? 2 : 1), 0);
  const payoffs = members.filter((m) => m.score === 3).length;
  const base = Math.min(1, weighted / 24);
  // A line with no payoff at all is only half a line.
  return payoffs > 0 ? base : base * 0.5;
}

export function packageFits(heroId: string, tribes: readonly Tribe[], setId: SetId): PackageFit[] {
  return STRATEGY_PACKAGES.map((pkg) => {
    const tribeAvail = tribeAvailability(pkg, tribes);
    const heroAffinity = pkg.heroes[heroId] ?? 1;
    const depth = poolDepth(pkg, setId);
    return { id: pkg.id, fit: tribeAvail * heroAffinity * depth, tribeAvailability: tribeAvail, heroAffinity, poolDepth: depth };
  });
}

/** Fits, best first; exact ties broken by a private RNG seeded from `seed` (never the run's RNG). */
export function rankPackages(heroId: string, tribes: readonly Tribe[], setId: SetId, seed: number): PackageFit[] {
  const rng = makeRng(mixSeed(seed, 0x51e, heroId.length) >>> 0);
  const keyed = packageFits(heroId, tribes, setId).map((f) => ({ f, key: rng.next() }));
  keyed.sort((a, b) => b.f.fit - a.f.fit || a.key - b.key);
  return keyed.map((k) => k.f);
}

/** A fit below this is not a line a pilot should commit to (unsupported tribe / empty pool). */
export const VIABLE_FIT = 0.15;

/**
 * The line for a run. `exploration` indexes the ranked VIABLE list (wrapping), so any non-negative integer yields
 * a playable line; the secondary is the next viable package that shares a tribe with the primary or is
 * tribe-agnostic — a complement the primary's shop will also offer, never a second unrelated tribe.
 */
export function pickLineForRun(heroId: string, tribes: readonly Tribe[], seed: number, exploration: number, setId: SetId = 'set2'): LineChoice {
  const ranked = rankPackages(heroId, tribes, setId, seed);
  const viable = ranked.filter((f) => f.fit >= VIABLE_FIT);
  const pool = viable.length > 0 ? viable : ranked.slice(0, 1);
  const k = Math.max(0, Math.floor(exploration)) % pool.length;
  const primary = pool[k]!;
  const pPkg = STRATEGY_PACKAGES.find((p) => p.id === primary.id)!;
  const complement = pool.find((f) => {
    if (f.id === primary.id) return false;
    const pkg = STRATEGY_PACKAGES.find((p) => p.id === f.id)!;
    return pkg.tribes.length === 0 || pPkg.tribes.length === 0 || pkg.tribes.some((t) => pPkg.tribes.includes(t));
  });
  return {
    primary: primary.id,
    ...(complement ? { secondary: complement.id } : {}),
    fitRank: k,
    fit: primary.fit,
  };
}

/** How many distinct viable lines a run can rotate through (the period of `exploration`). */
export function viableLineCount(heroId: string, tribes: readonly Tribe[], setId: SetId = 'set2'): number {
  return Math.max(1, packageFits(heroId, tribes, setId).filter((f) => f.fit >= VIABLE_FIT).length);
}
