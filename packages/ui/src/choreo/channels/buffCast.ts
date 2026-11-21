// packages/ui/src/choreo/channels/buffCast.ts
import type { CombatEvent } from '@game/core';
import type { Moment } from '../compile';

/** One tendril to fire: a buffer (`source`) empowering another unit (`target`) by the summed delta this moment.
 *
 *  `spellId` is the SPELL that caused the buff, when one did (stamped by the sim on the buff event). It rides
 *  along so the presentation can ask "does this buff have an authored effect of its own?" — a spell's def
 *  REPLACES the stock tendril rather than playing over it, and after on-attack casts began resolving inside
 *  the wind-up there is no moment-level binding left to make that decision with: the moment is the ATTACK's,
 *  and the spell is only visible per-buff (owner report 2026-09-01, Dragonflame "back to casting tendrils"). */
/** `label` = the grant's source LABEL when `from` moved its visible origin onto a body (an Ancient's `trigger`-origin grant):
 *  `source` is then the minion, and the label still names the Ancient (R-FX-ANCIENT-TENDRIL-02). */
export interface BuffCast { source: string; target: string; attack: number; health: number; spellId?: string; label?: string; }

/** Where a buff VISIBLY comes from: the body the sim stamped on a label grant (`from`, R-FX-ANCIENT-ORIGIN-01: an
 *  Ancient's grant that starts at the minion that set it off, or at the recipient itself for a self-buff), else its
 *  `source`. Both stock channels read this one answer, so an origin moves a grant between them without a special case. */
export function buffOriginOf(e: Extract<CombatEvent, { type: 'buff' }>): string {
  return e.from ?? e.source;
}

/** Collect this moment's buff events into per-(source,target) casts, EXCLUDING self-buffs (source === target),
 *  summing repeated buffs to the same pair. Order: first appearance of each (source,target) pair. Pure. */
export function groupBuffCasts(moment: Moment, events: CombatEvent[]): BuffCast[] {
  const order: string[] = [];
  const byKey = new Map<string, BuffCast>();
  for (let i = moment.start; i < moment.end; i++) {
    const e = events[i];
    if (!e || e.type !== 'buff') continue;
    const source = buffOriginOf(e);
    if (source === e.target) continue; // self-buff: keeps its +N float, no tendril
    if (e.ruby) continue; // a Ruby is TOLD BY THE GEM — see the note above `groupSelfBuffs`
    const key = `${source} ${e.target}`;
    const cur = byKey.get(key);
    if (cur) { cur.attack += e.attack; cur.health += e.health; }
    else {
      const c: BuffCast = { source, target: e.target, attack: e.attack, health: e.health };
      // From the FIRST buff of the pair. Two different spells buffing the same pair in one moment is not a
      // shape the sim produces (a cast's buffs share its step), and taking the first keeps this pure and cheap.
      if (e.spellId !== undefined) c.spellId = e.spellId;
      if (e.from !== undefined) c.label = e.source;
      byKey.set(key, c); order.push(key);
    }
  }
  return order.map((k) => byKey.get(k)!);
}
