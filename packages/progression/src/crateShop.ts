/**
 * THE CRATE SHOP'S RULES: tiered crates and the category focus (owner decisions 2026-10-18; spec
 * docs/superpowers/specs/2026-10-18-aether-crate-shop-design.md).
 *
 * A crate TIER sets a rarity FLOOR: nothing below it can drop. Inside a tier the odds are the published
 * `CRATE_RARITY_ODDS` restricted to the rarities at or above the floor and renormalized, and a rarity with nothing
 * left falls to the nearest one that still has something, never below the floor. An optional category FOCUS narrows
 * the pool to the ticked categories and costs a percent of the crate's price (`AetherEconomy.focusFeePercent`).
 *
 * A Standard crate (floor Common) with no focus is the version-4 roll DRAW FOR DRAW: same odds, same fall-back, same
 * id-sorted pool, so the Welcome Crate and every pre-shop crate keep their exact behaviour.
 *
 * DEPENDENCY-FREE ON PURPOSE. Like the other progression files it is copied VERBATIM into `supabase/functions/_shared/`
 * for the Deno Edge Functions, so it may import only sibling files by relative path. The SQL copy of the pick is
 * `progression_tiered_crate_pick` (it mirrors `pickTieredCrateReward` exactly); the server decides every roll and price.
 */

import { CRATE_TIERS, DEFAULT_AETHER_ECONOMY, type AetherEconomy, type CrateTier } from './aether';
import {
  COSMETICS, COSMETIC_CATEGORIES, COSMETIC_RARITIES, CRATE_RARITY_ODDS, crateFloorLabel, crateRarityFallback, eligibleCrateCosmetics, parseOpenCrateResult,
  type CosmeticCategory, type CosmeticDef, type CosmeticRarity, type OpenCrateResult,
} from './cosmetics';

// ── Tiers ───────────────────────────────────────────────────────────────────────────────────────────────────

/** The rarity floor each tier sells. Standard = Common (nothing is excluded). */
export const CRATE_TIER_FLOOR: Readonly<Record<CrateTier, CosmeticRarity>> = Object.freeze({
  standard: 'common', rare: 'rare', epic: 'epic', legendary: 'legendary', ancient: 'ancient',
});

/** The player-facing tier names: 'Standard', 'Rare', 'Epic', 'Legendary', 'Ancient'. Built from the same mapping
 *  `crateLabel` uses for an owned shop crate (`crateFloorLabel`), so a crate on the shelf and in the inventory agree. */
export const CRATE_TIER_LABELS: Readonly<Record<CrateTier, string>> = Object.freeze({
  standard: crateFloorLabel(CRATE_TIER_FLOOR.standard),
  rare: crateFloorLabel(CRATE_TIER_FLOOR.rare),
  epic: crateFloorLabel(CRATE_TIER_FLOOR.epic),
  legendary: crateFloorLabel(CRATE_TIER_FLOOR.legendary),
  ancient: crateFloorLabel(CRATE_TIER_FLOOR.ancient),
});

/** Is rarity `r` at or above `floor`? */
export const atOrAbove = (r: CosmeticRarity, floor: CosmeticRarity): boolean => COSMETIC_RARITIES.indexOf(r) >= COSMETIC_RARITIES.indexOf(floor);

/** The rarities a floor allows, lowest first, with the sum of their published odds (the renormalizing denominator). */
function floorBand(floor: CosmeticRarity): { rarities: CosmeticRarity[]; sum: number } {
  const rarities = COSMETIC_RARITIES.filter((r) => atOrAbove(r, floor));
  return { rarities, sum: rarities.reduce((s, r) => s + CRATE_RARITY_ODDS[r], 0) };
}

/** The odds a tier DISPLAYS, in percent to one decimal: each rarity at or above the floor renormalized, 0 below it. */
export function tierOddsPercent(floor: CosmeticRarity): Record<CosmeticRarity, number> {
  const { sum } = floorBand(floor);
  const out = {} as Record<CosmeticRarity, number>;
  for (const r of COSMETIC_RARITIES) out[r] = atOrAbove(r, floor) ? Math.round((CRATE_RARITY_ODDS[r] / sum) * 100 * 10) / 10 : 0;
  return out;
}

// ── The pool ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * What a crate of this floor (and focus) can still give: the version-4 pool (`eligibleCrateCosmetics`: active,
 * crate-sourced, enabled category, unowned, id-sorted) kept to rarities at or above the floor and, when a focus is named,
 * to those categories. A null or empty focus means no focus.
 */
