import { describe, it, expect } from 'vitest';
import { CARD_INDEX, RUNES, EPIC_RUNES, RUNE_INDEX, SETS, poolFor } from '@game/content';
import { CONFIG, createRun, reduce, type Action, type BoardCard, type RunState, type ShopCard } from './index';
import { offerBuyPrice, questCombatMods } from './reducer';
import { advanceRuneThresholds, offerBuyStats } from './recruit';
import { END_OF_QUARTER_CHANCE } from './shop';
import { runeTally } from '../../ui/src/runeTally';

/**
 * Three Set 2 Basic runes (owner designs 2026-11-13). Rules R-SET2-RUNE-GOLDFORGRUB-01, R-SET2-RUNE-ENDOFQUARTER-01 and
 * R-SET2-RUNE-DRUNKSHOPKEEPER-01.
 *  - GOLD FOR GRUB (Demon, 4; first drafted as Infernal at 6 Gold): "When you spend 7 Gold, a random Demon consumes a
 *    minion in the Shop." Dragon Hoard's repeating `gold` meter with a Hydraskus-style bite as the payout.
 *  - END OF QUARTER (neutral, 3): "Every card in your Shop has a 30% chance to cost 1 less." Each card entering the Shop
 *    rolls once per copy held.
 *  - DRUNK SHOPKEEPER (Dwarf, 2): "When you cast an Ale, give minions in your Shop +1/+1 permanently."
 */

const act = (s: RunState, a: Action): RunState => reduce(s, a) as RunState;
const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
function run(seed = 13, tier = 3): RunState {
  return {
    ...createRun(seed, 'runesmith', 'ascent', CONFIG.defaultLine, 'set2'),
    tribes: [...SETS.set2.tribes], wave: 7, tier, phase: 'recruit', embers: 60, hand: [], board: [], recruitBuffFx: [],
    pool: Object.fromEntries(poolFor('set2').buyable.map((c) => [c.id, 5])),
  } as RunState;
}
const take = (s: RunState, id: string): RunState =>
  ({ ...act({ ...s, runeforgeOffer: [id], runeforgeEpic: !!RUNE_INDEX[id]!.epic }, { type: 'buyRune', index: 0 }), embers: 60, discover: undefined, discoverQueue: undefined });
/** Take the runes, then zero every threshold meter (the rune purchases themselves spent Gold). */
function withRunes(ids: string[], over: Partial<RunState> = {}, seed = 13, tier = 3): RunState {
  const s = ids.reduce(take, run(seed, tier));
  return { ...s, runeThresholds: (s.runeThresholds ?? []).map((t) => ({ ...t, tick: 0 })), runeProcs: {}, shopEaten: [], ...over };
}
const isMinion = (o: ShopCard): boolean => { const d = CARD_INDEX[o.cardId]; return !!d && !d.spell && !d.ruby; };
const minions = (s: RunState) => s.shop.filter(isMinion);
const DEMONS = () => [body('k1', 'dm_knocked'), body('x', 'dw_brakka'), body('k2', 'dm_leech')];
const consumeGain = (c: BoardCard | undefined): [number, number] =>
  (c?.buffs ?? []).filter((b) => b.source === 'Consume').reduce<[number, number]>((t, b) => [t[0] + b.attack, t[1] + b.health], [0, 0]);
const nextTurn = (s: RunState): RunState => act(act(act(s, { type: 'faceOmen' }), { type: 'settleCombat' }), { type: 'resolveCombat' });

