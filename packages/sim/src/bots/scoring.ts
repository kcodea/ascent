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
import { effectsValue } from './effects';
import type { BotPackage } from './packages';

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
  /** Weight on the estimated value of a card's EFFECTS (magnitude-aware — see effects.ts). */
  effectWeight: number;
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
export function cardScore(def: CardDef, state: RunState, w: BotWeights, pkg?: BotPackage): number {
  if (def.spell) return scoreSpell(def, state, w) + (pkg?.fits(def) ?? 0);
  let v = (def.attack + def.health) * w.statValue;

  const kw = def.keywords;
  if (kw.includes('T')) v += w.taunt;
  if (kw.includes('DS')) v += w.divineShield;
  if (kw.includes('W')) v += w.windfury + def.attack * 0.5 * w.windfury;
  if (kw.includes('V')) v += w.venom;
  if (kw.includes('R')) v += w.reborn + def.health * 0.3 * w.reborn;
  if (kw.includes('C')) v += w.cleave;
  if (kw.includes('ST')) v += w.stealth;

  // Effect value — magnitude-aware (a +5/+5 Deathrattle outscores a +1/+1 one, a big summon outscores a
  // small buff), trigger-weighted. Replaces the old flat per-effect nudge, so buys stop treating all effect
  // cards alike.
  if (def.effects.length > 0) v += effectsValue(def.effects) * w.effectWeight;

  // Tribe commitment.
  const syn = def.tribe && def.tribe !== 'neutral' ? tribeCount(state, def.tribe) : 0;
  v += syn * w.tribeSynergy;

  // Triple-seeking.
  const owned = copiesOwned(state, def.id);
  if (owned === 1) v += w.tripleProgress;
  else if (owned >= 2) v += w.tripleComplete;

  v += (def.tier ?? 1) * w.tierValue;
  v -= (def.tier ?? 1) * w.costPenalty; // cost tracks tier for buyable cards
  // EXPLORER package commitment — a big nudge toward the archetype this run is building.
  v += pkg?.fits(def) ?? 0;
  return v;
}

/** Spell factories that hit your WHOLE board — their value multiplies by how many bodies are out to receive
 *  it, which is the single biggest thing the old tier-only model missed (Growth's +3/+4 across five minions is
 *  a ~35-stat swing, not a "tier 4" shrug). */
const BOARD_WIDE_SPELL = new Set<string>(['spellBuffAll', 'spellGrantTribeAttack', 'spellPendingSCBuff']);

/**
 * Score a SPELL. Spells were previously valued by tier alone — `tier × (tierValue + statValue×1.5)` — which
 * made every T4 spell identical and left them structurally unable to out-score a body, so bots bought ~0 per
 * run. This reads what the spell actually DOES:
 *   - its effect magnitude (the same estimator minions use),
 *   - multiplied by the board it lands on when it's a board-wide effect,
 *   - plus the run's spell power, which pumps every stat-granting spell,
 *   - minus its real Gold cost (spells carry `cost`; minions' cost just tracks tier).
 * Kept on the same scale as `cardScore` so the two remain directly comparable in the buy loop.
 */
function scoreSpell(def: CardDef, state: RunState, w: BotWeights): number {
  const boardN = state.board.length;
  let magnitude = 0;
  for (const e of def.effects) {
    const p = (e.params ?? {}) as Record<string, number | undefined>;
    const stats = (p.attack ?? 0) + (p.health ?? 0);
    if (BOARD_WIDE_SPELL.has(e.do)) {
      // Lands on every body — scale by the board, and fold in spell power (it applies per target too).
      const perTarget = stats + spellPowerBonus(state);
      magnitude += perTarget * Math.max(1, boardN);
    } else {
      magnitude += effectsValue([e]) + (stats > 0 ? spellPowerBonus(state) : 0);
    }
  }
  // An empty-param utility spell (Discover, refresh, steal) still does something — floor it.
  if (magnitude <= 0) magnitude = 3;
  let v = magnitude * (w.effectWeight + 0.9) + (def.tier ?? 1) * w.tierValue;
  v -= (def.cost ?? 0) * (w.costPenalty + 0.6); // a real Gold cost, unlike a minion's tier-tracked price
  // A board-wide buff with nothing on board is a dead card — don't buy it into an empty board.
  if (boardN === 0) v -= 4;
  return v;
}

/** The run's accumulated spell power (both halves) — every stat-granting spell gets this much bigger, so a
 *  Spellbinder-style run should value spells more highly than a run with none. */
function spellPowerBonus(state: RunState): number {
  const sp = state.spellBonus;
  return (sp?.attack ?? 0) + (sp?.health ?? 0);
}
