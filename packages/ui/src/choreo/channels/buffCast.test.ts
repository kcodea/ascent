// packages/ui/src/choreo/channels/buffCast.test.ts
import { describe, expect, it } from 'vitest';
import type { CombatEvent } from '@game/core';
import type { Moment } from '../compile';
import { groupBuffCasts } from './buffCast';

const M = (start: number, end: number): Moment =>
  ({ start, end, primary: { type: 'buff' } as CombatEvent, stepGroups: [[start]], kind: 'buffWave' });

describe('groupBuffCasts — one entry per (source→target) with source !== target', () => {
  it('groups a tribe aura: one source, one entry per distinct target', () => {
    const events: CombatEvent[] = [
      { type: 'buff', source: 'A', target: 'x', attack: 1, health: 1 },
      { type: 'buff', source: 'A', target: 'y', attack: 1, health: 1 },
    ] as CombatEvent[];
    const casts = groupBuffCasts(M(0, 2), events);
    expect(casts).toEqual([
      { source: 'A', target: 'x', attack: 1, health: 1 },
      { source: 'A', target: 'y', attack: 1, health: 1 },
    ]);
  });
  it('excludes self-buffs (source === target)', () => {
    const events: CombatEvent[] = [
      { type: 'buff', source: 'S', target: 'S', attack: 3, health: 3 },
    ] as CombatEvent[];
    expect(groupBuffCasts(M(0, 1), events)).toEqual([]);
  });
  it('sums multiple buffs to the same (source,target) into one cast', () => {
    const events: CombatEvent[] = [
      { type: 'buff', source: 'A', target: 'x', attack: 1, health: 0 },
      { type: 'buff', source: 'A', target: 'x', attack: 0, health: 2 },
    ] as CombatEvent[];
    expect(groupBuffCasts(M(0, 2), events)).toEqual([{ source: 'A', target: 'x', attack: 1, health: 2 }]);
  });
  it('only reads events inside the moment slice', () => {
    const events: CombatEvent[] = [
      { type: 'buff', source: 'A', target: 'x', attack: 9, health: 9 },
      { type: 'buff', source: 'A', target: 'y', attack: 1, health: 1 },
    ] as CombatEvent[];
    expect(groupBuffCasts(M(1, 2), events)).toEqual([{ source: 'A', target: 'y', attack: 1, health: 1 }]);
  });
});
