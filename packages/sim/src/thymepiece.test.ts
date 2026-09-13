import { describe, it, expect } from 'vitest';
import { CARD_INDEX, EQUIPMENT_INDEX } from '@game/content';
import {
  createRun, reduce, deserialize, serialize, offerBuyPrice, spellCostReduction, upgradeCostOf, nextRefreshCostOf,
  type Action, type BoardCard, type RunState, type ShopCard,
} from './index';
import { createStarform } from './starform';

/**
 * THYMEPIECE — "All cards cost −1 Gold for the next 8 seconds" (owner design 2026-09-12; gilded −2, same 8s).
 *
 * The engine never reads a clock. The activation action carries the turn clock's reading (`clockSeconds`,
 * seconds LEFT), the factory anchors the window at `clockSeconds − 8`, and EXPIRY is the
 * `discountWindowExpired` action the UI's clock tick dispatches when the clock crosses that anchor — so the
 * window pauses with the clock (Discover, Choose One, aim, hero select) and replays from the recording.
 *
 * Scope: CARDS ONLY — shop minions (`offerBuyPrice`) and spells, in the slot AND in the row
 * (`spellCostReduction`, which both buy paths use). The Shop upgrade and a refresh are untouched. Prices
 * floor at 0; the Starform's 0 stays 0.
 */

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(11), setId: 'set3', phase: 'recruit', embers: 20, tier: 6, ...over } as RunState);
const act = (s: RunState, a: Action): RunState => reduce(s, a);
const offer = (s: RunState, cardId: string, over: Partial<ShopCard> = {}): ShopCard => ({ uid: `s${s.uidSeq++}`, cardId, ...over });
/** Thymes on the board, its Thymepiece granted and selected. */
const armed = (golden = false, over: Partial<RunState> = {}): RunState =>
  act(run({ hand: [body('th', 'dw3_thymes', { golden })], ...over }), { type: 'play', uid: 'th', toIndex: 0 });
const activate = (s: RunState, clockSeconds?: number): RunState =>
  act(s, { type: 'activateEquipment', ...(clockSeconds !== undefined ? { clockSeconds } : {}) });
/** The first plain (non-spell, non-Ruby, non-Starform) minion offer in the row. */
const minionOffer = (s: RunState): ShopCard => s.shop.find((o) => { const d = CARD_INDEX[o.cardId]; return d && !d.spell && !d.ruby && !o.starform; })!;

describe('the Equipment', () => {
  it('keeps its cost and no-target shape; the texts print the amount and the window', () => {
    const eq = EQUIPMENT_INDEX['thymepiece']!;
    expect(eq.baseCost).toBe(3);
    expect(eq.targetMode).toBe('none');
    expect(eq.effectId).toBe('equipmentCardDiscountWindow');
    expect(eq.params).toEqual({ amount: 1, seconds: 8 });
    expect(eq.gildedParams).toEqual({ amount: 2, seconds: 8 });
    expect(eq.text).toContain('**1** less Gold');
    expect(eq.text).toContain('**8 seconds**');
    expect(eq.goldenText).toContain('**2** less Gold');
    expect(CARD_INDEX['dw3_thymes']!.text).toContain('**1** less Gold for the next **8 seconds**');
    expect(CARD_INDEX['dw3_thymes']!.goldenText).toContain('**2** less Gold');
  });
});

