/**
 * SET 2 RUNE BATCH, BASIC TRIBAL (owner review 2026-11-12) — the printed numbers both phases read: the Shop module
 * (`packages/sim/src/set2RunesBasicTribal.ts`), `simulate.ts` and the badge / live text, so the halves cannot drift.
 * Every value is PER COPY held (the boolean-flag family rule, owner 2026-08-27).
 */
export const SET2_TRIBAL_RUNES = {
  /** Bloodscent: "When a Beast kills a minion, it gains +4/+4 permanently." */
  bloodscent: { attack: 4, health: 4 },
  /** Trophy Hunter: "When a Beast kills a minion, gain 1 Gold next turn. (3 per combat.)" */
  trophyHunterGold: 1,
  trophyHunterPerCombat: 3,
  /** Pitchforks: "Imps deal 3 damage to 2 enemies when summoned." */
  pitchforksDamage: 3,
  pitchforksTargets: 2,
  /** Imp Legion: "Echo: deal 3 damage to the lowest-Health enemy." */
  impLegionDamage: 3,
  /** Collections: "give minions in the Shop +2/+2 permanently." */
  collections: { attack: 2, health: 2 },
  /** Flamekeeper: "give your Dragons +2/+2 permanently." */
  flamekeeper: { attack: 2, health: 2 },
  /** Hatchling Roost: "Dragons with a Shout cost 1 Gold." */
  hatchlingRoostPrice: 1,
  /** Dragon Hoard: "if you cast 3 or more Shop spells this turn, get a Dragonflame." */
  dragonHoardSpells: 3,
} as const;

/** The Dragonflame spell id (Flamekeeper hears it; Dragon Hoard grants it). */
export const DRAGONFLAME_ID = 'sp_dragonflame';