export function eligibleForCrate(
  owned: Iterable<string>, floor: CosmeticRarity, focus: readonly CosmeticCategory[] | null, catalog: readonly CosmeticDef[] = COSMETICS,
): CosmeticDef[] {
  const cats = focus && focus.length > 0 ? new Set<CosmeticCategory>(focus) : null;
  return eligibleCrateCosmetics(owned, catalog).filter((c) => atOrAbove(c.rarity, floor) && (!cats || cats.has(c.category)));
}

/** The categories a player may focus at this floor: those with something still eligible, in `COSMETIC_CATEGORIES` order. */
export function availableFocusCategories(owned: Iterable<string>, floor: CosmeticRarity, catalog: readonly CosmeticDef[] = COSMETICS): CosmeticCategory[] {
  const have = new Set(eligibleForCrate(owned, floor, null, catalog).map((c) => c.category));
  return COSMETIC_CATEGORIES.filter((c) => have.has(c));
}

/**
 * The canonical focus: sorted (by name), de-duplicated. Null when nothing is ticked or when it covers EVERY available
 * category (that is no focus, and costs nothing). 'bad' when it names anything that is not available at this floor.
 */
export function normalizeFocus(focus: readonly string[] | null, available: readonly CosmeticCategory[]): CosmeticCategory[] | null | 'bad' {
  if (!focus || focus.length === 0) return null;
  const ok = new Set<string>(available);
  const uniq = [...new Set(focus)];
  if (uniq.some((c) => !ok.has(c))) return 'bad';
  if (uniq.length >= ok.size) return null;
  return (uniq as CosmeticCategory[]).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// ── Pricing ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The focus fee as a percent of the crate's price. `ticked` counts only categories still AVAILABLE; ticking none, or all
 * of them, is no focus and costs 0. 1..7 ticked read the ladder; 8 or more (but fewer than all) pay the last rung.
 */
export function focusFeePercent(ticked: number, available: number, eco: AetherEconomy = DEFAULT_AETHER_ECONOMY): number {
  if (ticked <= 0 || ticked >= available) return 0;
  const ladder = eco.focusFeePercent;
  return ladder[Math.min(ticked, ladder.length) - 1] ?? 0;
}

export interface CrateQuote {
  tier: CrateTier;
  floor: CosmeticRarity;
  /** The canonical focus, or null for an unfocused crate. */
  focus: CosmeticCategory[] | null;
  /** The crate's own price (0 for a milestone crate). */
  crate: number;
  /** The focus fee, whole Aether (the percent of the price, rounded down like the SQL's integer division). */
  fee: number;
  total: number;
  /** How many items this crate could still give (always at least 1 in a quote). */
  remaining: number;
}

/**
 * What a crate costs this player right now. Null = sold out (nothing eligible) or a bad focus. `milestone` = the crate
 * is free and its floor is Legendary whatever `tier` was passed; only the focus fee is charged, at the Legendary price.
 */
export function quoteCrate(input: {
  tier: CrateTier; focus: readonly string[] | null; owned: Iterable<string>; economy?: AetherEconomy; milestone?: boolean; catalog?: readonly CosmeticDef[];
}): CrateQuote | null {
  const eco = input.economy ?? DEFAULT_AETHER_ECONOMY;
  const tier: CrateTier = input.milestone ? 'legendary' : input.tier;
  const floor = CRATE_TIER_FLOOR[tier];
  const owned = new Set(input.owned);
  const available = availableFocusCategories(owned, floor, input.catalog);
  const focus = normalizeFocus(input.focus, available);
  if (focus === 'bad') return null;
  const remaining = eligibleForCrate(owned, floor, focus, input.catalog).length;
  if (remaining === 0) return null;
  const price = eco.cratePrice[tier];
  const fee = focus ? Math.floor((price * focusFeePercent(focus.length, available.length, eco)) / 100) : 0;
  const crate = input.milestone ? 0 : price;
  return { tier, floor, focus, crate, fee, total: crate + fee, remaining };
}

// ── The roll ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Open a tiered crate: ONE server draw `u` in [0, 1] (the SQL's `random()`) is scaled by the floor's odds total, rolls a
 * rarity at or above the floor at the published odds, and where it landed inside that rarity's band (`frac`) picks an item
 * of it, EVERY eligible item of the rarity equally likely, in id order. A rarity with nothing left falls to the nearest
 * one at or above the floor (`crateRarityFallback`, ties toward the more common); null when nothing at or above the floor
 * is eligible. u = 1 is the last rarity with frac = 1. With floor Common this is `pickCrateReward` draw for draw.
 */
export function pickTieredCrateReward(eligible: readonly CosmeticDef[], floor: CosmeticRarity, u: number): CosmeticDef | null {
  const { rarities, sum } = floorBand(floor);
  const x = Math.min(Math.max(u, 0), 1) * sum;
  let rolled = rarities[rarities.length - 1]!;
  let frac = 1;
  let lo = 0;
  for (const r of rarities) {
    const hi = lo + CRATE_RARITY_ODDS[r];
    if (x < hi) { rolled = r; frac = (x - lo) / CRATE_RARITY_ODDS[r]; break; }
    lo = hi;
  }
  for (const r of crateRarityFallback(rolled).filter((q) => atOrAbove(q, floor))) {
    const bucket = eligible.filter((c) => c.rarity === r);
    if (bucket.length === 0) continue;
    return bucket[Math.min(bucket.length - 1, Math.max(0, Math.floor(frac * bucket.length)))]!;
  }
  return null;
}

/**
 * The exact chance of each eligible item from ONE crate of this floor (for tests, reports and any odds display): each
 * rarity at or above the floor gets its renormalized odds, passed to its fallback when it is empty, then split EQUALLY
 * among that rarity's eligible items. Sums to 1 while anything at or above the floor is eligible.
 */
export function tieredCrateChances(eligible: readonly CosmeticDef[], floor: CosmeticRarity): Map<string, number> {
  const { rarities, sum } = floorBand(floor);
  const out = new Map<string, number>();
  for (const rolled of rarities) {
    for (const r of crateRarityFallback(rolled).filter((q) => atOrAbove(q, floor))) {
      const bucket = eligible.filter((c) => c.rarity === r);
      if (bucket.length === 0) continue;
      for (const c of bucket) out.set(c.id, (out.get(c.id) ?? 0) + CRATE_RARITY_ODDS[rolled] / sum / bucket.length);
      break;
    }
  }
  return out;
}

// ── The purchase answer ─────────────────────────────────────────────────────────────────────────────────────

/**
 * What `buy_crate` answers (2026-10-18): the open result of the crate it just sold and opened (the same JSON keys as
 * `open_crate`), the Aether balance AFTER the charge, and the quote the server priced it at. A REPLAY of the same
 * request id answers `already_opened` with `quote: null`: the original charge stands, nothing is charged twice and no
 * fresh quote exists to give, so the quote is nullable.
 */
export interface BuyCrateResult extends OpenCrateResult {
  /** The balance after the purchase (always present on a purchase; it is optional only on a plain open). */
  aether: number;
  quote: CrateQuote | null;
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** Parse the server's quote object; null for anything malformed (never a half-trusted price). */
function parseCrateQuote(v: unknown): CrateQuote | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const tier = o.tier;
  if (typeof tier !== 'string' || !(CRATE_TIERS as readonly string[]).includes(tier)) return null;
  if (typeof o.floor !== 'string' || !(COSMETIC_RARITIES as readonly string[]).includes(o.floor)) return null;
  let focus: CosmeticCategory[] | null = null;
  if (o.focus !== null && o.focus !== undefined) {
    if (!Array.isArray(o.focus) || !o.focus.every((c) => typeof c === 'string' && (COSMETIC_CATEGORIES as readonly string[]).includes(c))) return null;
    focus = o.focus.length > 0 ? [...(o.focus as CosmeticCategory[])] : null;
  }
  if (!isCount(o.crate) || !isCount(o.fee) || !isCount(o.total) || !isCount(o.remaining)) return null;
  return { tier: tier as CrateTier, floor: o.floor as CosmeticRarity, focus, crate: o.crate, fee: o.fee, total: o.total, remaining: o.remaining };
}

/**
 * Parse a `buy_crate` answer. Null when it is not a valid open result, when the balance is missing or not a non-negative
 * integer, or when a quote is present but malformed. An explicit `quote: null` (a replay) is valid.
 */
export function parseBuyCrateResult(v: unknown): BuyCrateResult | null {
  const opened = parseOpenCrateResult(v);
  if (!opened || opened.aether === undefined) return null;
  const rawQuote = (v as Record<string, unknown>).quote;
  if (rawQuote === undefined) return null;
  const quote = rawQuote === null ? null : parseCrateQuote(rawQuote);
  if (rawQuote !== null && !quote) return null;
  return { ...opened, aether: opened.aether, quote };
}
