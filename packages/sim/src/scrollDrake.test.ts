/**
 * SCROLL DRAKE (Set 3 Dragon/Spirit, T3 3/4, placeholder name + stats) — owner design 2026-10-30:
 *
 *   "Set 3: Add a t3 ... spirit minion that reduces the cost of spells in the shop by 1 and adds a second spell to
 *    every shop. (This will replace a minion at highest shop tiers so that the shop doesn't have more total offers)"
 *   Follow-up the same day: "Actually make it a dragon spirit. Golden is 2 less".
 *
 * Pinned here (R-SCROLL-DRAKE-01 in the oracle):
 *  - PRICE (owner 2026-11-10, R-SCROLL-DRAKE-02: "the first spell you buy each turn is 1 less instead of every spell"):
 *    the FIRST Shop spell bought each turn costs 1 less per copy on the board (2 Gilded), floored at 0, stacking with
 *    the run's other discounts. Counted for the turn, not per copy: a spell bought before Scrollz landed used it up.
 *  - OFFERS: every roll (refresh, turn start, frozen top-up) puts ONE spell in the minion row IN PLACE OF a minion,
 *    at every tier; the total offer count never grows; capped at one extra spell for any number of copies.
 *  - Frozen / kept offers and the Starform's pinned slot keep working; no Drake = the exact old rng stream.
 */
import { describe, it, expect } from 'vitest';
import { CARD_INDEX, poolFor } from '@game/content';
import { ANCIENT_IDS, createRun, deserialize, enableAncients, reduce, serialize, type BoardCard, type BoardSnapshot, type RunState } from './index';
import { shopSpellsBoughtThisTurn, spellCostReduction } from './recruit';
import { toBotVisibleState } from './productionBots/visibleState';
import { rollShop, tierSlots, topUpTavern, extraRowSpells, SCROLL_DRAKE_ID } from './shop';

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7), setId: 'set3', phase: 'recruit', embers: 30, tier: 6, tribes: ['kobold', 'dwarf', 'undead', 'spirit', 'dragon'],
    pool: Object.fromEntries(poolFor('set3').buyable.map((c) => [c.id, 5])), recruitBuffFx: [], ...over } as RunState);
const isSpell = (cardId: string): boolean => !!CARD_INDEX[cardId]?.spell;
const rowSpells = (s: RunState): number => s.shop.filter((o) => isSpell(o.cardId)).length;
const D = CARD_INDEX[SCROLL_DRAKE_ID]!;
const drake = (uid = 'dk', golden = false): BoardCard => body(uid, SCROLL_DRAKE_ID, { golden });

describe('Scrollz — the card', () => {
  it('is a Set 3 Dragon/Spirit, Tier 3, drawable from the Set 3 pool only', () => {
    expect(D).toMatchObject({ tribe: 'dragon', tribe2: 'spirit', tier: 3 });
    expect(poolFor('set3').buyable.some((c) => c.id === SCROLL_DRAKE_ID)).toBe(true);
    expect(poolFor('set2').buyable.some((c) => c.id === SCROLL_DRAKE_ID)).toBe(false);
    expect(D.text).toBe('The first **Shop spell** you buy each turn costs **1** less. Each Shop has an extra spell in place of a minion.');
    expect(D.goldenText).toBe('The first **Shop spell** you buy each turn costs **2** less. Each Shop has an extra spell in place of a minion.');
  });
});

