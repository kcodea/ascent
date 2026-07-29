import { CARD_INDEX } from '@game/content';
import type { BotCardView, BotVisibleState } from './types';
import { fightScore } from './fightScore';

/**
 * STATE EVALUATION — decomposed, normalized, and explainable.
 *
 * Every component is normalized to roughly [-1, 1.5] BEFORE weighting. Adding raw Attack to raw Gold to a
 * probability produces a number that moves for reasons nobody can name, and tuning it is guesswork; keeping the
 * components on one scale means a weight change means what it says.
 *
 * This is the v1 evaluator. It scores what is directly visible — board strength, economy, tier, survival — and
 * deliberately does NOT model packages or synergy yet; that is Ticket 3, and bolting a half-guessed version in
 * here would make both harder to tune. The gap it leaves is real and known: it will happily sell a Kennelmaster
 * whose value is in what it enables rather than its stats.
 */

export interface EvaluationBreakdown {
  /**
   * How the board actually PERFORMS, measured by fighting with it rather than inferred from its stats.
   * Replaces the three proxies that used to stand in for it (raw power, width, a keyword value table).
   */
  fightStrength: number;
  boardPower: number;
  economy: number;
  tierProgress: number;
  handValue: number;
  survivalUrgency: number;
  wastedGoldPenalty: number;
  total: number;
}

export interface EvaluationConfig {
  version: 1;
  weights: Omit<EvaluationBreakdown, 'total'>;
  /** Below this fraction of starting health, survival starts dominating. */
  dangerHealthFraction: number;
  /** Threat archetypes fought per evaluation. The cost/accuracy dial: 5 costs ~0.19ms, 2 costs ~0.06ms. */
  fightPanelSize: number;
}

export const EVALUATION_CONFIG_V1: EvaluationConfig = {
  version: 1,
  weights: {
    // Fighting carries most of the board's value now. `boardPower` survives at a small weight purely as a
    // tiebreaker between boards the panel cannot separate — at low waves everything loses to everything, and
    // without it the search has no reason to prefer a bigger wipe-out to a smaller one.
    fightStrength: 44,
    boardPower: 8,
    economy: 12,
    tierProgress: 9,
    handValue: 5,
    survivalUrgency: 16,
    wastedGoldPenalty: -10,
  },
  dangerHealthFraction: 0.35,
  // Two archetypes mid-search. Five is more accurate but triples the cost of every node, and the node budget
  // buys more by looking at more LINES than at more opponents.
  fightPanelSize: 2,
};

/** Positive unbounded → [0, 1.5]. `reference` is "a normal amount for this wave", so the curve stays useful
 *  from wave 1 to wave 20 instead of saturating after turn 4. */
const norm = (value: number, reference: number): number =>
  Math.max(0, Math.min(1.5, Math.log1p(Math.max(0, value)) / Math.log1p(Math.max(1, reference))));

/** Roughly what a healthy board is worth at this wave — the enemy curve, so "good" means "good for now". */
const powerReference = (wave: number): number => 8 + wave * 7;

/** Keywords that change how a body trades, weighted by how much. Not a synergy model — just "a Ward 3/3 beats
 *  a vanilla 3/3", which the raw stat sum cannot see. */
const KEYWORD_VALUE: Record<string, number> = {
  DS: 3,   // Ward — absorbs a hit outright
  T: 2,    // Taunt — controls what gets hit
  W: 3,    // Flurry — a second swing
  R: 2.5,  // Rise — a second body
  V: 2,    // Venom
  C: 2,    // Cleave
  RL: 1.5, // Rally
  SC: 1.5, // Critical
  M: 0.5,  // Magnetic
  EG: 1,   // Engrave
};

const bodyPower = (c: BotCardView): number => c.attack + c.health;

const keywordScore = (c: BotCardView): number =>
  c.keywords.reduce((n, k) => n + (KEYWORD_VALUE[k] ?? 0), 0) * (c.golden ? 1.5 : 1);