describe('the three runes as content', () => {
  it('Gold for Grub: Basic, Demon, 4 Gold, Set 2 only, the owner text, a repeating 7-Gold meter', () => {
    const r = RUNE_INDEX['rune_gold_for_grub']!;
    expect(RUNES.includes(r)).toBe(true);
    expect(EPIC_RUNES.includes(r)).toBe(false);
    expect([r.name, r.cost, !!r.epic, r.tribes, r.sets]).toEqual(['Gold for Grub', 4, false, ['demon'], ['set2']]);
    expect(r.text).toBe('When you spend **7** Gold, a random **Demon** consumes a minion in the Shop.');
    expect(r.reward).toEqual({ kind: 'runeThreshold', meter: 'gold', per: 7, demonConsumeShop: 1 });
    expect(RUNE_INDEX['rune_infernal'], 'the draft id is gone').toBeUndefined();
  });
  it('End of Quarter: Basic, neutral, 3 Gold, Set 2 only, the owner text', () => {
    const r = RUNE_INDEX['rune_end_of_quarter']!;
    expect(RUNES.includes(r)).toBe(true);
    expect([r.name, r.cost, !!r.epic, r.tribes, r.sets]).toEqual(['End of Quarter', 3, false, undefined, ['set2']]);
    expect(r.text).toBe('Every card in your Shop has a **30%** chance to cost **1** less.');
    expect(r.reward).toEqual({ kind: 'combatFlag', flag: 'runeEndOfQuarter' });
  });
  it('Drunk Shopkeeper: Basic, Dwarf, 2 Gold, Set 2 only, the owner text', () => {
    const r = RUNE_INDEX['rune_drunk_shopkeeper']!;
    expect(RUNES.includes(r)).toBe(true);
    expect([r.name, r.cost, !!r.epic, r.tribes, r.sets]).toEqual(['Drunk Shopkeeper', 2, false, ['dwarf'], ['set2']]);
    expect(r.text).toBe('When you cast an **Ale**, give minions in your Shop **+1/+1** permanently.');
    expect(r.reward).toEqual({ kind: 'combatFlag', flag: 'runeDrunkShopkeeper' });
  });
});

