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
 *  - at or below the run's tier CEILING: 6 in a normal run, 7 only with Tier-7 access (Summit, Open Road).
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

/** Combat's ceiling for one side: a side whose Shop already stands at Tier 7 has access; every other side is
 *  capped at the standard 6. (Combat carries no access flag; the Shop tier is the honest read.) */
export function combatTierCeiling(sideTier: number): number {
  return Math.max(STANDARD_TIER_CEILING, sideTier);
}
