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
  return deferAvengeAfterSummons(deferClashBuffs(stripEpicFires(events)));
}

/** Epic multiplier fires carried by the event they PRECEDED (by object identity, so it survives the reorders). */
const EPIC_FIRES = new WeakMap<CombatEvent, string[]>();

/**
 * The `epicFire` markers (R-FX-EPIC-FIRE-01) are presentation-only and must never be a beat of their own (that would
 * add screen time to every multiplied trigger), so the replay drops them and pins each one's minion to the next real
 * event: the trigger it multiplied. `epicFiresOf` reads them back when that event's beat plays.
 */
function stripEpicFires(events: CombatEvent[]): CombatEvent[] {
  if (!events.some((e) => e.type === 'epicFire')) return events;
  const out: CombatEvent[] = [];
  let pending: string[] = [];
  for (const e of events) {
    if (e.type === 'epicFire') { if (!pending.includes(e.source)) pending.push(e.source); continue; }
    if (pending.length) { EPIC_FIRES.set(e, [...(EPIC_FIRES.get(e) ?? []), ...pending]); pending = []; }
    out.push(e);
  }
  return out;
}

/** The epic minions whose multiplier fired into `event` (its On Watcher effect plays as that event's beat plays). */
export function epicFiresOf(event: CombatEvent | undefined): readonly string[] {
  return (event && EPIC_FIRES.get(event)) ?? [];
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
