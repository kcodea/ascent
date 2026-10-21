import { describe, it, expect } from 'vitest';
import { CARD_INDEX, EQUIPMENT_INDEX } from '@game/content';
import {
  createRun, reduce, deserialize, serialize, offerBuyPrice, spellCostReduction, sellValueOf, sellValueWithBonus,
  type Action, type BoardCard, type RunState, type ShopCard,
} from './index';
import { amplifyEquipment, equipmentAmplifiedOf, equipmentText } from './equipment';

/**
 * THYMEPIECE — "Cards sell for +1 Gold for the next 8 seconds" (owner rework 2026-10-21; gilded: +1 for 16
 * seconds; Amplified doubles the seconds). It replaced the 2026-09-12 design ("all cards cost 1 less Gold for
 * the next 8 seconds").
 *
 * The engine never reads a clock. The activation action carries the turn clock's reading (`clockSeconds`,
 * seconds LEFT), the factory anchors the window at `clockSeconds − seconds`, and EXPIRY is the
 * `sellWindowExpired` action the UI's clock tick dispatches when the clock crosses that anchor — so the window
 * pauses with the clock (Discover, Choose One, aim, hero select) and replays from the recording. A sale counts
 * when it lands before that expiry action (the bonus is read at the moment of the sale, in `sellValueOf`).
 */

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(11), setId: 'set3', phase: 'recruit', embers: 20, tier: 6, ...over } as RunState);
const act = (s: RunState, a: Action): RunState => reduce(s, a);
/** Thymes on the board, its Thymepiece granted and selected. `board` lands to Thymes's right. */
const armed = (golden = false, over: Partial<RunState> = {}): RunState =>
  act(run({ hand: [body('th', 'dw3_thymes', { golden })], ...over }), { type: 'play', uid: 'th', toIndex: 0 });
const activate = (s: RunState, clockSeconds?: number): RunState =>
  act(s, { type: 'activateEquipment', ...(clockSeconds !== undefined ? { clockSeconds } : {}) });
/** Gold a sale of `uid` paid. */
const soldFor = (s: RunState, uid: string): number => act(s, { type: 'sell', uid }).embers - s.embers;
/** The first plain (non-spell, non-Ruby, non-Starform) minion offer in the row. */
const minionOffer = (s: RunState): ShopCard => s.shop.find((o) => { const d = CARD_INDEX[o.cardId]; return d && !d.spell && !d.ruby && !o.starform; })!;
/** Re-arm the Equipment's own charge (spent by a use) so a second activation is legal this turn. */
const recharge = (s: RunState): RunState =>
  ({ ...s, embers: 20, equipment: { ...s.equipment!, available: s.equipment!.available.map((g) => ({ ...g, ownChargeSpent: false })) } } as RunState);

describe('the Equipment', () => {
  it('keeps its cost and no-target shape; +1 for 8 seconds, gilded +1 for 16', () => {
    const eq = EQUIPMENT_INDEX['thymepiece']!;
    expect(eq.baseCost).toBe(3);
    expect(eq.targetMode).toBe('none');
    expect(eq.effectId).toBe('equipmentSellBonusWindow');
    expect(eq.params).toEqual({ amount: 1, seconds: 8 });
    expect(eq.gildedParams).toEqual({ amount: 1, seconds: 16 });
    expect(eq.text).toBe('Cards sell for **+1** Gold for the next **8 seconds**.');
    expect(eq.goldenText).toBe('Cards sell for **+1** Gold for the next **16 seconds**.');
    expect(CARD_INDEX['dw3_thymes']!.text).toContain('cards sell for **+1** Gold for the next **8 seconds**');
    expect(CARD_INDEX['dw3_thymes']!.goldenText).toContain('cards sell for **+1** Gold for the next **16 seconds**');
  });
});

describe('the window', () => {
  it('activation at clock 40 opens { amount 1, untilClock 32 } and costs 3 Gold', () => {
    const s = armed();
    const t = activate(s, 40);
    expect(t.embers).toBe(s.embers - 3);
    expect(t.sellBonusWindow).toEqual({ amount: 1, untilClock: 32 });
  });
  it('gilded Thymes opens a +1 window of 16 seconds', () => {
    expect(activate(armed(true), 40).sellBonusWindow).toEqual({ amount: 1, untilClock: 24 });
  });
  it('no clock reading (a headless test, a legacy recording) → the window runs to the end of the turn', () => {
    expect(activate(armed()).sellBonusWindow).toEqual({ amount: 1, untilClock: null });
  });
  it('the expiry action closes it; a stray expiry with no window is a free no-op (same state)', () => {
    const t = activate(armed(), 40);
    const closed = act(t, { type: 'sellWindowExpired' });
    expect(closed.sellBonusWindow).toBeUndefined();
    expect(act(closed, { type: 'sellWindowExpired' })).toBe(closed);
  });
  it('a re-activation replaces the window with the fresher one, never shortens a running one, never stacks the amount', () => {
    const later = activate(recharge(activate(armed(), 40)), 36); // 32 → 28, later wins
    expect(later.sellBonusWindow).toEqual({ amount: 1, untilClock: 28 });
    const third = activate(recharge(later), 20);
    expect(third.sellBonusWindow).toEqual({ amount: 1, untilClock: 12 });
  });
});

