import type { BotVisibleState } from '../../productionBots/types';
import { featuresOf } from './features';
import { predict, type ValueModel } from './model';

/**
 * THE VALUE TERM — what the strategist blends into the evaluator.
 *
 * Returns the model's expected normalised survival for the pilot's visible state (≈ 0 = eliminated on this wave,
 * ≈ 1 = survives to the corpus' last recorded wave; a linear model can stray a little outside [0, 1]). Returns
 * `null` when the model has no opinion (no band for the wave, or a feature-schema drift), so the caller can fall
 * back instead of scoring every candidate the same. Pure and deterministic: ~50 multiply-adds, no simulation.
 *
 * Because every candidate in one search shares wave, Resolve and Armor, those features move nothing between
 * candidates; what the term ranks is the BOARD SHAPE the recordings say survives — tier for the wave, scaling
 * engines, keyword mix — which is exactly the strategic gap the pinned lobbies diagnosed.
 */
export function valueTermOf(v: BotVisibleState, model: ValueModel): number | null {
  return predict(model, featuresOf(v));
}