describe('Gold for Grub: the meter and the bite', () => {
  it('fires on the 7th Gold and the 14th, not before; the badge counts x/7 live', () => {
    const s = withRunes(['rune_gold_for_grub'], { board: DEMONS() });
    const before = minions(s).length;
    advanceRuneThresholds(s, 'gold', 6);
    expect(s.shopEaten).toEqual([]);
    expect(runeTally(s, 'rune_gold_for_grub')).toBe('6/7g');
    advanceRuneThresholds(s, 'gold', 1);
    expect(s.shopEaten).toHaveLength(1);
    expect(minions(s).length).toBe(before - 1);
    expect(runeTally(s, 'rune_gold_for_grub')).toBe('0/7g');
    expect(s.runeProcs?.rune_gold_for_grub).toBe(1);
    advanceRuneThresholds(s, 'gold', 6);
    expect(s.shopEaten, 'the 13th Gold is not a bite').toHaveLength(1);
    advanceRuneThresholds(s, 'gold', 1);
    expect(s.shopEaten, 'the 14th is').toHaveLength(2);
  });

  it('the eater is a friendly DEMON and gains exactly the meal\'s Shop stats (a normal Demon consume)', () => {
    const s = withRunes(['rune_gold_for_grub'], { board: DEMONS() });
    const statsByUid = new Map(s.shop.map((o) => [o.uid, offerBuyStats(s, o)]));
    advanceRuneThresholds(s, 'gold', 7);
    const ev = s.shopEaten![0]!;
    expect(['k1', 'k2']).toContain(ev.eaterUid);
    const meal = statsByUid.get(ev.uid)!;
    expect(consumeGain(s.board.find((c) => c.uid === ev.eaterUid))).toEqual([meal.attack, meal.health]);
    expect(consumeGain(s.board.find((c) => c.uid === 'x')), 'the Dwarf never eats').toEqual([0, 0]);
    expect(s.shop.some((o) => o.uid === ev.uid), 'the meal left the Shop').toBe(false);
  });

  it('the leftover carries: 9 Gold = one bite with 2 banked, then 5 more = the second', () => {
    let s = withRunes(['rune_gold_for_grub'], { board: DEMONS() });
    advanceRuneThresholds(s, 'gold', 9);
    expect(s.shopEaten).toHaveLength(1);
    expect(runeTally(s, 'rune_gold_for_grub')).toBe('2/7g');
    s = nextTurn({ ...s, frozen: false });
    expect(runeTally(s, 'rune_gold_for_grub'), 'the remainder carries across the turn').toBe('2/7g');
    s.shopEaten = [];
    advanceRuneThresholds(s, 'gold', 5);
    expect(s.shopEaten).toHaveLength(1);
  });

  it('real buys tick it in real time: the 3-Gold buy that crosses the 7th Gold bites in that buy', () => {
    let s = withRunes(['rune_gold_for_grub'], { board: DEMONS() });
    s = act(s, { type: 'buy', uid: minions(s)[0]!.uid });
    expect(s.shopEaten ?? [], '3 Gold spent').toHaveLength(0);
    s.runeThresholds = s.runeThresholds!.map((t) => ({ ...t, tick: 6 })); // as if 6 were spent (the 3-slot row has only 3 minions to buy)
    s = act(s, { type: 'buy', uid: minions(s)[0]!.uid });
    expect(s.shopEaten).toHaveLength(1);
    expect(runeTally(s, 'rune_gold_for_grub')).toBe('2/7g');
  });

  it('a Refresh paying the 7th Gold bites the NEW row, not the one rolling away', () => {
    let s = withRunes(['rune_gold_for_grub'], { board: DEMONS() });
    s.runeThresholds = s.runeThresholds!.map((t) => ({ ...t, tick: 6 }));
    const oldRow = new Set(s.shop.map((o) => o.uid));
    s = act(s, { type: 'roll' });
    expect(s.shopEaten).toHaveLength(1);
    expect(oldRow.has(s.shopEaten![0]!.uid)).toBe(false);
    expect(s.runeProcs?.rune_gold_for_grub).toBe(1);
  });

  it('Big Spender doubles it: 3 Gold of Refreshes counts 6 (no bite), the 4th Gold makes 8 and bites', () => {
    let s = withRunes(['rune_gold_for_grub', 'rune_big_spender'], { board: DEMONS() });
    let bites = 0;
    for (let i = 0; i < 3; i++) { s = act(s, { type: 'roll' }); bites += s.shopEaten?.length ?? 0; }
    expect(bites).toBe(0);
    s = act(s, { type: 'roll' });
    expect(s.shopEaten).toHaveLength(1);
    expect(runeTally(s, 'rune_gold_for_grub')).toBe('1/7g');
  });

  it('the random Demon and the random meal are deterministic from the seed (and do vary with it)', () => {
    const go = (seed: number) => {
      const s = withRunes(['rune_gold_for_grub'], { board: DEMONS() }, seed);
      advanceRuneThresholds(s, 'gold', 21);
      return s.shopEaten!.map((e) => `${e.eaterUid}:${e.cardId}`);
    };
    expect(go(29)).toEqual(go(29));
    expect(go(29)).toHaveLength(3);
    const seen = new Set([3, 5, 7, 11, 13, 17, 19, 23].map((n) => go(n).join('|')));
    expect(seen.size).toBeGreaterThan(1);
  });

  it('no Demon on the board: nothing is eaten, no rune fire, and the meter still resets (the Gold counted)', () => {
    const s = withRunes(['rune_gold_for_grub'], { board: [body('x', 'dw_brakka')] });
    const row = s.shop.map((o) => o.uid);
    advanceRuneThresholds(s, 'gold', 7);
    expect(s.shopEaten).toEqual([]);
    expect(s.shop.map((o) => o.uid)).toEqual(row);
    expect(s.runeProcs?.rune_gold_for_grub).toBeUndefined();
    expect(runeTally(s, 'rune_gold_for_grub')).toBe('0/7g');
  });

  it('no minion in the Shop: nothing is eaten and no rune fire', () => {
    const s = withRunes(['rune_gold_for_grub'], { board: DEMONS() });
    s.shop = s.shop.filter((o) => !isMinion(o));
    advanceRuneThresholds(s, 'gold', 7);
    expect(s.shopEaten).toEqual([]);
    expect(s.runeProcs?.rune_gold_for_grub).toBeUndefined();
  });

  it('with Shop Madness the eaten slot refills at once (the Shop keeps 6 minions)', () => {
    const s = withRunes(['rune_shop_madness', 'rune_gold_for_grub'], { board: DEMONS() });
    expect(minions(s)).toHaveLength(6);
    advanceRuneThresholds(s, 'gold', 14);
    expect(s.shopEaten).toHaveLength(2);
    expect(minions(s)).toHaveLength(6);
  });

  it('two copies: one meter each, so 7 Gold is two bites', () => {
    const s = withRunes(['rune_gold_for_grub', 'rune_gold_for_grub'], { board: DEMONS() });
    advanceRuneThresholds(s, 'gold', 7);
    expect(s.shopEaten).toHaveLength(2);
  });
});

