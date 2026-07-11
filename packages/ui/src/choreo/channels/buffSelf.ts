// packages/ui/src/choreo/channels/buffSelf.ts
import type { CombatEvent } from '@game/core';
import type { Moment } from '../compile';

/** One self-buff pulse to fire: a unit (`uid`) empowering ITSELF by the summed delta this moment. */
export interface SelfBuff { uid: string; attack: number; health: number; }

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
    const cur = byUid.get(e.target);
    if (cur) { cur.attack += e.attack; cur.health += e.health; }
    else { const s = { uid: e.target, attack: e.attack, health: e.health }; byUid.set(e.target, s); order.push(e.target); }
  }
  return order.map((k) => byUid.get(k)!);
}
