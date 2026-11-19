import type { CombatEvent } from '@game/core';

/** The triggers whose medallion pulse an effect can replace in the per-beat scan. */
export type PulseTrigger = 'startOfCombat' | 'avenge' | 'echo';

export interface TriggerPulseScan {
  /** Every unit whose effect fired in this beat, first-seen order: they all keep their trigger SOUND. */
  fired: string[];
  /** The subset that still shows the stock medallion pulse (no effect replaced it). */
  pulse: string[];
}

/**
 * TRIGGER-PULSE channel. Which units fired an effect in this beat, and which of them still wear the stock medallion
 * pulse (R-FX-TRIGGER-STOCK-01, owner 2026-11-19: an authored effect REPLACES the pulse, as a bound Shout and a
 * bound Pummel already did).
 *
 * The scan is the one `useCombatReplay` always ran: a unit is acting when it is the `source` (or an Ancient grant's
 * `from`) of an sc / buff / keyword / summon / toHand event, the `target` of an improve / maxGold / hpGrant / reborn
 * event, or a death whose card has an Echo or an Avenge. `rally` and `shout` are not here: they pulse from their own
 * paths.
 *
 * What is new is the REASON each event gives. The simulator stamps `key: 'factory:<do>:<on>'` and `avenge: true` on
 * the events an effect emits, so a Start of Combat, an Avenge and an Echo can be told apart from "some effect
 * fired". A unit's pulse is dropped only when EVERY reason it fired for has an effect (`hasFx`): a body that fires
 * its Start of Combat and also buffs for an unrelated reason in the same beat still pulses. A reason is attributed
 * only when the event's `srcCard` is that unit's own card, so a buff a rune or another card caused never counts as
 * this unit's trigger.
 */
export function triggerPulseScan(
  beat: { start: number; end: number },
  events: CombatEvent[],
  cardIds: ReadonlyMap<string, string>,
  cardHasOn: (cardId: string, on: 'onDeath' | 'avenge') => boolean,
  hasFx: (cardId: string, trigger: PulseTrigger) => boolean,
): TriggerPulseScan {
  const reasons = new Map<string, Set<PulseTrigger | 'other'>>();
  const note = (uid: string | undefined, why: PulseTrigger | 'other'): void => {
    if (!uid) return;
    const set = reasons.get(uid) ?? new Set();
    set.add(why);
    reasons.set(uid, set);
  };
  /** Why this event fired, as far as the acting unit `uid` is concerned. */
  const reasonOf = (e: CombatEvent, uid: string): PulseTrigger | 'other' => {
    if (typeof e.srcCard === 'string' && e.srcCard !== cardIds.get(uid)) return 'other';
    if (e.avenge === true) return 'avenge';
    if (typeof e.key === 'string') {
      if (e.key.endsWith(':startOfCombat')) return 'startOfCombat';
      if (e.key.endsWith(':onDeath')) return 'echo';
    }
    return 'other';
  };
  for (let i = beat.start; i < beat.end; i++) {
    const e = events[i];
    if (!e) continue;
    if (e.type === 'shout') continue;
    if (e.type === 'sc' && e.heroPower) continue; // a hero-power grant pulses no body
    if (e.type === 'buff' && e.from) note(e.from, 'other'); // an Ancient's grant: the body it visibly starts from
    else if ((e.type === 'sc' || e.type === 'buff' || e.type === 'keyword') && e.source) note(e.source, reasonOf(e, e.source));
    else if ((e.type === 'summon' || e.type === 'toHand') && e.source) note(e.source, reasonOf(e, e.source));
    else if (e.type === 'improve' || e.type === 'maxGold' || e.type === 'hpGrant' || e.type === 'reborn') note(e.target, reasonOf(e, e.target));
    else if (e.type === 'death') {
      const cardId = cardIds.get(e.target) ?? '';
      if (cardHasOn(cardId, 'onDeath')) note(e.target, 'echo');
      else if (cardHasOn(cardId, 'avenge')) note(e.target, 'other');
    }
  }
  const fired: string[] = [];
  const pulse: string[] = [];
  for (const [uid, why] of reasons) {
    fired.push(uid);
    const cardId = cardIds.get(uid);
    const replaced = cardId !== undefined && [...why].every((r) => r !== 'other' && hasFx(cardId, r));
    if (!replaced) pulse.push(uid);
  }
  return { fired, pulse };
}
