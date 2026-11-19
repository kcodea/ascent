import { describe, it, expect } from 'vitest';
import type { CombatEvent } from '@game/core';
import { triggerPulseScan, type PulseTrigger } from './triggerPulse';

const ev = (e: Record<string, unknown>): CombatEvent => e as unknown as CombatEvent;

/** uid → cardId for the tests: SOC is a Start of Combat card, AVG an Avenge card, ECH an Echo card. */
const cardIds = new Map([['SOC', 'c_soc'], ['AVG', 'c_avg'], ['ECH', 'c_ech'], ['PLAIN', 'c_plain']]);
const cardHasOn = (cardId: string, on: 'onDeath' | 'avenge'): boolean =>
  (cardId === 'c_ech' && on === 'onDeath') || (cardId === 'c_avg' && on === 'avenge');
const none = (): boolean => false;
const bound = (...kinds: PulseTrigger[]) => (_cardId: string, k: PulseTrigger): boolean => kinds.includes(k);

const scan = (events: CombatEvent[], hasFx: (cardId: string, k: PulseTrigger) => boolean = none) =>
  triggerPulseScan({ start: 0, end: events.length }, events, cardIds, cardHasOn, hasFx);

describe('triggerPulseScan (R-FX-TRIGGER-STOCK-01)', () => {
  const soc = ev({ type: 'buff', target: 'x', attack: 1, health: 1, source: 'SOC', srcCard: 'c_soc', key: 'factory:scBuff:startOfCombat' });
  const avenge = ev({ type: 'summon', source: 'AVG', srcCard: 'c_avg', avenge: true, minion: { uid: 'tok' } });
  const echoDeath = ev({ type: 'death', target: 'ECH' });
  const echoSummon = ev({ type: 'summon', source: 'ECH', srcCard: 'c_ech', key: 'factory:deathrattleSummon:onDeath', minion: { uid: 'tok2' } });

  it('with nothing bound, every acting unit pulses: the scan the replay always ran', () => {
    const r = scan([soc, avenge, echoDeath, echoSummon, ev({ type: 'improve', target: 'PLAIN', amount: 1 })]);
    expect(r.fired).toEqual(['SOC', 'AVG', 'ECH', 'PLAIN']);
    expect(r.pulse).toEqual(['SOC', 'AVG', 'ECH', 'PLAIN']);
  });

  it('a bound Start of Combat drops only that pulse; the unit still counts as fired (its sound stays)', () => {
    const r = scan([soc, avenge], bound('startOfCombat'));
    expect(r.fired).toEqual(['SOC', 'AVG']);
    expect(r.pulse).toEqual(['AVG']);
  });

  it('a bound Avenge and a bound Echo each drop their own pulse', () => {
    expect(scan([soc, avenge, echoDeath, echoSummon], bound('avenge')).pulse).toEqual(['SOC', 'ECH']);
    expect(scan([soc, avenge, echoDeath, echoSummon], bound('echo')).pulse).toEqual(['SOC', 'AVG']);
  });

  it('a unit that also fired for an unrelated reason keeps its pulse', () => {
    const plainBuff = ev({ type: 'buff', target: 'y', attack: 1, health: 0, source: 'SOC' }); // no key: just "an effect"
    expect(scan([soc, plainBuff], bound('startOfCombat')).pulse).toEqual(['SOC']);
  });

  it('an event another card caused is never read as this unit\'s trigger', () => {
    // A rune / another card stamped the Start of Combat key, but the unit named as source is a different card.
    const foreign = ev({ type: 'buff', target: 'x', attack: 1, health: 1, source: 'PLAIN', srcCard: 'c_soc', key: 'factory:scBuff:startOfCombat' });
    expect(scan([foreign], bound('startOfCombat')).pulse).toEqual(['PLAIN']);
  });

  it('a dying Avenge card (no Echo) keeps the pulse it always had, even with an Avenge effect bound', () => {
    expect(scan([ev({ type: 'death', target: 'AVG' })], bound('avenge', 'echo')).pulse).toEqual(['AVG']);
  });

  it('an Ancient grant\'s origin body, a shout and a hero-power grant keep their old handling', () => {
    const r = scan([
      ev({ type: 'buff', target: 'x', attack: 1, health: 1, source: 'SOC', from: 'PLAIN', key: 'factory:a:startOfCombat' }),
      ev({ type: 'shout', source: 'SOC', target: 'AVG' }),
      ev({ type: 'sc', source: 'AVG', heroPower: true }),
    ], bound('startOfCombat', 'avenge', 'echo'));
    expect(r.fired).toEqual(['PLAIN']);
    expect(r.pulse).toEqual(['PLAIN']);
  });
});
