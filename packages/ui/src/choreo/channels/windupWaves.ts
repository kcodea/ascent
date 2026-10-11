import type { CombatEvent } from '@game/core';
import type { Moment } from '../compile';
import { defenderOf, ownStrikeAt } from './rallyFired';

/**
 * DOES A WAVE VOLLEY SIT BETWEEN THIS SWING'S WIND-UP AND ITS OWN STRIKE? (Gasket, owner add 2026-10-10)
 *
 * Gasket's Rally sprays the whole board as one presentation WAVE per pass (`ctx.wave`), resolved inside the swing's
 * wind-up and BEFORE its own strike. A wave is never absorbed into the attack moment (`compileMoments` stops at a wave
 * boundary), so each pass is its own beat after the wind-up, and the strike is the beat after those.
 *
 * That is exactly the shape the PARK exists for (`holdAfterWindup`): the attacker holds its reared-back pose while the
 * clock runs through the volleys, then strikes on its own damage beat (or settles, if a volley killed its target).
 * Without the park the lunge's contact advanced the clock into the first VOLLEY, so the strike looked like it dealt
 * the spray and the real hit landed a beat later on nothing.
 *
 * A forced Echo spray (Echohorn → Fel Spikes) is already parked by its `rally` signal; this is the general rule for
 * any wave the swing's own wind-up produced. Pure, scans forward from the attack moment's end: true at the first wave
 * event before the attacker's own strike lands, false at the strike, a new attack, or the end of the log.
 */
export function wavesAheadOf(moment: Moment, events: CombatEvent[], attackerUid: string | null): boolean {
  if (attackerUid === null) return false;
  const defender = defenderOf(moment);
  for (let i = moment.end; i < events.length; i++) {
    const e = events[i]!;
    if (e.type === 'attack') return false;
    if (ownStrikeAt(events, i, attackerUid, defender)) return false;
    if (e.wave !== undefined) return true;
  }
  return false;
}
