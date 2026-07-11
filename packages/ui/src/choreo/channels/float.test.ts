import { describe, expect, it } from 'vitest';
import type { CombatEvent } from '@game/core';
import type { Moment } from '../compile';
import { spawnFloats } from './float';

const moment = (events: CombatEvent[]): Moment => ({ start: 0, end: events.length, primary: events[0]!, stepGroups: [[0]], kind: 'damage' });
const noEl = (): Element | null => null;

describe('spawnFloats', () => {
  it('spawns a damage float for the struck unit', () => {
    const evs: CombatEvent[] = [{ type: 'dmg', target: 'b', amount: 3, remainingHp: 5 }];
    const { floats, deathFloats } = spawnFloats(moment(evs), evs, noEl, null);
    expect(floats).toEqual([{ id: 0, uid: 'b', text: '3', kind: 'dmg' }]);
    expect(deathFloats).toEqual([]);
  });

  it('suppresses the attacker\'s own retaliation damage number', () => {
    const evs: CombatEvent[] = [
      { type: 'dmg', target: 'b', amount: 3, remainingHp: 5 },
      { type: 'dmg', target: 'a', amount: 1, remainingHp: 9 },
    ];
    const { floats } = spawnFloats(moment(evs), evs, noEl, 'a');
    expect(floats).toEqual([{ id: 0, uid: 'b', text: '3', kind: 'dmg' }]);
  });

  it('a killing blow on a dying unit becomes a board-overlay DeathFloat positioned via findEl', () => {
    const evs: CombatEvent[] = [
      { type: 'dmg', target: 'b', amount: 9, remainingHp: 0 },
      { type: 'death', target: 'b', side: 'enemy' },
    ];
    const findEl = (uid: string): Element | null => {
      if (uid !== 'b') return null;
      const el = { getBoundingClientRect: () => ({ left: 10, top: 20, width: 40, height: 60 }) } as unknown as Element;
      return el;
    };
    const { floats, deathFloats } = spawnFloats(moment(evs), evs, findEl, null);
    expect(floats).toEqual([]);
    expect(deathFloats).toEqual([{ id: 0, x: 30, y: 50, text: '9', kind: 'dmg' }]);
  });

  it('buff events (self or other) no longer produce a float — every buff is a directed FX', () => {
    // self-buff → pulse, buff-other → tendril; both flash the badge instead of floating a +N (see suppression suite).
    const evs: CombatEvent[] = [
      { type: 'buff', target: 'b', attack: 1, health: 1, source: 'b' },
      { type: 'buff', target: 'b', attack: 2, health: 0, source: 'b' },
    ];
    const { floats } = spawnFloats(moment(evs), evs, noEl, null);
    expect(floats).toEqual([]);
  });

  it('a moment with no floatable events spawns nothing', () => {
    const evs: CombatEvent[] = [{ type: 'reveal', target: 'a' }];
    const { floats, deathFloats } = spawnFloats(moment(evs), evs, noEl, null);
    expect(floats).toEqual([]);
    expect(deathFloats).toEqual([]);
  });
});

const M = (start: number, end: number): Moment =>
  ({ start, end, primary: { type: 'buff' } as CombatEvent, stepGroups: [[start]], kind: 'buffWave' });

describe('spawnFloats — buff suppression', () => {
  it('emits NO float for a self-buff (source === target) — the pulse handles it', () => {
    const events = [{ type: 'buff', source: 'S', target: 'S', attack: 2, health: 2 }] as CombatEvent[];
    const { floats } = spawnFloats(M(0, 1), events, noEl, null);
    expect(floats.filter((f) => f.kind === 'buff')).toEqual([]);
  });

  it('emits NO float for a buff-other (source !== target) — the tendril handles it', () => {
    const events = [{ type: 'buff', source: 'b', target: 'a', attack: 2, health: 2 }] as CombatEvent[];
    const { floats } = spawnFloats(M(0, 1), events, noEl, null);
    expect(floats.filter((f) => f.kind === 'buff')).toEqual([]);
  });
});
