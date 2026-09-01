import type { CombatEvent } from '@game/core';
import { RESULT_TYPES, type Beat } from '../combatBeats';
import { momentKind, type MomentKind } from './kinds';

/**
 * The Moment Compiler — phase 1 of the combat choreographer (spec: docs/superpowers/specs/
 * 2026-07-06-combat-choreographer-design.md). Groups the sim's event log into presentation MOMENTS.
 * With DEFAULT_RULES it reproduces `buildBeats` exactly (locked by the equivalence tests), while also
 * carrying each moment's `stepGroups` — the sim-declared simultaneity (resolution-step tags) later phases
 * use for ordering/stagger authoring. Pure + deterministic; moments are contiguous slices of the log, so
 * `computeFrame`'s in-order fold is never violated.
 *
 * `compileMoments` deliberately RE-IMPLEMENTS `buildBeats`'s algorithm — do not refactor one to call the
 * other and do not delete `buildBeats`: it is the equivalence-test ORACLE (making one delegate to the other
 * would turn the equivalence tests tautological).
 */

/** Grouping rules — today's hardcoded buildBeats behavior expressed as data. Later phases extend this
 *  (chain/splitPerTarget) and make it live-tunable; phase 1 ships the defaults only.
 *  Forward-note: phase 4 rules (chain, splitPerTarget) will need predicate/key-based rules, not just type
 *  membership — expect this interface to grow beyond Set<type> fields (see the spec's phase 4). */
export interface GroupingRules {
  /** Result events: a contiguous run collapses into one impact moment. */
  collapse: ReadonlySet<CombatEvent['type']>;
  /** Runs of these collapse too (multi-target buff waves land at once). */
  collapseRuns: ReadonlySet<CombatEvent['type']>;
  /** On-attack "flash" events absorbed into the attack's wind-up moment. */
  absorbIntoWindup: ReadonlySet<CombatEvent['type']>;
}

export const DEFAULT_RULES: GroupingRules = {
  collapse: RESULT_TYPES,
  collapseRuns: new Set(['buff']),
  // `spellcast` joined on 2026-09-01. It is the side's running cast COUNTER (the UI's live tallies tick off
  // it), emitted the instant a swing casts a spell — so it sat between the `attack` and everything the cast
  // produced, and the absorb loop stopped dead on it. That one un-absorbed counter is what pushed a Rally's
  // whole cast (its buffs, its narration, its authored FX) out of the wind-up and into beats after the lunge:
  // *"the flame beat … completes the lunge, no damage is dealt or taken, and all the animations trigger. once
  // they finish, damage is dealt and stats reconcile."*
  // `questTrigger` joined on 2026-09-01, alongside `spellcast` and for the same reason: it is the pulse a
  // quest or HERO POWER fires as it pays out (Gorun's Blade Mastery emits one on every swing), so it sits
  // between the attack and the rest of the swing's consequences and stopped the absorb loop dead.
  // `toHand` and the keyword pair joined on 2026-09-01, found by SWEEPING every on-attack card rather than by
  // another report (owner: *"when my flagrunner attacks, his attack goes off, then the rally card is granted,
  // and then the gorun animation goes off … both should happen BEFORE the lunge"*). A card conjured by a Rally
  // is a consequence of the swing exactly like a buff is, and an un-absorbed one splits the swing AND strands
  // everything behind it — which is why Gorun's grant looked late too. `keyword`/`keywordLost` are the same
  // class (Tauntbreaker strips Taunt as it swings); they are listed together so a grant and a strip can never
  // resolve on different sides of the lunge.
  absorbIntoWindup: new Set([
    'buff', 'rally', 'summon', 'reveal', 'improve', 'tribeAura', 'spellcast', 'questTrigger',
    'toHand', 'keyword', 'keywordLost',
  ]),
};

/**
 * A MID-COMBAT NARRATION (`sc` without `cast`) is an on-attack FLASH, exactly like the `buff` events already
 * absorbed — it is something the swing caused, and it rides an `sc` only because it has no combat unit to
 * target or because it announces a cast.
 *
 * This started narrower: a shop-buff line (`+X/+Y Shop`, Demon Horse buffing the tavern as it swings, owner ask
 * 2026-08-18). It was widened to every non-cast `sc` on 2026-09-01, because the narrow version was what broke
 * the swing that casts a spell:
 *
 *   *"the flame beat winds up and attacks, and completes the lunge, no damage is dealt or taken, and all the
 *   animations trigger. once they finish, damage is dealt and stats reconcile … we need all of the animations
 *   and stats to reconcile while the flamebeat is paused in his pre-attack animation, like echohorn does."*
 *
 * Flamebeat Drake's Rally casts Dragonflame, so its events run `attack, rally, sc, buff…`. The absorb loop
 * STOPPED at that `sc`, which orphaned the cast AND every buff behind it into their own post-lunge beats — the
 * swing finished, then its consequences played. Absorbing the narration lets the loop carry on into the buffs
 * it announces, so the whole cast belongs to the wind-up it came from.
 *
 * A genuine Start-of-Combat cast (`cast: true`) is still untouched: it is not a consequence of a swing, and the
 * absorb loop only runs after an `attack` event anyway.
 */