describe('End of Quarter: the roll', () => {
  /** Every card that entered the Shop across `n` Refreshes (row + spell slot), each seen once. */
  function entered(ids: string[], n: number, seed = 13): ShopCard[] {
    let s = withRunes(ids, {}, seed, 4);
    const seen = new Map<string, ShopCard>();
    const note = () => { for (const o of [...s.shop, s.spell]) if (o && !seen.has(o.uid)) seen.set(o.uid, o); };
    for (let i = 0; i < n; i++) { s = act({ ...s, embers: 60 }, { type: 'roll' }); note(); }
    return [...seen.values()];
  }

  it('about 30% of the cards entering the Shop roll the 1 Gold cut (statistical, 600 Refreshes)', () => {
    const cards = entered(['rune_end_of_quarter'], 600);
    expect(cards.length).toBeGreaterThan(2000);
    const hit = cards.filter((o) => (o.quarterCut ?? 0) > 0).length / cards.length;
    expect(hit).toBeGreaterThan(END_OF_QUARTER_CHANCE - 0.03);
    expect(hit).toBeLessThan(END_OF_QUARTER_CHANCE + 0.03);
    expect(cards.every((o) => o.quarterRolls === 1 && (o.quarterCut ?? 0) <= 1)).toBe(true);
  });

  it('the Shop spell rolls too, and a discounted spell slot buys 1 cheaper', () => {
    const cards = entered(['rune_end_of_quarter'], 200);
    const spells = cards.filter((o) => CARD_INDEX[o.cardId]?.spell);
    expect(spells.length).toBeGreaterThan(150);
    expect(spells.some((o) => (o.quarterCut ?? 0) > 0)).toBe(true);
    // Buy a spell slot with and without its cut from the same state.
    let s = withRunes(['rune_end_of_quarter']);
    for (let i = 0; i < 40 && !(s.spell && CARD_INDEX[s.spell.cardId]!.cost! > 0); i++) s = act({ ...s, embers: 60 }, { type: 'roll' });
    const sp = s.spell!;
    const paid = (cut: number) => { const t = { ...s, embers: 60, spell: { ...sp, quarterCut: cut } }; return 60 - act(t, { type: 'buy', uid: sp.uid }).embers; };
    expect(paid(0) - paid(1)).toBe(1);
  });

  it('it never moves another draw: the Shop rows are identical with and without the rune', () => {
    const rows = (ids: string[]) => { let s = withRunes(ids, {}, 21, 4); const out: string[] = []; for (let i = 0; i < 20; i++) { s = act({ ...s, embers: 60 }, { type: 'roll' }); out.push([...s.shop.map((o) => o.cardId), s.spell?.cardId].join(',')); } return out; };
    // Taking a rune spends Gold; compare from the same pre-rune state by taking a neutral, Shop-inert rune in its place.
    expect(rows(['rune_end_of_quarter'])).toEqual(rows(['rune_wholesale']));
  });

  it('deterministic from the seed', () => {
    const go = () => entered(['rune_end_of_quarter'], 30, 29).map((o) => `${o.uid}:${o.quarterCut ?? 0}`);
    expect(go()).toEqual(go());
  });

  it('the cards already in the Shop roll when the rune is taken; a card never re-rolls while it stays', () => {
    let s = withRunes(['rune_end_of_quarter']);
    expect([...s.shop, s.spell].filter(Boolean).every((o) => o!.quarterRolls === 1)).toBe(true);
    s = act(s, { type: 'freeze' });
    const kept = new Map(s.shop.map((o) => [o.uid, o.quarterCut ?? 0]));
    s = nextTurn(s);
    const stayed = s.shop.filter((o) => kept.has(o.uid));
    expect(stayed.length).toBeGreaterThan(0);
    for (const o of stayed) { expect(o.quarterCut ?? 0, 'a frozen card keeps its cut').toBe(kept.get(o.uid)); expect(o.quarterRolls).toBe(1); }
  });

  it('two copies roll separately: up to 2 off, and about 51% of cards get at least 1', () => {
    const cards = entered(['rune_end_of_quarter', 'rune_end_of_quarter'], 400);
    const any = cards.filter((o) => (o.quarterCut ?? 0) > 0).length / cards.length;
    expect(any).toBeGreaterThan(0.46);
    expect(any).toBeLessThan(0.56);
    expect(cards.some((o) => o.quarterCut === 2)).toBe(true);
    expect(cards.every((o) => o.quarterRolls === 2)).toBe(true);
  });
});

