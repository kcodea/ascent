import type { CombatEvent } from '@game/core';
import { RESULT_TYPES, type Beat } from '../combatBeats';

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
  absorbIntoWindup: new Set(['buff', 'rally', 'summon', 'reveal', 'improve']),
};

/** A presentation moment — `Beat`-shaped (start/end/primary) so every existing consumer
 *  (`attackerOfImpact`, the scheduler, float/anim derivation) works unchanged, plus the step structure. */
export interface Moment extends Beat {
  /** The moment's event INDICES grouped by resolution step, in log order — sim-declared simultaneity.
   *  An UNTAGGED event (`step === undefined`: legacy saved replays, synthetic fixtures) is always its own
   *  group — with no sim-declared simultaneity we grant no reorder freedom. */
  stepGroups: number[][];
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

export function compileMoments(events: CombatEvent[], rules: GroupingRules = DEFAULT_RULES): Moment[] {
  const moments: Moment[] = [];
  let i = 0;
  while (i < events.length) {
    const start = i;
    const t = events[i]!.type;
    if (rules.collapse.has(t)) {
      while (i < events.length && rules.collapse.has(events[i]!.type)) i++;
    } else if (rules.collapseRuns.has(t)) {
      while (i < events.length && events[i]!.type === t) i++;
    } else if (t === 'attack') {
      i++;
      while (i < events.length && rules.absorbIntoWindup.has(events[i]!.type)) i++;
    } else {
      i++;
    }
    moments.push({ start, end: i, primary: events[start]!, stepGroups: groupBySteps(events, start, i) });
  }
  return moments;
}
