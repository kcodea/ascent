import { describe, expect, it } from 'vitest';
import type { CombatEvent } from '@game/core';
import { payloadsFiredIn, PAYLOAD_STACK_MS } from './payloadFired';
import { RUBY_GAP_MS } from './rubyLanded';

/** The PAYLOAD-FIRED channel's pure scan: per body, counted at the signal, in first-seen order. */
const trigger = (source: string, marker = 'dealtDamageAleMeter'): CombatEvent =>
  ({ type: 'payloadTrigger', source, side: 'player', marker } as CombatEvent);
const dmg = (target: string, source: string): CombatEvent => ({ type: 'dmg', target, amount: 1, remainingHp: 1, source } as CombatEvent);
const span = (start: number, end: number) => ({ start, end });

describe('payloadsFiredIn', () => {
  it('finds one crossing on one body, with its marker', () => {
    const ev = [dmg('foe', 'hg'), trigger('hg')];
    expect(payloadsFiredIn(span(0, 2), ev)).toEqual([{ uid: 'hg', marker: 'dealtDamageAleMeter', count: 1 }]);
  });

  it('COUNTS a double crossing (Han Gover’s 80-damage hit) instead of collapsing it', () => {
    const ev = [dmg('foe', 'hg'), trigger('hg'), trigger('hg')];
    expect(payloadsFiredIn(span(0, 3), ev)).toEqual([{ uid: 'hg', marker: 'dealtDamageAleMeter', count: 2 }]);
  });

  it('keeps distinct bodies apart, in order of first appearance', () => {
    const ev = [trigger('gv', 'dealtDamageGoldNextTurn'), trigger('hg'), trigger('gv', 'dealtDamageGoldNextTurn')];
    expect(payloadsFiredIn(span(0, 3), ev)).toEqual([
      { uid: 'gv', marker: 'dealtDamageGoldNextTurn', count: 2 },
      { uid: 'hg', marker: 'dealtDamageAleMeter', count: 1 },
    ]);
  });

  it('respects the moment’s bounds and ignores every other event type', () => {
    const ev = [trigger('early'), dmg('foe', 'hg'), trigger('hg'), dmg('hg', 'foe'), trigger('late')];
    expect(payloadsFiredIn(span(1, 4), ev)).toEqual([{ uid: 'hg', marker: 'dealtDamageAleMeter', count: 1 }]);
    expect(payloadsFiredIn(span(1, 2), ev)).toEqual([]);
  });

  /** A stack's stride must read as a stride: clearly longer than the Ruby beat (50ms thickens one burst) and
   *  no longer than a whole recipient gap would be in a cascade, or two crossings read as unrelated. */
  it('the stack stride sits between "one thick burst" and "two unrelated hits"', () => {
    expect(PAYLOAD_STACK_MS).toBeGreaterThan(RUBY_GAP_MS);
    expect(PAYLOAD_STACK_MS).toBeLessThan(400);
  });
});
