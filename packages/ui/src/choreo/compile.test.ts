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
  ['rise pull-back', () => simulate(
    [{ cardId: 'footman', attack: 2, health: 1 }],
    [{ cardId: 'stray', attack: 4, health: 6 }], makeRng(7), CARD_INDEX)],
  ['windfury double-attack', () => simulate(
    [{ cardId: 'speedy', attack: 4, health: 4 }],
    [{ cardId: 'sandbag', attack: 1, health: 12 }], makeRng(13), CARD_INDEX)],
  ['venom-heavy trade', () => simulate(
    [{ cardId: 'venom', attack: 1, health: 1 }, { cardId: 'venom', attack: 1, health: 1 }],
    [{ cardId: 'stray', attack: 3, health: 8 }, { cardId: 'pack', attack: 2, health: 2 }], makeRng(21), CARD_INDEX)],
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

  it('single-action fallthrough: sc / toHand each become their own single-event moment', () => {
    const moments = compileMoments(
      [
        { type: 'sc', source: 'a', text: 'x', step: 0 },
        { type: 'toHand', cardId: 'y', side: 'player', step: 1 },
      ],
      DEFAULT_RULES,
    );
    expect(moments).toHaveLength(2);
    expect(moments[0]).toMatchObject({ start: 0, end: 1, primary: { type: 'sc', source: 'a' }, stepGroups: [[0]] });
    expect(moments[1]).toMatchObject({ start: 1, end: 2, primary: { type: 'toHand', cardId: 'y' }, stepGroups: [[1]] });
  });

  it('a shop-buff sc after an attack is absorbed into the attack wind-up (Demon Horse); an ordinary sc is not', () => {
    // Shop-buff flash: `attack` then `+1/+2 Shop` fold into ONE attack moment so the number fires in the lunge.
    const shop = compileMoments(
      [
        { type: 'attack', source: 'a', target: 'b', step: 0 },
        { type: 'sc', source: 'a', text: '+1/+2 Shop', step: 1 },
        { type: 'dmg', target: 'b', amount: 3, step: 2 },
      ] as unknown as Parameters<typeof compileMoments>[0],
      DEFAULT_RULES,
    );
    expect(shop[0]).toMatchObject({ start: 0, end: 2, primary: { type: 'attack' } }); // attack + sc together
    expect(shop[1]).toMatchObject({ primary: { type: 'dmg' } });
    // An ordinary (non-Shop) sc after an attack stays its OWN beat — the predicate is shop-buff-only.
    const other = compileMoments(
      [
        { type: 'attack', source: 'a', target: 'b', step: 0 },
        { type: 'sc', source: 'a', text: '+2 Spell Power', step: 1 },
      ] as unknown as Parameters<typeof compileMoments>[0],
      DEFAULT_RULES,
    );
    expect(other[0]).toMatchObject({ start: 0, end: 1, primary: { type: 'attack' } });
    expect(other[1]).toMatchObject({ start: 1, end: 2, primary: { type: 'sc' } });
  });

  it('empty log compiles to no moments', () => {
    expect(compileMoments([], DEFAULT_RULES)).toEqual([]);
  });
});
