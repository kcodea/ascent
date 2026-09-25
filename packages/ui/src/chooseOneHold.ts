import type { RunState } from '@game/sim';

/**
 * THE CHOOSE ONE HOLD — which hand card is standing in a board slot while its Choose One play is unresolved.
 *
 * A Choose One MINION commits nothing until its branch (and, for a targeted branch, its target) is settled:
 * the card stays in `run.hand` the whole time (reducer deferral, owner ruling 2026-08-28). The board only
 * SHOWS it at the slot the player dropped it on (owner ask 2026-08-31), and hides it from the hand row.
 *
 * The play has TWO open steps, and the card must hold its slot through BOTH (owner bug 2026-09-25: *"the card
 * should stay on board like it is during the choose animation for that targeting animation, too, and only go
 * back to hand if i cancel"*):
 *   1. the Choose One prompt       → `run.chooseOne`
 *   2. the chosen branch's aim step → `run.pendingTarget` with `deferredPlay`
 * Reading only step 1 released the card back to the hand the moment a targeted branch was picked, so the aim
 * beam started from the hand. A spell takes no slot and an Equipment has no card, so neither is held.
 *
 * Returns the held card's uid and the slot it asked for (clamped by the caller to the live board length), or
 * null when nothing is held.
 */
export function chooseOneHeldSlot(run: Pick<RunState, 'chooseOne' | 'pendingTarget'>): { uid: string; toIndex?: number } | null {
  const co = run.chooseOne;
  if (co) return co.spell || co.equipmentId ? null : { uid: co.uid, toIndex: co.toIndex };
  const pt = run.pendingTarget;
  if (pt?.deferredPlay && !pt.spell) return { uid: pt.uid, toIndex: pt.toIndex };
  return null;
}
