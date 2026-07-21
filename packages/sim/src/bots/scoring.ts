/**
 * Shared card valuation for the balance bots (owner ask 2026-07-21; see docs/bot-sims-handoff.md). A bot
 * scores every buy/keep decision through `cardScore`; the WEIGHTS a bot passes are what give it a personality
 * (a tempo bot prizes Taunt/Divine Shield survivability, a greedy bot just wants raw stats now, …). Pure and
 * deterministic — no RNG, no engine calls — so a report over it reproduces exactly.
 *
 * This is a heuristic, deliberately: it grounds the *cheap* decisions (which of two shop cards is better).
 * The strong bot (meta) additionally grounds its FINAL board in real `simulate()` outcomes — see rollout.ts.
 */
import type { RunState } from '../state';
import type { CardDef } from '@game/core';
import { CARD_INDEX } from '@game/content';

/** A bot's valuation personality. Every field is a multiplier/weight the shared scorer folds together, so a
 *  bot is (mostly) a Weights preset + a couple of behaviour flags. */
export interface BotWeights {
  /** Flat value per point of (attack + health) — the stat-density backbone. */
  statValue: number;
  /** Per-keyword bonuses (absent = 0). Survivability keywords let a defensive bot value a weak-statted Taunt. */
  taunt: number;
  divineShield: number;
  windfury: number;   // scaled by attack (it doubles the swing)
  venom: number;
  reborn: number;     // scaled by health (it comes back)
  cleave: number;
  stealth: number;
  /** Bonus per OTHER board minion sharing this card's tribe — rewards committing to a package. */
  tribeSynergy: number;
  /** Bonus when buying this card would PROGRESS a triple (1 copy owned) or COMPLETE one (2 owned, huge). */
  tripleProgress: number;
  tripleComplete: number;
  /** Penalty per Gold of cost — a value-per-cost trade rather than raw value. */
  costPenalty: number;
  /** Reward higher-tier bodies slightly (a T5 is usually a better keep than a T1 at equal stats). */
  tierValue: number;
}

/** Count board minions of a given tribe (dual-type via the def), for the synergy term. */
function tribeCount(state: RunState, tribe: string): number {
  let n = 0;
  for (const c of state.board) {
    const d = CARD_INDEX[c.cardId];
    if (c.tribe === tribe || d?.tribe2 === tribe || d?.universalTribe) n++;
  }
  return n;
}

/** How many copies of `cardId` we already have across board + hand (for triple-seeking; goldens don't count). */
function copiesOwned(state: RunState, cardId: string): number {
  let n = 0;
  for (const c of [...state.board, ...state.hand]) if (c.cardId === cardId && !c.golden) n++;
  return n;
}

/**
 * Score a card DEF in the context of the current run + a bot's weights. Higher = a better buy/keep. Used for
 * both shop offers (what to buy) and board cards (what to sell — the weakest scorer goes).
 */
export function cardScore(def: CardDef, state: RunState, w: BotWeights): number {
  if (def.spell) return scoreSpell(def, state, w);
  let v = (def.attack + def.health) * w.statValue;

  const kw = def.keywords;
  if (kw.includes('T')) v += w.taunt;
  if (kw.includes('DS')) v += w.divineShield;
  if (kw.includes('W')) v += w.windfury + def.attack * 0.5 * w.windfury;
  if (kw.includes('V')) v += w.venom;
  if (kw.includes('R')) v += w.reborn + def.health * 0.3 * w.reborn;
  if (kw.includes('C')) v += w.cleave;
  if (kw.includes('ST')) v += w.stealth;

  // A card with a Battlecry / Deathrattle / on-attack effect is doing more than its stats — a flat nudge so
  // effect cards aren't undervalued vs vanilla beaters of the same size.
  if (def.effects.length > 0) v += 1.5 * w.statValue;

  // Tribe commitment.
  const syn = def.tribe && def.tribe !== 'neutral' ? tribeCount(state, def.tribe) : 0;
  v += syn * w.tribeSynergy;

  // Triple-seeking.
  const owned = copiesOwned(state, def.id);
  if (owned === 1) v += w.tripleProgress;
  else if (owned >= 2) v += w.tripleComplete;

  v += (def.tier ?? 1) * w.tierValue;
  v -= (def.tier ?? 1) * w.costPenalty; // cost tracks tier for buyable cards
  return v;
}

/** Spells are one-shot — valued by their tier as a rough proxy (a proper per-spell model is future work). A
 *  bot with `statValue` still keeps them comparable to minions so it doesn't ignore a strong spell package. */
function scoreSpell(def: CardDef, _state: RunState, w: BotWeights): number {
  return (def.tier ?? 1) * (w.tierValue + w.statValue * 1.5);
}
