import type { CombatEvent } from '@game/core';
import { deferAvengeAfterSummons } from './avengeOrder';
import { deferClashBuffs } from './clashOrder';

/**
 * The event order the REPLAY walks — not the raw log.
 *
 * Both transforms reorder events for presentation (clash buffs held to the tail of their exchange, Avenge
 * payoffs held until after the death cascade's summons deploy), which moves `compileMoments`'s grouping
 * boundaries. Anything computing a MOMENT INDEX that will be handed to `seekTo` must fold this same array,
 * or its indices address a different moment list than the replay's — and the seek lands on an unrelated beat.
 *
 * Extracted so the replay and the proc harness cannot drift apart: they were separately correct and jointly
 * wrong, which is the failure mode a shared helper removes by construction.
 */
export function replayOrder(events: CombatEvent[]): CombatEvent[] {
  return deferAvengeAfterSummons(deferClashBuffs(events));
}
