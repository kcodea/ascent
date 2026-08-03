import { describe, it, expect } from 'vitest';
import type { CombatEvent } from '@game/core';
import type { Moment } from '../compile';
import { rubiedLandsIn } from './rubyLanded';
import { groupSelfBuffs } from './buffSelf';
import { groupBuffCasts } from './buffCast';

const buff = (target: string, ruby?: true): CombatEvent =>
  ({ type: 'buff', target, attack: 1, health: 1, source: 's', ...(ruby ? { ruby } : {}) } as CombatEvent);

/** Only `start`/`end` are read; the rest of a Moment is irrelevant to this scan. */
const span = (start: number, end: number): Moment => ({ start, end } as unknown as Moment);

describe('rubiedUidsIn', () => {
  it('picks out ONLY the ruby-flagged buffs', () => {
    const events = [buff('a'), buff('b', true), buff('c')];
    expect(rubiedLandsIn(span(0, 3), events)).toEqual([{ uid: 'b', count: 1 }]);
  });

  /** The whole reason the engine flag exists: without it a Ruby cue bound to buff events fires on all
   *  forty-odd other buff sources. An empty result on a moment full of ordinary buffs is the guard. */
  it('returns nothing when a moment has buffs but no Rubies', () => {
    expect(rubiedLandsIn(span(0, 3), [buff('a'), buff('b'), buff('c')])).toEqual([]);
  });

  it('keeps event order — the sweep runs left to right down the board', () => {
    const events = [buff('c', true), buff('a', true), buff('b', true)];
    expect(rubiedLandsIn(span(0, 3), events).map((l) => l.uid)).toEqual(['c', 'a', 'b']);
  });

  /** Two Rubies on one body is a 2-STACK, not a duplicate to collapse — this is the gilded multiplier, and
   *  it is also a Resonance Idol bounce, which lands a genuine second Ruby and deserves its second gem. */
  it('COUNTS a unit hit twice in the same moment, keeping first-seen order', () => {
    const events = [buff('a', true), buff('b', true), buff('a', true)];
    expect(rubiedLandsIn(span(0, 3), events)).toEqual([{ uid: 'a', count: 2 }, { uid: 'b', count: 1 }]);
  });

  it('respects the moment window and never reads outside it', () => {
    const events = [buff('before', true), buff('inside', true), buff('after', true)];
    expect(rubiedLandsIn(span(1, 2), events)).toEqual([{ uid: 'inside', count: 1 }]);
  });

  /** `end` may run past the array when a moment is the last one compiled; a hole must not throw. */
  it('tolerates an end index past the event array', () => {
    expect(rubiedLandsIn(span(0, 99), [buff('a', true)])).toEqual([{ uid: 'a', count: 1 }]);
  });
});

/**
 * The one-channel rule, in code. A Ruby landing is told by the gem detonation, so the two GENERIC buff
 * channels stand down for it — otherwise a gilded Frenzied Excavator buffing itself says the same thing
 * twice and looks like two different things happened (owner ruling 2026-08-02).
 */
describe('a Ruby buff is claimed by the gem, not the generic buff cues', () => {
  const moment = span(0, 4);

  it('groupSelfBuffs ignores a ruby-flagged self-buff but keeps an ordinary one', () => {
    const self = (target: string, ruby?: true): CombatEvent =>
      ({ type: 'buff', target, attack: 1, health: 1, source: target, ...(ruby ? { ruby } : {}) } as CombatEvent);
    const out = groupSelfBuffs(moment, [self('rubied', true), self('plain')]);
    expect(out.map((s) => s.uid)).toEqual(['plain']);
  });

  it('groupBuffCasts ignores a ruby-flagged buff-other but keeps an ordinary one', () => {
    const cast = (target: string, ruby?: true): CombatEvent =>
      ({ type: 'buff', target, attack: 1, health: 1, source: 'src', ...(ruby ? { ruby } : {}) } as CombatEvent);
    const out = groupBuffCasts(moment, [cast('rubied', true), cast('plain')]);
    expect(out.map((c) => c.target)).toEqual(['plain']);
  });

  /** The gem still claims it — the event is suppressed for the generic cues, never dropped outright. */
  it('the same ruby buff is still picked up by rubiedUidsIn', () => {
    const e = { type: 'buff', target: 'rubied', attack: 1, health: 1, source: 'src', ruby: true } as CombatEvent;
    expect(rubiedLandsIn(moment, [e])).toEqual([{ uid: 'rubied', count: 1 }]);
  });
});
