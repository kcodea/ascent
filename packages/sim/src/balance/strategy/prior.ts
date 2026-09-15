/**
 * BALANCE BOT B4 — THE LINE PRIOR: what the strategist adds to the generalist's evaluator for one decision.
 *
 * Every term reads the VISIBLE state only (`BotVisibleState`) and returns a small normalized number; the pilot
 * installs the prior through `withEvaluationPrior` at `PRIOR_WEIGHT`, so it rides inside `pilotSearch`, the
 * sampled futures and the positioning pass alike. It never generates an action — legality stays the reducer's —
 * and it is capped so the fight-grounded terms remain dominant (roadmap: "Priors guide construction; they do not
 * replace engine outcomes").
 *
 * Terms:
 *  - CARD AFFINITY — members of the line on the board (and, at a discount, in hand). This is what makes the
 *    strategist buy the engine piece over a vanilla body of equal stats, keep it, and not sell it.
 *  - RUNE AFFINITY — owned runes that serve the line, valued by expected payoff over the REMAINING rounds: a
 *    rune that pays every turn is worth more early; a one-shot grant is worth the same whenever it lands.
 *  - TIER TIMING — the line's economy profile: behind the curve is bad, on it is good, ahead of it wastes Gold.
 *  - PAIRS HELD — a held pair of a line card is two-thirds of a triple: save the third copy.
 *  - HERO BIAS — a small nudge to have USED an affine hero power (`powerReady` false after use — the view cannot
 *    tell "used" from "gated", so this stays tiny).
 */
import { CARD_INDEX, RUNE_INDEX } from '@game/content';
import type { CardDef } from '@game/core';
import type { BotVisibleState } from '../../productionBots/types';
import type { EvaluationPrior } from '../../productionBots/evaluate';
import { packageById, runeAffinity, runeIsRecurring, type StrategyPackage } from './packages';
import type { LineChoice } from './lines';
import { valueTermOf, type ValueModel } from '../value';

/** The prior's weight in utility units per normalized point. Sized so a full line on the board (~1.5) is worth
 *  about half of `fightStrength`'s range — enough to steer construction, never enough to lose a fight for it. */
export const PRIOR_WEIGHT = 10;

/** The horizon a line plans against — the typical length of an eight-seat lobby (a per-turn rune is fully
 *  valued with ≥ 8 rounds left, and decays linearly after). */
export const PLANNING_HORIZON = 14;

export interface LinePackages { primary: StrategyPackage; secondary: StrategyPackage | null }

export function packagesOf(line: LineChoice): LinePackages {
  return { primary: packageById(line.primary), secondary: line.secondary ? packageById(line.secondary) : null };
}

/** A card's affinity to the line in [0, 1]: the primary's member score / 3, plus the secondary's at 40%. */
export function cardAffinity(def: CardDef | undefined, pk: LinePackages): number {
  if (!def) return 0;
  const p = pk.primary.member(def) / 3;
  const s = pk.secondary ? (pk.secondary.member(def) / 3) * 0.4 : 0;
  return Math.min(1, p + s);
}

/** Owned-rune affinity to the line in [0, 1]. */
export function lineRuneAffinity(runeId: string, pk: LinePackages): number {
  const rune = RUNE_INDEX[runeId];
  if (!rune) return 0;
  const p = runeAffinity(pk.primary, rune);
  const s = pk.secondary ? runeAffinity(pk.secondary, rune) * 0.4 : 0;
  return Math.min(1, p + s);
}

/** The tier the profile wants by `wave`. */
export function targetTier(pk: StrategyPackage, wave: number): number {
  let t = 1;
  for (let tier = 2; tier <= 6; tier++) {
    const by = pk.economy.tierByWave[tier as 2 | 3 | 4 | 5 | 6];
    if (by !== undefined && wave >= by) t = tier;
  }
  return t;
}

/** Expected payoff of a rune bought now, in [0, 1]: a recurring rune scales with the rounds left; a one-shot
 *  grant is a fixed fraction (it lands once, whenever). */
