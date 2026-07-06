import { describe, expect, it } from 'vitest';
import { makeRng, simulate } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { buildBeats } from '../combatBeats';
import { compileMoments, DEFAULT_RULES } from './compile';

/** Real fights across the shapes that exercise every grouping rule: plain exchange, Deathrattle cascade,
 *  mutual chip, and a wider board. Rosters mirror the existing suites so the logs are known-interesting. */
const FIGHTS: [string, () => ReturnType<typeof simulate>][] = [
  ['exchange + rattle', () => simulate(
    [{ cardId: 'stray', attack: 3, health: 10 }, { cardId: 'sandbag', attack: 0, health: 5 }],
    [{ cardId: 'pack', attack: 2, health: 2 }], makeRng(3), CARD_INDEX)],
  ['mutual chip', () => simulate(
    [{ cardId: 'stray', attack: 3, health: 10 }],
    [{ cardId: 'sandbag', attack: 2, health: 8 }], makeRng(3), CARD_INDEX)],
  ['bigger board', () => simulate(
    [{ cardId: 'stray', attack: 3, health: 4 }, { cardId: 'pack', attack: 2, health: 2 }, { cardId: 'sandbag', attack: 0, health: 9 }],
    [{ cardId: 'pack', attack: 2, health: 2 }, { cardId: 'stray', attack: 3, health: 4 }], makeRng(11), CARD_INDEX)],
];

describe('compileMoments — default rules reproduce buildBeats exactly', () => {
  for (const [name, run] of FIGHTS) {
    it(`equivalence: ${name}`, () => {
      const r = run();
      const beats = buildBeats(r.events);
      const moments = compileMoments(r.events, DEFAULT_RULES);
      expect(moments.map(({ start, end, primary }) => ({ start, end, primary })))
        .toEqual(beats.map(({ start, end, primary }) => ({ start, end, primary })));
    });
  }

  it('carries stepGroups: contiguous same-step runs covering exactly the moment, in order', () => {
    const r = FIGHTS[0]![1]();
    const moments = compileMoments(r.events, DEFAULT_RULES);
    for (const m of moments) {
      const flat = m.stepGroups.flat();
      expect(flat).toEqual(Array.from({ length: m.end - m.start }, (_, k) => m.start + k));
      for (const g of m.stepGroups) {
        const steps = new Set(g.map((i) => r.events[i]!.step));
        expect(steps.size).toBe(1); // every group is step-homogeneous (real sim output is fully tagged)
      }
    }
  });

  it('untagged events (legacy replays / fixtures) are each their OWN group — never merged', () => {
    const moments = compileMoments(
      [
        { type: 'dmg', target: 'b', amount: 1, remainingHp: 4 },
        { type: 'dmg', target: 'c', amount: 1, remainingHp: 3 },
      ],
      DEFAULT_RULES,
    );
    expect(moments).toHaveLength(1); // two dmg events collapse into one impact moment (grouping unchanged)…
    expect(moments[0]!.stepGroups).toEqual([[0], [1]]); // …but with NO step info, each event stands alone
  });
});