describe('what it pays', () => {
  const withBoard = (cards: BoardCard[], golden = false, over: Partial<RunState> = {}): RunState => armed(golden, { board: cards, ...over });

  it('a board minion sold inside the window pays +1; after the expiry action it pays the base again', () => {
    const t = activate(withBoard([body('a', 'dw3_striker')]), 40);
    expect(soldFor(t, 'a'), 'base 1 + 1').toBe(2);
    expect(soldFor(act(t, { type: 'sellWindowExpired' }), 'a')).toBe(1);
  });
  it('the bonus is read at the moment of the sale: a sale before the expiry lands counts, one after does not', () => {
    let s = activate(withBoard([body('a', 'dw3_striker'), body('b', 'dw3_striker')]), 40);
    const g0 = s.embers;
    s = act(s, { type: 'sell', uid: 'a' }); // the clock reads 32.1 — the expiry has not been dispatched
    expect(s.embers - g0).toBe(2);
    s = act(s, { type: 'sellWindowExpired' });
    const g1 = s.embers;
    s = act(s, { type: 'sell', uid: 'b' });
    expect(s.embers - g1).toBe(1);
  });
  it('a minion sold from the hand pays +1 too (every sellable card)', () => {
    const t = activate(armed(false, { hand: [body('th', 'dw3_thymes'), body('h', 'dw3_striker')] }), 40);
    expect(soldFor(t, 'h')).toBe(2);
  });
  it('no window, no bonus (an untouched Thymepiece changes nothing)', () => {
    expect(soldFor(withBoard([body('a', 'dw3_striker')]), 'a')).toBe(1);
  });
  it('stacks with Keg Runner\'s Sell (+2): 1 + 2 + 1 = 4', () => {
    const t = activate(withBoard([body('k', 'dw3_kegrunner')]), 40);
    expect(soldFor(t, 'k')).toBe(4);
  });
  it('stacks with Hoarder\'s flat 2 and a per-instance sell bonus', () => {
    const t = activate(withBoard([body('h', 'hoarder'), body('f', 'dw3_striker', { sellBonus: 2 })]), 40);
    expect(soldFor(t, 'h')).toBe(3);
    expect(soldFor(t, 'f')).toBe(4);
  });
  it('stacks with Quick Sale\'s one-shot bonus, and the float helper shows the Gold actually paid', () => {
    const t = activate(withBoard([body('a', 'dw3_striker')], false, { nextSellBonus: 2 }), 40);
    expect(sellValueWithBonus(t.board.find((c) => c.uid === 'a')!, t)).toBe(4);
    expect(soldFor(t, 'a')).toBe(4);
  });
  it('lands on top of an overridden sell value (Bargain Bin\'s 0 sells for 1)', () => {
    const t = activate(withBoard([body('a', 'dw3_striker', { sellOverride: 0 })]), 40);
    expect(sellValueOf(t.board.find((c) => c.uid === 'a')!, t)).toBe(1);
    expect(soldFor(t, 'a')).toBe(1);
  });
  it('gilded: still +1 per sale (only the window is longer)', () => {
    const t = activate(withBoard([body('a', 'dw3_striker')], true), 40);
    expect(soldFor(t, 'a')).toBe(2);
  });
  it('no longer touches any price: minion offers and spells cost exactly what they did', () => {
    const s = armed();
    const t = activate(s, 40);
    const o = minionOffer(t);
    expect(offerBuyPrice(t, o).cost).toBe(offerBuyPrice(s, o).cost);
    expect(spellCostReduction(t, CARD_INDEX['manafont'])).toBe(spellCostReduction(s, CARD_INDEX['manafont']));
  });
});

