/**
 * GAUNTLET FOE PORTRAIT — what the stage opponent wears as its "face" (it has no hero). A stage may name a
 * `portraitCardId` (owner ask 2026-09-30: Demons wear Grobbus); its card art is the portrait everywhere the foe
 * shows up (shop foe, combat opponent, fight recap, "Now Facing"). A stage with no portrait card, or a card with
 * no art on disk, falls back to the stage's TRIBE EMBLEM (`TRIBE_ICON[tribe]`). Returns primitives only, so
 * callers can keep primitive selectors / stable memo deps.
 */
import type { Tribe } from '@game/core';
import { gauntletStage } from '@game/content';
import { artFor } from '../art';

export interface FoePortrait {
  /** URL of the portrait card's art; absent = show the tribe emblem instead. */
  art?: string;
  /** The stage's tribe — the emblem fallback (absent = the neutral anvil). */
  tribe?: Exclude<Tribe, 'neutral'>;
}

export function foePortrait(stageNo: number | null | undefined): FoePortrait {
  const stage = stageNo == null ? undefined : gauntletStage(stageNo);
  return { art: artFor(stage?.portraitCardId), tribe: stage?.tribe };
}
