import type { CombatEvent } from '@game/core';

/**
 * Presentation-only event normalization: hold every **Avenge** payoff beat until AFTER the death's summons
 * have deployed. Runs on the replay's copy of the log (composed after `deferClashBuffs`), never the sim's.
 *
 * Why: the sim fires an Avenge the instant a death hits its threshold — right after that death's own
 * Deathrattle summon. That reads fine for a lone death. But it inverts against summons that come LATER in the
 * same exchange:
 *   • **A multi-death clash** (Cleave / AoE): deaths resolve one-by-one, so an Avenge on death #2 fires
 *     before death #3's summon — you see the payoff (a buff pulse, a coin burst) *before* the next token pops in.
 *   • **Deferred attack-on-summon tokens** (a Violet Whelp's "Whelp that attacks immediately"): that summon is
 *     held to the post-cascade flush, so ANY Avenge in the same death lands before the token exists.
 * The desired read is: all the summons arrive, THEN the Avenge payoffs land. So each `avenge`-tagged event
 * slides to just after the last summon that follows it within the same exchange.
 *
 * Correctness (the fold in `computeFrame` must be unchanged): an Avenge event only ever hops FORWARD past
 *   • a `summon` (a brand-new uid — can't be the Avenge event's target), or
 *   • any event acting on a DIFFERENT unit than the Avenge event's target.
 * Both trivially commute with the Avenge event in the in-order fold (they touch disjoint array entries). If a
 * same-unit event (its own target's `dmg`/`reborn`/`death`/…) sits between the Avenge event and the next
 * summon, we BAIL for that event (leave it put) rather than risk reordering two ops on one unit. We also never
 * cross an `attack` — that begins a new exchange, not this death's cascade. `avenge`-tagged SUMMONS are left
 * in place (reordering a summon relative to another summon would change its index-based board slot).
 *
 * Returns the SAME array reference when nothing moved, so downstream memos keep referential stability.
 */

/** The unit an event acts on (for the disjoint-target commutativity check). `undefined` = touches no single
 *  unit (economy / narration) → always safe to hop. `attack` is handled as a hard stop by the caller. */
function targetOf(e: CombatEvent): string | undefined {
  switch (e.type) {
    case 'summon': return e.minion.uid;
    case 'sc': return e.source;
    case 'rally': return e.target;
    case 'toHand':
    case 'questTrigger':
    case 'attack': return undefined;
    default: return (e as { target?: string }).target;
  }
}

export function deferAvengeAfterSummons(events: CombatEvent[]): CombatEvent[] {
  const work = events.slice();
  let moved = false;
  // Right-to-left: move the rightmost Avenge event first so earlier ones scan a settled tail and Avenge
  // events preserve their relative order as they cluster after the summons.
  for (let i = work.length - 1; i >= 0; i--) {
    const e = work[i]!;
    if (!e.avenge || e.type === 'summon') continue; // only Avenge payoffs; never reorder Avenge summons
    const et = targetOf(e);
    let lastSummon = -1;
    for (let j = i + 1; j < work.length; j++) {
      const f = work[j]!;
      if (f.type === 'attack') break; // a new exchange — this death's cascade ends here
      if (f.type === 'summon') { lastSummon = j; continue; } // new uid → always safe to hop
      const ft = targetOf(f);
      if (et !== undefined && ft === et) break; // a same-unit interaction → don't reorder two ops on one unit
    }
    if (lastSummon === -1) continue; // no summon ahead in this exchange → nothing to defer past
    work.splice(i, 1); // remove from its spot…
    work.splice(lastSummon, 0, e); // …and re-insert right AFTER the last summon (indices shifted by the removal)
    moved = true;
  }
  return moved ? work : events;
}
