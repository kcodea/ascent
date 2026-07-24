import { describe, it, expect } from 'vitest';
import { createRun, type BoardCard, type RunState } from './state';
import { reduce } from './reducer';
import { sellValueOf, sellValueWithBonus } from './recruit';

/**
 * Quick Sale's bonus has to be visible on the SELL FLOAT, not just in the Gold total.
 *
 * The float styles itself off the amount (`amount > 1` floats green instead of plain gold), so a display that
 * omitted the bonus both showed the wrong number AND the wrong colour — selling under Quick Sale paid 3 Gold
 * while floating a yellow "+1" (owner 2026-07-24). `sellValueWithBonus` is the single helper the reducer's
 * payout and the UI's float now share, which is what keeps them in lockstep.
 */
const minion = (uid: string): BoardCard =>
  ({ uid, cardId: 'stray', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false });

describe('Quick Sale — the sell float matches the Gold paid', () => {
  it('adds the one-shot bonus to the displayed value, and crosses the >1 green threshold', () => {
    const s: RunState = { ...createRun(1), phase: 'recruit', board: [minion('m1')], nextSellBonus: 2 };
    expect(sellValueOf(s.board[0]!, s)).toBe(1);          // base sell, unchanged
    expect(sellValueWithBonus(s.board[0]!, s)).toBe(3);   // what the player sees AND banks
    expect(sellValueWithBonus(s.board[0]!, s)).toBeGreaterThan(1); // > 1 → the float renders green
  });

  it('the Gold actually banked equals the displayed value', () => {
    const s: RunState = { ...createRun(1), phase: 'recruit', embers: 0, board: [minion('m1')], nextSellBonus: 2 };
    const shown = sellValueWithBonus(s.board[0]!, s);
    const next = reduce(s, { type: 'sell', uid: 'm1' });
    expect(next.embers).toBe(shown);
    expect(next.nextSellBonus).toBe(0); // one-shot: spent by the sell
  });

  it('without Quick Sale the value is unchanged (and floats plain gold)', () => {
    const s: RunState = { ...createRun(1), phase: 'recruit', board: [minion('m1')] };
    expect(sellValueWithBonus(s.board[0]!, s)).toBe(1);
  });
});
