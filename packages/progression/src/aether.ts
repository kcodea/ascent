/**
 * AETHER: the earned currency that replaces level-up crates (owner decisions 2026-10-18; spec
 * docs/superpowers/specs/2026-10-18-aether-crate-shop-design.md).
 *
 * Aether is earned by playing and spent in the Crate Shop; it is never bought with real money and accounts start
 * at 0. This file is THE economy rules: what each mode pays, the crate prices, the focus-fee ladder, and the
 * milestone cadence and floor for the free milestone crates (Epic since 2026-10-20). Level no longer grants a crate per level (Level 1's Welcome
 * Crate and every 10th level's milestone crate are the exceptions).
 *
 * DEPENDENCY-FREE ON PURPOSE (its one import is the sibling `rules.ts`). Like the other progression files it is
 * copied VERBATIM into `supabase/functions/_shared/` for the Deno Edge Functions, so it may import only sibling
 * files by relative path: no packages, no Node APIs.
 *
 * The SQL copy of these numbers is `aether_config` in `2026-10-18-aether.sql`. The server decides every roll,
 * balance and price; the client only NAMES a tier, a focus and the price it showed. The numbers are versioned
 * (`AetherEconomy.version`) so a retune is a new row in SQL, not a code change an old client mis-shows.
 *
 * Integer math throughout, and every constant is frozen, so this file and the SQL cannot disagree on a float.
 */

import { isValidPlacement, type ProgressionMode } from './rules';

// ── Crate tiers ─────────────────────────────────────────────────────────────────────────────────────────────

/** The five crate tiers a player can buy, cheapest first. A tier sets the rarity FLOOR of what it can drop. */
export type CrateTier = 'standard' | 'rare' | 'epic' | 'legendary' | 'ancient';
export const CRATE_TIERS: readonly CrateTier[] = Object.freeze(['standard', 'rare', 'epic', 'legendary', 'ancient'] as const);

// ── The economy document ────────────────────────────────────────────────────────────────────────────────────

export interface AetherEconomy {
  /** Bumped whenever a number below changes (the SQL `aether_config` row carries the same version). */
  version: number;
  /** Ranked: Aether for an accepted, placed game, win or lose. */
  rankedBase: number;
  /** Ranked: the placement bonus on top of `rankedBase`. Length 8, index 0 = 1st place. */
  rankedPlacementBonus: readonly number[];
  /** Versus: Aether for a completed match (the loser's whole pay; an abandoned match pays this too). */
  versusComplete: number;
  /** Versus: the winner's bonus on top of `versusComplete`. */
  versusWin: number;
  /** Gauntlet: Aether for the FIRST clear of a stage, once per stage. */
  gauntletFirstClear: number;
  /** What each crate tier costs. */
  cratePrice: Readonly<Record<CrateTier, number>>;
  /** Focus fee as a percent of the crate's price, by number of categories ticked. Length 7, index 0 = 1 ticked. */
  focusFeePercent: readonly number[];
  /** A free milestone crate (floor `MILESTONE_CRATE_TIER`) arrives at every Nth account level. */
  milestoneEvery: number;
}

export const DEFAULT_AETHER_ECONOMY: AetherEconomy = Object.freeze({
  version: 1,
  rankedBase: 50,
  rankedPlacementBonus: Object.freeze([140, 80, 45, 35, 25, 15, 10, 0]),
  versusComplete: 25,
  versusWin: 45,
  gauntletFirstClear: 200,
  cratePrice: Object.freeze({ standard: 100, rare: 200, epic: 400, legendary: 600, ancient: 900 }),
  focusFeePercent: Object.freeze([100, 60, 40, 25, 15, 10, 5]),
  milestoneEvery: 10,
});

const PLACEMENT_BONUS_LENGTH = 8;
const FOCUS_FEE_LENGTH = 7;

const isNonNegInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

function nonNegIntArray(v: unknown, length: number): number[] | null {
  if (!Array.isArray(v) || v.length !== length) return null;
  return v.every(isNonNegInt) ? [...v] : null;
}

/**
 * Parse an economy document (the SQL `aether_config` row as the server hands it to the client). Strict: only
 * non-negative integers, exactly the expected array lengths and all five tiers. Null for anything else, never a
 * partly-trusted economy (a bad price must not silently become 0).
 */
