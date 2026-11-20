import { CONFIG, boardManaBonus, type RunState } from '@game/sim';

/**
 * The Gold pill's hover forecast: the projected STARTING Gold of the next two turns. Cap-aware, folding in board
 * mana income (Money Bot), the permanent above-cap bonus (`maxGoldBonus`: Shop License, Soulsman, Bone Taxer,
 * Nadja x Death) and the one-turn bank (`bonusEmbersNextTurn`: Hoarder, Bounty Bot, ...; into the next turn only,
 * since it is consumed then). Mirrors the reducer's turn-start `embers` formula (`advanceCombat`, reducer.ts).
 *
 * `liveMaxGold` (R-COMBAT-TIER-GOLD-01, owner ask 2026-11-20): max Gold the fight on screen has raised SO FAR, read
 * off the replayed `maxGold` events (`replay.combatBuffs.gold`, the same fold the Buffs window ticks). It is pure
 * presentation of the log: settle writes the same gain into `maxGoldBonus`, so the caller passes it only while the
 * fight is UNSETTLED (see `liveCombatMaxGold`) and the reading never counts it twice.
 */
export function goldForecastOf(run: RunState, liveMaxGold = 0): { next: number; afterNext: number } {
  const above = (run.maxGoldBonus ?? 0) + boardManaBonus(run) + liveMaxGold;
  const grown = (waves: number): number =>
    Math.max(run.maxEmbers, Math.min(CONFIG.embersCap, run.maxEmbers + waves * CONFIG.embersPerWave));
  return {
    next: grown(1) + above + (run.bonusEmbersNextTurn ?? 0),
    afterNext: grown(2) + above,
  };
}

/** The live combat max-Gold delta to fold into the forecast: the replay's reading while the fight is unsettled,
 *  0 otherwise (out of combat there is no fight; once settled the run state already holds the gain). */
export function liveCombatMaxGold(phase: RunState['phase'], combatSettled: boolean, replayedMaxGold: number): number {
  return phase === 'combat' && !combatSettled ? replayedMaxGold : 0;
}
