/**
 * THE DAMAGE TIERS every hero attack escalates by, and the COMBINE timeline they all open with (shared by Blast and
 * Quake since 2026-09-28).
 *
 * Tiers follow the engine's per-round loss caps of 5 / 10 / 15 / 20: I 1-5, II 6-11, III 12-19, IV 20+. APPROVED by
 * the owner 2026-09-28 for Blast ("those are good thresholds, this blast animation looks good!") and carried to Quake
 * by the ask that made it ("same attack dmg threshold logic as blast"). Each style's tuner can move them in DEV
 * only; production plays these defaults, so every style steps up on exactly the same blow.
 */
import { clamp } from './easing';

export const TIERS = [1, 2, 3, 4] as const;
export type TierNum = (typeof TIERS)[number];

export interface TierThresholds { tier2At: number; tier3At: number; tier4At: number }

/** The shipped (owner-approved) thresholds. */
export const HERO_ATTACK_TIER_THRESHOLDS: Readonly<TierThresholds> = Object.freeze({ tier2At: 6, tier3At: 12, tier4At: 20 });

/** The damage tier of a blow (1..4), from the thresholds. */
export function tierOf(total: number, c: TierThresholds = HERO_ATTACK_TIER_THRESHOLDS): TierNum {
  if (total >= c.tier4At) return 4;
  if (total >= c.tier3At) return 3;
  if (total >= c.tier2At) return 2;
  return 1;
}

/** The running totals the counter shows: each part adds, clamped to the engine's total, and the last is the total. */
export function combineCounts(values: readonly number[], total: number): number[] {
  const t = Math.max(0, Math.round(total));
  let run = 0;
  const out = values.map((v) => { run += Math.max(0, v); return Math.min(run, t); });
  if (out.length) out[out.length - 1] = t;
  return out;
}

/** The combine's per-tier dials. */
export interface CombineDials { FlyMs: number; StaggerMs: number; HoldMs: number }

/** The combine beats: where each number pops in, leaves and lands; the merge (the slam); and when the hold ends. */
export interface CombineTimeline {
  spawns: number[];
  launches: number[];
  arrivals: number[];
  mergeAt: number;
  /** The hold after the slam is over: the style's own wind-up starts here. */
  holdEnd: number;
}

/**
 * The combine for `n` numbers. Every number pops in where it comes from (staggered), leaves after `popInMs`, lands
 * `FlyMs` later; the last landing IS the merge; the total holds `HoldMs` before the style takes over. Pure.
 */
export function combineTimeline(n: number, T: CombineDials, popInMs: number): CombineTimeline {
  const spawns = Array.from({ length: n }, (_, i) => i * T.StaggerMs * 0.6);
  const launches = Array.from({ length: n }, (_, i) => popInMs + i * T.StaggerMs);
  const arrivals = launches.map((l) => l + T.FlyMs);
  const mergeAt = n ? arrivals[n - 1]! : popInMs;
  return { spawns, launches, arrivals, mergeAt, holdEnd: mergeAt + T.HoldMs };
}

/** Reduced motion: the numbers fade in where they are, then the total; the blow lands; everything fades. */
export function reducedCombineTimeline(n: number, fadeMs: number): { spawns: number[]; arrivals: number[]; mergeAt: number; impactAt: number; endAt: number } {
  const f = fadeMs;
  const arrivals = Array.from({ length: n }, () => f + 120);
  const mergeAt = f + 120;
  const impactAt = mergeAt + f + 200;
  return { spawns: Array.from({ length: n }, () => 0), arrivals, mergeAt, impactAt, endAt: impactAt + f + 120 };
}

/** A per-tier dial read off a config (`t1FlyMs` ... `t4FlyMs`). */
export function dialsOf<S extends string>(suffixes: readonly S[], tier: TierNum, c: Record<string, unknown>): Record<S, number> {
  return Object.fromEntries(suffixes.map((s) => [s, Number(c[`t${tier}${s}`])])) as Record<S, number>;
}

export { clamp };
