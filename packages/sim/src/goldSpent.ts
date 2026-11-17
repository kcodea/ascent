/**
 * GOLD SPENT, COUNTED: the one answer to "how much Gold has this run spent?" for every MECHANIC that counts it.
 *
 * Owner ruling 2026-11-17 ("all spend mechanics should function in the same way"): Big Spender makes each Gold you spend
 * count twice (three times with two copies) for EVERYTHING that counts Gold spent: the "When you spend N Gold" meters,
 * the "for each Gold spent this turn" readers (Baby Gastrid, Rope Wrangler, Patch Job, Rune of Spending, the Ancient
 * pairings), the run-long counts (Ancient Wanderer, Indy's recharge, Summit's lock) and the "Spend N Gold" quests.
 *
 * The real Gold stays on `goldSpent` / `goldSpentThisTurn` (economy stats, match history, telemetry, the Gold fuse
 * timer, achievements). Big Spender's extra lands on `goldSpentExtra` / `goldSpentExtraThisTurn`, written only by the
 * reducer's `spendGold`. A mechanic reads the two helpers below, never the raw tallies.
 */
import type { RunState } from './state';
import { runeStacksOf } from './runeDup';

/** How many times each Gold spent counts right now: 1, or 1 + the Big Spender copies held. */
export function goldCountMult(s: Pick<RunState, 'questFlags' | 'runeStacks'>): number {
  return s.questFlags?.runeBigSpender ? 1 + runeStacksOf(s, 'rune_big_spender') : 1;
}

/** The COUNTED Gold spent this turn: the real tally plus Big Spender's extra. */
export function countedGoldSpentThisTurn(s: Partial<Pick<RunState, 'goldSpentThisTurn' | 'goldSpentExtraThisTurn'>>): number {
  return Math.max(0, (s.goldSpentThisTurn ?? 0) + (s.goldSpentExtraThisTurn ?? 0));
}

/** The COUNTED Gold spent this run: the real total plus Big Spender's extra. */
export function countedGoldSpent(s: Partial<Pick<RunState, 'goldSpent' | 'goldSpentExtra'>>): number {
  return Math.max(0, (s.goldSpent ?? 0) + (s.goldSpentExtra ?? 0));
}
