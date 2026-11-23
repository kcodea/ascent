/**
 * SET 3 NEW-CONCEPT RUNES, UNDEAD (owner review 2026-11-23) — the printed numbers both phases read: the Shop module
 * (`packages/sim/src/set3UndeadRunes.ts`), `simulate.ts` and the badge / live text, so the halves cannot drift.
 * Every value is PER COPY held (the boolean-flag family rule, owner 2026-08-27) unless it is a cap.
 */
export const SET3_UNDEAD_RUNES = {
  /** Grave Tithe: "After 3 friendly minions Rise in a combat, gain 2 Gold next turn. (Once per combat.)" */
  graveTitheRises: 3,
  graveTitheGold: 2,
  /** Dead Weight: "Overflow: give your Undead Aura +2 Attack." */
  deadWeightAttack: 2,
  /** Bone Pile: "Start of Combat: summon a Skeleton for every 2 Undead you control." */
  bonePilePer: 2,
  /** Requiem: "Whenever your Undead Aura improves, give your Undead +1/+1 permanently. (5 times per turn.)" The cap is
   *  per TURN, Shop and that turn's combat together (R-TURN-01), and does not scale with copies (copies scale the grant). */
  requiem: { attack: 1, health: 1 },
  requiemPerTurn: 5,
  /** Undying Legion: "Avenge (5): get a random Undead minion and summon it from your hand." */
  undyingLegionAvenge: 5,
} as const;

/** The Skeleton token Bone Pile and Second Burial summon (the Endless March's old 1/1, Set 3). */
export const SKELETON_TOKEN_ID = 'u3_skeleton';
/** The Spear Warden (the set-1 card, in the Set 3 pool) Night Watch summons and Rank and File grants Taunt to. */
export const SPEAR_WARDEN_ID = 'knit';
/** The Footman token (Deathless Hand's summon) Rank and File grants Taunt to. */
export const FOOTMAN_ID = 'footman';
/** Rank and File: does this card id get Taunt? */
export function rankAndFileTaunts(cardId: string): boolean {
  return cardId === FOOTMAN_ID || cardId === SPEAR_WARDEN_ID;
}
