import { describe, it, expect } from 'vitest';
import type { CombatEvent } from '@game/core';
import type { Moment } from '../compile';
import { rubiedUidsIn } from './rubyLanded';

const buff = (target: string, ruby?: true): CombatEvent =>
  ({ type: 'buff', target, attack: 1, health: 1, source: 's', ...(ruby ? { ruby } : {}) } as CombatEvent);

/** Only `start`/`end` are read; the rest of a Moment is irrelevant to this scan. */
const span = (start: number, end: number): Moment => ({ start, end } as unknown as Moment);

describe('rubiedUidsIn', () => {
  it('picks out ONLY the ruby-flagged buffs', () => {
    const events = [buff('a'), buff('b', true), buff('c')];
    expect(rubiedUidsIn(span(0, 3), events)).toEqual(['b']);
  });

  /** The whole reason the engine flag exists: without it a Ruby cue bound to buff events fires on all
   *  forty-odd other buff sources. An empty result on a moment full of ordinary buffs is the guard. */
  it('returns nothing when a moment has buffs but no Rubies', () => {
    expect(rubiedUidsIn(span(0, 3), [buff('a'), buff('b'), buff('c')])).toEqual([]);
  });

  it('keeps event order — the sweep runs left to right down the board', () => {
    const events = [buff('c', true), buff('a', true), buff('b', true)];
    expect(rubiedUidsIn(span(0, 3), events)).toEqual(['c', 'a', 'b']);
  });

  /** A Resonance Idol bounce can land a second Ruby on the same body in one moment. Two detonations on one
   *  card at one instant is noise, not information — it fires once. */
  it('de-duplicates a unit hit twice in the same moment', () => {
    const events = [buff('a', true), buff('b', true), buff('a', true)];
    expect(rubiedUidsIn(span(0, 3), events)).toEqual(['a', 'b']);
  });

  it('respects the moment window and never reads outside it', () => {
    const events = [buff('before', true), buff('inside', true), buff('after', true)];
    expect(rubiedUidsIn(span(1, 2), events)).toEqual(['inside']);
  });

  /** `end` may run past the array when a moment is the last one compiled; a hole must not throw. */
  it('tolerates an end index past the event array', () => {
    expect(rubiedUidsIn(span(0, 99), [buff('a', true)])).toEqual(['a']);
  });
});
