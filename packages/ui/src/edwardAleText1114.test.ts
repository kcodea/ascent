// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, type BoardCard, type RunState, type ShopCard } from '@game/sim';
import { discoverCardText, handCardView, handLiveOf, liveOptsFromRun, shopView } from './Recruit';

/**
 * EDWARD KEG-HANDS live text (owner 2026-11-14, R-EDWARD-01: "this needs to reflect on the ales themselves when in
 * play"). While an Edward is on the board, a Dwarven Ale in HAND prints the numbers its hand cast will produce: x2,
 * x3 with a Gilded Edward, spell power included. A Shop offer or a Discover option is not cast from hand by being
 * there, so it prints its base numbers.
 */
const card = (uid: string, cardId: string, golden = false): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1), setId: 'set2', phase: 'recruit', tier: 6, hand: [], shop: [], board: [card('d', 'dw_brakka')], ...over } as RunState);
const handText = (r: RunState, id: string): string => handCardView(r, card('h', id), handLiveOf(r, {}, {} as never)).text;
const withEdward = (golden = false, over: Partial<RunState> = {}): RunState => run({ board: [card('d', 'dw_brakka'), card('e', 'dw_edward', golden)], ...over });

describe('Edward Keg-hands: an Ale in hand prints its multiplied numbers', () => {
  it('without Edward, every Ale in hand prints its card text', () => {
    for (const id of ['wo_mine', 'wo_champion', 'wo_health', 'wo_attack']) expect(handText(run(), id), id).toBe(CARD_INDEX[id]!.text);
  });

  it('with Edward: x2 on every Ale', () => {
    const r = withEdward();
    expect(handText(r, 'wo_mine')).toBe('Gain **{{4 Gold}}**.');
    expect(handText(r, 'wo_champion')).toBe('Give your **left-most** minion **{{+10/+10}}**.');
    expect(handText(r, 'wo_health')).toBe('Give **3 random** friendly minions **{{+6 Health}}**.');
    expect(handText(r, 'wo_attack')).toBe('Give **3 random** friendly minions **{{+6 Attack}}**.');
    expect(handText(r, 'wo_reinforcement')).toBe('Get {{2 minions}} of your **most common type** ({{Dwarf}}).');
  });

  it('with a Gilded Edward: x3', () => {
    const r = withEdward(true);
    expect(handText(r, 'wo_mine')).toBe('Gain **{{6 Gold}}**.');
    expect(handText(r, 'wo_champion')).toBe('Give your **left-most** minion **{{+15/+15}}**.');
    expect(handText(r, 'wo_reinforcement')).toContain('{{3 minions}}');
  });

  it('spell power is folded in, then multiplied, exactly as the cast does', () => {
    const r = withEdward(false, { spellBonus: { attack: 1, health: 1 } } as Partial<RunState>);
    expect(handText(r, 'wo_champion')).toBe('Give your **left-most** minion **{{+12/+12}}**.');
    expect(handText(r, 'wo_health')).toBe('Give **3 random** friendly minions **{{+2/+8}}**.');
  });

  it('a Shop offer and a Discover option print the base numbers', () => {
    const r = withEdward(true);
    expect(shopView({ uid: 's', cardId: 'wo_mine' } as ShopCard, liveOptsFromRun(r)).text).toBe(CARD_INDEX['wo_mine']!.text);
    expect(discoverCardText(r, 'wo_champion', {}).text).toBe(CARD_INDEX['wo_champion']!.text);
  });

  it('a non-Ale spell in hand is unchanged by Edward', () => {
    expect(handText(withEdward(true), 'growth')).toBe(handText(run(), 'growth'));
  });
});
