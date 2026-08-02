import { describe, it, expect } from 'vitest';
import { createRun, reduce, type BoardCard, type RunState } from './index';

/**
 * THE UNIVERSAL TRIPLE-ACCRUAL RULE (owner, restated 2026-08-02: "the buff is not supposed to reset when
 * tripled" — ever).
 *
 * The 2026-07-31 fix was an opt-in registry, and every accruing effect added after it silently inherited the
 * reset bug. The audit found FOUR leakers, each pinned here: Menagerie Mammoth (the owner's report), King
 * Oona, Broodwright, and Trophy Stalker. The merge now preserves ANY nonzero `summonBonus` through gilding
 * (top-two combined, the Karthus precedent) with no registry to forget — a fifth accruing card added next
 * month is covered the day it ships.
 */
const gild = (cardId: string, tribe: BoardCard['tribe'], bonuses: [number, number, number]): number | undefined => {
  const copy = (uid: string, bonus: number): BoardCard =>
    ({ uid, cardId, tribe, attack: 1, health: 1, keywords: [], golden: false, ...(bonus > 0 ? { summonBonus: bonus } : {}) });
  let s: RunState = {
    ...createRun(1), phase: 'recruit', embers: 0, shop: [],
    board: [copy('a', bonuses[0]), copy('b', bonuses[1])],
    hand: [copy('c', bonuses[2])],
  };
  s = reduce(s, { type: 'play', uid: 'c' }); // third copy → triple
  return [...s.board, ...s.hand].find((c) => c.cardId === cardId && c.golden)?.summonBonus;
};

describe('gilding never resets an accrued improvement — the four audit leakers', () => {
  it('Menagerie Mammoth keeps its per-summon escalation (the owner report)', () => {
    expect(gild('b2_mammoth', 'beast', [3, 2, 0]), 'top-two procs combine').toBe(5);
  });
  it("King Oona keeps her Avenge improvement", () => {
    expect(gild('b2_oona', 'beast', [2, 1, 0])).toBe(3);
  });
  it('Broodwright keeps its Avenge improvement', () => {
    expect(gild('dm_broodwright', 'demon', [4, 1, 0])).toBe(5);
  });
  it('Trophy Stalker keeps its per-attack Rally growth', () => {
    expect(gild('trophystalker', 'beast', [10, 5, 0])).toBe(15);
  });
  it('a card with NO accrual still gilds with summonBonus unset', () => {
    expect(gild('drummer', 'neutral', [0, 0, 0])).toBeUndefined();
  });
});
