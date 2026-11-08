import { describe, it, expect } from 'vitest';
import { CARD_INDEX, RUNE_INDEX } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { applyEndOfTurn, consumeShopMinion } from './recruit';

/**
 * R-CONSUME-RUNE-01 — Rune of the Empty Plate ("When you Consume 2 minions, get a random Shop spell") counts a
 * Demon eating a SHOP minion, not only Fodder. Owner report 2026-11-08: a Gilded Bob Blart eating the Shop at
 * End of Turn never moved the rune's 0/2 meter.
 */

const bc = (uid: string, cardId: string, golden = false): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden };
};
const spellsInHand = (s: RunState) => s.hand.filter((c) => CARD_INDEX[c.cardId]?.spell && !CARD_INDEX[c.cardId]?.ruby);
const minionShop = () => [{ uid: 'o1', cardId: 'stray' }, { uid: 'o2', cardId: 'pack' }, { uid: 'o3', cardId: 'alley' }];

function withEmptyPlate(extra: Partial<RunState> = {}): RunState {
  const def = RUNE_INDEX['rune_empty_plate']!;
  const s: RunState = {
    ...createRun(3, 'aster'), setId: 'set2', wave: 7, tier: 6, phase: 'recruit', embers: 40, hand: [], board: [],
    runeforgeOffer: ['rune_empty_plate'], runeforgeEpic: !!def.epic, ...extra,
  } as RunState;
  return reduce(s, { type: 'buyRune', index: 0 }) as RunState;
}

describe('Rune of the Empty Plate counts Shop-minion Consumes', () => {
  it('two Shop eats pay one Shop spell', () => {
    const s = withEmptyPlate({ board: [bc('eater', 'dm_gourmand')], shop: minionShop() });
    const eater = s.board[0]!;
    expect(consumeShopMinion(s, eater, 0)).toBe(true);
    expect(spellsInHand(s), 'one eat is not enough').toHaveLength(0);
    expect(consumeShopMinion(s, eater, 0)).toBe(true);
    expect(spellsInHand(s), 'the 2nd Shop eat pays the spell').toHaveLength(1);
  });

  it("Bob Blart's End of Turn eat ticks the meter (the reported board)", () => {
    const s = withEmptyPlate({ board: [bc('blart', 'dm_gourmand', true)], shop: minionShop() });
    const t = () => (s.runeThresholds ?? []).find((x) => x.sourceId === 'rune_empty_plate')!;
    expect(t().tick).toBe(0);
    applyEndOfTurn(s);
    expect(t().tick, 'Blart ate the right-most Shop minion').toBe(1);
  });
});
