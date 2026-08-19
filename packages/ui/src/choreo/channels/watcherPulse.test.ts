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

  it('a RALLY source earns a pulse — the Hawkus case (owner call 2026-08-19)', () => {
    // Hawkus procs an ally's Echo off ANOTHER unit's swing, so its only trace in the beat is a `rally` cue.
    // Before this it left no pulse at all: the Echo it fired animated, but the card that caused it never lit.
    const events = [
      ev({ type: 'attack', attacker: 'ATK', defender: 'DEF', swing: 0 }),
      ev({ type: 'rally', source: 'HAWK', target: 'ECHO' }),
    ];
    expect(watcherPulseUids({ start: 0, end: 2 }, events, 'ATK')).toEqual(['HAWK']);
  });

  it('does NOT pulse a rallier that is the attacker — Echohorn keeps its own attacker pulse', () => {
    // The other shape of the same event: Echohorn procs off its OWN swing, so it is the attacker and already
    // has attacker pulse paths. Letting `rally` through the guard would give it a second, differently
    // coloured pulse on top.
    const events = [
      ev({ type: 'attack', attacker: 'ECH', defender: 'DEF', swing: 0 }),
      ev({ type: 'rally', source: 'ECH', target: 'ally' }),
    ];
    expect(watcherPulseUids({ start: 0, end: 2 }, events, 'ECH')).toEqual([]);
  });

  it('dedupes a multi-proc rally into ONE pulse', () => {
    // A gilded Hawkus fires its Echo twice; the medallion should light once, not stutter per proc.
    const events = [
      ev({ type: 'attack', attacker: 'ATK', defender: 'DEF', swing: 0 }),
      ev({ type: 'rally', source: 'HAWK', target: 'ECHO' }),
      ev({ type: 'rally', source: 'HAWK', target: 'ECHO' }),
    ];
    expect(watcherPulseUids({ start: 0, end: 3 }, events, 'ATK')).toEqual(['HAWK']);
  });

  it('is empty when only the attacker acts', () => {
    const events = [
      ev({ type: 'attack', attacker: 'ATK', defender: 'DEF', swing: 0 }),
      ev({ type: 'buff', target: 'z', attack: 1, health: 1, source: 'ATK' }),
    ];
    expect(watcherPulseUids({ start: 0, end: 2 }, events, 'ATK')).toEqual([]);
  });
});
