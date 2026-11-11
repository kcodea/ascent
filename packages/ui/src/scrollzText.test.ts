// @vitest-environment jsdom
/**
 * SCROLLZ, the player-facing half of R-SCROLL-DRAKE-02 (owner 2026-11-10: "the first spell you buy each turn is 1 less
 * instead of every spell"): the Shop price pill and the card's own text, built exactly as the screen builds them
 * (`shopOfferOpts` + `shopView` for an offer, `handLiveOf` + `handCardView` for a held copy, `instView` for the board).
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX, poolFor } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState, type ShopCard } from '@game/sim';
import { handCardView, handLiveOf, shopOfferOpts, shopView } from './Recruit';
import { liveCardText } from './instView';
import { firstShopSpellDiscountText } from './cardText';

const ID = 'd3_scrolldrake';
const D = CARD_INDEX[ID]!;
const drake = (uid: string, golden = false): BoardCard =>
  ({ uid, cardId: ID, tribe: D.tribe, attack: D.attack, health: D.health, keywords: [], golden });
const spellId = poolFor('set3').spells.find((c) => (c.cost ?? 0) >= 3)!.id;
const base = CARD_INDEX[spellId]!.cost!;
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7), setId: 'set3', phase: 'recruit', embers: 30, tier: 6, hand: [], board: [], shop: [], spell: null, recruitBuffFx: [], ...over } as RunState);
const pill = (s: RunState, o: ShopCard): number | undefined => shopView(o, shopOfferOpts(s, o, { cardBuffsLive: {} })).cost;

describe('Scrollz: the Shop price pill', () => {
  it('every spell offer shows the discounted price until the first spell is bought, then the normal price', () => {
    let s = run({ board: [drake('dk')], spell: { uid: 's1', cardId: spellId }, shop: [{ uid: 'r1', cardId: spellId }, { uid: 'r2', cardId: spellId }] });
    expect([s.spell!, ...s.shop].map((o) => pill(s, o))).toEqual([base - 1, base - 1, base - 1]);
    s = reduce(s, { type: 'buy', uid: 'r1' });
    expect([s.spell!, ...s.shop].map((o) => pill(s, o))).toEqual([base, base]);
    const next = { ...s, wave: s.wave + 1 };
    expect(pill(next, next.spell!), 'a new turn shows the discount again').toBe(base - 1);
  });

  it('Gilded shows 2 less', () => {
    const s = run({ board: [drake('g', true)], spell: { uid: 's1', cardId: spellId } });
    expect(pill(s, s.spell!)).toBe(base - 2);
  });
});

describe('Scrollz: the card says whether this turn\'s discount is left', () => {
  it('the helper: Ready until a Shop spell is bought, then Used; nothing in combat (no count)', () => {
    expect(firstShopSpellDiscountText(ID, false, 0)).toBe(`${D.text} Ready this turn.`);
    expect(firstShopSpellDiscountText(ID, false, 2)).toBe(`${D.text} Used this turn.`);
    expect(firstShopSpellDiscountText(ID, true, 0)).toBe(`${D.goldenText} Ready this turn.`);
    expect(firstShopSpellDiscountText(ID, false, undefined)).toBeNull();
    expect(firstShopSpellDiscountText('sandbag', false, 0)).toBeNull();
  });

  it('hand and Shop offer copies read the run count, before and after a spell buy', () => {
    let s = run({ hand: [drake('h')], spell: { uid: 's1', cardId: spellId }, shop: [{ uid: 'o', cardId: ID }] });
    const handText = (r: RunState): string => handCardView(r, r.hand.find((c) => c.uid === 'h')!, handLiveOf(r, {}, { runeBartering: r.runeBartering, runeStacks: r.runeStacks, ancientsEnabled: r.ancientsEnabled, heroId: r.heroId, ancients: undefined, sellBonusWindow: r.sellBonusWindow })).text;
    const offerText = (r: RunState): string => shopView(r.shop[0]!, shopOfferOpts(r, r.shop[0]!, { cardBuffsLive: {} })).text;
    expect(handText(s)).toBe(`${D.text} Ready this turn.`);
    expect(offerText(s)).toBe(`${D.text} Ready this turn.`);
    s = reduce(s, { type: 'buy', uid: 's1' });
    expect(handText(s), 'a spell bought before it is played has used the turn up').toBe(`${D.text} Used this turn.`);
    expect(offerText(s)).toBe(`${D.text} Used this turn.`);
  });

  it('combat (no count passed) prints the plain text', () => {
    const t = liveCardText(ID, { tier: 3, golden: false, spellBonus: 0, spellBonusH: 0, frontToBackBonus: 0, spellsThisTurn: 0, spellsCast: 0, deathrattlesTriggered: 0, undeadBuyAtk: 0, soulsmanGold: 0 });
    expect(t.text).toBe(D.text);
  });

  it('player text rules: no em dash, no double hyphen', () => {
    for (const t of [D.text, D.goldenText!, firstShopSpellDiscountText(ID, false, 0)!, firstShopSpellDiscountText(ID, false, 1)!]) {
      expect(t).not.toMatch(/—|--/);
    }
  });
});
