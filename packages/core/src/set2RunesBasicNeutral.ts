/**
 * SET 2 RUNE BATCH, BASIC NEUTRAL (owner review 2026-11-12, docs/design/2026-11-12-set2-rune-batch.md): the printed
 * numbers both phases and the rune tallies read, so the Shop module (`packages/sim/src/set2RunesBasicNeutral.ts`), the
 * simulator and the badge cannot drift.
 */
export const SET2_BASIC_NEUTRAL = {
  /** Piggy Bank: End of Turn, a random friendly minion +1/+3, repeated for every unspent Gold. */
  piggyBank: { attack: 1, health: 3 },
  /** Hazard Pay: after a lost combat, Gold and free Refreshes (per copy). */
  hazardPay: { gold: 3, refreshes: 1 },
  /** Second Opinion: extra Discover options per copy. */
  secondOpinionExtra: 1,
  /** Shield Wall: Start of Combat, your Taunt minions gain this. */
  shieldWall: { attack: 4, health: 6 },
  /** Shatterproof: a Ward loss gives that minion this, permanently. */
  shatterproof: { attack: 5, health: 5 },
  /** Warm-Up: Pummel (150), 2 Gold next turn, once per combat. */
  warmUp: { every: 150, gold: 2 },
  /** Golden Handshake: a Gild gives your minions this. */
  goldenHandshake: { attack: 2, health: 2 },
  /** Late Bloomer: a Shop upgrade pays this Gold and gives your minions this. */
  lateBloomer: { gold: 2, attack: 3, health: 3 },
  /** Loyal Customer: every Nth minion bought is free. */
  loyalCustomerEvery: 4,
} as const;