function isWindupNarration(e: CombatEvent): boolean {
  return e.type === 'sc' && !e.cast;
}

/** A presentation moment — `Beat`-shaped (start/end/primary) so every existing consumer
 *  (`attackerOfImpact`, the scheduler, float/anim derivation) works unchanged, plus the step structure. */
export interface Moment extends Beat {
  /** The moment's event INDICES grouped by resolution step, in log order — sim-declared simultaneity.
   *  An UNTAGGED event (`step === undefined`: legacy saved replays, synthetic fixtures) is always its own
   *  group — with no sim-declared simultaneity we grant no reorder freedom. */
  stepGroups: number[][];
  /** Presentation kind (phase 2) — see kinds.ts. */
  kind: MomentKind;
}

/** Split a moment's index range into contiguous runs sharing a DEFINED `step` tag. */
function groupBySteps(events: CombatEvent[], start: number, end: number): number[][] {
  const groups: number[][] = [];
  let cur: number[] = [];
  let curStep: number | undefined;
  for (let i = start; i < end; i++) {
    const s = events[i]!.step;
    // `undefined !== undefined` is false — without the explicit `s === undefined` check, consecutive
    // UNTAGGED events would wrongly share a group.
    if (cur.length > 0 && (s === undefined || s !== curStep)) { groups.push(cur); cur = []; }
    cur.push(i);
    curStep = s;
  }
  if (cur.length > 0) groups.push(cur);
  return groups;
}

/**
 * For each event index, does it open a NEW swing's results — the first damage dealt by an attacker whose
 * `attack` event is still unresolved?
 *
 * ── Why the collapse needs this (owner report 2026-09-01) ──────────────────────────────────────────────────
 *
 * `collapse` merges a contiguous run of RESULT_TYPES into one moment, which is right for ONE clash: its
 * damage, its cleave splash, the retaliation and the deaths are a single impact. But two different swings'
 * results can sit next to each other, and then they merged too:
 *
 *     dmg<soldier · dmg<enemy · death · dmg<ECHOHORN · dmg<enemy      ← one beat
 *
 * A summoned charger's whole exchange and the parked attacker's whole exchange, in the same beat. Echohorn's
 * swing therefore had no beat of its own, which is why no amount of holding or delaying could separate them —
 * *"its attack follows immediately after the charging soldier attacks"* was them being literally simultaneous.
 *
 * The rule this expresses is simply **one swing's results are one beat**. A retaliation is not a new swing
 * (the defender has no open `attack`), so an ordinary clash is untouched — which is what keeps this from
 * re-pacing every fight in the game.
 */
function swingOpeners(events: CombatEvent[]): boolean[] {
  const flags = new Array<boolean>(events.length).fill(false);
  const pending = new Set<string>();
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.type === 'attack') pending.add(e.attacker);
    else if (e.type === 'dmg' && typeof e.source === 'string' && pending.has(e.source)) {
      flags[i] = true;
      pending.delete(e.source); // its swing has landed; later damage from it belongs to whatever caused that
    }
  }
  return flags;
}

export function compileMoments(events: CombatEvent[], rules: GroupingRules = DEFAULT_RULES): Moment[] {
  const opensSwing = swingOpeners(events);
  const moments: Moment[] = [];
  let i = 0;
  while (i < events.length) {
    const start = i;
    const t = events[i]!.type;
    const w = events[i]!.wave;
    if (w !== undefined) {
      // A presentation WAVE (multi-pass AoE echo — Fel Spikes): the whole pass — its volley of damage, the
      // reactor buffs it fires, its deaths — shares one wave id and collapses into ONE moment regardless of
      // event type; the next pass (a new id) is its own moment (a pause between waves). MUST mirror `buildBeats`
      // (the equivalence oracle) exactly. Real logs today carry no wave tags, so equivalence is untouched.
      while (i < events.length && events[i]!.wave === w) i++;
    } else if (rules.collapse.has(t)) {
      // `i > start` so a run always keeps its OWN opening damage — it is only a LATER swing's first damage
      // that starts a new moment.
      while (i < events.length && events[i]!.wave === undefined && rules.collapse.has(events[i]!.type)
        && !(i > start && opensSwing[i])) i++;
    } else if (rules.collapseRuns.has(t)) {
      while (i < events.length && events[i]!.wave === undefined && events[i]!.type === t) i++;
    } else if (t === 'attack') {
      i++;
      // Both guards: never absorb across a WAVE boundary (partC), and DO absorb a shop-buff flash (Demon Horse).
      while (i < events.length && events[i]!.wave === undefined
        && (rules.absorbIntoWindup.has(events[i]!.type) || isWindupNarration(events[i]!))) i++;
    } else {
      i++;
    }
    moments.push({
      start, end: i, primary: events[start]!,
      stepGroups: groupBySteps(events, start, i),
      kind: momentKind(events[start]!),
    });
  }
  return moments;
}
