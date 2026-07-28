import type { CombatEvent } from '@game/core';
import { deferAvengeAfterSummons } from './avengeOrder';
import { deferClashBuffs } from './clashOrder';
import { compileMoments, type Moment } from './compile';

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

/**
 * The MOMENT LIST the replay walks — the only correct source of a moment index.
 *
 * `replayOrder` alone was not a sufficient seam: what has to match between the replay and anything computing
 * an index for `seekTo` is the whole `compileMoments(replayOrder(events))` composition, and leaving that
 * composition duplicated at two call sites left the door open for exactly the drift it was extracted to
 * prevent — `compileMoments` takes optional `GroupingRules`, so the two could diverge without either side
 * looking wrong. Both the replay and the proc scan call THIS.
 */
export function replayBeats(events: CombatEvent[]): Moment[] {
  return compileMoments(replayOrder(events));
}
