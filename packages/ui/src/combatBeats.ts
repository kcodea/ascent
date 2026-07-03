import type { CombatEvent } from '@game/core';

/**
 * Group the combat event log into **beats** for the replay clock. A beat is one "moment" shown for a fixed
 * length before the next. Pure + deterministic (no React/DOM) so it's unit-testable.
 *
 * The shapes:
 * - An **action** (`attack` / `sc` / a lone `summon`) is its own beat — the wind-up.
 * - A run of **result** events (damage, shields, poison, deaths) collapses into ONE beat — the impact — so
 *   an attack's consequences land together.
 * - A run of **buff** events also collapses into one beat (a single effect buffing many minions at once —
 *   Grim's Deathrattle, a Rally aura — fires them together, not one at a time).
 * - An **attack absorbs its on-attack "flash" events** (Rally, Better Bot's mech-buff, a rally-summoned
 *   token, Stealth reveal) that the sim emits *between* the `attack` and its damage. Those animate during
 *   the wind-up, so the **damage lands at the lunge's connection** instead of a beat later (after the buff
 *   animation). Event ORDER is never changed — only how events are grouped into beats — so the replay's
 *   state derivation (`computeFrame`, which folds events in order) stays correct.
 */

/** Result events — the "impact" of an action. A contiguous run becomes one beat. `keyword` rides here so a
 *  grant fired mid-death-cascade (Mumi's Rise) never splits the impact run (the dmg/death beat). */
export const RESULT_TYPES = new Set<CombatEvent['type']>([
  'dmg', 'shield', 'shieldUp', 'poison', 'venomLost', 'death', 'keyword',
]);

/** On-attack "flash" events the sim emits between an `attack` and its damage — pulled into the attack's
 *  wind-up beat so they don't delay the impact. (Pure stat buffs to other minions, the rally cue, a
 *  rally-summoned token, the Stealth reveal — none of which change the attack's own damage numbers.) */
const WINDUP_ABSORB = new Set<CombatEvent['type']>(['buff', 'rally', 'summon', 'reveal', 'improve']);

export interface Beat {
  start: number;
  end: number;
  primary: CombatEvent;
}

export function buildBeats(events: CombatEvent[]): Beat[] {
  const beats: Beat[] = [];
  let i = 0;
  while (i < events.length) {
    const start = i;
    const t = events[i]!.type;
    if (RESULT_TYPES.has(t)) {
      while (i < events.length && RESULT_TYPES.has(events[i]!.type)) i++; // group the impact
    } else if (t === 'buff') {
      while (i < events.length && events[i]!.type === 'buff') i++; // a multi-target buff lands at once
    } else if (t === 'attack') {
      i++; // the attack (the wind-up itself) …
      // … then absorb the on-attack flashes that precede the damage, so they play during the lunge and the
      // NEXT beat — the result run — lands at the connection. Stop at the first result event / new action.
      while (i < events.length && WINDUP_ABSORB.has(events[i]!.type)) i++;
    } else {
      i++; // a single action (sc, a lone summon, toHand, maxGold, …)
    }
    beats.push({ start, end: i, primary: events[start]! });
  }
  return beats;
}
