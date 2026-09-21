/**
 * The PAYLOAD-FIRED channel — which DAMAGE-METER crossings (Han Gover's Ale meter, Goldvein's Gold meter — the
 * future "Payload" keyword) happened inside a moment, on which bodies, and how many times each.
 *
 * The Rally/Shout channels' cousin (`rallyFired.ts`, `shoutFired.ts`). The engine logs one `payloadTrigger`
 * event PER CREDITED CROSSING (`noteDamageDealt` in core), emitted after the `dmg` that crossed it — usually
 * folded into that hit's impact moment (it is a RESULT_TYPE), where a cue reached only through the moment's
 * primary event could never see it; occasionally LEADING a moment of its own, when the victim's `onDamaged`
 * reactor emitted a non-result event in between (Hearth Whisperer's `handBuff` — the sim runs `onDamaged`
 * before the meter). Either way this scan is per event, per moment, exactly the shape the choreography skill
 * asks for ("a repeated trigger must be COUNTED at the signal"): a Han Gover whose one 80-damage hit crosses
 * twice yields `count: 2`, and the runner plays the owner's `payload-trigger` def twice, spaced as a stack, so
 * the double reads as a double.
 *
 * Pure, and deliberately so: it is the whole testable surface of this channel. `score.ts` holds the
 * scheduling, which needs a live Pixi renderer and cannot be tested here (no jsdom in this repo).
 */
import type { CombatEvent } from '@game/core';
import type { Moment } from '../compile';

export interface PayloadFired {
  /** The body whose meter crossed — where the def lands (both anchors), and whose card resolves the binding. */
  uid: string;
  /** The meter that crossed (`dealtDamageAleMeter` / `dealtDamageGoldNextTurn`) — the first one seen for this
   *  body in the moment (a body carries exactly one meter). */
  marker: string;
  /** How many credited crossings this body had in this moment. */
  count: number;
}

export function payloadsFiredIn(moment: Pick<Moment, 'start' | 'end'>, events: CombatEvent[]): PayloadFired[] {
  const byUid = new Map<string, PayloadFired>();
  const order: string[] = [];
  for (let i = moment.start; i < moment.end; i++) {
    const e = events[i];
    if (!e || e.type !== 'payloadTrigger') continue;
    const cur = byUid.get(e.source);
    if (cur) cur.count += 1;
    else { byUid.set(e.source, { uid: e.source, marker: e.marker, count: 1 }); order.push(e.source); }
  }
  return order.map((k) => byUid.get(k)!);
}

/**
 * Between the plays of one body's STACK — a Han Gover whose single hit crossed twice. The def's burst peaks at
 * ~100ms and its shockwave has left the medallion by ~300ms, so a quarter-second stride lets the second
 * detonation read as a second one rather than thickening the first (a 50ms Ruby beat would). Divided by the
 * combat speed by the scheduler, like every other stride.
 */
export const PAYLOAD_STACK_MS = 240;
