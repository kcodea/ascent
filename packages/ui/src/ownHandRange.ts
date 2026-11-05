/**
 * WHOSE HAND A TAG-TEAM FIGHT'S EVENTS BELONG TO (owner report 2026-11-05: "duos cards sent to hand combines both players
 * which is messy"; R-DUOS-HAND-OWN-01). A Duos fight is one log, and every event on a team's side says `player`, so a
 * `toHand` alone cannot tell the two teammates apart. The hand-off can: the first board's cards come before the side's
 * `tagIn`, the reserve's after it. Each player keeps only their own at settle (`duosMemberView`), so the hand row must
 * show only those too. Scanned off the list the replay plays (`replayOrder` reorders it, so `tagInAt` indexes the raw log).
 */
import type { CombatEvent } from '@game/core';

/** A half-open span of event indices: `[from, to)`. */
export type HandRange = readonly [from: number, to: number];

/** Every event: a fight with no teammates, or a view that is not one member's. */
export const WHOLE_LOG: HandRange = [0, Infinity];

/** The events of `member`'s own board on the player side (0 = fought first, 1 = the reserve; `undefined` = all of them). */
export function ownHandRange(events: readonly CombatEvent[], member: number | undefined): HandRange {
  if (member == null) return WHOLE_LOG;
  const at = events.findIndex((e) => e.type === 'tagIn' && e.side === 'player');
  const tagged = at < 0 ? Infinity : at;
  return member === 0 ? [0, tagged] : [tagged, Infinity];
}

export const inHandRange = (i: number, [from, to]: HandRange): boolean => i >= from && i < to;