describe('End of Quarter: the price', () => {
  const minion = (s: RunState) => minions(s)[0]!;
  it('a cut takes 1 off a minion, stacks with Wholesale, and never goes below 0', () => {
    const s = withRunes(['rune_end_of_quarter', 'rune_wholesale']);
    const o = { ...minion(s), quarterCut: 0 };
    const base = offerBuyPrice(s, o).cost;
    expect(offerBuyPrice(s, { ...o, quarterCut: 1 }).cost).toBe(base - 1);
    expect(offerBuyPrice(s, { ...o, cost: 1, quarterCut: 1 }).cost).toBe(0);
    expect(offerBuyPrice(s, { ...o, cost: 0, quarterCut: 2 }).cost).toBe(0);
  });
  it('the buy charges the shown price', () => {
    const s = withRunes(['rune_end_of_quarter']);
    const o = minion(s);
    const t = { ...s, embers: 60, shop: s.shop.map((x) => (x.uid === o.uid ? { ...x, quarterCut: 1 } : x)) };
    const shown = offerBuyPrice(t, t.shop.find((x) => x.uid === o.uid)!).cost;
    expect(60 - act(t, { type: 'buy', uid: o.uid }).embers).toBe(shown);
    expect(shown).toBe(CONFIG.minionCost - 1);
  });
  it('Shop-only: the combat mods (what a snapshot carries into a fight) are untouched by the rune', () => {
    const a = withRunes(['rune_end_of_quarter']);
    const b = withRunes([]);
    // `flagCopies` rides every flag generically; nothing in the fight reads this one. Every combat mod is unchanged.
    const { flagCopies: _a, ...ma } = questCombatMods(a) as Record<string, unknown>;
    const { flagCopies: _b, ...mb } = questCombatMods(b) as Record<string, unknown>;
    expect(ma).toEqual(mb);
  });
});

