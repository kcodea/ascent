import type { CombatEvent } from '@game/core';
import { RESULT_TYPES } from '../combatBeats';

/**
 * Presentation-only event normalization: within a CLASH (a contiguous run of result events), slide any
 * `buff` events to the END of that run so a stat gain never SPLITS the impact.
 *
 * Why: when a unit gains Attack from being hit (Target Dummy's onDamaged, an Enrage-like), the sim emits the
 * buff INLINE — `dmg(defender) · buff(defender) · dmg(attacker-retaliation)` — so the +N pops BETWEEN the
 * defender's hit and the attacker's retaliation. But that retaliation was dealt with the defender's PRE-buff
 * Attack, so a +N sandwiched mid-clash misreads as "the enemy took the buffed damage". Sliding the buff to the
 * run's tail lets the whole clash land first (at its real values), the units settle, THEN the +N floats.
 *
 * Only a run that STARTS with a result is treated as a clash — a leading buff wave (its own beat) is left
 * untouched. Safe because it reorders WITHIN one contiguous result run and buffs COMMUTE with the damage/
 * shield/death events there: a buff adds to Attack/Health while the others change Health/keywords on (usually
 * other) units, so the folded frame at the run's end is identical — only the intermediate beat split changes.
 * Deaths are sim-decided and still shown; a trailing buff never resurrects a body. The sim event log itself is
 * untouched (this runs on the replay's copy only), so determinism / goldens are unaffected.
 *
 * Returns the SAME array reference when nothing moved, so downstream memos keep referential stability.
 */
export function deferClashBuffs(events: CombatEvent[]): CombatEvent[] {
  const out: CombatEvent[] = [];
  let changed = false;
  let i = 0;
  while (i < events.length) {
    if (RESULT_TYPES.has(events[i]!.type)) {
      // A clash: a maximal contiguous run of results (+ interleaved buffs). Emit the non-buffs in order,
      // then the buffs — so a buff that sat between two results moves past them.
      const nonBuff: CombatEvent[] = [];
      const buffs: CombatEvent[] = [];
      let seenBuff = false;
      while (i < events.length && (RESULT_TYPES.has(events[i]!.type) || events[i]!.type === 'buff')) {
        if (events[i]!.type === 'buff') { buffs.push(events[i]!); seenBuff = true; }
        else { nonBuff.push(events[i]!); if (seenBuff) changed = true; } // a result after a buff → order moved
        i++;
      }
      out.push(...nonBuff, ...buffs);
    } else {
      out.push(events[i]!);
      i++;
    }
  }
  return changed ? out : events;
}