export function evaluate(v: BotVisibleState, cfg: EvaluationConfig = EVALUATION_CONFIG_V1): EvaluationBreakdown {
  const w = cfg.weights;
  const ref = powerReference(v.wave);

  const power = v.board.reduce((n, c) => n + bodyPower(c), 0);
  const boardPower = norm(power, ref);

  // THE BOARD, FOUGHT. Three signals blended because no one of them has gradient everywhere:
  //   - win rate is what actually matters, but SATURATES — measured at wave 7, a full board and a crippled
  //     2-card board both scored 0.00 because every archetype beat both;
  //   - margin (surviving power, signed) separates a narrow loss from a rout, but also bottoms out at -1 when
  //     the board is wiped outright;
  //   - damage taken kept separating boards when both of the above were flat (0.36 vs 0.44 on that same pair).
  // Blended, something still moves in every position, which is the whole requirement for a search signal.
  const fight = fightScore(v, cfg.fightPanelSize);
  const fightStrength =
    fight.winRate * 0.55 +
    ((fight.margin + 1) / 2) * 0.30 +
    (1 - fight.averageDamage) * 0.15;

  // Economy is gold you can still USE plus the ceiling you have built. Gold left over at end of turn is waste
  // (below), but gold in hand mid-turn is options.
  const economy = norm(v.economy.gold + v.economy.maxGold, 20);

  const tierProgress = norm(v.economy.tier, 6);

  // A card in hand is worth something, but less than the same card on board — and a full hand blocks buying.
  const handValue = norm(v.hand.reduce((n, c) => n + bodyPower(c) * 0.5, 0), ref);

  // Health as a signed advantage: comfortable is ~0, nearly dead is strongly negative. This is what makes a
  // low-health bot prefer immediate strength over compounding.
  const effectiveHp = v.hero.resolve + v.hero.armor;
  const healthFraction = Math.max(0, Math.min(1, effectiveHp / 45));
  const survivalUrgency = healthFraction < cfg.dangerHealthFraction
    ? -(1 - healthFraction / cfg.dangerHealthFraction)
    : 0;

  // DEAD gold — gold that cannot buy anything at all. The first version had this backwards: it counted the
  // surplus above the cheapest offer as waste, which punished HAVING spending power and made gaining gold look
  // like a loss. Measured: casting Ember Pouch scored below doing nothing, so the bot bought spells and never
  // cast them. Gold you can spend is options; only gold you cannot spend is wasted.
  const cheapest = Math.min(...v.shop.map((o) => o.cost), v.spellOffer?.cost ?? Infinity, v.economy.upgradeCost);
  const wasted = Number.isFinite(cheapest) && v.economy.gold < cheapest ? v.economy.gold : 0;
  const wastedGoldPenalty = norm(wasted, 10);

  const parts = { fightStrength, boardPower, economy, tierProgress, handValue, survivalUrgency, wastedGoldPenalty };
  const total =
    parts.fightStrength * w.fightStrength +
    parts.boardPower * w.boardPower +
    parts.economy * w.economy +
    parts.tierProgress * w.tierProgress +
    parts.handValue * w.handValue +
    parts.survivalUrgency * w.survivalUrgency +
    parts.wastedGoldPenalty * w.wastedGoldPenalty;

  return { ...parts, total };
}

/** A tier-aware value for a single offer, used to break ties among purchases without running the full search. */
export function offerAppeal(cardId: string, attack: number, health: number, keywords: string[]): number {
  const def = CARD_INDEX[cardId];
  const tierBonus = (def?.tier ?? 1) * 1.5;
  const kw = keywords.reduce((n, k) => n + (KEYWORD_VALUE[k] ?? 0), 0);
  return attack + health + tierBonus + kw;
}

/**
 * What a REFRESH is worth, WITHOUT looking at what it produced.
 *
 * Search must never evaluate the real post-refresh shop: the engine is seeded, so reading it is reading the
 * future of the very decision being made. Search did exactly that until this existed — `evaluate(t.visible)` on
 * a reveal child scored the actual new shop, which is the precise cheat the reveal boundary was built to
 * prevent.
 *
 * The honest score is the same state with the gold spent. This evaluator has no shop term, so there is nothing
 * further to project — and that is also why the bot rarely refreshes: a refresh reads as pure loss because the
 * thing it buys (a better shop) is invisible here. That is a real gap, recorded rather than papered over.
 */
export function expectedAfterRefresh(v: BotVisibleState, cfg: EvaluationConfig = EVALUATION_CONFIG_V1): EvaluationBreakdown {
  const cost = v.economy.freeRolls > 0 ? 0 : v.economy.refreshCost;
  return evaluate({
    ...v,
    economy: { ...v.economy, gold: Math.max(0, v.economy.gold - cost), freeRolls: Math.max(0, v.economy.freeRolls - 1) },
  }, cfg);
}