describe('Drunk Shopkeeper: an Ale cast buffs the Shop', () => {
  const ALE = 'wo_mine'; // untargeted Ale (Gain 2 Gold)
  const ale = (uid: string) => body(uid, ALE);
  const fromShopkeeper = (o: ShopCard): [number, number] =>
    (o.buffs ?? []).filter((b) => b.source === 'Drunk Shopkeeper').reduce<[number, number]>((t, b) => [t[0] + b.attack, t[1] + b.health], [0, 0]);
  const play = (s: RunState, uid: string): RunState => act(s, { type: 'play', uid });

  it('one Ale = +1/+1 on every Shop minion; two Ales = +2/+2; the stats are on the offer (what it buys at)', () => {
    let s = withRunes(['rune_drunk_shopkeeper'], { hand: [ale('a1'), ale('a2')] });
    const before = new Map(minions(s).map((o) => [o.uid, offerBuyStats(s, o)]));
    s = play(s, 'a1');
    for (const o of minions(s)) expect(fromShopkeeper(o)).toEqual([1, 1]);
    expect(s.runeProcs?.rune_drunk_shopkeeper).toBe(1);
    s = play(s, 'a2');
    for (const o of minions(s)) {
      expect(fromShopkeeper(o)).toEqual([2, 2]);
      const b = before.get(o.uid)!;
      expect(offerBuyStats(s, o)).toMatchObject({ attack: b.attack + 2, health: b.health + 2 });
    }
  });

  it('a non-Ale spell does nothing; without the rune an Ale does nothing', () => {
    const spell = poolFor('set2').all.find((c) => c.spell && !c.target && !c.token && !c.ruby && c.effects.length > 0 && !['wo_mine', 'wo_reinforcement', 'wo_champion', 'wo_health', 'wo_attack'].includes(c.id) && !c.discoverOnPlay)!;
    let s = withRunes(['rune_drunk_shopkeeper'], { hand: [body('sp', spell.id)] });
    s = play(s, 'sp');
    for (const o of minions(s)) expect(fromShopkeeper(o)).toEqual([0, 0]);
    let p = withRunes([], { hand: [ale('a1')] });
    p = play(p, 'a1');
    for (const o of minions(p)) expect(fromShopkeeper(o)).toEqual([0, 0]);
  });

  it('cards that enter the Shop after the cast are not buffed; frozen cards keep it into the next turn', () => {
    let s = withRunes(['rune_drunk_shopkeeper'], { hand: [ale('a1')] });
    s = play(s, 'a1');
    const buffed = new Set(minions(s).map((o) => o.uid));
    const rolled = act({ ...s, embers: 60 }, { type: 'roll' });
    for (const o of minions(rolled)) expect(fromShopkeeper(o)).toEqual([0, 0]);
    let f = act(s, { type: 'freeze' });
    f = nextTurn(f);
    const kept = minions(f).filter((o) => buffed.has(o.uid));
    expect(kept.length).toBeGreaterThan(0);
    for (const o of kept) expect(fromShopkeeper(o)).toEqual([1, 1]);
  });

  it('a multiplied Ale (Edward Keg-hands: twice) gives +1/+1 per cast, like every Ale trigger', () => {
    let s = withRunes(['rune_drunk_shopkeeper'], { hand: [ale('a1')], board: [body('e', 'dw_edward')] });
    s = play(s, 'a1');
    for (const o of minions(s)) expect(fromShopkeeper(o)).toEqual([2, 2]);
  });

  it('two copies: +2/+2 per Ale', () => {
    let s = withRunes(['rune_drunk_shopkeeper', 'rune_drunk_shopkeeper'], { hand: [ale('a1')] });
    s = play(s, 'a1');
    for (const o of minions(s)) expect(fromShopkeeper(o)).toEqual([2, 2]);
  });

  it('with Shop Madness: the +3/+3 Shop buff plus the Ale\'s +1/+1, on all 6 minions', () => {
    let s = withRunes(['rune_shop_madness', 'rune_drunk_shopkeeper'], { hand: [ale('a1')] });
    s = play(s, 'a1');
    expect(minions(s)).toHaveLength(6);
    for (const o of minions(s)) {
      const d = CARD_INDEX[o.cardId]!;
      const st = offerBuyStats(s, o);
      expect([st.attack - d.attack * (o.golden ? 2 : 1), st.health - d.health * (o.golden ? 2 : 1)]).toEqual([4, 4]);
    }
  });

  it('with End of Quarter: the buff leaves the price alone and the discount leaves the stats alone', () => {
    let s = withRunes(['rune_end_of_quarter', 'rune_drunk_shopkeeper'], { hand: [ale('a1')] });
    const price = new Map(minions(s).map((o) => [o.uid, offerBuyPrice(s, o).cost]));
    s = play(s, 'a1');
    for (const o of minions(s)) {
      expect(fromShopkeeper(o)).toEqual([1, 1]);
      expect(offerBuyPrice(s, o).cost).toBe(price.get(o.uid));
    }
  });

  it('an empty Shop: no fire', () => {
    let s = withRunes(['rune_drunk_shopkeeper'], { hand: [ale('a1')] });
    s = { ...s, shop: s.shop.filter((o) => !isMinion(o)) };
    s = play(s, 'a1');
    expect(s.runeProcs?.rune_drunk_shopkeeper).toBeUndefined();
  });
});
