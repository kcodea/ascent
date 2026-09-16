import type { StatKind } from '../choreo/statMilestones';
import { bindingFor, statMilestoneKind } from '../choreo/bindings';
import { canPlayDefs, playDef } from './playDef';
import { sfx } from '../sfx';

/**
 * Fire the authored celebration for a badge that just crossed a milestone tier upward.
 *
 * A DIRECT, point-anchored single fire — the badge's own screen point is source AND target, so the def plays
 * ON the badge with nothing to travel between (the `spellCast` single-fire shape, minus the DOM measure the
 * point makes unnecessary). WHICH def plays comes from `bindings.json` keyed `(cardId, statMilestoneN)`, so a
 * per-card override can shadow the per-tier default and every tier is rebindable from the workbench.
 *
 * PHASE-AGNOSTIC: the caller decides when to fire. Today only `Card.tsx`'s uid-gated recruit path calls it, so
 * the celebration is shop/hand-only for free; `Unit.tsx` can call the same helper for combat later.
 */
export function fireStatMilestone(
  cardId: string | null,
  stat: StatKind,
  tier: number,
  point: { x: number; y: number },
): void {
  if (!canPlayDefs()) return;
  const binding = bindingFor(cardId, statMilestoneKind(tier));
  if (!binding) return; // unbound tier plays nothing — the frame still changes
  const camera = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  // The VISUAL fires on EVERY badge that crossed — the burst lands on each Attack/Health badge.
  playDef(binding.def, { source: point, target: point, cursor: point, camera }, { uids: { source: cardId, target: cardId } });
  // The SOUND is de-duped: when both stats on a unit — or several units under one shop-wide buff — cross a
  // milestone in the same beat, each would fire the rune-arrival clang and they'd stack into a muddy chorus.
  // Play it at most once per short window, so a simultaneous batch reads as one clang (owner ask 2026-09-15);
  // genuinely separate actions land more than a window apart and each still sound.
  if (binding.sfx !== undefined && !soundCoolingDown()) sfx[binding.sfx]?.();
}

/** True until `MILESTONE_SOUND_GAP_MS` has passed since the last milestone clang, so a burst of simultaneous
 *  crossings collapses to one sound. Stamps the clock on the first call of a batch. */
let lastMilestoneSoundAt = -Infinity;
const MILESTONE_SOUND_GAP_MS = 120;
function soundCoolingDown(): boolean {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (now - lastMilestoneSoundAt <= MILESTONE_SOUND_GAP_MS) return true;
  lastMilestoneSoundAt = now;
  return false;
}
