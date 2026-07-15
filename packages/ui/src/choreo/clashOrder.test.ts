import { describe, expect, it } from 'vitest';
import type { CombatEvent } from '@game/core';
import { deferClashBuffs } from './clashOrder';

const dmg = (target: string): CombatEvent => ({ type: 'dmg', target, amount: 1, remainingHp: 1 } as CombatEvent);
const buff = (target: string): CombatEvent => ({ type: 'buff', target, attack: 1, health: 0, source: target } as CombatEvent);
const attack = (a: string, d: string): CombatEvent => ({ type: 'attack', attacker: a, defender: d, swing: 0 } as CombatEvent);
const death = (target: string): CombatEvent => ({ type: 'death', target, side: 'enemy' } as CombatEvent);
const summon = (uid: string): CombatEvent => ({ type: 'summon', minion: { uid, cardId: 't' }, side: 'enemy', index: 0 } as CombatEvent);
const types = (es: CombatEvent[]): string[] => es.map((e) => e.type);

describe('deferClashBuffs — slide onDamaged buffs to the tail of their clash', () => {
  it('moves a buff sandwiched between two damage events to after the retaliation (the Target Dummy case)', () => {
    // enemy attacks the dummy: dmg(dummy) · buff(dummy) · dmg(enemy-retaliation)
    const evs = [attack('e', 'dummy'), dmg('dummy'), buff('dummy'), dmg('e')];
    expect(types(deferClashBuffs(evs))).toEqual(['attack', 'dmg', 'dmg', 'buff']);
  });

  it('leaves a buff that already trails the clash untouched (returns the same reference)', () => {
    // dummy attacks: dmg(enemy) · dmg(dummy-retaliation) · buff(dummy) — buff is already last
    const evs = [attack('dummy', 'e'), dmg('e'), dmg('dummy'), buff('dummy')];
    expect(deferClashBuffs(evs)).toBe(evs); // nothing moved → same array
  });

  it('does not touch a leading buff wave (a run that starts with a buff is its own beat)', () => {
    const evs = [buff('a'), buff('b'), dmg('c')];
    expect(deferClashBuffs(evs)).toBe(evs);
  });

  it('keeps deaths in sim order and drops the buff after them', () => {
    // dummy hit, gains atk, and its retaliation kills the attacker
    const evs = [attack('e', 'dummy'), dmg('dummy'), buff('dummy'), dmg('e'), death('e')];
    expect(types(deferClashBuffs(evs))).toEqual(['attack', 'dmg', 'dmg', 'death', 'buff']);
  });

  it('keeps a Deathrattle death ADJACENT to its summons — the buff trails the tokens (second-deathrattle bug)', () => {
    // Panther attacks a Target Dummy: the dummy gains Atk (buff), its retaliation kills the Panther, whose
    // Deathrattle then summons 2 cubs. The deferred buff must land AFTER the summons — otherwise it wedges a
    // beat between the death and its tokens, killing the pre-summon wait AND the dying attacker's skull.
    const evs = [attack('p', 'dummy'), dmg('dummy'), buff('dummy'), dmg('p'), death('dummy'), death('p'), summon('c1'), summon('c2')];
    expect(types(deferClashBuffs(evs))).toEqual(['attack', 'dmg', 'dmg', 'death', 'death', 'summon', 'summon', 'buff']);
  });

  it('handles two sandwiched buffs, preserving their relative order at the tail', () => {
    const evs = [dmg('a'), buff('x'), dmg('b'), buff('y'), dmg('c')];
    const out = deferClashBuffs(evs);
    expect(types(out)).toEqual(['dmg', 'dmg', 'dmg', 'buff', 'buff']);
    expect((out[3] as { target: string }).target).toBe('x');
    expect((out[4] as { target: string }).target).toBe('y');
  });

  it('does not merge across an action boundary — two separate clashes stay separate', () => {
    const evs = [dmg('a'), buff('a'), attack('a', 'b'), dmg('b'), buff('b'), dmg('a')];
    expect(types(deferClashBuffs(evs))).toEqual(['dmg', 'buff', 'attack', 'dmg', 'dmg', 'buff']);
  });
});
