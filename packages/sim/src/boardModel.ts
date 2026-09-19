import type { BoardMinion } from '@game/core';
import { boardFeatures } from './boardFeatures';
import { BOARD_MODEL } from './boardModel.data';

/**
 * LEARNED BOARD STRENGTH — inference for the model fit by `npm run board:train`.
 *
 * Predicts a board's Elo *relative to boards recorded at its own wave*, where that Elo came from actually
 * fighting the boards against each other (`npm run board:elo`). Held-out quality (split by run, refit
 * 2026-09-19): r = 0.867 pooled / 0.80 within a wave, against 0.82 for wave-relative raw power. (The 0.789 the
 * band model once reported was mostly "which wave of the band is this" — see the trainer's header — and the
 * same band recipe re-run on today's content scores 0.24.)
 *
 * WHY THIS EXISTS. Raw power explains synthetic boards almost perfectly (r 0.88–0.94 at every wave) and human
 * boards badly once they get going (0.37 at waves 10–12). A bot tuned against the first distribution builds
 * tall-and-cheap boards, which is why ours finished at tier ~4.5 against legacy's 5.6 and died around round 10
 * against real player boards. The fitted weights (ridge λ = 300, so they are shrunk and spread) put the stat
 * features first, then `trig_onDeath` and `effectCount` (a board that DOES something), mark `tribe_mech` down
 * and keep `distinctTribes` negative (concentration beats spread — that is synergy).
 *
 * THE YARDSTICK IS THE WAVE (owner directive 2026-09-19: "it should be running against an average board strength
 * for all snapshots at that turn, not a turn bracket"). Every feature is centred and scaled against the corpus
 * boards recorded at EXACTLY this wave — `BOARD_MODEL.waves[wave]` — never a wave band. The first model used
 * bands (1–3, 4–6, …, 13–15) and the yardstick jumped at every edge: the 13–15 band's mean total attack was
 * ~5,250 against ~390 for 10–12, so the replay viewer showed a board going 99 → 11 from round 12 to 13 with no
 * real change.
 *
 * The rules the generator bakes into the table (documented here because inference relies on them):
 *   - The centre is the wave's MEDIAN board and the scale its interquartile range (÷1.349, so it reads as a
 *     standard deviation), not mean / sd: the late waves are heavy-tailed (one wave-12 board holds 30k power
 *     beside a median of 1.2k) and a mean / sd yardstick simply moved the cliff to whichever wave the runaway
 *     sat in. A feature whose IQR is 0 at a wave (most keyword counts) falls back to its sd, then to 1.
 *   - A wave with at least `nMin` (15) corpus boards uses its own statistics. A thinner wave blends its
 *     neighbours' boards in by distance (own ×1, ±1 ×1/2, ±2 ×1/3, …) until the pooled weight reaches `nMin` —
 *     a smooth yardstick, never a cliff. Today waves 1–13 stand alone; 14–17 blend.
 *   - Every wave from `minWave` to `maxWave` is emitted. Past either end, inference CLAMPS to the nearest
 *     emitted wave, so a board with any fitted neighbour is always scored; the only refusal is an empty board.
 *   - The label side matches: the training Elo is re-centred on each wave's MEDIAN board, so 1500 is "the
 *     median recorded board at this wave" on both sides of the regression (the fitted intercept is 1445).
 *   - Standardised values are clipped ABOVE at +`zClip` (3), and only above: a runaway board counts as "three
 *     deviations above its wave", not fifty (without it one such held-out board dominated the pooled fit,
 *     r 0.34 → 0.87), while a board far UNDER its wave keeps its gradient so the bot's search can climb.
 *     Measured on the pilot's competence scenarios: a symmetric clip flattened the learned term for the weak
 *     hand-built fixtures and the pilot held a payoff in hand rather than play it.
 *
 * What a caller should expect: a board that does NOT change from one wave to the next loses ground, because
 * the recorded field grows ~50% a turn mid-game and ~2× a turn from wave 11 (median power 598 → 1,203 → 2,772
 * at waves 11 / 12 / 13). That drop is the population, not the yardstick; the artefact this replaced was the
 * jump at a band edge, and a fixed board's Elo must never RISE with the wave (see `boardModel.test.ts`).
 *
 * Pure and cheap: one table lookup + ~52 multiply-adds (and 52 compares), no simulation, no RNG. Safe to call
 * inside the search loop, unlike `fightScore`, which pays for real combats.
 */

/** The wave whose statistics a board of this wave is judged against — the wave itself, clamped to the table. */
function statsFor(wave: number): { mean: number[]; scale: number[] } | null {
  const w = Math.min(BOARD_MODEL.maxWave, Math.max(BOARD_MODEL.minWave, Math.round(wave)));
  return BOARD_MODEL.waves[w] ?? null;
}

/**
 * Predicted Elo for this board at this wave. ~1500 is average for its wave; higher is stronger.
 *
 * Returns `null` when there is no model to apply (no waves fitted, or an empty board), so callers fall back
 * rather than silently scoring everything identically.
 */
export function predictBoardElo(minions: readonly BoardMinion[], wave: number): number | null {
  if (minions.length === 0) return null;
  const st = statsFor(wave);
  if (!st) return null;
  const f = boardFeatures(minions, wave);
  const clip = BOARD_MODEL.zClip;
  let sum = BOARD_MODEL.b;
  for (let j = 0; j < f.length; j++) {
    let z = (f[j]! - st.mean[j]!) / st.scale[j]!;
    if (clip > 0 && z > clip) z = clip;
    sum += z * BOARD_MODEL.w[j]!;
  }
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
