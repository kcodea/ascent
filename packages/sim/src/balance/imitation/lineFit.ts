/**
 * IMITATION (B7) — what the recorded survivors say about a LINE.
 *
 * `lineSurvivorAffinity(pkg, setId, model)` reads the package's engine + payoff minions (member score ≥ 2) and
 * averages the imitation weights of its best few over the mid bands (waves 5–10, where the corpus is thickest and
 * the held-out signal is), so a line whose core cards the survivors actually held (Dwarf Ale: Brakka, Gangplank,
 * Tapkeeper; Beast: Echohorn, Hawkus; Demon consume: Bob Blart) reads high and one whose core the survivors did
 * not (or the corpus never fielded) reads ~0. In [0, MAX_LLR]; deterministic; nothing here is hero-specific — the
 * corpus holds 70 runs over ~40 heroes, far too thin for a per-hero table (see docs/balance-bot-player-study.md).
 */
import type { SetId } from '@game/content';
import { packageMembers, type StrategyPackage } from '../strategy/packages';
import { cardWeightOver, type ImitationModel } from './model';

export const LINE_BANDS: readonly string[] = ['build', 'scale'];
export const LINE_TOP = 5;

export function lineSurvivorAffinity(pkg: StrategyPackage, setId: SetId, model: ImitationModel, bands: readonly string[] = LINE_BANDS, top = LINE_TOP): number {
  const weights = packageMembers(pkg, setId)
    .filter((m) => m.score >= 2 && !m.spell)
    .map((m) => cardWeightOver(model, m.cardId, bands))
    .filter((w) => w !== 0)
    .sort((a, b) => b - a)
    .slice(0, top);
  if (weights.length === 0) return 0;
  return Math.max(0, weights.reduce((n, w) => n + w, 0) / top);
}
