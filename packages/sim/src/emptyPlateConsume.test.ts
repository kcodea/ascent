/**
 * RUNE OF THE EMPTY PLATE counts EVERY Consume (owner 2026-11-08): eating Fodder, eating a Shop minion, and the
 * Starform's consumes (it eating a Shop minion, a Demon eating it, a Celestial consuming it on the buy). Before
 * this the meter only ticked on FODDER, so in Set 2 (where every Demon eats Shop minions) it never paid at all.
 * These drive REAL consumes — the older tests bumped the meter directly, which is how the dead wiring hid.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { applyEndOfTurn, consumeShopMinion, consumeTavernFodder } from './recruit';
import { buyStarform, createStarform, starformConsumeShopMinion } from './starform';
import { createRun, reduce, type BoardCard, type RunState } from './index';

const bm = (uid: string, cardId: string, a = 2, h = 2): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack: a, health: h, keywords: [], golden: false });

function withPlate(extra: Partial<RunState> = {}): RunState {
  const s: RunState = { ...createRun(3, 'runesmith'), wave: 7, phase: 'recruit', embers: 30, runeforgeOffer: ['rune_empty_plate'], ...extra };
  const next = reduce(s, { type: 'buyRune', index: 0 }) as RunState;
  next.hand = [];
  next.shop = [{ uid: 'o1', cardId: 'stray' }, { uid: 'o2', cardId: 'alley' }]; // room left, so creating the Starform eats nothing
  return next;
}
const tick = (s: RunState) => s.runeThresholds!.find((t) => t.sourceId === 'rune_empty_plate')!.tick;
const spells = (s: RunState) => s.hand.filter((c) => CARD_INDEX[c.cardId]?.spell).length;
const SRC = { cardId: 'dbg_plate', name: 'Test' };

describe('Rune of the Empty Plate — any Consume counts', () => {
  it('a Demon eating a Shop minion at End of Turn ticks it, and the count carries into the next turn', () => {
    const s = withPlate({ board: [bm('g', 'dm_gourmand')] });
    applyEndOfTurn(s);
    expect(tick(s)).toBe(1);
    expect(spells(s)).toBe(0);
    s.shop = [{ uid: 'o4', cardId: 'stray' }];
    applyEndOfTurn(s); // a later turn's End of Turn: the banked 1 + this 1 = the 2nd Consume
    expect(spells(s)).toBe(1);
    expect(tick(s)).toBe(0);
  });

  it('a Gilded double-stat eat is still ONE minion Consumed', () => {
    const s = withPlate({ board: [bm('d', 'dm_gourmand')] });
    consumeShopMinion(s, s.board[0]!, 0, 2);
    expect(tick(s)).toBe(1);
  });

  it('eating Fodder still counts', () => {
    const s = withPlate({ board: [bm('d', 'dm_gourmand')] });
    s.shop = [{ uid: 'f1', cardId: 'fred' }, { uid: 'f2', cardId: 'fred' }];
    consumeTavernFodder(s);
    expect(spells(s)).toBe(1);
  });

  it('the Starform eating a Shop minion counts', () => {
    const s = withPlate();
    createStarform(s, SRC);
    expect(starformConsumeShopMinion(s, s.shop.findIndex((o) => o.uid === 'o1'))).toBe(true);
    expect(tick(s)).toBe(1);
  });

  it('a Demon eating the Starform counts', () => {
    const s = withPlate({ board: [bm('d', 'dm_gourmand')] });
    s.shop = [];
    createStarform(s, SRC);
    consumeShopMinion(s, s.board[0]!, s.shop.findIndex((o) => o.starform));
    expect(tick(s)).toBe(1);
  });

  it('a Celestial consuming the Starform on the buy counts; a buy with no receiver consumes into nothing and does not', () => {
    const cel = Object.values(CARD_INDEX).find((d) => d.tribe === 'celestial' && !d.spell)!;
    const s = withPlate({ board: [bm('c', cel.id)] });
    createStarform(s, SRC);
    buyStarform(s);
    expect(tick(s)).toBe(1);
    const t = withPlate({ board: [] });
    createStarform(t, SRC);
    buyStarform(t);
    expect(tick(t)).toBe(0);
  });
});
