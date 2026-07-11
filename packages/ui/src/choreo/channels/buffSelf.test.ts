import { describe, it, expect } from 'vitest';
import type { CombatEvent } from '@game/core';
import { groupSelfBuffs } from './buffSelf';
import type { Moment } from '../compile';

const moment = (start: number, end: number): Moment => ({ start, end } as Moment);

describe('groupSelfBuffs', () => {
  it('collects self-buffs (source === target), summing repeats per uid', () => {
    const events: CombatEvent[] = [
      { type: 'buff', target: 'a', source: 'a', attack: 2, health: 1 },
      { type: 'buff', target: 'a', source: 'a', attack: 1, health: 3 },
      { type: 'buff', target: 'b', source: 'b', attack: 4, health: 0 },
    ];
    expect(groupSelfBuffs(moment(0, 3), events)).toEqual([
      { uid: 'a', attack: 3, health: 4 },
      { uid: 'b', attack: 4, health: 0 },
    ]);
  });

  it('excludes buff-OTHERS (source !== target)', () => {
    const events: CombatEvent[] = [
      { type: 'buff', target: 'x', source: 'y', attack: 5, health: 5 },
    ];
    expect(groupSelfBuffs(moment(0, 1), events)).toEqual([]);
  });

  it('only reads events within the moment window', () => {
    const events: CombatEvent[] = [
      { type: 'buff', target: 'a', source: 'a', attack: 1, health: 1 },
      { type: 'buff', target: 'b', source: 'b', attack: 9, health: 9 },
    ];
    expect(groupSelfBuffs(moment(1, 2), events)).toEqual([{ uid: 'b', attack: 9, health: 9 }]);
  });
});
