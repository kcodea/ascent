/**
 * The SHOUT-FIRED channel — which Shout RE-FIRES happened inside a moment, between which pair of units, and
 * whether a swing has fires ahead of its own strike.
 *
 * The Rally channel's cousin (`rallyFired.ts`). The engine logs one `shout` event PER FIRE (inside the Drakko
 * repeat loop — see `fireShout` in core), and `compileMoments` makes each fire its OWN moment together with
 * the consequences it produced. So a Drakko-repeated Shout is three moments: three frame commits, three
 * number rolls, three beats of screen time. The swing that caused them PARKS at the top of its wind-up
 * while they play (the Echohorn hold) and strikes when its own damage beat arrives.
 *
 * Why (owner report 2026-09-01): with a gilded Drakko, Dawnclaw's Echo fired Wardkeeper's Shout three times
 * and the replay showed one. A first fix paced the fires as cues INSIDE the wind-up; the owner rejected it —
 * the effects still committed in one frame and the attacker stood frozen through a stretched pause.
 *
 * Pure, and deliberately so: it is the whole testable surface of this channel.
 */
import type { CombatEvent } from '@game/core';
import type { Moment } from '../compile';

export interface ShoutFired {
  /** The unit that RE-TRIGGERED the Shout (Dawnclaw, Ryme, Chorus Drake, Embercrest…) — whose binding decides
   *  what plays, and who pulses. */
  source: string;
  /** The Shout's OWNER — where the def lands, and who blooms. */
  target: string;
  /** How many times this pair fired in this moment. Normally 1 — each fire compiles to its own moment. */
  count: number;
}

/** Pair key separator — NUL cannot occur in a uid, and is written as an ESCAPE, never a literal byte
 *  (a raw NUL makes git treat the module as binary). Same choice as `rallyFired.ts`. */
const SEP = '\u0000';
const pairKey = (source: string, target: string): string => `${source}${SEP}${target}`;

export function shoutsFiredIn(moment: Moment, events: CombatEvent[]): ShoutFired[] {
  const byPair = new Map<string, ShoutFired>();
  const order: string[] = [];
  for (let i = moment.start; i < moment.end; i++) {
    const e = events[i];
    if (!e || e.type !== 'shout') continue;
    const key = pairKey(e.source, e.target);
    const cur = byPair.get(key);
    if (cur) cur.count += 1;
    else { byPair.set(key, { source: e.source, target: e.target, count: 1 }); order.push(key); }
  }
  return order.map((k) => byPair.get(k)!);
}

/**
 * Does a Shout re-fire sit between this exchange and the attacker's OWN strike? Then the swing must PARK at
 * the top of its wind-up (the Echohorn hold) so the fires play as their own beats first, and resume when its
 * damage beat arrives — the `heldLungeRef` release path, unchanged.
 *
 * Scans forward from the moment's end and stops at the first thing that ends the swing's consequence window:
 * the attacker's own non-wave damage (its strike landed), or the next attack (the swing was cancelled or the
 * clash was skipped — a corpse target). A fire that comes AFTER the strike (the defender's Deathrattle
 * re-firing a Shout) is not ahead of it, and does not park.
 */
export function shoutsAheadOf(moment: Moment, events: CombatEvent[], attackerUid: string | null): boolean {
  if (attackerUid === null) return false;
  for (let i = moment.end; i < events.length; i++) {
    const e = events[i]!;
    if (e.type === 'attack') return false;
    if (e.type === 'dmg' && e.source === attackerUid && e.wave === undefined) return false;
    if (e.type === 'shout') return true;
  }
  return false;
}
