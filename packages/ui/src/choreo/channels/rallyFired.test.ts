import { describe, it, expect } from 'vitest';
import type { CombatEvent } from '@game/core';
import type { Moment } from '../compile';
import { compileMoments } from '../compile';
import { ralliesFiredIn, RALLY_BEAT_MS, RALLY_GAP_MS } from './rallyFired';

const rally = (source: string, target: string): CombatEvent => ({ type: 'rally', source, target } as CombatEvent);
const buff = (target: string): CombatEvent =>
  ({ type: 'buff', target, attack: 1, health: 1, source: 's' } as CombatEvent);

/** Only `start`/`end` are read; the rest of a Moment is irrelevant to this scan. */
const span = (start: number, end: number): Moment => ({ start, end } as unknown as Moment);

describe('ralliesFiredIn', () => {
  it('picks out ONLY the rally events', () => {
    expect(ralliesFiredIn(span(0, 3), [buff('a'), rally('r', 'e'), buff('c')]))
      .toEqual([{ source: 'r', target: 'e', count: 1 }]);
  });

  it('returns nothing for a moment with no Rally in it', () => {
    expect(ralliesFiredIn(span(0, 2), [buff('a'), buff('b')])).toEqual([]);
  });

  /** BOTH ends, which is the property that made a Rally unrepresentable through the primary-event `fxDef`
   *  path: what plays is decided by the rallier's card, and where it plays is the ally it procced. */
  it('carries both ends of the pair', () => {
    const [fired] = ralliesFiredIn(span(0, 1), [rally('echohorn', 'sporeling')]);
    expect(fired).toEqual({ source: 'echohorn', target: 'sporeling', count: 1 });
  });

  it('keeps event order across distinct pairs', () => {
    const events = [rally('r2', 'e2'), rally('r1', 'e1')];
    expect(ralliesFiredIn(span(0, 2), events).map((f) => f.source)).toEqual(['r2', 'r1']);
  });

  /** A gilded Echohorn loops `mul(self)` times, and Elderhorn's Hunt grant adds more procs — two fires on the
   *  same ally is a 2-STACK, not a duplicate to collapse. Erasing it would hide the multiplier. */
  it('COUNTS a pair that fires twice in one moment, keeping first-seen order', () => {
    const events = [rally('r1', 'e1'), rally('r2', 'e2'), rally('r1', 'e1')];
    expect(ralliesFiredIn(span(0, 3), events)).toEqual([
      { source: 'r1', target: 'e1', count: 2 },
      { source: 'r2', target: 'e2', count: 1 },
    ]);
  });

  /** Same rallier, DIFFERENT ally is two lands, not a 2-stack: the walk has to visit both units. */
  it('separates one rallier proccing two different allies', () => {
    expect(ralliesFiredIn(span(0, 2), [rally('r', 'e1'), rally('r', 'e2')])).toEqual([
      { source: 'r', target: 'e1', count: 1 },
      { source: 'r', target: 'e2', count: 1 },
    ]);
  });

  it('respects the moment window and never reads outside it', () => {
    const events = [rally('before', 'x'), rally('inside', 'x'), rally('after', 'x')];
    expect(ralliesFiredIn(span(1, 2), events).map((f) => f.source)).toEqual(['inside']);
  });

  /** `end` may run past the array when a moment is the last one compiled; a hole must not throw. */
  it('tolerates an end index past the event array', () => {
    expect(ralliesFiredIn(span(0, 99), [rally('r', 'e')])).toEqual([{ source: 'r', target: 'e', count: 1 }]);
  });
});

/**
 * THE reason this channel exists, pinned as a test rather than left in a comment. A Rally is an `onAttack`
 * trigger, so its event lands inside the attacker's wind-up and the moment is classified `attackExchange` —
 * the `rally` KIND never appears. Anything that resolves one binding off the primary event therefore cannot
 * reach a Rally; only a scan of the moment's own events can.
 */
describe('a real Rally is absorbed into its attacker wind-up', () => {
  const events = [
    { type: 'attack', attacker: 'echohorn', defender: 'foe', swing: 0 },
    rally('echohorn', 'sporeling'),
    { type: 'dmg', target: 'foe', amount: 3, remainingHp: 0 },
  ] as CombatEvent[];

  it('classifies as attackExchange, NOT rally', () => {
    const [windup] = compileMoments(events);
    expect(windup?.kind).toBe('attackExchange');
    expect(windup?.primary.type).toBe('attack');
  });

  it('still finds the Rally inside that moment, with its own pair', () => {
    const [windup] = compileMoments(events);
    expect(ralliesFiredIn(windup!, events)).toEqual([{ source: 'echohorn', target: 'sporeling', count: 1 }]);
  });
});

/** The 2:1 ratio IS the information — see `beatExceedsGap` in fx/land.ts. */
describe('cascade timing', () => {
  it('beats a stack clearly faster than it walks between pairs', () => {
    expect(RALLY_BEAT_MS).toBeLessThan(RALLY_GAP_MS);
  });
});