export function parseAetherEconomy(v: unknown): AetherEconomy | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const rankedPlacementBonus = nonNegIntArray(o.rankedPlacementBonus, PLACEMENT_BONUS_LENGTH);
  const focusFeePercent = nonNegIntArray(o.focusFeePercent, FOCUS_FEE_LENGTH);
  if (!rankedPlacementBonus || !focusFeePercent) return null;
  const prices = o.cratePrice;
  if (!prices || typeof prices !== 'object' || Array.isArray(prices)) return null;
  const p = prices as Record<string, unknown>;
  const cratePrice = {} as Record<CrateTier, number>;
  for (const tier of CRATE_TIERS) {
    const price = p[tier];
    if (!isNonNegInt(price)) return null;
    cratePrice[tier] = price;
  }
  const { version, rankedBase, versusComplete, versusWin, gauntletFirstClear, milestoneEvery } = o;
  if (!isNonNegInt(version) || !isNonNegInt(rankedBase) || !isNonNegInt(versusComplete) || !isNonNegInt(versusWin)
    || !isNonNegInt(gauntletFirstClear) || !isNonNegInt(milestoneEvery) || milestoneEvery < 1) return null;
  return Object.freeze({
    version, rankedBase, rankedPlacementBonus: Object.freeze(rankedPlacementBonus), versusComplete, versusWin,
    gauntletFirstClear, cratePrice: Object.freeze(cratePrice), focusFeePercent: Object.freeze(focusFeePercent), milestoneEvery,
  });
}

// ── The launch grant ────────────────────────────────────────────────────────────────────────────────────────

/** Every account's one-time gift when Aether launches (owner 2026-10-19: "lets give everyone 1,000 Aether as part of
 *  the announcement of this change"). The server pays it (2026-10-19-aether-launch-grant.sql, `c_grant`): the rollout
 *  pays every existing profile, a trigger pays each profile created after. This copy is what the Collection's
 *  "Introducing Aether" announcement names. */
export const AETHER_LAUNCH_GRANT = 1000;

// ── What a settlement pays ──────────────────────────────────────────────────────────────────────────────────

export interface AetherBreakdown {
  /** The flat part: Ranked base, or Versus "match completed". */
  base: number;
  /** The result part: the Ranked placement bonus, or the Versus winner's bonus. */
  placement: number;
  total: number;
}

export const ZERO_AETHER: AetherBreakdown = Object.freeze({ base: 0, placement: 0, total: 0 });

/**
 * The Aether one settlement awards, from the facts the SERVER trusts. A non-terminal game earns nothing.
 *
 *  - Ranked: 50 + the placement bonus, win or lose. No valid placement means the ladder never accepted the game,
 *    so 0 (mirrors `xpForSettlement`).
 *  - Versus: 25 for a completed match, +45 for the winner. Placement 1 = winner, 2 = loser, null = abandoned
 *    with no winner (pays the 25 only).
 *  - Practice and Tutorial: 0. There is no comeback bonus. (Gauntlet pays through its own once-per-stage path.)
 */
export function aetherForSettlement(
  input: { mode: ProgressionMode; placement: number | null; terminal?: boolean },
  eco: AetherEconomy = DEFAULT_AETHER_ECONOMY,
): AetherBreakdown {
  if (input.terminal === false) return { ...ZERO_AETHER };
  if (input.mode === 'versus') {
    const win = input.placement === 1 ? eco.versusWin : 0;
    return { base: eco.versusComplete, placement: win, total: eco.versusComplete + win };
  }
  if (input.mode === 'ranked') {
    if (!isValidPlacement(input.placement)) return { ...ZERO_AETHER };
    const bonus = eco.rankedPlacementBonus[input.placement - 1] ?? 0;
    return { base: eco.rankedBase, placement: bonus, total: eco.rankedBase + bonus };
  }
  return { ...ZERO_AETHER };
}

// ── Milestone crates ────────────────────────────────────────────────────────────────────────────────────────

/**
 * The tier a milestone crate is granted at: its rarity FLOOR, and the chest it opens as. EPIC since 2026-10-20 (owner: "i
 * want the chest quality to reduce down to Epic for the milestone chests (every 10 levels) and you cannot focus those ones
 * specifically"); the SQL copy is the `'epic'` in settle_progression + aether_rollout
 * (2026-10-20-milestone-chests-epic.sql). Milestone crates granted before then stay floor Legendary (owner: "Keep them
 * Legendary"), so a crate's own `floor` is the truth and this is only the default for a crate that has none. A milestone
 * crate is never focused: not at open, not ever.
 */
export const MILESTONE_CRATE_TIER: CrateTier = 'epic';

/** The milestone levels (10, 20, 30, ...) at or below `level`: each owes the account one free milestone crate. */
export function milestoneLevelsThrough(level: number, every: number = DEFAULT_AETHER_ECONOMY.milestoneEvery): number[] {
  const out: number[] = [];
  if (!Number.isFinite(level) || !Number.isInteger(every) || every < 1) return out;
  for (let l = every; l <= level; l += every) out.push(l);
  return out;
}
