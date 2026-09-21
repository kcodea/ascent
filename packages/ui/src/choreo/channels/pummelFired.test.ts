import { describe, expect, it } from 'vitest';
import type { CombatEvent } from '@game/core';
import { pummelsFiredIn, PUMMEL_STACK_MS } from './pummelFired';
import { RUBY_GAP_MS } from './rubyLanded';

/** The PUMMEL-FIRED channel's pure scan: per body, counted at the signal, in first-seen order. The double
 *  cases are SYNTHETIC logs — every shipped Pummel is once per combat — pinning the counter as the contract. */
const trigger = (source: string, marker = 'dealtDamageAleMeter'): CombatEvent =>
  ({ type: 'pummelTrigger', source, side: 'player', marker } as CombatEvent);
const dmg = (target: string, source: string): CombatEvent => ({ type: 'dmg', target, amount: 1, remainingHp: 1, source } as CombatEvent);
const span = (start: number, end: number) => ({ start, end });

describe('pummelsFiredIn', () => {
  it('finds one fire on one body, with its marker', () => {
    const ev = [dmg('foe', 'hg'), trigger('hg')];
    expect(pummelsFiredIn(span(0, 2), ev)).toEqual([{ uid: 'hg', marker: 'dealtDamageAleMeter', count: 1 }]);
  });

  it('COUNTS a body fired twice in one moment (synthetic) instead of collapsing it', () => {
    const ev = [dmg('foe', 'hg'), trigger('hg'), trigger('hg')];
    expect(pummelsFiredIn(span(0, 3), ev)).toEqual([{ uid: 'hg', marker: 'dealtDamageAleMeter', count: 2 }]);
  });

  it('keeps distinct bodies apart, in order of first appearance', () => {
    const ev = [trigger('gv', 'dealtDamageGoldNextTurn'), trigger('hg'), trigger('gv', 'dealtDamageGoldNextTurn')];
    expect(pummelsFiredIn(span(0, 3), ev)).toEqual([
      { uid: 'gv', marker: 'dealtDamageGoldNextTurn', count: 2 },
      { uid: 'hg', marker: 'dealtDamageAleMeter', count: 1 },
    ]);
  });

  it('respects the moment’s bounds and ignores every other event type', () => {
    const ev = [trigger('early'), dmg('foe', 'hg'), trigger('hg'), dmg('hg', 'foe'), trigger('late')];
    expect(pummelsFiredIn(span(1, 4), ev)).toEqual([{ uid: 'hg', marker: 'dealtDamageAleMeter', count: 1 }]);
    expect(pummelsFiredIn(span(1, 2), ev)).toEqual([]);
  });

  /** A stack's stride must read as a stride: clearly longer than the Ruby beat (50ms thickens one burst) and
   *  no longer than a whole recipient gap would be in a cascade, or two fires read as unrelated. */
  it('the stack stride sits between "one thick burst" and "two unrelated hits"', () => {
    expect(PUMMEL_STACK_MS).toBeGreaterThan(RUBY_GAP_MS);
    expect(PUMMEL_STACK_MS).toBeLessThan(400);
  });
});
