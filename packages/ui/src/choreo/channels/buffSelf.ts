// packages/ui/src/choreo/channels/buffSelf.ts
import type { CombatEvent } from '@game/core';
import type { Moment } from '../compile';

/** One self-buff pulse to fire: a unit (`uid`) empowering ITSELF by the summed delta this moment.
 *
 *  `spellId` is the SPELL that caused it, when one did — the same field `BuffCast` carries and for the same
 *  reason. A spell that buffs a RANDOM friendly can roll its own caster, and that lands here rather than in the
 *  tendril channel; without the id the stock pulse fires on top of the spell's authored def (owner report
 *  2026-09-01: *"they are also triggering a 'self buff' animation and i want to remove that animation"*). */
export interface SelfBuff { uid: string; attack: number; health: number; spellId?: string; }

/** Collect this moment's buff events where `source === target` into per-uid totals, summing repeated self-buffs
 *  to the same unit. Order: first appearance of each uid. Buff-OTHERS (source !== target) are excluded (they are
 *  handled by the tendril channel). Pure. Mirror of `groupBuffCasts` with the opposite predicate. */
export function groupSelfBuffs(moment: Moment, events: CombatEvent[]): SelfBuff[] {
  const order: string[] = [];
  const byUid = new Map<string, SelfBuff>();
  for (let i = moment.start; i < moment.end; i++) {
    const e = events[i];
    if (!e || e.type !== 'buff') continue;
    if (e.source !== e.target) continue; // buff-OTHER: handled by the tendril channel
    // A RUBY landing is told by the gem detonation (`ruby-gem-apply`), so the generic buff cue stands down for
    // it. One piece of information, one channel: a gilded Frenzied Excavator buffs itself, and firing both the
    // self-buff cue and the gem on that card says the same thing twice while looking like two different things
    // happened. The `ruby` flag on the buff event exists precisely so the two can be told apart here.
    // (Owner ruling 2026-08-02; see docs/fx-vocabulary.md, "information channels".)
    if (e.ruby) continue;
    const cur = byUid.get(e.target);
    if (cur) { cur.attack += e.attack; cur.health += e.health; }
    else {
      const s: SelfBuff = { uid: e.target, attack: e.attack, health: e.health };
      if (e.spellId !== undefined) s.spellId = e.spellId; // from the FIRST buff, as in `groupBuffCasts`
      byUid.set(e.target, s); order.push(e.target);
    }
  }
  return order.map((k) => byUid.get(k)!);
}
