/**
 * The PUMMEL-FIRED channel — which PUMMEL (X) fires (Han Gover's Ale meter, Goldvein's Gold meter — the
 * damage-dealt threshold keyword, owner 2026-09-21) happened inside a moment, on which bodies, and how many
 * times each.
 *
 * The Rally/Shout channels' cousin (`rallyFired.ts`, `shoutFired.ts`). The engine logs one `pummelTrigger`
 * event per body per combat (`noteDamageDealt` in core — every Pummel is once per combat), emitted after the
 * `dmg` that reached X — usually folded into that hit's impact moment (it is a RESULT_TYPE), where a cue
 * reached only through the moment's primary event could never see it; occasionally LEADING a moment of its
 * own, when the victim's `onDamaged` reactor emitted a non-result event in between (Hearth Whisperer's
 * `handBuff` — the sim runs `onDamaged` before the meter). Either way this scan is per event, per moment,
 * exactly the shape the choreography skill asks for ("a repeated trigger must be COUNTED at the signal"): the
 * count is kept as the contract, so a log that fires one body twice in a moment (two bodies of the same card
 * in one clash are two entries; a future repeating meter would be one entry with `count: 2`) plays the owner's
 * `pummel-trigger` def per fire, spaced as a stack, and a double reads as a double.
 *
 * Pure, and deliberately so: it is the whole testable surface of this channel. `score.ts` holds the
 * scheduling, which needs a live Pixi renderer and cannot be tested here (no jsdom in this repo).
 */
import type { CombatEvent } from '@game/core';
import type { Moment } from '../compile';

export interface PummelFired {
  /** The body whose Pummel fired — where the def lands (both anchors), and whose card resolves the binding. */
  uid: string;
  /** The meter that fired (`dealtDamageAleMeter` / `dealtDamageGoldNextTurn`) — the first one seen for this
   *  body in the moment (a body carries exactly one meter). */
  marker: string;
  /** How many `pummelTrigger` events this body had in this moment (one per combat from today's engine). */
  count: number;
}

export function pummelsFiredIn(moment: Pick<Moment, 'start' | 'end'>, events: CombatEvent[]): PummelFired[] {
  const byUid = new Map<string, PummelFired>();
  const order: string[] = [];
  for (let i = moment.start; i < moment.end; i++) {
    const e = events[i];
    if (!e || e.type !== 'pummelTrigger') continue;
    const cur = byUid.get(e.source);
    if (cur) cur.count += 1;
    else { byUid.set(e.source, { uid: e.source, marker: e.marker, count: 1 }); order.push(e.source); }
  }
  return order.map((k) => byUid.get(k)!);
}

/**
 * Between the plays of one body's STACK — a body the log fired more than once in one moment (no shipped meter
 * does today: every Pummel is once per combat; the stride is the contract for a repeating one). The def's
 * burst peaks at ~100ms and its shockwave has left the medallion by ~300ms, so a quarter-second stride lets the
 * second detonation read as a second one rather than thickening the first (a 50ms Ruby beat would). Divided
 * by the combat speed by the scheduler, like every other stride.
 */
export const PUMMEL_STACK_MS = 240;
