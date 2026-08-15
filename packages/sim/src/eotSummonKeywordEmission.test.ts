import { describe, it, expect } from 'vitest';
import { createRun, reduce, reduceWithPresentation, type RunState } from './index';
import type { CardSummonedConsequence } from '@game/core';

/**
 * Owner directive 2026-08-14: EVERYTHING should present in real time on its beat. The last two End-of-Turn
 * gaps were `cardSummoned` (a minion summoned mid-beat — Moira re-firing a summoner's Shout) and
 * `keywordChanged`, neither of which the emission diff produced, so they snapped in at commit. This asserts the
 * emission half; the on-beat board injection / keyword-pip overlay is the UI concern verified live.
 */
const faceOmen = { type: 'faceOmen' } as const;

// [Moira, Pennycat]: at End of Turn Moira re-fires Pennycat's Shout (`battlecrySummon` → a 1/1 Stray).
const state = (): RunState => ({
  ...createRun(1, 'warden'), phase: 'recruit', hand: [],
  board: [
    { uid: 'm', cardId: 'b2_moira', tribe: 'beast', attack: 6, health: 4, keywords: [], golden: false },
    { uid: 'p', cardId: 'alley', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false },
  ],
} as RunState);

describe('End-of-Turn summon emits cardSummoned on its beat', () => {
  it('gameplay is byte-identical to plain reduce (capture on)', () => {
    const s = state();
    expect(JSON.stringify(reduceWithPresentation(s, faceOmen, true).state)).toBe(JSON.stringify(reduce(s, faceOmen)));
  });

  it('Moira re-firing Pennycat summons a Stray → cardSummoned in the board zone', () => {
    const { batch } = reduceWithPresentation(state(), faceOmen, true);
    const summons = batch!.events.filter((e): e is CardSummonedConsequence => e.type === 'cardSummoned');
    expect(summons.length, 'the re-fired summon emitted cardSummoned').toBeGreaterThanOrEqual(1);
    expect(summons.every((s) => s.target.zone === 'board'), 'a summon lands on the board').toBe(true);
    expect(summons.some((s) => s.cardId === 'stray'), 'the Stray token was the thing summoned').toBe(true);
  });
});