export function runePayoff(runeId: string, wave: number): number {
  const rune = RUNE_INDEX[runeId];
  if (!rune) return 0;
  const remaining = Math.max(1, PLANNING_HORIZON - wave);
  return runeIsRecurring(rune) ? Math.min(1, remaining / 8) : 0.6;
}

export interface PriorBreakdown { cards: number; runes: number; timing: number; pairs: number; hero: number; mass: number; investment: number; clutter: number; value: number; total: number }

/** The learned value term's weight in UTILITY units per unit of the model's output (the coordinator's ceiling is
 *  30 on the evaluator's scale; heavier makes the pilot tier on the real curve but die earlier at depth 1). */
export const VALUE_WEIGHT = 20;

/**
 * A wave's board-mass reference — the procedural enemy curve's "healthy board" (`8 + 7·wave`, as `evaluate.ts`
 * uses for `boardPower`), kept LINEAR here so a stat is worth the same at wave 9 as at wave 4. The evaluator's
 * own terms go flat exactly where it matters: `boardPower` is log-saturated past the reference and `fightStrength`
 * reads 0 for every board once the real population outgrows the pilot (measured 2026-09-15: 100 pinned set-2
 * lobbies, 77 total stats at wave 8 against the recorded players' 162, win rate 18% and falling — the search had
 * no gradient left to prefer a Tier-4 body over a Tier-1 one).
 */
export const massReference = (wave: number): number => Math.max(20, 8 + 7 * wave);