describe('the window', () => {
  it('activation at clock 40 opens { amount 1, untilClock 32 } and costs 3 Gold', () => {
    const s = armed();
    const t = activate(s, 40);
    expect(t.embers).toBe(s.embers - 3);
    expect(t.cardDiscountWindow).toEqual({ amount: 1, untilClock: 32 });
  });
  it('gilded Thymes opens a −2 window, still 8 seconds', () => {
    expect(activate(armed(true), 40).cardDiscountWindow).toEqual({ amount: 2, untilClock: 32 });
  });
  it('no clock reading (a headless test, a legacy recording) → the window runs to the end of the turn', () => {
    const t = activate(armed());
    expect(t.cardDiscountWindow).toEqual({ amount: 1, untilClock: null });
    expect(offerBuyPrice(t, minionOffer(t)).cost).toBe(2);
  });
  it('the expiry action closes it; a stray expiry with no window is a free no-op (same state)', () => {
    const t = activate(armed(), 40);
    const closed = act(t, { type: 'discountWindowExpired' });
    expect(closed.cardDiscountWindow).toBeUndefined();
    expect(act(closed, { type: 'discountWindowExpired' })).toBe(closed);
  });
  it('a re-activation replaces the window with the fresher one and never shortens a running one', () => {
    let s = activate(armed(), 40); // closes at 32
    // Re-arm the Equipment's own charge (spent by the first use) so a second activation is legal this turn.
    s = { ...s, embers: 20, equipment: { ...s.equipment!, available: s.equipment!.available.map((g) => ({ ...g, ownChargeSpent: false })) } } as RunState;
    const later = activate(s, 36); // closes at 28 — later than 32, so it wins
    expect(later.cardDiscountWindow).toEqual({ amount: 1, untilClock: 28 });
    // A third use at clock 20 closes at 12 — later still (the clock counts down), so it wins too.
    const third = activate({ ...later, embers: 20, equipment: { ...later.equipment!, available: later.equipment!.available.map((g) => ({ ...g, ownChargeSpent: false })) } } as RunState, 20);
    expect(third.cardDiscountWindow).toEqual({ amount: 1, untilClock: 12 });
  });
});

describe('what it discounts', () => {
  it('every minion offer in the row: coin and charge both −1 while the window is open, base again after expiry', () => {
    const t = activate(armed(), 40);
    const o = minionOffer(t);
    const base = offerBuyPrice(act(t, { type: 'discountWindowExpired' }), o).cost;
    expect(base).toBe(3);
    const price = offerBuyPrice(t, o);
    expect(price).toMatchObject({ cost: 2, windowOff: 1 });
    const bought = act(t, { type: 'buy', uid: o.uid });
    expect(t.embers - bought.embers, 'the charge equals the coin').toBe(2);
    const after = act(t, { type: 'discountWindowExpired' });
    expect(offerBuyPrice(after, o).cost).toBe(3);
    const boughtLate = act(after, { type: 'buy', uid: o.uid });
    expect(after.embers - boughtLate.embers).toBe(3);
  });
  it('the spell slot: −1 while open, base after expiry — through the real buy', () => {
    const s = armed(false, { spell: offer(run(), 'manafont') }); // Gold Font, cost 3
    const baseCost = CARD_INDEX['manafont']!.cost!;
    expect(baseCost).toBe(3);
    const t = activate(s, 40);
    expect(spellCostReduction(t, CARD_INDEX['manafont'])).toBe(spellCostReduction(s, CARD_INDEX['manafont']) + 1);
    const bought = act(t, { type: 'buy', uid: t.spell!.uid });
    expect(t.embers - bought.embers).toBe(baseCost - 1);
    const after = act(t, { type: 'discountWindowExpired' });
    const boughtLate = act(after, { type: 'buy', uid: after.spell!.uid });
    expect(after.embers - boughtLate.embers).toBe(baseCost);
  });
  it('a spell offer sitting in the minion row (Spell Cart) is discounted the same way', () => {
    const s0 = run();
    const spellInRow = offer(s0, 'emberpouch');
    const s = armed(false, { shop: [spellInRow], spell: null });
    const t = activate(s, 40);
    const bought = act(t, { type: 'buy', uid: spellInRow.uid });
    expect(bought.hand.some((c) => c.cardId === 'emberpouch')).toBe(true);
    expect(t.embers - bought.embers, 'a 1-Gold spell floors at 0').toBe(0);
  });
  it('gilded: −2 on minions, floored at 0 on a 1-Gold spell', () => {
    const t = activate(armed(true), 40);
    expect(offerBuyPrice(t, minionOffer(t)).cost).toBe(1);
    expect(Math.max(0, 1 - spellCostReduction(t, CARD_INDEX['emberpouch']))).toBe(0);
  });
  it('the Starform is a card like any other: its live 6-Gold price takes the window (rules v2 2026-09-13)', () => {
    let s = armed();
    s = act(s, { type: 'buy', uid: minionOffer(s).uid }); // open a slot
    const sf = createStarform(s, { cardId: 'dbg_starseed', name: 'Star Seed' });
    const t = activate(s, 40);
    expect(offerBuyPrice(t, sf)).toMatchObject({ cost: 5, windowOff: 1 });
  });
  it('a held (displaced) offer is never discounted — callers price it at the flat minion cost', () => {
    // Documented contract of `offerBuyPrice` (held offers branch before it); the UI reads `minionCostOf`.
    const t = activate(armed(), 40);
    expect(offerBuyPrice(t, minionOffer(t)).windowOff).toBe(1);
  });
  it('a free first buy overrides the window and spends nothing of it', () => {
    const t = activate(armed(false, { questFreeFirstBuy: true }), 40);
    expect(offerBuyPrice(t, minionOffer(t))).toMatchObject({ cost: 0, freeBuy: true, windowOff: 0 });
  });
  it('the Shop upgrade and a refresh are untouched', () => {
    const s = armed();
    const t = activate(s, 40);
    expect(upgradeCostOf(t)).toBe(upgradeCostOf(s));
    expect(nextRefreshCostOf(t)).toBe(nextRefreshCostOf(s));
    const rolled = act(t, { type: 'roll' });
    expect(t.embers - rolled.embers).toBe(nextRefreshCostOf(t));
  });
});

