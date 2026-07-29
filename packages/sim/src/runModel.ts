import type { BoardMinion } from '@game/core';
import { boardFeatures } from './boardFeatures';
import { QUEST_VALUE, RUNE_VALUE, RUN_VALUE } from './runModel.data';

/**
 * LEARNED RUN-STATE VALUE + QUEST/RUNE TABLES — inference for `npm run bot:learn`.
 *
 * The value model predicts `winsAfter` (wins still to come) from an end-of-turn state, fit on mass self-play
 * against the real player-board pool. The quest/rune tables are causal contrasts (mean winsAfter when picked
 * minus when offered-and-passed), which exist because rollouts FORCE exploration of picks the bot would never
 * take — the direct fix for "quest picks are scored by immediate evaluation, which cannot see the payoff".
 *
 * Everything degrades gracefully: with the stub data file (no fit yet) every function returns null/0 and the
 * evaluator falls back to its other terms.
 */

export interface RunStateInputs {
  board: readonly BoardMinion[];
  wave: number;
  gold: number;
  maxGold: number;
  tier: number;
  effectiveHp: number;
  handSize: number;
}

/** Predicted wins still to come from this state, or null when no model band covers the wave. */
export function predictWinsAfter(x: RunStateInputs): number | null {
  const st = RUN_VALUE.waves[String(x.wave)];
  if (!st || RUN_VALUE.w.length === 0) return null;
  const f = [...boardFeatures(x.board, x.wave), x.gold, x.maxGold, x.tier, x.effectiveHp, x.handSize];
  if (f.length !== RUN_VALUE.w.length) return null; // feature schema drifted — refuse rather than mis-score
  let sum = RUN_VALUE.b;
  for (let j = 0; j < f.length; j++) sum += ((f[j]! - st.mean[j]!) / st.scale[j]!) * RUN_VALUE.w[j]!;
  return sum;
}

/** Measured wins-after delta for picking this quest over passing it. 0 when unknown. */
export const questValue = (questId: string): number => QUEST_VALUE[questId] ?? 0;
/** Measured wins-after delta for picking this rune over passing it. 0 when unknown. */
export const runeValue = (runeId: string): number => RUNE_VALUE[runeId] ?? 0;