/** The prior's terms for one visible state (exported for traces and the curricula). */
export function linePriorBreakdown(v: BotVisibleState, line: LineChoice, pk: LinePackages = packagesOf(line), model: ValueModel | null = null, valueWeight = VALUE_WEIGHT): PriorBreakdown {
  // CARDS. Board at full value (golden 1.5×); a MINION in hand at 0.6 (a line body not yet fielded). Spells and
  // Rubies in hand count for nothing: their value is in the cast, and crediting them held made the pilot hoard
  // its own payoff spells (measured 2026-09-15: a tempo line sat on Spirit Fire rather than cast it).
  let cardSum = 0;
  for (const c of v.board) cardSum += cardAffinity(CARD_INDEX[c.cardId], pk) * (c.golden ? 1.5 : 1);
  const boardFull = v.board.length >= 7;
  // HAND DISCIPLINE: a line minion in hand is credited only while the board has room for it — a card that cannot
  // be fielded this turn is not progress (measured 2026-09-15: the pilot's hand grew to 9.1 unplayed cards from
  // round 6 while its board never changed). Unplayable, non-pair hand minions are PENALISED below.
  if (!boardFull) {
    for (const c of v.hand) {
      const def = CARD_INDEX[c.cardId];
      if (!def || def.spell || def.ruby) continue;
      cardSum += cardAffinity(def, pk) * 0.6;
    }
  }
  // Engines matter MORE as the game goes on: real set-2 boards scale exponentially from wave ~8 (measured
  // 2026-09-15: total board stats 21 @ w4 → 162 @ w8 → 1,442 @ w12), and that growth comes from per-turn engines,
  // not flat bodies. From wave 4 the line's pieces outweigh a bigger vanilla body by a widening margin, so the
  // one-turn fight margin cannot talk the pilot into selling its engine for stats.
  const waveScale = Math.min(1.5, 0.7 + 0.1 * v.wave);
  const cards = Math.min(1.5, (cardSum * waveScale) / 4);

  // RUNES. Affinity × remaining-round payoff, saturating at one strong rune and a half.
  let runeSum = 0;
  for (const id of v.runes) runeSum += lineRuneAffinity(id, pk) * runePayoff(id, v.wave);
  const runes = Math.min(1.0, runeSum / 1.5);

  // TIER TIMING. d < 0: behind the curve (bad, capped at two tiers); d = 0: on it; d > 0: ahead (Gold spent on
  // a tier the line did not want yet).
  const d = v.economy.tier - targetTier(pk.primary, v.wave);
  const timing = d < 0 ? -1.0 * Math.min(2, -d) : d === 0 ? 0.5 : -0.3 * d;

  // PAIRS held across board + hand (non-golden): any pair is two-thirds of a golden — double stats AND a
  // Discover from the tier above — and goldens are where the recorded players' boards get their mass (0.48 per
  // board at wave 8, 1.14 at wave 12, measured 2026-09-15). A line card's pair is worth a little more.
  const copies = new Map<string, number>();
  for (const c of [...v.board, ...v.hand]) if (!c.golden) copies.set(c.cardId, (copies.get(c.cardId) ?? 0) + 1);
  let pairSum = 0;
  for (const [id, n] of copies) if (n >= 2) pairSum += 0.3 + 0.1 * cardAffinity(CARD_INDEX[id], pk);
  const pairs = Math.min(0.8, pairSum);

  // HERO. A tiny nudge toward having used an affine power this turn.
  const affinity = pk.primary.heroes[v.hero.heroId] ?? 1;
  const hero = affinity > 1 && v.hero.powerKind !== 'passive' && !v.hero.powerReady ? Math.min(0.3, (affinity - 1) * 0.5) : 0;

  // BOARD MASS — linear in total stats against the wave reference, capped at twice it. The one term here that is
  // not about the line: it is the gradient the fight terms lose once the pilot is behind the field.
  const totalStats = v.board.reduce((n, c) => n + c.attack + c.health, 0);
  // Ramped in over the first six waves: early on the player curve holds 1–2 bodies and tiers (the timing term's
  // job); from wave 6 the field's boards are big and mass is what survives the fights.
  const mass = Math.min(2, totalStats / massReference(v.wave)) * Math.min(1, v.wave / 6);

  // INVESTMENT — run-wide channels every FUTURE buy or cast rides on: the permanent Shop buff (Demon Horse, Hank,
  // Butcher, Blart — the engine the recorded set-2 players scale on), Spell Power, the Ruby / Imp / Beast / Magnetic
  // auras. Invisible to a one-turn fight, so credited here, scaled by the rounds left to cash them in.
  const remaining = Math.max(1, PLANNING_HORIZON - v.wave);
  const a = v.auras;
  const tb = v.runCounters.tavernBuyBonus;
  const channels =
    (tb.attack + tb.health) / 12 +
    (a.spellPower.attack + a.spellPower.health) / 6 +
    (a.rubyBonus.attack + a.rubyBonus.health) / 6 +
    (a.impBuff.attack + a.impBuff.health) / 10 +
    a.beastBuyAtk / 6 + a.undeadBuyAtk / 6 +
    (a.magneticBuy.attack + a.magneticBuy.health) / 8;
  const investment = Math.min(1.5, channels) * Math.min(1, remaining / 6);

  // UNPLAYED HAND: with a full board, every hand minion that is not half of a pair is dead weight — Gold that
  // bought nothing and a slot that blocks the next buy. −0.15 each, capped.
  let clutterCount = 0;
  if (boardFull) {
    for (const c of v.hand) {
      const def = CARD_INDEX[c.cardId];
      if (!def || def.spell || def.ruby || c.golden) continue;
      if ((copies.get(c.cardId) ?? 0) >= 2) continue;
      clutterCount++;
    }
  }
  const clutter = -Math.min(0.9, 0.15 * clutterCount);

  // LEARNED VALUE (the survival model fit on the recorded set-2 players, `balance/value`): what a board that
  // SURVIVES looks like at this wave. Blended at `valueWeight` utility per unit (≈ [0, 1]); null (no band / drift)
  // contributes nothing. Expressed in the prior's units, so `PRIOR_WEIGHT × (valueWeight / PRIOR_WEIGHT)`.
  const learned = model ? valueTermOf(v, model) : null;
  const value = learned === null ? 0 : learned * (valueWeight / PRIOR_WEIGHT);

  return { cards, runes, timing, pairs, hero, mass, investment, clutter, value, total: cards + runes + timing + pairs + hero + mass + investment + clutter + value };
}

/** The installable prior for a line. `model` blends the learned value term (null = none). */
export function linePrior(line: LineChoice, model: ValueModel | null = null, valueWeight = VALUE_WEIGHT): EvaluationPrior {
  const pk = packagesOf(line);
  return (v) => linePriorBreakdown(v, line, pk, model, valueWeight).total;
}
