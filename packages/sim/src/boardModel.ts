import type { BoardMinion } from '@game/core';
import { boardFeatures } from './boardFeatures';
import { BOARD_MODEL } from './boardModel.data';

/**
 * LEARNED BOARD STRENGTH — inference for the model fit by `npm run board:train`.
 *
 * Predicts a board's Elo *relative to boards at its own wave*, where that Elo came from actually fighting the
 * boards against each other (`npm run board:elo`). Held-out quality: r = 0.789, against 0.716 for raw power.
 *
 * WHY THIS EXISTS. Raw power explains synthetic boards almost perfectly (r 0.88–0.94 at every wave) and human
 * boards badly once they get going (0.37 at waves 10–12). A bot tuned against the first distribution builds
 * tall-and-cheap boards, which is why ours finished at tier ~4.5 against legacy's 5.6 and died around round 10
 * against real player boards. The fitted weights say plainly what it was missing: `distinctTribes` is NEGATIVE
 * (concentration beats spread — that is synergy), while `maxTier`, `effectCount` and `trig_onDeath` are all
 * strongly positive.
 *
 * Pure and cheap: ~52 multiply-adds, no simulation, no RNG. Safe to call inside the search loop, unlike
 * `fightScore`, which pays for real combats.
 */

const BANDS: [number, number, string][] = [
  [1, 3, '1-3'], [4, 6, '4-6'], [7, 9, '7-9'], [10, 12, '10-12'], [13, 15, '13-15'], [16, 20, '16-20'],
];

/** The band whose statistics a board of this wave is judged against; falls back to the nearest fitted band. */
function bandFor(wave: number): string | null {
  const hit = BANDS.find(([lo, hi]) => wave >= lo && wave <= hi);
  if (hit && BOARD_MODEL.bands[hit[2]]) return hit[2];
  // Bands with too few rated boards were never fitted (16-20 today). Judging against the closest fitted band is
  // better than refusing to score — the alternative is the search going blind exactly in the late game.
  const fitted = BANDS.filter(([, , k]) => BOARD_MODEL.bands[k]);
  if (fitted.length === 0) return null;
  let best = fitted[0]!;
  for (const b of fitted) if (Math.abs(wave - (b[0] + b[1]) / 2) < Math.abs(wave - (best[0] + best[1]) / 2)) best = b;
  return best[2];
}

/**
 * Predicted Elo for this board at this wave. ~1500 is average for its wave; higher is stronger.
 *
 * Returns `null` when there is no model to apply (no bands fitted, or an empty board), so callers fall back
 * rather than silently scoring everything identically.
 */
export function predictBoardElo(minions: readonly BoardMinion[], wave: number): number | null {
  if (minions.length === 0) return null;
  const key = bandFor(wave);
  if (!key) return null;
  const st = BOARD_MODEL.bands[key]!;
  const f = boardFeatures(minions, wave);
  let sum = BOARD_MODEL.b;
  for (let j = 0; j < f.length; j++) sum += ((f[j]! - st.mean[j]!) / st.scale[j]!) * BOARD_MODEL.w[j]!;
  return sum;
}

/**
 * The same prediction squashed to [0, 1] for use as an evaluator component, where every term is normalized so
 * the weights mean what they say. 1500 ± ~600 covers the bulk of the rated population.
 */
export function boardStrength(minions: readonly BoardMinion[], wave: number): number {
  const elo = predictBoardElo(minions, wave);
  if (elo === null) return 0;
  return 1 / (1 + Math.exp(-(elo - 1500) / 300));
}
