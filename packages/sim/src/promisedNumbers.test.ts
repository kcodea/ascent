/**
 * Two "the number you were promised never arrives" defects (owner reports 2026-08-26).
 *
 * Both are the same shape: a value the game SHOWS you and then fails to hand over — one in printed text, one
 * in real stats. Grouped so the pair reads as the single class of bug it is.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, offerBuyStats, type RunState } from './index';
import { perCardPlayedText } from '../../ui/src/cardText';

describe('Kringle prints BOTH halves of its per-card grant', () => {
  it('the card is +1/+2 per card, so the live text must be too (it used to say only "+1 Attack")', () => {
    // Nothing played: the printed text stands, rate and all.
    expect(perCardPlayedText('dw_foreman', 0)).toBeNull();
    expect(CARD_INDEX['dw_foreman']!.text).toContain('+1/+2');

    const one = perCardPlayedText('dw_foreman', 1)!;
    expect(one, 'one card played → the full +1/+2, not a bare Attack number').toContain('{{+1/+2}}');
    expect(one, 'and the rate keeps both halves too').toContain('(+1/+2 for each card you played');
    expect(one, 'both ends of the Dwarf line, as the card prints').toContain('left and right-most Dwarves');
    expect(one, 'no Attack-only phrasing survives').not.toContain('Attack');

    // It scales, both halves together.
    expect(perCardPlayedText('dw_foreman', 4)!).toContain('{{+4/+8}}');
    // Golden doubles the rate: +2/+4 per card.
    expect(perCardPlayedText('dw_foreman', 3, true)!).toContain('{{+6/+12}}');
  });
});

describe("the Merchant's Chorus shop enchant survives the purchase", () => {
  const shopEnchanted = (): RunState => ({
    ...createRun(1),
    embers: 20,
    board: [],
    hand: [],
    shop: [{ uid: 'x', cardId: 'alley' }], // Alleycat 1/1
    tavernBuyBonus: { atk: 0, hp: 0 },
    tavernBuyBonusTurn: { atk: 40, hp: 40 }, // a Shout-heavy turn under Rune of the Merchant's Chorus
  });

  it('a +40/+40 offer is worth +40/+40 when BOUGHT, not just when shown', () => {
    const s0 = shopEnchanted();
    // The shop already valued it correctly — this is the number the row displays.
    expect(offerBuyStats(s0, s0.shop[0]!)).toEqual({ attack: 41, health: 41 });

    const s = reduce(s0, { type: 'buy', uid: 'x' });
    const bought = s.hand.find((c) => c.cardId === 'alley')!;
    expect([bought.attack, bought.health], 'the purchase pays what the shop advertised').toEqual([41, 41]);
  });

  it('and it KEEPS them once played — a bought body carries its buffs onto the board', () => {
    let s = reduce(shopEnchanted(), { type: 'buy', uid: 'x' });
    s = reduce(s, { type: 'play', uid: s.hand.find((c) => c.cardId === 'alley')!.uid });
    const onBoard = s.board.find((c) => c.cardId === 'alley')!;
    expect([onBoard.attack, onBoard.health]).toEqual([41, 41]);
  });

  it('it stacks WITH the permanent layer rather than replacing it', () => {
    const s0 = { ...shopEnchanted(), tavernBuyBonus: { atk: 2, hp: 2 } };
    const s = reduce(s0, { type: 'buy', uid: 'x' });
    const bought = s.hand.find((c) => c.cardId === 'alley')!;
    expect([bought.attack, bought.health], '1/1 + permanent 2/2 + this-turn 40/40').toEqual([43, 43]);
  });

  it('Fodder is still excluded (it carries the enchant through its own run-wide channel — no double-pay)', () => {
    const s0: RunState = { ...shopEnchanted(), shop: [{ uid: 'f', cardId: 'fred' }] };
    const s = reduce(s0, { type: 'buy', uid: 'f' });
    const bought = s.hand.find((c) => c.cardId === 'fred')!;
    const base = CARD_INDEX['fred']!;
    expect([bought.attack, bought.health]).toEqual([base.attack, base.health]);
  });
});
