import type { CardDef } from './types';

/**
 * THE LEGAL RANDOM MINION (owner reports 2026-10-20, R-RANDOM-POOL-01).
 *
 * "A random minion" effects (summon one, get one, discover one) used to build their candidate list straight off the
 * set pool with only `!token && !spell`, and the set pool carries every TIER 7 minion of the set. The Shop never
 * offers those (it caps at your Shop tier, and a normal run's Shop tier tops out at 6), so a picker with no tier
 * bound of its own handed out cards no Shop could ever sell: a Funeral on Loan Bullseye rolled Elderhorn, and Rune
 * of the Foundry handed over Orivax.
 *
 * Every random-minion picker filters through here, so the rule lives once:
 *  - a MINION (not a spell, not a Ruby),
 *  - not a token (generated or reward-only bodies),
 *  - not a henchman (hero-bound, never in any shop),
 *  - at or below the tier CEILING: 6, or 7 only while that player's Shop actually stands at Tier 7. Tier-7 access
 *    alone (Summit, Open Road) does not open it (R-RANDOM-TIER7-01, owner 2026-10-21).
 *
 * An effect whose text NAMES a tier ("a random Tier 7 minion", Rune of the Deep) asks for that tier explicitly and
 * does not come through this gate. The filter keeps the input order, so seeded picks stay replay-stable.
 */
export const STANDARD_TIER_CEILING = 6;

export function isLegalRandomMinion(c: CardDef | undefined, ceiling: number = STANDARD_TIER_CEILING): c is CardDef {
  return !!c && !c.spell && !c.ruby && !c.token && !c.henchman && c.tier <= ceiling;
}

/** `pool` narrowed to the legal random minions at or below `ceiling`, input order preserved. */
export function legalRandomMinions(pool: readonly CardDef[], ceiling: number = STANDARD_TIER_CEILING): CardDef[] {
  return pool.filter((c) => isLegalRandomMinion(c, ceiling));
}

/** The same gate for a MIXED candidate list (minions + spells, e.g. "a random Choose One card"): spells pass
 *  untouched (their own pool rules apply), minions must be legal. */
export function isLegalRandomCard(c: CardDef, ceiling: number = STANDARD_TIER_CEILING): boolean {
  return c.spell ? true : isLegalRandomMinion(c, ceiling);
}

/** THE random-pick ceiling for one player, both phases (the Shop's `randomTierCeiling` calls this): Tier 7 only
 *  while that player's Shop stands at Tier 7, else the standard 6. R-RANDOM-TIER7-01 (owner 2026-10-21, "cant be
 *  getting t7s in combat either"): access alone never opens Tier 7 to a random picker. */
export function combatTierCeiling(sideTier: number): number {
  return sideTier >= 7 ? 7 : STANDARD_TIER_CEILING;
}
