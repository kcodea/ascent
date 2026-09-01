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
 *
 * Superseded at runtime by `choreo/compile.ts` (`useCombatReplay` consumes `compileMoments`, not `buildBeats`,
 * for the live replay). Kept as the equivalence ORACLE for `choreo/compile.ts` (`compileMoments` re-implements
 * this algorithm on purpose) and as `attackerOfImpact`'s home — do not dedupe one into the other, or the
 * equivalence tests become tautological.
 */

/** Result events — the "impact" of an action. A contiguous run becomes one beat. `keyword` rides here so a
 *  grant fired mid-death-cascade (Mumi's Rise) never splits the impact run (the dmg/death beat). */
export const RESULT_TYPES = new Set<CombatEvent['type']>([
  'dmg', 'shield', 'shieldUp', 'poison', 'venomLost', 'death', 'keyword',
]);

/** On-attack "flash" events the sim emits between an `attack` and its damage — pulled into the attack's
 *  wind-up beat so they don't delay the impact. (Pure stat buffs to other minions, the rally cue, a
 *  rally-summoned token, the Stealth reveal — none of which change the attack's own damage numbers.) */
const WINDUP_ABSORB = new Set<CombatEvent['type']>([
  'buff', 'rally', 'summon', 'reveal', 'improve', 'spellcast', 'questTrigger', 'toHand', 'keyword', 'keywordLost',
]);

export interface Beat {
  start: number;
  end: number;
  primary: CombatEvent;
}

/** The attacker uid whose damage number is suppressed on the result (impact) beat at `resultIndex`. An
 *  `attack` is its own wind-up beat, so its damage — the attacked unit's hit AND the attacker's retaliation
 *  (a clash is two-way) — lands in the NEXT beat; only the unit being attacked shows a number, so the
 *  attacker (the previous beat's `attack` primary) is dropped. Also handles an `attack` grouped alongside its
 *  own damage, defensively. Returns null when this impact isn't an attack's (SC/Deathrattle damage, etc.). */
export function attackerOfImpact(beats: Beat[], resultIndex: number): string | null {
  const prev = beats[resultIndex - 1];
  if (prev?.primary.type === 'attack') return prev.primary.attacker;
  const self = beats[resultIndex]?.primary;
  return self?.type === 'attack' ? self.attacker : null;
}

/** The two units of the melee exchange this RESULT moment resolves, or null when it isn't one. Both already
 *  received the clash's hit FX from the lunge's impact channel (fired once at contact, on the DEFENDER), so
 *  the `damageFx` cue must skip them or the strike reads twice — see the guard in `score.ts`. Deliberately a
 *  sibling of `attackerOfImpact` rather than an extension of it: that function answers "whose damage NUMBER
 *  is suppressed", this one answers "whose hit FX is already covered", and the two must stay free to diverge. */
export function meleePairOfImpact(beats: Beat[], resultIndex: number): { attacker: string; defender: string } | null {
  const prev = beats[resultIndex - 1]?.primary;
  return prev?.type === 'attack' ? { attacker: prev.attacker, defender: prev.defender } : null;
}

export function buildBeats(events: CombatEvent[]): Beat[] {
  // ONE SWING'S RESULTS ARE ONE BEAT — mirrors `swingOpeners` in `choreo/compile.ts`, which this function is
  // the equivalence oracle for. Without it a summoned charger's exchange and the parked attacker's exchange
  // collapse into a single beat (owner report 2026-09-01).
  const opensSwing = new Array<boolean>(events.length).fill(false);
  {
    const pending = new Set<string>();
    for (let i = 0; i < events.length; i++) {
      const e = events[i]!;
      if (e.type === 'attack') pending.add(e.attacker);
      else if (e.type === 'dmg' && typeof e.source === 'string' && pending.has(e.source)) {
        opensSwing[i] = true;
        pending.delete(e.source);
      }
    }
  }
  const beats: Beat[] = [];
  let i = 0;
  while (i < events.length) {
    const start = i;
    const t = events[i]!.type;
    const w = events[i]!.wave;
    if (w !== undefined) {
      // A presentation WAVE (multi-pass AoE echo — Fel Spikes): every event of one pass carries the SAME wave id
      // regardless of type — its volley of damage, the reactor buffs those hits fire, and any deaths — so the
      // whole pass reads as ONE simultaneous moment, and the next pass (a new id) becomes its own moment with a
      // pause before it. This runs BEFORE the type rules so a wave is never split by an interleaved reactor buff.
      while (i < events.length && events[i]!.wave === w) i++;
    } else if (RESULT_TYPES.has(t)) {
      while (i < events.length && events[i]!.wave === undefined && RESULT_TYPES.has(events[i]!.type)
        && !(i > start && opensSwing[i])) i++; // group the impact
    } else if (t === 'buff') {
      while (i < events.length && events[i]!.wave === undefined && events[i]!.type === 'buff') i++; // a multi-target buff lands at once
    } else if (t === 'attack') {
      i++; // the attack (the wind-up itself) …
      // … then absorb the on-attack flashes that precede the damage, so they play during the lunge and the
      // NEXT beat — the result run — lands at the connection. Stop at the first result event / new action / wave.
      // A mid-combat NARRATION (`sc` without `cast`) is a flash too — a shop buff earned on the swing, or the
      // announcement of a spell the swing cast. Absorbing it is what lets the loop carry on into the buffs
      // BEHIND it, so a Rally that casts a spell keeps its whole cast inside the wind-up (owner 2026-09-01).
      // Mirrors `isWindupNarration` in `choreo/compile.ts` — this function is that algorithm's oracle, so the
      // two rules must move together or the equivalence tests start lying about which one is right.
      while (i < events.length && events[i]!.wave === undefined
        && (WINDUP_ABSORB.has(events[i]!.type) || (events[i]!.type === 'sc' && !(events[i]! as { cast?: true }).cast))) i++;
    } else {
      i++; // a single action (sc, a lone summon, toHand, maxGold, …)
    }
    beats.push({ start, end: i, primary: events[start]! });
  }
  return beats;
}
