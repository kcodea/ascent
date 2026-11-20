import type { CombatEvent } from '@game/core';
import { CONFIG, boardManaBonus, type RunState } from '@game/sim';
import type { PrefixFoldSpec } from './choreo/prefixFold';
import { inHandRange, WHOLE_LOG, type HandRange } from './ownHandRange';

/** The Gold a fight has added for next turn SO FAR, read off the replayed log (R-COMBAT-TIER-GOLD-01). */
export interface LiveCombatGold {
  /** Max Gold raised (`maxGold` events: Soulsman, Bone Taxer, Nadja x Death, Rune of Soul Taxes, Richmond's own half). */
  maxGold: number;
  /** One-turn Gold banked for next turn (`bonusGold` events, R-COMBAT-GOLD-EVENT-01). */
  nextTurn: number;
}

export const NO_LIVE_GOLD: LiveCombatGold = { maxGold: 0, nextTurn: 0 };

/**
 * The Gold pill's hover forecast: the projected STARTING Gold of the next two turns. Cap-aware, folding in board
 * mana income (Money Bot), the permanent above-cap bonus (`maxGoldBonus`) and the one-turn bank
 * (`bonusEmbersNextTurn`, into the next turn only, since it is consumed then). Mirrors the reducer's turn-start
 * `embers` formula (`advanceCombat`, reducer.ts).
 *
 * `live` (R-COMBAT-TIER-GOLD-01, owner ask 2026-11-20): what the fight on screen has added SO FAR, folded off the
 * replayed events (`combatGoldFold`). Pure presentation of the log: settle writes the same gains into the run, so the
 * caller passes it only while the fight is UNSETTLED (`liveCombatGold`) and nothing is counted twice.
 */
export function goldForecastOf(run: RunState, live: LiveCombatGold = NO_LIVE_GOLD): { next: number; afterNext: number } {
  const above = (run.maxGoldBonus ?? 0) + boardManaBonus(run) + live.maxGold;
  const grown = (waves: number): number =>
    Math.max(run.maxEmbers, Math.min(CONFIG.embersCap, run.maxEmbers + waves * CONFIG.embersPerWave));
  return {
    next: grown(1) + above + (run.bonusEmbersNextTurn ?? 0) + live.nextTurn,
    afterNext: grown(2) + above,
  };
}

/** The live delta to fold into the forecast: the replay's reading while the fight is unsettled, nothing otherwise
 *  (out of combat there is no fight; once settled the run state already holds the gains). */
export function liveCombatGold(phase: RunState['phase'], combatSettled: boolean, replayed: LiveCombatGold): LiveCombatGold {
  return phase === 'combat' && !combatSettled ? replayed : NO_LIVE_GOLD;
}

/**
 * The fight's Gold for next turn, folded over the events played so far: the PLAYER side only, and in a Duos fight only
 * the player's own board (`ownHand`, R-DUOS-HAND-OWN-01: each teammate settles only their own board's carry; the
 * teammate's half of a team grant reaches this run live through the pass channel). Continued by `makePrefixFold`, so
 * a Skip, a seek and a resumed save all read the same number.
 */
export const COMBAT_GOLD_FOLD: PrefixFoldSpec<LiveCombatGold & { range: HandRange }, LiveCombatGold, HandRange> = {
  init: (range) => ({ maxGold: 0, nextTurn: 0, range: range ?? WHOLE_LOG }),
  step: (s, e: CombatEvent, i) => {
    if (e.type === 'maxGold') { if (e.side === 'player' && inHandRange(i, s.range)) s.maxGold += e.amount; }
    else if (e.type === 'bonusGold') { if (e.side === 'player' && inHandRange(i, s.range)) s.nextTurn += e.amount; }
  },
  read: (s) => ({ maxGold: s.maxGold, nextTurn: s.nextTurn }),
};
