import { describe, expect, it } from 'vitest';
import type { CombatEvent } from '@game/core';
import { buildBeats } from './combatBeats';

describe('buildBeats', () => {
  it('a plain attack → wind-up beat, then the impact (damage) beat', () => {
    const ev: CombatEvent[] = [
      { type: 'attack', attacker: 'a', defender: 'b', swing: 0 },
      { type: 'dmg', target: 'b', amount: 3, remainingHp: 2 },
      { type: 'dmg', target: 'a', amount: 2, remainingHp: 5 }, // retaliation
    ];
    const beats = buildBeats(ev);
    expect(beats).toEqual([
      { start: 0, end: 1, primary: ev[0] }, // wind-up (the attack)
      { start: 1, end: 3, primary: ev[1] }, // impact: both dmg together
    ]);
  });

  it('an on-attack buff is absorbed into the wind-up, so the damage still lands in the next beat (at connection)', () => {
    // The sim emits: attack → Better Bot buffs another mech → THEN the damage. The buff must not push the
    // damage into a later beat — it rides in the wind-up; the impact beat is still the very next one.
    const ev: CombatEvent[] = [
      { type: 'attack', attacker: 'a', defender: 'b', swing: 0 },
      { type: 'buff', target: 'c', attack: 1, health: 0, source: 'a' },
      { type: 'dmg', target: 'b', amount: 3, remainingHp: 2 },
      { type: 'dmg', target: 'a', amount: 2, remainingHp: 5 },
    ];
    const beats = buildBeats(ev);
    expect(beats.length).toBe(2);
    expect(beats[0]).toEqual({ start: 0, end: 2, primary: ev[0] }); // attack + buff = the wind-up
    expect(beats[1]).toEqual({ start: 2, end: 4, primary: ev[2] }); // impact: the next beat (connection)
  });

  it('absorbs a run of on-attack flashes (rally + summon + buff) into the wind-up', () => {
    const ev: CombatEvent[] = [
      { type: 'attack', attacker: 'a', defender: 'b', swing: 0 },
      { type: 'rally', source: 'a', target: 'd' },
      { type: 'summon', minion: { uid: 't', cardId: 'fred', name: 'Fodder', tribe: 'demon', attack: 1, health: 1, keywords: [], golden: false }, side: 'player', index: 1 },
      { type: 'buff', target: 'c', attack: 1, health: 1, source: 'a' },
      { type: 'dmg', target: 'b', amount: 3, remainingHp: 0 },
      { type: 'death', target: 'b', side: 'enemy' },
    ];
    const beats = buildBeats(ev);
    expect(beats.length).toBe(2);
    expect(beats[0]).toEqual({ start: 0, end: 4, primary: ev[0] }); // attack + rally + summon + buff
    expect(beats[1]).toEqual({ start: 4, end: 6, primary: ev[4] }); // dmg + death together at connection
  });

  it('a standalone buff run (no preceding attack) still gets its own beat', () => {
    const ev: CombatEvent[] = [
      { type: 'buff', target: 'a', attack: 2, health: 2, source: 's' },
      { type: 'buff', target: 'b', attack: 2, health: 2, source: 's' },
      { type: 'dmg', target: 'a', amount: 1, remainingHp: 4 },
    ];
    const beats = buildBeats(ev);
    expect(beats).toEqual([
      { start: 0, end: 2, primary: ev[0] }, // the two buffs land together
      { start: 2, end: 3, primary: ev[2] },
    ]);
  });

  it('Start-of-Combat cast is its own beat; its damage is the next beat', () => {
    const ev: CombatEvent[] = [
      { type: 'sc', source: 'a', text: 'Ember Whelp scorches the front line' },
      { type: 'dmg', target: 'b', amount: 1, remainingHp: 4 },
    ];
    const beats = buildBeats(ev);
    expect(beats).toEqual([
      { start: 0, end: 1, primary: ev[0] },
      { start: 1, end: 2, primary: ev[1] },
    ]);
  });
});
