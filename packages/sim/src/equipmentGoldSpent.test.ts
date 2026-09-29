import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';

/**
 * R-EQUIP-02 (owner 2026-09-29: "this should count as gold spent"): the Gold paid to USE an Equipment is Gold
 * spent. It goes through the same chokepoint as a buy / roll / tier-up, so the run + per-turn tallies and every
 * Spend meter (`goldSpent` effects) advance with it. Drives the real reducer.
 */
const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1), phase: 'recruit', embers: 20, ...over } as RunState);

/** Frank (grants Bloodpot, 1 Gold, target a friendly minion) played next to a Coinfire Forewoman (every 5 Gold spent:
 *  Dwarves +2 Attack) whose meter is pre-charged to `tick`. */
const setup = (tick: number): RunState => {
  const s = run({ hand: [body('f', 'e3_frank')], board: [body('c', 'dw_coinfire', { goldTick: tick })] });
  return reduce(s, { type: 'play', uid: 'f', toIndex: 1 });
};

describe('R-EQUIP-02 — Gold paid to use an Equipment counts as Gold spent', () => {
  it('advances the run and per-turn Gold-spent tallies by the activation cost', () => {
    const before = setup(0);
    const after = reduce(before, { type: 'activateEquipment', targetUid: 'c' });
    expect(after.embers, 'Bloodpot costs 1 Gold').toBe(before.embers - 1);
    expect(after.goldSpentThisTurn ?? 0, 'Gold spent this turn').toBe((before.goldSpentThisTurn ?? 0) + 1);
    expect(after.goldSpent ?? 0, 'run Gold spent').toBe((before.goldSpent ?? 0) + 1);
  });

  it("advances a Spend card's meter, and fires it when the payment crosses the threshold", () => {
    const low = reduce(setup(0), { type: 'activateEquipment', targetUid: 'c' });
    expect(low.board.find((c) => c.uid === 'c')!.goldTick, 'the meter took the 1 Gold').toBe(1);

    const before = setup(4);
    const atk = before.board.find((c) => c.uid === 'c')!.attack;
    const after = reduce(before, { type: 'activateEquipment', targetUid: 'c' });
    const c = after.board.find((b) => b.uid === 'c')!;
    expect(c.goldTick, 'the 5th Gold paid the threshold and reset the meter').toBe(0);
    expect(c.attack, 'Bloodpot +3 and Coinfire +2 (its Spend payoff fired)').toBe(atk + 3 + 2);
  });
});