describe('Scrollz — PRICE: the first Shop spell bought each turn (R-SCROLL-DRAKE-02)', () => {
  const spellId = poolFor('set3').spells.find((c) => (c.cost ?? 0) >= 3)!.id;
  const base = CARD_INDEX[spellId]!.cost!;
  const slot = (uid: string) => ({ uid, cardId: spellId });
  /** Buy `uid` and return [state, Gold paid]. */
  const buy = (s: RunState, uid: string): [RunState, number] => { const n = reduce(s, { type: 'buy', uid }); return [n, s.embers - n.embers]; };
  const foe: BoardSnapshot = { v: 1, wave: 1, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: 1,
    minions: [{ cardId: 'sandbag', attack: 0, health: 1, keywords: [] }], seed: 1, origin: 'self' };
  const nextTurn = (s: RunState): RunState =>
    reduce(reduce({ ...s, servedBoards: { [s.wave]: { ...foe, wave: s.wave } } }, { type: 'faceOmen' }), { type: 'resolveCombat' });
  const botPrice = (s: RunState, uid: string): number => {
    const v = toBotVisibleState(s);
    return (v.spellOffer?.uid === uid ? v.spellOffer : v.shop.find((o) => o.uid === uid))!.cost;
  };

  it('the reduction: -1 per plain copy, -2 Gilded, stacking, while no Shop spell has been bought this turn', () => {
    expect(spellCostReduction(run({ board: [] }))).toBe(0);
    expect(spellCostReduction(run({ board: [drake()] }))).toBe(1);
    expect(spellCostReduction(run({ board: [drake('g', true)] }))).toBe(2);
    expect(spellCostReduction(run({ board: [drake('a'), drake('b')] }))).toBe(2);
    expect(spellCostReduction(run({ board: [drake('a'), drake('g', true)], spellCostMod: 1 }))).toBe(4);
    expect(spellCostReduction(run({ board: [drake('a'), body('lz', 'lazarus')] })), 'stacks with Lazarus').toBe(2);
    const used = run({ board: [drake('a'), drake('g', true), body('lz', 'lazarus')], spellCostMod: 1 });
    used.shopSpellBuys = { wave: used.wave, n: 1 };
    expect(spellCostReduction(used), 'used up: only Lazarus and the stored discount are left').toBe(2);
    expect(shopSpellsBoughtThisTurn({ ...used, wave: used.wave + 1 }), 'a new turn reads 0').toBe(0);
  });

  it('a held copy (hand) does nothing: it is a board aura', () => {
    expect(spellCostReduction(run({ board: [], hand: [drake()] }))).toBe(0);
  });

  it('the first spell costs 1 less, the second costs full price (slot, then row)', () => {
    let s = run({ board: [drake()], spell: slot('s1'), shop: [slot('r1')] });
    let paid: number;
    [s, paid] = buy(s, 's1');
    expect(paid).toBe(base - 1);
    expect(shopSpellsBoughtThisTurn(s)).toBe(1);
    [s, paid] = buy(s, 'r1');
    expect(paid, 'the second spell is not discounted').toBe(base);
  });

  it('row first, then slot: the discount follows the first buy, whichever path', () => {
    let s = run({ board: [drake()], spell: slot('s1'), shop: [slot('r1')] });
    let paid: number;
    [s, paid] = buy(s, 'r1');
    expect(paid).toBe(base - 1);
    [s, paid] = buy(s, 's1');
    expect(paid).toBe(base);
  });

  it('Gilded: 2 less on the first spell only', () => {
    let s = run({ board: [drake('g', true)], spell: slot('s1'), shop: [slot('r1')] });
    let paid: number;
    [s, paid] = buy(s, 's1');
    expect(paid).toBe(base - 2);
    [s, paid] = buy(s, 'r1');
    expect(paid).toBe(base);
  });

  it('two copies stack on the first spell only', () => {
    let s = run({ board: [drake('a'), drake('b')], spell: slot('s1'), shop: [slot('r1')] });
    let paid: number;
    [s, paid] = buy(s, 's1');
    expect(paid).toBe(base - 2);
    [s, paid] = buy(s, 'r1');
    expect(paid, 'the second copy does not discount the second spell').toBe(base);
  });

  it('a spell bought before Scrollz was played has used the turn up', () => {
    let s = run({ board: [], hand: [drake('dk')], spell: slot('s1'), shop: [slot('r1')] });
    let paid: number;
    [s, paid] = buy(s, 's1');
    expect(paid, 'no Scrollz yet: full price').toBe(base);
    s = reduce(s, { type: 'play', uid: 'dk' });
    expect(s.board.some((c) => c.uid === 'dk')).toBe(true);
    expect(spellCostReduction(s), 'played after the first buy: nothing this turn').toBe(0);
    [s, paid] = buy(s, 'r1');
    expect(paid).toBe(base);
  });

  it('CROSS-PHASE: live the moment it is played (nothing bought yet) and gone the moment it is sold', () => {
    let s = run({ board: [], hand: [drake('dk')] });
    expect(spellCostReduction(s)).toBe(0);
    s = reduce(s, { type: 'play', uid: 'dk' });
    expect(spellCostReduction(s), 'played mid-shop: live at once').toBe(1);
    s = reduce(s, { type: 'sell', uid: 'dk' });
    expect(spellCostReduction(s), 'sold: gone at once').toBe(0);
  });

  it('the visible price (the pill and the bots read it): every spell offer is discounted until the first buy, then none', () => {
    let s = run({ board: [drake()], spell: slot('s1'), shop: [slot('r1'), slot('r2')] });
    expect(['s1', 'r1', 'r2'].map((u) => botPrice(s, u))).toEqual([base - 1, base - 1, base - 1]);
    s = reduce(s, { type: 'buy', uid: 'r1' });
    expect(['s1', 'r2'].map((u) => botPrice(s, u)), 'after the first buy every offer shows the normal price').toEqual([base, base]);
  });

  it('resets next turn, and a frozen Shop shows the discount again', () => {
    let s = run({ board: [drake('dk', false)], spell: slot('s1'), shop: [slot('r1')] });
    s.board[0]!.health = 900;
    s = reduce(s, { type: 'buy', uid: 's1' });
    expect(botPrice(s, 'r1')).toBe(base);
    s = reduce(s, { type: 'freeze' });
    expect(s.frozen).toBe(true);
    const wave = s.wave;
    s = nextTurn(s);
    expect(s.phase).toBe('recruit');
    expect(s.wave).toBe(wave + 1);
    expect(s.board.some((c) => c.cardId === SCROLL_DRAKE_ID)).toBe(true);
    expect(s.shop.some((o) => o.uid === 'r1'), 'the frozen spell offer carried over').toBe(true);
    expect(shopSpellsBoughtThisTurn(s)).toBe(0);
    expect(botPrice(s, 'r1'), 'the kept offer is discounted again').toBe(base - 1);
    const [, paid] = buy({ ...s, embers: 30 }, 'r1');
    expect(paid).toBe(base - 1);
  });

  it('floor 0 with another discount, and that free first buy still uses the turn up', () => {
    let s = run({ board: [drake('a', true), drake('b', true)], spellCostMod: 5, spell: slot('s1'), shop: [slot('r1')] });
    let paid: number;
    [s, paid] = buy(s, 's1');
    expect(paid, 'floor 0').toBe(0);
    s.spellCostMod = 1;
    [s, paid] = buy(s, 'r1');
    expect(paid, 'only the other discount is left').toBe(base - 1);
  });

  it('a save from before the count existed reads 0 bought, and the count survives a JSON round trip', () => {
    const old = run({ board: [drake()], spell: slot('s1') });
    delete old.shopSpellBuys;
    expect(spellCostReduction(deserialize(serialize(old)))).toBe(1);
    const bought = reduce(old, { type: 'buy', uid: 's1' });
    expect(spellCostReduction(deserialize(serialize(bought)))).toBe(0);
  });
});

