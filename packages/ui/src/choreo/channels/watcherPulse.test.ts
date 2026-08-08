import { describe, it, expect } from 'vitest';
import type { CombatEvent } from '@game/core';
import { watcherPulseUids } from './watcherPulse';

const ev = (e: Partial<CombatEvent>): CombatEvent => e as CombatEvent;

describe('watcherPulseUids', () => {
  it('returns non-attacker friendly sources of stat-grant events, attacker excluded', () => {
    // attack by ATK; ATK's own rally buff (source ATK); a watcher WCH reacts (buff source WCH); WCH improve.
    const events = [
      ev({ type: 'attack', attacker: 'ATK', defender: 'DEF', swing: 0 }),
      ev({ type: 'buff', target: 'ally', attack: 1, health: 1, source: 'ATK' }), // attacker's own → excluded
      ev({ type: 'buff', target: 'x', attack: 2, health: 1, source: 'WCH' }),     // watcher → included
      ev({ type: 'improve', target: 'WCH', amount: 1 }),                          // same watcher, dedup
      ev({ type: 'buff', target: 'y', attack: 1, health: 1, source: 'WCH2' }),    // second watcher
    ];
    expect(watcherPulseUids({ start: 0, end: 5 }, events, 'ATK')).toEqual(['WCH', 'WCH2']);
  });

  it('is empty when only the attacker acts', () => {
    const events = [
      ev({ type: 'attack', attacker: 'ATK', defender: 'DEF', swing: 0 }),
      ev({ type: 'buff', target: 'z', attack: 1, health: 1, source: 'ATK' }),
    ];
    expect(watcherPulseUids({ start: 0, end: 2 }, events, 'ATK')).toEqual([]);
  });
});
