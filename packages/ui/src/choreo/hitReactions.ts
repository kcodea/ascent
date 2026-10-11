import { presentationPolicyFor, type CombatEvent } from '@game/core';

/**
 * HIT REACTIONS GET THEIR OWN BEAT, AT THE HIT (R-DEMON-DMG-BEATS-01, owner 2026-10-11).
 *
 *   *"when a minion is buffed from dmg dealt by demons, it should have its beat happen in real time. for example,
 *   with gasket, when gasket winds up and rally procs, damaging the units it does, rad rachel's tendrils should go
 *   out THEN, before the gasket's attack goes off."*
 *
 * A wave pass (Gasket's Rally, a Fel Spikes volley) is ONE moment: every event of the pass shares its wave id. The
 * reactions its hits fire (Rad Rachel / Ruinous Lord / Impossible Todd buffing on a Demon's landed hit) carry that
 * id too, and `deferClashBuffs` has already slid them to the pass's tail. Folded into the pass they had no cue at
 * all (the `damage` kind draws no tendril) and their numbers only appeared when the stat hold timed out.
 *
 * The engine order is already right (hit, then its reaction). This finds the pass's TRAILING buff run and, when
 * any buff in it belongs to an effect the presentation registry gives its own beat (`ownBeat`), returns where it
 * starts so the compiler can make it its own `buffWave` moment: the pass lands, THEN the reactions' tendrils and
 * stat rolls, THEN the next pass or the swing. A `foldedCue` reaction stays folded inside the pass.
 *
 * Presentation only: a contiguous split of a slice the replay already reordered, so the folded frame at the end of
 * the pass is unchanged. Returns -1 when nothing splits.
 */
export function hitReactionStart(events: readonly CombatEvent[], start: number, end: number): number {
  let j = end;
  while (j > start && events[j - 1]!.type === 'buff') j--;
  if (j === end || j === start) return -1; // no trailing reactions, or no hit in front of them
  for (let k = j; k < end; k++) {
    const e = events[k]!;
    if (e.type === 'buff' && e.key !== undefined && presentationPolicyFor(e.key)?.policy === 'ownBeat') return j;
  }
  return -1;
}

/** Base-speed (1x) gap between a pass landing and its reaction beat starting: the hit reads first. */
export const HIT_REACTION_LEAD_MS = 200;

/** Base-speed (1x) minimum the reaction beat stays on screen before the next beat (the next pass, the parked swing's
 *  strike, the next attack): the demon tendril's flight (`tendril-trail-demon`, ~384 ms) plus enough of the badge roll
 *  that the new numbers are visibly landing before anything else moves. */
export const HIT_REACTION_READ_MS = 640;
