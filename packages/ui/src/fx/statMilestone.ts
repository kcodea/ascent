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
  playDef(binding.def, { source: point, target: point, cursor: point, camera }, { uids: { source: cardId, target: cardId } });
  if (binding.sfx !== undefined) sfx[binding.sfx]?.();
}
