/**
 * THE PACK ECONOMY DOCUMENT (spec docs/superpowers/specs/2026-11-27-pack-economy-design.md, section 7).
 *
 * Every number the pack shop and the server-side pack roll run on: prices, duplicate payouts, odds, the purchase reward,
 * the level pack, Welcome, the counter and the shop window. The server stores this exact JSON (`pack_config`) and the
 * client reads the same shape; a retune is an UPDATE, not a release. `parsePackEconomy` is strict: null on anything
 * malformed, never a partly-trusted document.
 *
 * DEPENDENCY-FREE ON PURPOSE: sibling relative imports only (a shared artifact, see `sharedArtifact.ts`).
 */

import { COSMETIC_RARITIES, type CrateRarity } from './cosmetics';

export interface PackEconomy {
  version: number;
  rarityPackPrice: Record<CrateRarity, number>;
  themedPackPrice: number;
  duplicateAether: Record<CrateRarity, number>;
  /** Percent, sums to 100. */
  standardOdds: Record<CrateRarity, number>;
  rewardEvery: number;
  rewardRarity: CrateRarity;
  levelPackEvery: number;
  levelPackRarity: CrateRarity;
  welcomePacks: Record<CrateRarity, number>;
  freePackRarity: CrateRarity;
  counterTypes: number;
  stackMax: number;
  refreshHours: number;
  refreshZone: string;
  featuredDeals: number;
  /** Percent off. */
  dealOff: { min: number; max: number; step: number };
  /** Per player, per window. */
  dealStock: { min: number; max: number };
}

const byRarity = (v: readonly [number, number, number, number, number]): Record<CrateRarity, number> =>
  Object.freeze({ common: v[0], rare: v[1], epic: v[2], legendary: v[3], ancient: v[4] });

/** The owner's values (2026-11-27), version 1. */
export const DEFAULT_PACK_ECONOMY: Readonly<PackEconomy> = Object.freeze({
  version: 1,
  rarityPackPrice: byRarity([100, 175, 300, 500, 850]),
  themedPackPrice: 200,
  duplicateAether: byRarity([20, 35, 60, 100, 170]),
  standardOdds: byRarity([35, 31, 22, 9, 3]),
  rewardEvery: 15,
  rewardRarity: 'epic',
  levelPackEvery: 5,
  levelPackRarity: 'legendary',
  welcomePacks: byRarity([5, 2, 1, 1, 0]),
  freePackRarity: 'rare',
  counterTypes: 5,
  stackMax: 8,
  refreshHours: 6,
  refreshZone: 'America/New_York',
  featuredDeals: 4,
  dealOff: Object.freeze({ min: 20, max: 60, step: 5 }),
  dealStock: Object.freeze({ min: 2, max: 5 }),
} satisfies PackEconomy);

/** The launch gift: Aether granted to launch-day accounts only (owner 2026-11-27). */
export const PACK_LAUNCH_GRANT = 3000;
/** The version of the roll the server runs (bumped when the roll's rules change). */
export const PACK_ROLL_VERSION = 1;

const isRarity = (v: unknown): v is CrateRarity => typeof v === 'string' && (COSMETIC_RARITIES as readonly string[]).includes(v);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** An integer of at least `min`, or null. */
const int = (v: unknown, min = 0): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= min ? v : null);

/** A per-rarity table with exactly the five rarity keys, every value a non-negative integer. */
function rarityTable(v: unknown): Record<CrateRarity, number> | null {
  if (!isRecord(v) || Object.keys(v).length !== COSMETIC_RARITIES.length) return null;
  const out = {} as Record<CrateRarity, number>;
  for (const r of COSMETIC_RARITIES) {
    const n = int(v[r]);
    if (n === null) return null;
    out[r] = n;
  }
  return out;
}

/** The strict parser: a complete, sane document, or null. */
export function parsePackEconomy(v: unknown): PackEconomy | null {
  if (!isRecord(v)) return null;
  const rarityPackPrice = rarityTable(v.rarityPackPrice);
  const duplicateAether = rarityTable(v.duplicateAether);
  const standardOdds = rarityTable(v.standardOdds);
  const welcomePacks = rarityTable(v.welcomePacks);
  const version = int(v.version, 1);
  const themedPackPrice = int(v.themedPackPrice);
  const rewardEvery = int(v.rewardEvery, 1);
  const levelPackEvery = int(v.levelPackEvery, 1);
  const counterTypes = int(v.counterTypes, 1);
  const stackMax = int(v.stackMax, 1);
  const refreshHours = int(v.refreshHours, 1);
  const featuredDeals = int(v.featuredDeals);
  if (!rarityPackPrice || !duplicateAether || !standardOdds || !welcomePacks) return null;
  if (version === null || themedPackPrice === null || rewardEvery === null || levelPackEvery === null) return null;
  if (counterTypes === null || stackMax === null || refreshHours === null || featuredDeals === null) return null;
  if (24 % refreshHours !== 0) return null; // windows must tile the day
  if (COSMETIC_RARITIES.reduce((s, r) => s + standardOdds[r], 0) !== 100) return null;
  if (!isRarity(v.rewardRarity) || !isRarity(v.levelPackRarity) || !isRarity(v.freePackRarity)) return null;
  if (typeof v.refreshZone !== 'string' || v.refreshZone === '') return null;
  const off = v.dealOff;
  const stock = v.dealStock;
  if (!isRecord(off) || !isRecord(stock)) return null;
  const offMin = int(off.min);
  const offMax = int(off.max);
  const offStep = int(off.step, 1);
  const stockMin = int(stock.min);
  const stockMax = int(stock.max);
  if (offMin === null || offMax === null || offStep === null || stockMin === null || stockMax === null) return null;
  if (offMax < offMin || offMax > 100 || (offMax - offMin) % offStep !== 0 || stockMax < stockMin) return null;
  return {
    version, rarityPackPrice, themedPackPrice, duplicateAether, standardOdds,
    rewardEvery, rewardRarity: v.rewardRarity, levelPackEvery, levelPackRarity: v.levelPackRarity,
    welcomePacks, freePackRarity: v.freePackRarity, counterTypes, stackMax, refreshHours, refreshZone: v.refreshZone,
    featuredDeals, dealOff: { min: offMin, max: offMax, step: offStep }, dealStock: { min: stockMin, max: stockMax },
  };
}

/**
 * The odds a Rarity Pack DISPLAYS, in percent to one decimal (the `tierOddsPercent` rounding): `cards` is every card's
 * Standard roll; `last` is the guaranteed last card, each rarity at or above the floor renormalized, 0 below it.
 */
export function rarityPackOdds(
  floor: CrateRarity, eco: PackEconomy = DEFAULT_PACK_ECONOMY,
): { cards: Record<CrateRarity, number>; last: Record<CrateRarity, number> } {
  const at = COSMETIC_RARITIES.indexOf(floor);
  const sum = COSMETIC_RARITIES.reduce((s, r, i) => (i >= at ? s + eco.standardOdds[r] : s), 0);
  const cards = {} as Record<CrateRarity, number>;
  const last = {} as Record<CrateRarity, number>;
  COSMETIC_RARITIES.forEach((r, i) => {
    cards[r] = Math.round(eco.standardOdds[r] * 10) / 10;
    last[r] = i >= at && sum > 0 ? Math.round((eco.standardOdds[r] / sum) * 100 * 10) / 10 : 0;
  });
  return { cards, last };
}