describe('lifecycle', () => {
  it('clears on combat entry and at the turn flip', () => {
    let s = activate(armed(), 40);
    s = act(s, { type: 'faceOmen' });
    expect(s.sellBonusWindow).toBeUndefined();
    s = act(s, { type: 'settleCombat' });
    s = act(s, { type: 'resolveCombat' });
    expect(s.sellBonusWindow).toBeUndefined();
  });
  it('Continue: a save at clock 30 with untilClock 32 resumes CLEARED; a save at clock 34 resumes ACTIVE', () => {
    const t = activate(armed(), 40); // untilClock 32
    const json = serialize(t);
    expect(deserialize(json, { turnRemaining: 30 }).sellBonusWindow).toBeUndefined();
    expect(deserialize(json, { turnRemaining: 32 }).sellBonusWindow, 'at the anchor the window is over').toBeUndefined();
    expect(deserialize(json, { turnRemaining: 34 }).sellBonusWindow).toEqual({ amount: 1, untilClock: 32 });
    expect(deserialize(json).sellBonusWindow, 'no reading → left as saved').toEqual({ amount: 1, untilClock: 32 });
  });
  it('a to-the-turn-end window (no reading) survives any resume clock', () => {
    const t = activate(armed());
    expect(deserialize(serialize(t), { turnRemaining: 1 }).sellBonusWindow).toEqual({ amount: 1, untilClock: null });
  });
  it('old saves: the retired next-turn-seconds fields and an open card-DISCOUNT window are dropped, never converted', () => {
    type Legacy = RunState & { bonusTurnSeconds?: number; bonusTurnSecondsNextTurn?: number; cardDiscountWindow?: unknown };
    const legacy = { ...run(), bonusTurnSeconds: 30, bonusTurnSecondsNextTurn: 60, cardDiscountWindow: { amount: 1, untilClock: 32 } } as Legacy;
    const healed = deserialize(JSON.stringify(legacy), { turnRemaining: 40 }) as Legacy;
    expect(healed.bonusTurnSeconds).toBeUndefined();
    expect(healed.bonusTurnSecondsNextTurn).toBeUndefined();
    expect(healed.cardDiscountWindow).toBeUndefined();
    expect(healed.sellBonusWindow).toBeUndefined();
    const o = minionOffer(healed);
    expect(offerBuyPrice(healed, o).cost, 'the old discount is gone').toBe(offerBuyPrice(run(), o).cost);
  });
});

/**
 * AMPLIFIED (owner 2026-09-22: "an amplified timepiece should double the duration"; reaffirmed for the sell
 * bonus 2026-10-21). An Amplified activation doubles the seconds (8 → 16, gilded 16 → 32); both of its triggers
 * open the same window. An extra trigger from any other source keeps the printed seconds ("a rate, not a bank").
 */
describe('Amplified', () => {
  it('an Amplified activation at clock 40 closes at 24 (16 seconds), spends the stack, and keeps the amount at +1', () => {
    const s = armed();
    amplifyEquipment(s, 'thymepiece');
    expect(equipmentAmplifiedOf(s, 'thymepiece')).toBe(1);
    const t = activate(s, 40);
    expect(t.sellBonusWindow).toEqual({ amount: 1, untilClock: 24 });
    expect(equipmentAmplifiedOf(t, 'thymepiece')).toBe(0);
  });
  it('gilded and Amplified together: +1 for 32 seconds', () => {
    const s = armed(true);
    amplifyEquipment(s, 'thymepiece');
    expect(activate(s, 40).sellBonusWindow).toEqual({ amount: 1, untilClock: 8 });
  });
  it('an extra trigger that is NOT Amplified keeps the printed 8 seconds', () => {
    expect(activate(armed(false, { equipmentExtraTriggers: 1 }), 40).sellBonusWindow).toEqual({ amount: 1, untilClock: 32 });
  });
  it('Amplified with no clock reading still runs to the end of the turn', () => {
    const s = armed();
    amplifyEquipment(s, 'thymepiece');
    expect(activate(s).sellBonusWindow).toEqual({ amount: 1, untilClock: null });
  });
  it('the printed rule doubles the window while Amplified, on both versions, and nothing else', () => {
    const eq = EQUIPMENT_INDEX['thymepiece']!;
    expect(equipmentText(eq, 'plain')).toContain('**8 seconds**');
    expect(equipmentText(eq, 'plain', { amplified: true })).toContain('**16 seconds**');
    expect(equipmentText(eq, 'gilded')).toContain('**16 seconds**');
    expect(equipmentText(eq, 'gilded', { amplified: true })).toBe('Cards sell for **+1** Gold for the next **32 seconds**.');
    expect(equipmentText(eq, 'plain', { amplified: false })).toBe(eq.text);
    const other = EQUIPMENT_INDEX['revelmaker']!;
    expect(equipmentText(other, 'plain', { amplified: true })).toBe(other.text);
  });
});
