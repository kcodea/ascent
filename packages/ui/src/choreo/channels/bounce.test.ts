import { describe, expect, it } from 'vitest';
import type { CombatEvent } from '@game/core';
import type { Moment } from '../compile';
import { BOUNCE_DEF, bouncesIn } from './bounce';

const buff = (target: string, over: Partial<Extract<CombatEvent, { type: 'buff' }>> = {}): CombatEvent =>
  ({ type: 'buff', target, attack: 1, health: 1, source: 'x', ...over } as CombatEvent);
const moment = (events: CombatEvent[]): Moment => ({ start: 0, end: events.length, primary: events[0]!, stepGroups: [[0]], kind: 'buffWave' });

describe('bouncesIn — the cross-target re-cast channel', () => {
  it('reads only buff events carrying `bounce` provenance, in event order', () => {
    const events = [
      buff('vic', { ruby: true }),                                       // the original landing — not a bounce
      buff('dt', { ruby: true, bounce: { from: 'vic', kind: 'ruby' } }), // Trouble's self-Ruby off it
      buff('other'),                                                     // a plain buff
      buff('c', { bounce: { from: 'r', kind: 'spell' } }),
    ];
    expect(bouncesIn(moment(events), events)).toEqual([
      { from: 'vic', to: 'dt', kind: 'ruby', count: 1 },
      { from: 'r', to: 'c', kind: 'spell', count: 1 },
    ]);
  });

  it('COUNTS a repeated hop as a stack rather than collapsing it (a gilded Trouble takes two)', () => {
    const events = [
      buff('dt', { ruby: true, bounce: { from: 'vic', kind: 'ruby' } }),
      buff('dt', { ruby: true, bounce: { from: 'vic', kind: 'ruby' } }),
      buff('dt2', { ruby: true, bounce: { from: 'vic', kind: 'ruby' } }),
    ];
    expect(bouncesIn(moment(events), events)).toEqual([
      { from: 'vic', to: 'dt', kind: 'ruby', count: 2 },
      { from: 'vic', to: 'dt2', kind: 'ruby', count: 1 },
    ]);
  });

  it('drops a same-body hop — the cue is cross-target only (owner ruling 2026-09-15)', () => {
    const events = [buff('a', { bounce: { from: 'a', kind: 'ruby' } })];
    expect(bouncesIn(moment(events), events)).toEqual([]);
  });

  it('respects the moment window', () => {
    const events = [buff('a'), buff('b', { bounce: { from: 'a', kind: 'ruby' } })];
    expect(bouncesIn({ ...moment(events), end: 1 }, events)).toEqual([]);
  });

  it('names the two defs by family', () => {
    expect(BOUNCE_DEF).toEqual({ ruby: 'ruby-bounce', spell: 'spell-bounce' });
  });
});
