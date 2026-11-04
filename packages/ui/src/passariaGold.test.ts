// @vitest-environment jsdom
/**
 * PASSARIA COSTS 2 GOLD, TOTAL (owner 2026-11-04, R-DUOS-PRIESTESS-GOLD-01: "passaria should not cost an additional gold
 * to pass, it should pay the 2g and that's it"). Through the store's `dispatch`, the action the aim's release sends
 * (Recruit.tsx): no 1 Gold pass fee and no buy cost, a refusal returns exactly what was paid, and the armed aim holds
 * the hand so it can never turn into the drag pass.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createVersusRun, type BoardCard, type RunState } from '@game/sim';
import { useGame } from './store';
import { passariaAimHoldsHand } from './versus/duosPassUi';

const minion = (uid: string): BoardCard => ({ uid, cardId: 'sandbag', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false });
const seat = (heroId = 'priestess'): RunState => ({
  ...createVersusRun(11, heroId, 'set2', { v: 1, mode: 'duos', modifiers: [] }), phase: 'recruit', embers: 10, board: [minion('m0')], hand: [],
} as RunState);
const run = (): RunState => useGame.getState().run;
const press = (uid: string): void => useGame.getState().dispatch({ type: 'heroPower', uid, slot: 0 });
const shopMinion = (): string => run().shop.find((o) => !CARD_INDEX[o.cardId]?.spell && !o.starform)!.uid;

describe('Passaria: the total Gold change', () => {
  beforeEach(() => { useGame.setState({ run: seat(), heroArmed: false, heroArmedSlot: 0, replaying: false }); });

  it('a board target costs exactly 2', () => {
    press('m0');
    expect(run().embers).toBe(8);
    expect(run().goldSpentThisTurn).toBe(2);
    expect(run().duos!.outbox.map((e) => e.paid)).toEqual([2]);
  });

  it('a Shop target costs exactly 2: no pass fee and no buy cost', () => {
    press(shopMinion());
    expect(run().embers).toBe(8);
    expect(run().goldSpentThisTurn).toBe(2);
    expect(run().duos!.outbox.map((e) => e.paid)).toEqual([2]);
  });

  for (const target of ['board', 'shop'] as const) {
    it(`a refusal returns exactly what a ${target} pass paid, once`, () => {
      press(target === 'board' ? 'm0' : shopMinion());
      useGame.getState().dispatch({ type: 'passRefunded', seq: 0 });
      expect(run().embers).toBe(10);
      expect(run().goldSpentThisTurn ?? 0).toBe(0);
      useGame.getState().dispatch({ type: 'passRefunded', seq: 0 });
      expect(run().embers).toBe(10);
    });
  }
});

describe('the armed aim holds the hand', () => {
  it('only while Passaria itself is armed', () => {
    expect(passariaAimHoldsHand({ run: seat(), heroArmed: true, heroArmedSlot: 0 })).toBe(true);
    expect(passariaAimHoldsHand({ run: seat(), heroArmed: false, heroArmedSlot: 0 })).toBe(false);
    expect(passariaAimHoldsHand({ run: seat('warden'), heroArmed: true, heroArmedSlot: 0 })).toBe(false);
  });
});