describe('Scrollz x Emissary x Ancient of Fortune: one "first Shop spell each turn" count', () => {
  const spellId = 'sparkplug';
  const price = CARD_INDEX[spellId]!.cost!;
  const slot = (uid: string) => ({ uid, cardId: spellId });
  const fortune = (over: Partial<RunState> = {}): RunState => {
    let s = enableAncients({ ...createRun(7, 'vale'), phase: 'recruit', tier: 3, embers: 40, heroReady: true, hand: [], board: [], shop: [], spell: null, ...over } as RunState);
    s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: ['fortune', ...ANCIENT_IDS.filter((a) => a !== 'fortune').slice(0, 2)] } };
    s = reduce(s, { type: 'pickAncient', id: 'fortune' });
    expect(s.ancients!.picked).toBe('fortune');
    return s;
  };

  it('the first spell is free (floor 0) and spends both; the second pays full price', () => {
    expect(price).toBeGreaterThan(1);
    let s = fortune({ board: [drake()], spell: slot('s1'), shop: [slot('r1')] });
    const gold = s.embers;
    s = reduce(s, { type: 'buy', uid: 's1' });
    expect(s.embers, 'free: the two never go below 0').toBe(gold);
    s = reduce(s, { type: 'buy', uid: 'r1' });
    expect(gold - s.embers, 'Scrollz went with the free spell').toBe(price);
  });

  it('a new turn has both again', () => {
    let s = fortune({ board: [drake()], spell: slot('s1') });
    s = reduce(s, { type: 'buy', uid: 's1' });
    const next = { ...s, wave: s.wave + 1, spell: slot('s2') };
    expect(spellCostReduction(next)).toBe(1);
    expect(reduce(next, { type: 'buy', uid: 's2' }).embers).toBe(next.embers);
  });
});

