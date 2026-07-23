import type { CombatSideState } from '../types';

/** The neutral, all-zero side context — a board with no run economy behind it (the procedural threat, an
 *  offline harness board, or a test that only cares about the minions). `simulate()` defaults both sides to
 *  this, so a bare `simulate(player, enemy, rng, cards)` behaves exactly as before. Frozen: never mutate it —
 *  clone via `combatSide(...)` to override fields. */
export const EMPTY_SIDE: Readonly<CombatSideState> = Object.freeze({
  spellsThisTurn: 0,
  spellsCast: 0,
  deathrattles: 0,
  spellPowerAtk: 0,
  spellPowerHp: 0,
  undeadAtk: 0,
  undeadHp: 0,
  undeadBuyAtk: 0,
  impAtk: 0,
  impHp: 0,
  fodderConsumedAtk: 0,
  fodderConsumedHp: 0,
  beastBuyAtk: 0,
  beastsPlayed: 0,
  magneticAtk: 0,
  magneticHp: 0,
  rubyBonus: { attack: 0, health: 0 },
  tier: 1,
  tribes: [] as string[],
  cardBuffs: {} as Record<string, { attack: number; health: number }>,
  questMods: {},
});

/** Build a `CombatSideState`, filling every unspecified field from `EMPTY_SIDE`. The single ergonomic way to
 *  construct a side's run context — `combatSide({ spellsThisTurn: 2, tier: 6 })` — for the reducer, the tools,
 *  and every test, so no caller has to spell out all ~20 fields. */
export function combatSide(partial: Partial<CombatSideState> = {}): CombatSideState {
  return { ...EMPTY_SIDE, ...partial };
}
