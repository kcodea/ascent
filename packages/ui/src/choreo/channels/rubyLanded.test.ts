import { describe, it, expect } from 'vitest';
import type { CombatEvent } from '@game/core';
import type { Moment } from '../compile';
import { rubiedLandsIn, rubyLandSchedule, rubyLandHolds, RUBY_BEAT_MS, RUBY_GAP_MS } from './rubyLanded';
import { groupSelfBuffs } from './buffSelf';
import { groupBuffCasts } from './buffCast';

const buff = (target: string, ruby?: true): CombatEvent =>
  ({ type: 'buff', target, attack: 1, health: 1, source: 's', ...(ruby ? { ruby } : {}) } as CombatEvent);

/** Only `start`/`end` are read; the rest of a Moment is irrelevant to this scan. */
const span = (start: number, end: number): Moment => ({ start, end } as unknown as Moment);

describe('rubiedUidsIn', () => {
  it('picks out ONLY the ruby-flagged buffs', () => {
    const events = [buff('a'), buff('b', true), buff('c')];
    expect(rubiedLandsIn(span(0, 3), events)).toEqual([{ uid: 'b', count: 1, attack: 1, health: 1 }]);
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
    expect(rubiedLandsIn(span(0, 3), events)).toEqual([{ uid: 'a', count: 2, attack: 2, health: 2 }, { uid: 'b', count: 1, attack: 1, health: 1 }]);
  });

  it('respects the moment window and never reads outside it', () => {
    const events = [buff('before', true), buff('inside', true), buff('after', true)];
    expect(rubiedLandsIn(span(1, 2), events)).toEqual([{ uid: 'inside', count: 1, attack: 1, health: 1 }]);
  });

  /** `end` may run past the array when a moment is the last one compiled; a hole must not throw. */
  it('tolerates an end index past the event array', () => {
    expect(rubiedLandsIn(span(0, 99), [buff('a', true)])).toEqual([{ uid: 'a', count: 1, attack: 1, health: 1 }]);
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
    expect(rubiedLandsIn(moment, [e])).toEqual([{ uid: 'rubied', count: 1, attack: 1, health: 1 }]);
  });
});

  it('carries the STAT DELTA, summed across a stack', () => {
    // The badge withholds this number until the effect delivers it (`fx/statHold.ts`), and the cue is the
    // only place that knows it — so losing it here would silently make every hold a no-op.
    const big = (target: string): CombatEvent =>
      ({ type: 'buff', target, attack: 3, health: 2, source: 's', ruby: true } as CombatEvent);
    expect(rubiedLandsIn(span(0, 2), [big('a'), big('a')]))
      .toEqual([{ uid: 'a', count: 2, attack: 6, health: 4 }]);
  });

describe('rubyLandSchedule', () => {
  it('staggers recipients by the ruby gap and stack members by the beat', () => {
    const out = rubyLandSchedule([{ uid: 'a', count: 2 }, { uid: 'b', count: 1 }]);
    expect(out.map((l) => l.uid)).toEqual(['a', 'a', 'b']);
    expect(out[0]!.at).toBe(0);
    expect(out[1]!.at).toBe(RUBY_BEAT_MS);
    expect(out[2]!.at).toBe(RUBY_GAP_MS);
  });

  it('is PURE — the same input twice gives identical timings, which is what keeps the hold and the fire in step', () => {
    const input = [{ uid: 'a', count: 1 }, { uid: 'b', count: 3 }];
    expect(rubyLandSchedule(input)).toEqual(rubyLandSchedule(input));
  });

  it('returns nothing for no lands', () => {
    expect(rubyLandSchedule([])).toEqual([]);
  });
});

describe('rubyLandHolds', () => {
  /** Fix-round-1 regression: rounding the per-gem average SEPARATELY for each gem in a stack, then
   *  accumulating those holds, overstates the total. A buff of 3 attack across 2 gems is 1.5 per gem —
   *  `Math.round(1.5)` is 2, so two per-gem holds would sum to 4 against a true delta of 3, printing a
   *  number the minion never had. Rounding ONCE over the whole recipient makes this impossible. */
  it('rounds ONCE over the whole recipient, not once per gem in a stack', () => {
    const buff = { attack: 3, health: 2, count: 2 };
    const out = rubyLandHolds([{ uid: 'a', count: 2 }], () => buff);
    expect(out).toEqual([{ uid: 'a', attack: 3, health: 2, at: 0 }]);
  });

  it('collapses a stack to ONE hold, timed to the FIRST gem — holdStat replaces rather than adds a second startAt on the same uid', () => {
    const buff = { attack: 4, health: 4, count: 2 };
    const out = rubyLandHolds([{ uid: 'a', count: 2 }, { uid: 'b', count: 1 }], () => buff);
    expect(out.map((h) => h.uid)).toEqual(['a', 'b']);
    expect(out[0]!.at).toBe(0); // 'a's first gem, not its second (which lands at RUBY_BEAT_MS)
    expect(out[1]!.at).toBe(RUBY_GAP_MS); // 'b' is the second recipient in the cascade
  });

  it('derives the per-gem share from the SAME buff a card actually carries, scaled by this event\'s own count', () => {
    // Total buff is all-time (count 5), but this particular land only reports 2 of them — the per-gem
    // average times THIS event's count, not the buff's lifetime count.
    const buff = { attack: 10, health: 5, count: 5 };
    const out = rubyLandHolds([{ uid: 'a', count: 2 }], () => buff);
    expect(out).toEqual([{ uid: 'a', attack: 4, health: 2, at: 0 }]); // (10/5)*2, (5/5)*2
  });

  it('skips a recipient with no board buff yet, or a buff with a zero count — nothing safe to divide by', () => {
    expect(rubyLandHolds([{ uid: 'a', count: 1 }], () => undefined)).toEqual([]);
    expect(rubyLandHolds([{ uid: 'a', count: 1 }], () => ({ attack: 1, health: 1, count: 0 }))).toEqual([]);
  });

  it('returns nothing for no lands', () => {
    expect(rubyLandHolds([], () => undefined)).toEqual([]);
  });
});
