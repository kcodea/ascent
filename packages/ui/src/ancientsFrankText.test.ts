/**
 * ANCIENTS × Frantic Frank (Fortune): a minion bought from Clearance prints "Sells for 2 Gold." as a blue note while
 * Fortune is picked (owner 2026-09-30: "just add sells for 2g if it is a fortune frank purchase"), at its CURRENT sell
 * value, on every surface the shop chain draws (board, hand, hover). Never for other minions or without Fortune.
 */
import { describe, expect, it } from 'vitest';
import { ANCIENT_IDS, createRun, enableAncients, reduce, type AncientId, type BoardCard, type RunState } from '@game/sim';
import { clearanceSellNote, instView, type SellTextState } from './instView';

const picked = (id: AncientId): RunState => {
  let s = enableAncients({ ...createRun(7, 'frank'), phase: 'recruit' } as RunState);
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  return reduce(s, { type: 'pickAncient', id });
};
const minion = (extra: Partial<BoardCard> = {}): BoardCard => ({ uid: 'm', cardId: 'hm_test_squire', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false, ...extra });
const text = (c: BoardCard, s: SellTextState): string => instView(c, 1, undefined, 0, 0, 0, 0, 0, 0, 0, 1, 0, undefined, undefined, { sellState: s, onBoard: true }).text;

describe('Frank × Fortune: the Clearance minion prints its sale price', () => {
  it('a Fortune Clearance buy prints "Sells for 2 Gold."', () => {
    expect(text(minion({ clearanceBuy: true }), picked('fortune'))).toContain(clearanceSellNote(2));
    expect(clearanceSellNote(2)).toBe('[[Sells for 2 Gold.]]');
    expect(clearanceSellNote(2)).not.toMatch(/—|--/);
  });
  it('prints the CURRENT value when the minion would sell for more anyway (the 2 Gold floor)', () => {
    expect(text(minion({ clearanceBuy: true, sellBonus: 3 }), picked('fortune'))).toContain(clearanceSellNote(4));
  });
  it('no line for a non-Clearance minion, or without Fortune', () => {
    expect(text(minion(), picked('fortune'))).not.toContain('Sells for');
    expect(text(minion({ clearanceBuy: true }), picked('bonds'))).not.toContain('Sells for');
  });
  it('the mark (and so the line) survives a save round trip', () => {
    const back = JSON.parse(JSON.stringify(minion({ clearanceBuy: true }))) as BoardCard;
    expect(text(back, picked('fortune'))).toContain(clearanceSellNote(2));
  });
});