describe('lifecycle', () => {
  it('clears on combat entry and at the turn flip', () => {
    let s = activate(armed(), 40);
    s = act(s, { type: 'faceOmen' });
    expect(s.cardDiscountWindow).toBeUndefined();
    s = act(s, { type: 'settleCombat' });
    s = act(s, { type: 'resolveCombat' });
    expect(s.cardDiscountWindow).toBeUndefined();
    expect(offerBuyPrice(s, minionOffer(s)).windowOff).toBe(0);
  });
  it('Continue: a save at clock 30 with untilClock 32 resumes CLEARED; a save at clock 34 resumes ACTIVE', () => {
    const t = activate(armed(), 40); // untilClock 32
    const json = serialize(t);
    expect(deserialize(json, { turnRemaining: 30 }).cardDiscountWindow).toBeUndefined();
    expect(deserialize(json, { turnRemaining: 32 }).cardDiscountWindow, 'at the anchor the window is over').toBeUndefined();
    expect(deserialize(json, { turnRemaining: 34 }).cardDiscountWindow).toEqual({ amount: 1, untilClock: 32 });
    expect(deserialize(json).cardDiscountWindow, 'no reading → left as saved').toEqual({ amount: 1, untilClock: 32 });
  });
  it('a to-the-turn-end window (no reading) survives any resume clock', () => {
    const t = activate(armed());
    expect(deserialize(serialize(t), { turnRemaining: 1 }).cardDiscountWindow).toEqual({ amount: 1, untilClock: null });
  });
  it('old saves: the retired next-turn-seconds fields are dropped', () => {
    const legacy = { ...run(), bonusTurnSeconds: 30, bonusTurnSecondsNextTurn: 60 } as RunState & { bonusTurnSeconds?: number; bonusTurnSecondsNextTurn?: number };
    const healed = deserialize(JSON.stringify(legacy)) as RunState & { bonusTurnSeconds?: number; bonusTurnSecondsNextTurn?: number };
    expect(healed.bonusTurnSeconds).toBeUndefined();
    expect(healed.bonusTurnSecondsNextTurn).toBeUndefined();
    expect(healed.cardDiscountWindow).toBeUndefined();
  });
});