describe('Scrollz — OFFERS: one spell in the row in place of a minion', () => {
  for (const tier of [1, 2, 3, 4, 5, 6]) {
    it(`tier ${tier}: same total offers, one minion traded for a spell`, () => {
      const plain = run({ tier, board: [], shop: [] });
      rollShop(plain);
      expect(plain.shop.length).toBe(tierSlots(tier));
      expect(rowSpells(plain)).toBe(0);
      expect(plain.spell).not.toBeNull();

      const aura = run({ tier, board: [drake()], shop: [] });
      rollShop(aura);
      expect(aura.shop.length, 'the row never grows').toBe(tierSlots(tier));
      expect(rowSpells(aura), 'one extra spell').toBe(1);
      expect(aura.shop.filter((o) => !isSpell(o.cardId)).length).toBe(tierSlots(tier) - 1);
      expect(isSpell(aura.shop[aura.shop.length - 1]!.cardId), 'the spell sits at the right end of the row').toBe(true);
      expect(aura.spell, 'the slot spell is still there').not.toBeNull();
      const extra = aura.shop.find((o) => isSpell(o.cardId))!;
      expect(CARD_INDEX[extra.cardId]!.tier, 'tier-gated like the slot spell').toBeLessThanOrEqual(tier);
    });
  }

  it('two copies, or a Gilded one, still add just ONE extra spell', () => {
    expect(extraRowSpells(run({ board: [drake('a'), drake('b')] }))).toBe(1);
    expect(extraRowSpells(run({ board: [drake('g', true)] }))).toBe(1);
    const s = run({ board: [drake('a'), drake('b', true)], shop: [] });
    rollShop(s);
    expect(rowSpells(s)).toBe(1);
    expect(s.shop.length).toBe(tierSlots(6));
  });

  it('the extra spell differs from the slot spell when the pool allows', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = run({ ...createRun(seed), board: [drake()], shop: [] } as Partial<RunState>);
      rollShop(s);
      const extra = s.shop.find((o) => isSpell(o.cardId))!;
      expect(extra.cardId).not.toBe(s.spell!.cardId);
    }
  });

  it('a manual refresh (the roll action) serves the extra spell', () => {
    let s = run({ board: [drake()], shop: [] });
    s = reduce(s, { type: 'roll' });
    expect(rowSpells(s)).toBe(1);
    expect(s.shop.length).toBe(tierSlots(6));
  });

  it('without the Drake the roll is byte-identical to before (rng stream untouched)', () => {
    const a = run({ board: [], shop: [] });
    const b = run({ board: [body('x', 'd3_choosey')], shop: [] });
    rollShop(a); rollShop(b);
    expect(b.shop.map((o) => o.cardId)).toEqual(a.shop.map((o) => o.cardId));
    expect(b.rngCursor).toBe(a.rngCursor);
  });

  it('an unspent board aura is a roll-time effect: playing it mid-shop does not rewrite the current row', () => {
    let s = run({ board: [], hand: [drake('dk')], shop: [] });
    rollShop(s);
    const row = s.shop.map((o) => o.uid);
    s = reduce(s, { type: 'play', uid: 'dk' });
    expect(s.shop.map((o) => o.uid)).toEqual(row);
    s = reduce(s, { type: 'roll' });
    expect(rowSpells(s), 'the next roll has it').toBe(1);
  });
});

