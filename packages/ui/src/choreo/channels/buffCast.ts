// packages/ui/src/choreo/channels/buffCast.ts
import type { CombatEvent } from '@game/core';
import type { Moment } from '../compile';

/** One tendril to fire: a buffer (`source`) empowering another unit (`target`) by the summed delta this moment. */
export interface BuffCast { source: string; target: string; attack: number; health: number; }

/** Collect this moment's buff events into per-(source,target) casts, EXCLUDING self-buffs (source === target),
 *  summing repeated buffs to the same pair. Order: first appearance of each (source,target) pair. Pure. */
export function groupBuffCasts(moment: Moment, events: CombatEvent[]): BuffCast[] {
  const order: string[] = [];
  const byKey = new Map<string, BuffCast>();
  for (let i = moment.start; i < moment.end; i++) {
    const e = events[i];
    if (!e || e.type !== 'buff') continue;
    if (e.source === e.target) continue; // self-buff: keeps its +N float, no tendril
    const key = `${e.source} ${e.target}`;
    const cur = byKey.get(key);
    if (cur) { cur.attack += e.attack; cur.health += e.health; }
    else { const c = { source: e.source, target: e.target, attack: e.attack, health: e.health }; byKey.set(key, c); order.push(key); }
  }
  return order.map((k) => byKey.get(k)!);
}
