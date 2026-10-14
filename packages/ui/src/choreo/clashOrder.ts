import type { CombatEvent } from '@game/core';
import { RESULT_TYPES } from '../combatBeats';
import { isReactionTailEvent } from './hitReactions';

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
 *
 * WHEN A BUFF DOES NOT COMMUTE (R-REALTIME-STATS-01, owner 2026-10-14): a `dmg` carries the target's ABSOLUTE Health
 * after the hit (`remainingHp`), and a `summon` carries the arriving body's whole stats. So a Health buff slid past a
 * later hit on the SAME body (Chosen Fiend / Ruinous Lord buffing the attacker that the retaliation then hits), or
 * any buff slid past its own body's arrival (Solid Ground lands on a summon before it is placed), is already inside
 * that later event's number, and folding it again printed the gain twice for the rest of the fight. Such a buff is
 * moved as a COPY tagged with the share that is already folded (`prefoldedShareOf`): the fold and the badge hold skip
 * that share, the float still says what was gained.
 */
const PREFOLDED = new WeakMap<CombatEvent, 'health' | 'all'>();

/** How much of a moved buff a LATER event in the replay order already carries (see `deferClashBuffs`). */
export function prefoldedShareOf(e: CombatEvent): 'health' | 'all' | undefined {
  return PREFOLDED.get(e);
}

/** The buffs of `run` (in log order) that the replay is about to slide past the events `after` them, copied and tagged
 *  where a later event already carries their stats. `run[k]` is the k-th event of the slice, `pulled` the bodies whose
 *  `summon` is moved ahead of the buffs too. */
function tagMoved(run: readonly CombatEvent[], pulled: readonly CombatEvent[]): Map<CombatEvent, CombatEvent> {
  const swap = new Map<CombatEvent, CombatEvent>();
  for (let k = 0; k < run.length; k++) {
    const b = run[k]!;
    if (b.type !== 'buff') continue;
    let share: 'health' | 'all' | undefined;
    for (const f of [...run.slice(k + 1), ...pulled]) {
      if (f.type === 'summon' && f.minion.uid === b.target) { share = 'all'; break; }
      if (f.type === 'dmg' && f.target === b.target && b.health !== 0) share = 'health';
    }
    if (!share) continue;
    const copy = { ...b };
    PREFOLDED.set(copy, share);
    swap.set(b, copy);
  }
  return swap;
}

export function deferClashBuffs(events: CombatEvent[]): CombatEvent[] {
  const out: CombatEvent[] = [];
  let changed = false;
  let i = 0;
  while (i < events.length) {
    const wave = events[i]!.wave;
    if (wave !== undefined && RESULT_TYPES.has(events[i]!.type)) {
      // A WAVE PASS (Gasket's Rally, a Fel Spikes volley): the whole same-wave slice is partitioned in one go, the
      // volley's own events (damage, Ward pops, deaths, the bodies they summon) first, then EVERYTHING its hits'
      // reactions emitted, stable on both sides (R-DEMON-DMG-BEATS-02, 2026-10-13). Not only the buffs: Impossible
      // Todd's Imp aura (`tribeAura`) and Rune of Ruins' pulse (`questTrigger`) fire on every hit too, and leaving them
      // between the hits kept the reactions from ever reaching the tail, so `hitReactionStart` could not split them
      // off and they folded back into the pass with no tendril and no roll. Same commuting argument as below: the pass
      // folds to the same frame at its end, only the beat split moves.
      let j = i;
      while (j < events.length && events[j]!.wave === wave) j++;
      const hits: CombatEvent[] = [];
      const reactions: CombatEvent[] = [];
      for (let k = i; k < j; k++) {
        const e = events[k]!;
        if (isReactionTailEvent(e)) reactions.push(e);
        else { if (reactions.length > 0) changed = true; hits.push(e); }
      }
      // A reaction that moved past a hit (or the arrival) of its own body is already inside that event's number.
      const swapW = changed ? tagMoved(events.slice(i, j), []) : new Map<CombatEvent, CombatEvent>();
      out.push(...hits, ...reactions.map((e) => swapW.get(e) ?? e));
      i = j;
    } else if (RESULT_TYPES.has(events[i]!.type)) {
      // A clash: a maximal contiguous run of results (+ interleaved buffs). Emit the non-buffs in order,
      // then the buffs — so a buff that sat between two results moves past them.
      const nonBuff: CombatEvent[] = [];
      const buffs: CombatEvent[] = [];
      let seenBuff = false;
      // Never slide a buff across a WAVE boundary (multi-pass echo — Fel Spikes): a wave's events must stay
      // contiguous so `compileMoments` groups each pass as one moment. Confine the run to a single wave id
      // (undefined for ordinary combat, so this is a no-op there). A wave's own reactor buffs still defer to
      // that wave's tail, which is harmless — the whole wave folds into one frame regardless.
      const w0 = events[i]!.wave;
      const runStart = i;
      while (i < events.length && events[i]!.wave === w0 && (RESULT_TYPES.has(events[i]!.type) || events[i]!.type === 'buff')) {
        if (events[i]!.type === 'buff') { buffs.push(events[i]!); seenBuff = true; }
        else { nonBuff.push(events[i]!); if (seenBuff) changed = true; } // a result after a buff → order moved
        i++;
      }
      const runEnd = i;
      out.push(...nonBuff);
      // If we're deferring buffs, let the clash's own consequence SUMMONS (deathrattle tokens, emitted right
      // after the death in the log) play BEFORE the buff floats. Otherwise the deferred buff becomes a beat
      // wedged between a Deathrattle death and its summons, which breaks the death→summon adjacency the replay
      // needs: `deathConsequenceLead` sees no death before the summon (→ no pre-summon wait), and the death
      // beat advances early (its next beat is the buff, not the lead-carrying summon) so a dying ATTACKER is
      // dropped from the DOM before its skull fires at `landed`. Keeping order results→deaths→summons→buffs
      // restores both. (Summons still commute with the buff: a token vs a stat gain on a — usually dead — unit.)
      const pulled: CombatEvent[] = [];
      if (buffs.length) while (i < events.length && events[i]!.wave === w0 && events[i]!.type === 'summon') { out.push(events[i]!); pulled.push(events[i]!); i++; }
      const swap = buffs.length ? tagMoved(events.slice(runStart, runEnd), pulled) : new Map<CombatEvent, CombatEvent>();
      if (swap.size > 0) changed = true;
      out.push(...buffs.map((b) => swap.get(b) ?? b));
    } else {
      out.push(events[i]!);
      i++;
    }
  }
  return changed ? out : events;
}