describe('Scrollz — freeze, kept offers, the Starform', () => {
  it('a Layaway-kept spell already fills the quota: no second extra spell', () => {
    const spellId = poolFor('set3').spells[0]!.id;
    const s = run({ board: [drake()], shop: [{ uid: 'k', cardId: spellId, kept: true }] });
    rollShop(s);
    expect(rowSpells(s)).toBe(1);
    expect(s.shop.length).toBe(tierSlots(6));
    expect(s.shop[0]!.uid).toBe('k');
  });

  it('a full kept row is never overfilled', () => {
    const minions = poolFor('set3').buyable.filter((c) => c.tier <= 6).slice(0, tierSlots(6));
    const s = run({ board: [drake()], shop: minions.map((c, i) => ({ uid: `k${i}`, cardId: c.id, kept: true })) });
    rollShop(s);
    expect(s.shop.length).toBe(tierSlots(6));
    expect(rowSpells(s)).toBe(0);
  });

  it('a frozen top-up puts the spell in a gap, never growing the row', () => {
    const minions = poolFor('set3').buyable.filter((c) => c.tier <= 6).slice(0, 2);
    const s = run({ board: [drake()], shop: minions.map((c, i) => ({ uid: `f${i}`, cardId: c.id })) });
    topUpTavern(s);
    expect(s.shop.length).toBe(tierSlots(6));
    expect(rowSpells(s)).toBe(1);
    expect(s.shop.slice(0, 2).map((o) => o.uid), 'frozen offers stay put').toEqual(['f0', 'f1']);

    const full = run({ board: [drake()], shop: poolFor('set3').buyable.slice(0, tierSlots(6)).map((c, i) => ({ uid: `f${i}`, cardId: c.id })) });
    topUpTavern(full);
    expect(full.shop.length, 'a full frozen row is left as frozen').toBe(tierSlots(6));
    expect(rowSpells(full)).toBe(0);
  });

  it('a frozen shop carried into the next turn keeps its offers and tops up the spell', () => {
    const s = run({ board: [drake()], shop: [] });
    rollShop(s);
    s.shop = s.shop.filter((o) => !isSpell(o.cardId)).slice(0, 2); // bought the spell + some minions
    const keep = s.shop.map((o) => o.uid);
    topUpTavern(s);
    expect(s.shop.slice(0, 2).map((o) => o.uid)).toEqual(keep);
    expect(rowSpells(s)).toBe(1);
  });

  it('the Starform keeps its pinned slot and the total still holds', () => {
    const s = run({ board: [drake()], shop: [{ uid: 'sf', cardId: 'ce3_starform', starform: true }] });
    rollShop(s);
    expect(s.shop.length).toBe(tierSlots(6));
    expect(s.shop.some((o) => o.uid === 'sf' && o.starform)).toBe(true);
    expect(rowSpells(s)).toBe(1);
  });
});
