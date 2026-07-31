import { describe, expect, it } from 'vitest';
import type { CombatEvent } from '@game/core';
import type { Moment } from '../compile';
import { spawnFloats } from './float';

const moment = (events: CombatEvent[]): Moment => ({ start: 0, end: events.length, primary: events[0]!, stepGroups: [[0]], kind: 'damage' });
/** Every float is now placed from ONE `rectOf` reading at spawn (see spawnFloats) — a card-sized box at
 *  (100, 200). Cases that don't care about position just use this. */
const rect = () => ({ cx: 100, cy: 200, w: 120, h: 160 });
const BOX = { x: 100, y: 200, w: 120, h: 160 };

describe('spawnFloats', () => {
  it('spawns a damage float for the struck unit', () => {
    const evs: CombatEvent[] = [{ type: 'dmg', target: 'b', amount: 3, remainingHp: 5 }];
    const { floats, deathFloats } = spawnFloats(moment(evs), evs, rect, null);
    expect(floats).toEqual([{ id: 0, uid: 'b', text: '3', kind: 'dmg', ...BOX }]);
    expect(deathFloats).toEqual([]);
  });

  it('suppresses the attacker\'s own retaliation damage number', () => {
    const evs: CombatEvent[] = [
      { type: 'dmg', target: 'b', amount: 3, remainingHp: 5 },
      { type: 'dmg', target: 'a', amount: 1, remainingHp: 9 },
    ];
    const { floats } = spawnFloats(moment(evs), evs, rect, 'a');
    expect(floats).toEqual([{ id: 0, uid: 'b', text: '3', kind: 'dmg', ...BOX }]);
  });

  it('a killing blow on a dying unit becomes a board-overlay DeathFloat at the slot centre', () => {
    const evs: CombatEvent[] = [
      { type: 'dmg', target: 'b', amount: 9, remainingHp: 0 },
      { type: 'death', target: 'b', side: 'enemy' },
    ];
    const rectOf = (uid: string) => (uid === 'b' ? { cx: 30, cy: 50, w: 40, h: 60 } : null);
    const { floats, deathFloats } = spawnFloats(moment(evs), evs, rectOf, null);
    expect(floats).toEqual([]);
    expect(deathFloats).toEqual([{ id: 0, x: 30, y: 50, text: '9', kind: 'dmg' }]);
  });

  it('carries the slot box so the board-level anchor can reproduce the card box', () => {
    const evs: CombatEvent[] = [{ type: 'dmg', target: 'b', amount: 3, remainingHp: 5 }];
    const rectOf = () => ({ cx: 640, cy: 360, w: 128, h: 176 });
    const { floats } = spawnFloats(moment(evs), evs, rectOf, null);
    expect(floats[0]).toMatchObject({ x: 640, y: 360, w: 128, h: 176 });
  });

  it('drops a float whose unit is not measurable — there is nowhere board-level to put it', () => {
    const evs: CombatEvent[] = [{ type: 'dmg', target: 'b', amount: 3, remainingHp: 5 }];
    const { floats, deathFloats } = spawnFloats(moment(evs), evs, () => null, null);
    expect(floats).toEqual([]);
    expect(deathFloats).toEqual([]);
  });

  it('buff events (self or other) no longer produce a float — every buff is a directed FX', () => {
    // self-buff → pulse, buff-other → tendril; both flash the badge instead of floating a +N (see suppression suite).
    const evs: CombatEvent[] = [
      { type: 'buff', target: 'b', attack: 1, health: 1, source: 'b' },
      { type: 'buff', target: 'b', attack: 2, health: 0, source: 'b' },
    ];
    const { floats } = spawnFloats(moment(evs), evs, rect, null);
    expect(floats).toEqual([]);
  });

  it('a moment with no floatable events spawns nothing', () => {
    const evs: CombatEvent[] = [{ type: 'reveal', target: 'a' }];
    const { floats, deathFloats } = spawnFloats(moment(evs), evs, rect, null);
    expect(floats).toEqual([]);
    expect(deathFloats).toEqual([]);
  });
});

const M = (start: number, end: number): Moment =>
  ({ start, end, primary: { type: 'buff' } as CombatEvent, stepGroups: [[start]], kind: 'buffWave' });

describe('spawnFloats — buff suppression', () => {
  it('emits NO float for a self-buff (source === target) — the pulse handles it', () => {
    const events = [{ type: 'buff', source: 'S', target: 'S', attack: 2, health: 2 }] as CombatEvent[];
    const { floats } = spawnFloats(M(0, 1), events, rect, null);
    expect(floats.filter((f) => f.kind === 'buff')).toEqual([]);
  });

  it('emits NO float for a buff-other (source !== target) — the tendril handles it', () => {
    const events = [{ type: 'buff', source: 'b', target: 'a', attack: 2, health: 2 }] as CombatEvent[];
    const { floats } = spawnFloats(M(0, 1), events, rect, null);
    expect(floats.filter((f) => f.kind === 'buff')).toEqual([]);
  });
});

const P = (start: number, end: number): Moment =>
  ({ start, end, primary: { type: 'poison', target: 'b' } as CombatEvent, stepGroups: [[start]], kind: 'poisonTick' });

describe('spawnFloats — Execute', () => {
  // Removed 2026-07-22 (owner): the red ☠ was a third signifier on a beat that already carries the crescent
  // strike and the victim's red flash.
  it('emits NO float for a poison proc', () => {
    const events = [{ type: 'poison', target: 'b' }] as CombatEvent[];
    const { floats, deathFloats } = spawnFloats(P(0, 1), events, rect, null);
    expect(floats).toEqual([]);
    expect(deathFloats).toEqual([]);
  });

  // Rally has its OWN ☠ (purple) — the removal must not have taken it out too.
  it('still emits the rally skull', () => {
    const events = [{ type: 'rally', source: 'a', target: 'b' }] as CombatEvent[];
    const { floats } = spawnFloats(
      { start: 0, end: 1, primary: events[0]!, stepGroups: [[0]], kind: 'rally' } as Moment, events, rect, null,
    );
    expect(floats).toEqual([{ id: 0, uid: 'b', text: '☠', kind: 'rally', ...BOX }]);
  });
});
