import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { CardDef } from '@game/core';
import {
  createRun, reduce, tierSlots, offerBuyPrice, offerBuyStats, topUpTavern, rollShop, elevateShop, rollSpellShop,
  STARFORM_ID, STARFORM_START_PRICE, createStarform, hasStarform, starformOf, starformStats, starformPrice, buffStarform, starformConsumeShopMinion,
  consumeStarform, collapseStarform, collapseHits, destroyStarform, serialize, deserialize,
  equipmentState, equipmentChargesOf, equipmentCostOf, holdsEquipment, selectEquipment,
  type Action, type BoardCard, type RunState, type ShopCard,
} from './index';
import { STAR_DESTROYER } from '@game/content';
import { applyShopRefreshed, addTurnShopBuff, applyRunShopBuff, consumeShopMinion, addOfferBuff, castSpellOnOffer, rightmostShopMinion } from './recruit';

/**
 * THE STARFORM — set 3 Celestials' shop token (owner design 2026-09-12; rules v2 2026-09-13). Every numbered
 * rule in the design is a ruling; every ruling is a test here. Driven through the REAL `reduce` wherever an
 * action exists (the buy, `roll`, `freeze`, `activateEquipment`, the turn rollover) and through the exported
 * helpers otherwise — the card factories that call them (Star Seed, Corona Devotee, Nova Herald, Twin Star,
 * Accretion) are pinned in `set3CelestialRoster.test.ts`; this file pins the engine they stand on.
 */
const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7), setId: 'set3', phase: 'recruit', embers: 20, ...over } as RunState);
const act = (s: RunState, a: Action): RunState => reduce(s, a);
/** A run with ONE open shop slot (the first offer bought), so a created Starform starts as a plain 1/1. */
const runOpen = (over: Partial<RunState> = {}): RunState => { const s = run(over); return act(s, { type: 'buy', uid: s.shop[0]!.uid }); };
const SRC = { cardId: 'dbg_starseed', name: 'Star Seed' };
/** The first plain minion id in the run's opening row — a real, pooled shop minion for fixtures. */
const minionIdOf = (s: RunState): string => s.shop.map((o) => o.cardId).find((id) => { const d = CARD_INDEX[id]; return d && !d.spell && !d.ruby; })!;
const offer = (s: RunState, cardId: string, over: Partial<ShopCard> = {}): ShopCard => ({ uid: `s${s.uidSeq++}`, cardId, ...over });
const sfStats = (s: RunState): [number, number] => { const st = starformStats(s)!; return [st.attack, st.health]; };

// ── synthetic watchers: the content PR ships the real factories; these prove the DISPATCH paths ──────────────
// `onBattlecryBuffSelf` is a params-driven "+a/+h to self" body that ignores the payload — usable on any trigger.
const gainedWatcher: CardDef = { id: 'dbg_twinstar', name: 'Twin Star (probe)', tribe: 'celestial', tier: 2, attack: 2, health: 2, keywords: [],
  effects: [{ on: 'starformGained', do: 'onBattlecryBuffSelf', params: { attack: 1, health: 1 } }], text: '' };
const removedWatcher: CardDef = { id: 'dbg_zenith', name: 'Zenith (probe)', tribe: 'celestial', tier: 2, attack: 2, health: 2, keywords: [],
  effects: [{ on: 'starformRemoved', do: 'onBattlecryBuffSelf', params: { attack: 5, health: 5 } }], text: '' };
const buyWatcher: CardDef = { id: 'dbg_peddler', name: 'Stardust Peddler (probe)', tribe: 'celestial', tier: 2, attack: 2, health: 2, keywords: [],
  effects: [{ on: 'onBuy', do: 'onBattlecryBuffSelf', params: { attack: 3, health: 0 } }], text: '' };
const consumeWatcher: CardDef = { id: 'dbg_gorger', name: 'Consume watcher (probe)', tribe: 'demon', tier: 2, attack: 2, health: 2, keywords: [],
  effects: [{ on: 'onConsume', do: 'onBattlecryBuffSelf', params: { attack: 0, health: 7 } }], text: '' };
/** A NON-Celestial removed-watcher, for the "no Celestial on board" buy: it hears the exit but can never receive. */
const removedWatcherN: CardDef = { ...removedWatcher, id: 'dbg_zenith_n', tribe: 'neutral' };
for (const c of [gainedWatcher, removedWatcher, buyWatcher, consumeWatcher, removedWatcherN]) CARD_INDEX[c.id] = c;

describe('Starform — the token def', () => {
  it('is a 1/1 Celestial token with no rules text, out of every draw pool', () => {
    const d = CARD_INDEX[STARFORM_ID]!;
    expect(d).toMatchObject({ name: 'Starform', tribe: 'celestial', tier: 1, attack: 1, health: 1, token: true, text: '' });
    const s = run();
    expect(s.pool[STARFORM_ID], 'never stocked in the shared pool').toBeUndefined();
    for (let i = 0; i < 12; i++) { rollShop(s); expect(s.shop.some((o) => o.cardId === STARFORM_ID)).toBe(false); }
  });
});

describe('rule 1 — created into the right-most Shop slot', () => {
  it('an open slot: appended right-most as a 1/1, flagged, priced 6', () => {
    let s = run();
    s = act(s, { type: 'buy', uid: s.shop[0]!.uid }); // open a slot
    const before = s.shop.length;
    const sf = createStarform(s, SRC);
    expect(s.shop.length).toBe(before + 1);
    expect(s.shop[s.shop.length - 1]).toBe(sf);
    expect(sf).toMatchObject({ cardId: STARFORM_ID, starform: true });
    expect(sfStats(s)).toEqual([1, 1]);
    expect(sf.cost, 'spawns at 6 Gold (rule 5)').toBe(STARFORM_START_PRICE);
    expect(offerBuyPrice(s, sf).cost, 'the coin reads 6').toBe(6);
    expect(hasStarform(s)).toBe(true);
    expect(starformOf(s)).toBe(sf);
  });

  it('a full row: CONSUMES the right-most Shop minion (a real Shop consume) and takes its slot', () => {
    const s = run();
    expect(s.shop.length, 'the opening row is full').toBe(tierSlots(s.tier));
    const victimIdx = rightmostShopMinion(s);
    const victim = s.shop[victimIdx]!;
    addOfferBuff(victim, 'Fortify', 2, 3); // the eaten offer's CURRENT stats travel, not its base
    const worth = offerBuyStats(s, victim);
    const poolBefore = s.pool[victim.cardId]!;
    const sf = createStarform(s, SRC);
    expect(s.shop.length, 'no overflow — the token took the victim\'s slot').toBe(tierSlots(s.tier));
    expect(s.shop[victimIdx], 'in the victim\'s exact slot').toBe(sf);
    expect(s.shop.some((o) => o.uid === victim.uid), 'the victim left the row').toBe(false);
    expect(sfStats(s)).toEqual([1 + worth.attack, 1 + worth.health]);
    expect(sf.buffs?.find((b) => b.source === 'Consume')).toMatchObject({ attack: worth.attack, health: worth.health });
    // …and every consume tally sees it exactly as a Demon's Shop consume:
    expect(s.shopMinionsEaten, 'Bottomless Banquet\'s meter').toBe(1);
    expect(s.shopEaten?.at(-1)).toMatchObject({ uid: victim.uid, eaterUid: sf.uid, cardId: victim.cardId, gainA: worth.attack, gainH: worth.health });
    expect(s.pool[victim.cardId], 'the eaten copy returns to the shared pool').toBe(poolBefore + 1);
  });

  it('a full row: the Open Market latch + onConsume watchers fire for the creation consume', () => {
    const s = run({ board: [body('w', consumeWatcher.id)], runeOpenMarket: { attack: 1, health: 1, usedThisTurn: false } as never });
    const tavernBefore = { ...s.tavernBuyBonus };
    createStarform(s, SRC);
    expect(s.runeOpenMarket?.usedThisTurn, 'Open Market\'s first-consume latch spent').toBe(true);
    expect(s.tavernBuyBonus.atk, 'and it paid out').toBe(tavernBefore.atk + 1);
    expect(s.board[0]!.health, 'the onConsume watcher heard a Shop consume').toBe(2 + 7);
  });

  it('the right-most offer is a spell / Ruby: skips leftward to the nearest minion', () => {
    const s = run();
    const spellId = Object.values(CARD_INDEX).find((c) => c.spell && !c.ruby && c.tier <= 1)!.id;
    const minion = minionIdOf(s);
    s.shop = [offer(s, minion), offer(s, minion), offer(s, spellId)];
    const victim = s.shop[1]!;
    const sf = createStarform(s, SRC);
    expect(s.shop.map((o) => o.uid)).toEqual([s.shop[0]!.uid, sf.uid, s.shop[2]!.uid]);
    expect(s.shop.some((o) => o.uid === victim.uid)).toBe(false);
    expect(CARD_INDEX[s.shop[2]!.cardId]!.spell, 'the spell offer stayed').toBe(true);
  });

  it('a full row with no minion at all: the token still appears (appended — the one overflow case)', () => {
    const s = run();
    const spellId = Object.values(CARD_INDEX).find((c) => c.spell && !c.ruby && c.tier <= 1)!.id;
    s.shop = [offer(s, spellId), offer(s, spellId), offer(s, spellId)];
    const sf = createStarform(s, SRC);
    expect(s.shop.length).toBe(4);
    expect(s.shop[3]).toBe(sf);
    expect(s.shopMinionsEaten ?? 0, 'nothing was eaten').toBe(0);
  });

  it('arrives wearing the standing shop channels (permanent + this-turn), baked under their names', () => {
    let s = run();
    s = act(s, { type: 'buy', uid: s.shop[0]!.uid });
    applyRunShopBuff(s, 2, 2, 'Staff of Guel');
    addTurnShopBuff(s, 1, 3);
    const sf = createStarform(s, SRC);
    expect(sfStats(s)).toEqual([1 + 2 + 1, 1 + 2 + 3]);
    expect(sf.buffs?.map((b) => b.source).sort()).toEqual(['Shop Enchant', 'Staff of Guel']);
  });
});

describe('rule 2 — only one at a time', () => {
  it('a second create is a no-op that returns the existing token', () => {
    const s = runOpen();
    const first = createStarform(s, SRC);
    buffStarform(s, 4, 4, 'test');
    const again = createStarform(s, { cardId: 'x', name: 'Another' });
    expect(again).toBe(first);
    expect(s.shop.filter((o) => o.starform).length).toBe(1);
    expect(sfStats(s)).toEqual([5, 5]);
    expect(s.shopMinionsEaten ?? 0, 'no second consume (the open-slot creation ate nothing either)').toBe(0);
  });
});

describe('rule 3 — persists through refreshes in the SAME slot, across turns and combat, under Freeze', () => {
  it('a paid roll rebuilds every other offer and leaves the token at its index', () => {
    let s = runOpen();
    const sf = createStarform(s, SRC); // an open slot → appended right-most
    buffStarform(s, 3, 3, 'test');
    const idx = s.shop.indexOf(sf);
    const others = s.shop.filter((o) => !o.starform).map((o) => o.uid);
    for (let n = 0; n < 3; n++) {
      s = act(s, { type: 'roll' });
      const now = starformOf(s)!;
      expect(now.uid, 'the same token').toBe(sf.uid);
      expect(s.shop.indexOf(now), 'the same slot').toBe(idx);
      expect(s.shop.length, 'the row is exactly the tier\'s width — the token takes a slot').toBe(tierSlots(s.tier));
      expect(s.shop.filter((o) => others.includes(o.uid)), 'the others rolled away').toEqual([]);
      expect(sfStats(s), 'its stats ride along').toEqual([4, 4]);
    }
  });

  it('a Starform in a MIDDLE slot stays there while kept (Layaway) offers pull left', () => {
    const s = run();
    const minion = minionIdOf(s);
    s.tier = 3; // 4 slots
    s.shop = [offer(s, minion), offer(s, minion), offer(s, minion), offer(s, minion)];
    s.shop[3]!.kept = true; // right-most is laid away
    const sf = createStarform(s, SRC); // eats the right-most MINION: the kept one is a minion too → index 3
    // Put the token in the middle by hand (a reorder is a player action, allowed) and keep a different offer.
    s.shop = [s.shop[0]!, sf, s.shop[1]!, s.shop[2]!];
    s.shop[3]!.kept = true;
    const keptUid = s.shop[3]!.uid;
    rollShop(s);
    expect(s.shop.indexOf(starformOf(s)!), 'still index 1').toBe(1);
    expect(s.shop[0]!.uid, 'the kept offer took the LEFT slot, as Layaway does').toBe(keptUid);
    expect(s.shop.length).toBe(4);
  });

  it('a spell shop / a filtered refill / an Elevation keep the token too', () => {
    const s = runOpen();
    const sf = createStarform(s, SRC);
    buffStarform(s, 2, 2, 'test');
    rollSpellShop(s);
    expect(starformOf(s), 'survives Spell Cart').toBe(sf);
    expect(s.shop.filter((o) => !o.starform).every((o) => CARD_INDEX[o.cardId]!.spell)).toBe(true);
    rollShop(s);
    elevateShop(s);
    expect(starformOf(s), 'never elevated away').toBe(sf);
    expect(sfStats(s)).toEqual([3, 3]);
  });

  it('Freeze keeps it like any offer, and it survives the turn rollover + combat with its stats intact', () => {
    let s = runOpen(); // the bought slot is the gap the frozen top-up fills
    const sf = createStarform(s, SRC);
    buffStarform(s, 6, 6, 'test');
    s = act(s, { type: 'freeze' });
    expect(s.frozen).toBe(true);
    topUpTavern(s);
    expect(starformOf(s)?.uid).toBe(sf.uid);
    expect(s.shop.length).toBe(tierSlots(s.tier));
    // Across the fight (unfrozen: the new turn rolls a fresh row around it).
    s = act(s, { type: 'freeze' });
    const settled = act(act(s, { type: 'faceOmen' }), { type: 'settleCombat' });
    s = act(settled, { type: 'resolveCombat' });
    expect(s.phase).toBe('recruit');
    expect(starformOf(s)?.uid, 'still in the shop next turn').toBe(sf.uid);
    expect(sfStats(s)).toEqual([7, 7]);
    // …and through a save / restore.
    const back = deserialize(serialize(s));
    expect(starformOf(back)).toMatchObject({ uid: sf.uid, starform: true });
    expect(sfStats(back)).toEqual([7, 7]);
  });
});

describe('rule 4 — refresh-time right-most buffs land ONCE', () => {
  it('Market Tormentor\'s slot enchant: two refreshes, landed once', () => {
    let s = runOpen({ rightmostSlotBuff: { attack: 2, health: 2 } });
    createStarform(s, SRC); // right-most
    s = act(s, { type: 'roll' });
    expect(sfStats(s), 'the first refresh lands it').toEqual([3, 3]);
    s = act(s, { type: 'roll' });
    s = act(s, { type: 'roll' });
    expect(sfStats(s), 'never again').toEqual([3, 3]);
    expect(starformOf(s)!.refreshLanded).toContain('tormentor');
    expect(starformOf(s)!.buffs?.find((b) => b.source === 'Market Tormentor')?.count).toBe(1);
  });

  it('Rune of the Embers doubles it once; Veinstorm stamps it once', () => {
    let s = runOpen({ runeEmbers: true, ownedRunes: ['rune_embers'], veinstormRubies: { atk: 1, hp: 1 } } as Partial<RunState>);
    createStarform(s, SRC);
    buffStarform(s, 0, 3, 'test'); // 1/4
    s = act(s, { type: 'roll' });
    // Veinstorm (+1/+1 → 2/5) lands in the roll, then Embers doubles the buffed Health (+5 → 2/10).
    expect(sfStats(s)).toEqual([2, 10]);
    s = act(s, { type: 'roll' });
    expect(sfStats(s), 'neither lands again').toEqual([2, 10]);
    expect(s.shop.filter((o) => !o.starform && o.buffs?.some((b) => b.source === 'Ruby')).length, 'the fresh offers are still stamped').toBeGreaterThan(0);
  });

  it('a PLAY-time right-most buff still applies normally (only refresh re-landing is gated)', () => {
    const s = runOpen({ rightmostSlotBuff: { attack: 2, health: 2 } });
    createStarform(s, SRC);
    applyShopRefreshed(s); // latch it
    expect(sfStats(s)).toEqual([3, 3]);
    const i = rightmostShopMinion(s);
    addOfferBuff(s.shop[i]!, 'Market Tormentor', 2, 2); // the Shout's incremental buff, aimed by a play
    expect(s.shop[i]!.starform).toBe(true);
    expect(sfStats(s)).toEqual([5, 5]);
  });
});

describe('rule 5 — it has a PRICE: 6 Gold, −1 per refresh (floor 0), across turns; a new token starts at 6 again', () => {
  it('the price ladder: 6 → 5 → 4 … → 0 and no lower, over PAID and FREE refreshes alike', () => {
    let s = runOpen({ embers: 40, freeRolls: 2 });
    createStarform(s, SRC);
    expect(starformPrice(s)).toBe(6);
    const expected = [5, 4, 3, 2, 1, 0, 0, 0];
    for (const want of expected) {
      const gold = s.embers;
      s = act(s, { type: 'roll' });
      expect(starformPrice(s)).toBe(want);
      if (s.freeRolls === 1 || s.freeRolls === 0 && gold === s.embers) expect(s.embers, 'a banked free refresh still ticks the price').toBe(gold);
    }
    expect(offerBuyPrice(s, starformOf(s)!).cost, 'the coin reads the live price').toBe(0);
  });

  it('Rune of Window Shopping\'s free refreshes tick it too — ANY roll counts', () => {
    let s = runOpen({ runeWindowShopping: true, questFlags: { runeWindowShopping: 1 } } as Partial<RunState>);
    createStarform(s, SRC);
    const gold = s.embers;
    s = act(s, { type: 'roll' });
    expect(s.embers, 'free').toBe(gold);
    expect(starformPrice(s)).toBe(5);
  });

  it('the reduction SURVIVES the turn boundary and a save / restore: a 3-Gold Starform is 3 Gold next turn', () => {
    let s = runOpen();
    createStarform(s, SRC);
    for (let i = 0; i < 3; i++) s = act(s, { type: 'roll' });
    expect(starformPrice(s)).toBe(3);
    const settled = act(act(s, { type: 'faceOmen' }), { type: 'settleCombat' });
    s = act(settled, { type: 'resolveCombat' });
    expect(s.phase).toBe('recruit');
    expect(starformPrice(s), 'the new turn\'s opening roll is not a refresh').toBe(3);
    expect(starformPrice(deserialize(serialize(s)))).toBe(3);
  });

  it('a NEW token starts at 6 again — after the old one left, and after a Zenith-style re-creation', () => {
    let s = runOpen();
    createStarform(s, SRC);
    s = act(s, { type: 'roll' });
    s = act(s, { type: 'roll' });
    expect(starformPrice(s)).toBe(4);
    collapseStarform(s);
    expect(hasStarform(s)).toBe(false);
    createStarform(s, SRC);
    expect(starformPrice(s), 'fresh token, fresh price').toBe(6);
    // A legacy save whose token predates the price field heals to 6, never to the flat minion cost.
    const legacy = serialize(s).replace(/"cost":6/g, '"cost":99');
    const back = deserialize(legacy);
    back.shop.forEach((o) => { if (o.starform) delete o.cost; });
    expect(starformPrice(deserialize(serialize(back)))).toBe(6);
  });

  it('the price helper takes EVERY regular discount like any minion — Cadence, Trade-In, the Gift, the Thymepiece window, the free first buy — and the buy charges exactly the coin', () => {
    const cases: Partial<RunState>[] = [
      { runeCadence: true, cadenceMinionOff: 1, questFlags: { runeCadence: 1 } } as Partial<RunState>,
      { runeTradeIn: true, tradeInTribe: 'celestial', questFlags: { runeTradeIn: 1 } } as Partial<RunState>,
      { minionCostOffTurn: 2 },
      { cardDiscountWindow: { amount: 1, untilClock: null } } as Partial<RunState>,
      { questFreeFirstBuy: true },
      { runeCadence: true, cadenceMinionOff: 1, questFlags: { runeCadence: 1 }, minionCostOffTurn: 2, cardDiscountWindow: { amount: 1, untilClock: null } } as Partial<RunState>,
    ];
    const wants = [5, 5, 4, 5, 0, 2];
    cases.forEach((over, i) => {
      let s = run({ ...over, board: [body('c', 'ce3_courier')] }); // a full row: the create eats the right-most (no buy spends a discount first)
      const sf = createStarform(s, SRC);
      const price = offerBuyPrice(s, sf);
      expect(price.cost, JSON.stringify(over)).toBe(wants[i]);
      const gold = s.embers;
      s = act(s, { type: 'buy', uid: sf.uid });
      expect(gold - s.embers, 'charged exactly the coin').toBe(wants[i]);
      expect(hasStarform(s)).toBe(false);
    });
    // The Spirit discount never applies (the token is no Spirit); a set minion-cost override is NOT the token's price.
    const s = runOpen({ spiritDiscount: 3, minionCostOverride: 1 } as Partial<RunState>);
    expect(offerBuyPrice(s, createStarform(s, SRC))).toMatchObject({ cost: 6, spiritOff: 0 });
  });

  it('too poor for the live price → the buy is refused, the token stays', () => {
    let s = runOpen({ embers: 2, board: [body('c', 'ce3_courier')] });
    const sf = createStarform(s, SRC);
    const before = s;
    s = act(s, { type: 'buy', uid: sf.uid });
    expect(s).toBe(before);
    expect(hasStarform(s)).toBe(true);
  });
});

describe('rule 5 — BUYING it = your LEFT-MOST Celestial consumes it (full stats); no Celestial → the token is lost; still a buy', () => {
  it('the left-most board Celestial (index 0 first) gains the token\'s FULL stats under the Starform ledger line; nothing enters the hand; the Gold is spent', () => {
    let s = runOpen({ board: [body('n', 'sandbag'), body('c1', 'ce3_courier'), body('c2', 'ce3_vendor'), body('p', buyWatcher.id)] });
    const sf = createStarform(s, SRC);
    buffStarform(s, 4, 6, 'test'); // 5/7
    const gold = s.embers, hand = s.hand.length, pool = { ...s.pool };
    s = act(s, { type: 'buy', uid: sf.uid });
    expect(hasStarform(s)).toBe(false);
    expect(gold - s.embers, '6 Gold').toBe(6);
    expect(s.hand.length, 'nothing entered the hand').toBe(hand);
    expect(s.pool, 'nothing returned').toEqual(pool);
    const c1 = s.board.find((c) => c.uid === 'c1')!, c2 = s.board.find((c) => c.uid === 'c2')!;
    expect([c1.attack, c1.health], 'the LEFT-most Celestial — the sandbag at index 0 is skipped').toEqual([1 + 5, 1 + 7]);
    expect(c1.buffs?.find((b) => b.source === 'Starform')).toMatchObject({ attack: 5, health: 7 });
    expect([c2.attack, c2.health], 'the second Celestial gets nothing').toEqual([2, 4]);
    expect(s.board[0]!.attack, 'the non-Celestial is untouched').toBe(0);
    expect(s.cardsBoughtThisTurn, 'counted as a minion bought (the opening buy + this one)').toBe(2);
    expect(s.board[3]!.attack, 'the onBuy watcher heard it (twice: the opening buy + this one)').toBe(2 + 3 + 3);
  });

  it('with ONE Celestial it is that one; with THREE it is still only the left-most', () => {
    let one = runOpen({ board: [body('c', 'ce3_courier')] });
    buffStarform(one, 2, 2, 'test'); createStarform(one, SRC); buffStarform(one, 2, 2, 'test');
    one = act(one, { type: 'buy', uid: starformOf(one)!.uid });
    expect([one.board[0]!.attack, one.board[0]!.health]).toEqual([1 + 3, 1 + 3]);
    let three = runOpen({ board: [body('a', 'ce3_courier'), body('b', 'ce3_vendor'), body('c', 'ce3_seer')] }); // three DIFFERENT Celestials (three of a kind would triple)
    createStarform(three, SRC); buffStarform(three, 9, 9, 'test');
    three = act(three, { type: 'buy', uid: starformOf(three)!.uid });
    expect(three.board.map((c) => c.attack)).toEqual([11, 2, 3]);
  });

  it('NO Celestial on board: the Gold is still taken, the token is lost (stats go nowhere), and the watcher hears reason consume — so a Zenith still re-creates', () => {
    let s = runOpen({ board: [body('n', 'sandbag'), body('z', removedWatcherN.id)] });
    const sf = createStarform(s, SRC);
    buffStarform(s, 4, 4, 'test');
    const gold = s.embers;
    s = act(s, { type: 'buy', uid: sf.uid });
    expect(hasStarform(s)).toBe(false);
    expect(gold - s.embers, 'no refund').toBe(6);
    expect(s.board.map((c) => c.attack), 'nobody gained the stats; the (neutral) removed-watcher fired').toEqual([0, 2 + 5]);
    expect(s.starformFx ?? [], 'no pull — there was no receiver').toEqual([]);
    expect(s.hand.length, "only the opening buy's card").toBe(1);
    expect(s.cardsBoughtThisTurn).toBe(2);
  });

  it('the buy fires starformRemoved(consume) and a `consumed` pull from the token to the receiver; it cannot triple', () => {
    let s = runOpen({ board: [body('z', removedWatcher.id), body('c', 'ce3_courier')] });
    const sf = createStarform(s, SRC);
    s = act(s, { type: 'buy', uid: sf.uid });
    expect(s.board[0]!.attack, 'starformRemoved fired (+5) AND it received the 1/1 token as the left-most Celestial').toBe(2 + 5 + 1);
    expect(s.starformFx).toEqual([{ kind: 'consumed', fromUid: sf.uid, toUids: ['z'] }]); // the watcher IS the left-most Celestial
    expect(s.hand.length, "only the opening buy's card — the token never enters the hand").toBe(1);
  });

  it('is never gilded (Golden Touch skips it every time) and never held', () => {
    let s = run({ hand: [body('g1', 'goldentouch'), body('g2', 'goldentouch'), body('g3', 'goldentouch')] });
    const sf = createStarform(s, SRC);
    for (const uid of ['g1', 'g2', 'g3']) s = act(s, { type: 'play', uid, toIndex: 0 });
    expect(starformOf(s)!.golden, 'three gilds, none on the token').toBeUndefined();
    expect(s.shop.filter((o) => !o.starform).every((o) => o.golden), 'every OTHER offer got gilded').toBe(true);
    expect(starformOf(s)!.uid).toBe(sf.uid);
    expect(sf.held, 'never held').toBeUndefined();
  });

  it('a Demon CAN eat it (it counts as a regular Shop minion) — and the watcher hears reason consume', () => {
    const s = runOpen({ board: [body('d', 'ce3_courier'), body('z', removedWatcher.id)] });
    createStarform(s, SRC);
    buffStarform(s, 4, 4, 'test'); // 5/5
    const eater = s.board[0]!;
    expect(consumeShopMinion(s, eater, rightmostShopMinion(s))).toBe(true);
    expect(hasStarform(s)).toBe(false);
    expect([eater.attack, eater.health]).toEqual([1 + 5, 1 + 5]);
    expect(s.board[1]!.attack, 'starformRemoved(consume)').toBe(2 + 5);
    expect(holdsEquipment(s, STAR_DESTROYER.id), 'the Star Destroyer left with it').toBe(false);
  });
});

describe('rule 9 — STAR DESTROYER: a standard Equipment sourced by the token, held exactly while a Starform exists; its use is the silent exit', () => {
  it('exists iff a Starform exists: granted on create, dropped on every exit, re-granted on the next create and on the turn rebuild', () => {
    let s = runOpen({ board: [body('c', 'ce3_courier')] });
    expect(holdsEquipment(s, STAR_DESTROYER.id)).toBe(false);
    const sf = createStarform(s, SRC);
    expect(holdsEquipment(s, STAR_DESTROYER.id)).toBe(true);
    const g = equipmentState(s).available.find((x) => x.equipmentId === STAR_DESTROYER.id)!;
    expect(g).toMatchObject({ version: 'plain', sourceKind: 'starform', sourceUids: [sf.uid], ownChargeSpent: false });
    expect(equipmentState(s).selectedEquipmentId, 'auto-selected with nothing else held').toBe(STAR_DESTROYER.id);
    expect(equipmentCostOf(s, STAR_DESTROYER), 'costs 0').toBe(0);
    expect(equipmentChargesOf(s, STAR_DESTROYER.id), 'its own once-per-turn charge').toBe(1);
    // Every exit drops it.
    let a = act(s, { type: 'buy', uid: sf.uid });
    expect(holdsEquipment(a, STAR_DESTROYER.id), 'gone after the buy-consume').toBe(false);
    const b = runOpen(); createStarform(b, SRC); collapseStarform(b);
    expect(holdsEquipment(b, STAR_DESTROYER.id), 'gone after a collapse').toBe(false);
    const c = runOpen(); createStarform(c, SRC); consumeStarform(c, body('x', 'ce3_courier'));
    expect(holdsEquipment(c, STAR_DESTROYER.id), 'gone after a consume').toBe(false);
    // Re-granted by the next create, with a fresh charge; and by the Start-of-Turn rebuild while the token survives.
    const sf2 = createStarform(a, SRC);
    expect(equipmentState(a).available.find((x) => x.equipmentId === STAR_DESTROYER.id)?.sourceUids).toEqual([sf2.uid]);
    const settled = act(act(a, { type: 'faceOmen' }), { type: 'settleCombat' });
    a = act(settled, { type: 'resolveCombat' });
    expect(hasStarform(a)).toBe(true);
    expect(holdsEquipment(a, STAR_DESTROYER.id), 'rebuilt with the turn').toBe(true);
    expect(equipmentChargesOf(a, STAR_DESTROYER.id)).toBe(1);
  });

  it('activation is THE SILENT EXIT: the token leaves the Shop and nothing else happens — no watcher, no gain, no pull, not a buy, no Gold, no Zenith rebirth', () => {
    let s = runOpen({ board: [body('z', removedWatcher.id), body('t', gainedWatcher.id), body('p', buyWatcher.id)] });
    const sf = createStarform(s, SRC);
    buffStarform(s, 5, 5, 'test');
    const board = s.board.map((c) => [c.attack, c.health]);
    const gold = s.embers, seq = s.starformFxSeq, bought = s.cardsBoughtThisTurn ?? 0, len = s.shop.length;
    selectEquipment(s, STAR_DESTROYER.id);
    s = act(s, { type: 'activateEquipment' });
    expect(hasStarform(s)).toBe(false);
    expect(s.shop.some((o) => o.uid === sf.uid)).toBe(false);
    expect(s.shop.length, 'only the token left the row').toBe(len - 1);
    expect(s.board.map((c) => [c.attack, c.health]), 'starformRemoved / starformGained / onBuy all stayed quiet').toEqual(board);
    expect(s.embers, 'free').toBe(gold);
    expect(s.starformFx ?? []).toEqual([]);
    expect(s.starformFxSeq).toBe(seq);
    expect(s.cardsBoughtThisTurn ?? 0).toBe(bought);
    expect(holdsEquipment(s, STAR_DESTROYER.id), 'the Equipment left with the token').toBe(false);
    expect(s.equipFx?.some((f) => f.kind === 'use' && f.equipmentId === STAR_DESTROYER.id), 'only the Equipment\'s own use cue').toBe(true);
  });

  it('spends its OWN charge: a second activation the same turn is refused; the shared bonus pool is drawn first like any Equipment', () => {
    let s = runOpen();
    createStarform(s, SRC);
    selectEquipment(s, STAR_DESTROYER.id);
    s = act(s, { type: 'activateEquipment' });
    expect(hasStarform(s)).toBe(false);
    createStarform(s, SRC); // a brand-new token → a brand-new entry with a fresh charge (the old entry was dropped)
    expect(equipmentChargesOf(s, STAR_DESTROYER.id)).toBe(1);
    // Within one token's life the charge is one per turn: drain it through the helper, then the action refuses.
    const t = runOpen();
    createStarform(t, SRC);
    selectEquipment(t, STAR_DESTROYER.id);
    t.equipment!.available.find((g) => g.equipmentId === STAR_DESTROYER.id)!.ownChargeSpent = true;
    expect(equipmentChargesOf(t, STAR_DESTROYER.id)).toBe(0);
    expect(act(t, { type: 'activateEquipment' }), 'refused — no charge').toBe(t);
    expect(hasStarform(t)).toBe(true);
    t.equipment!.bonusActivations = 1; // Equipment Charger's pool
    expect(equipmentChargesOf(t, STAR_DESTROYER.id)).toBe(1);
    const u = act(t, { type: 'activateEquipment' });
    expect(hasStarform(u)).toBe(false);
  });

  it('destroyStarform directly: false with no token; true removes it and drops the Equipment', () => {
    const s = runOpen();
    expect(destroyStarform(s)).toBe(false);
    createStarform(s, SRC);
    expect(destroyStarform(s)).toBe(true);
    expect(hasStarform(s)).toBe(false);
    expect(holdsEquipment(s, STAR_DESTROYER.id)).toBe(false);
  });
});

describe('rule 6 — printed stats are the counter; every shop buff bakes onto the offer', () => {
  it('Apples\' "this shop" branch → refresh → the Starform keeps it, the new offers do not', () => {
    let s = runOpen();
    const sf = createStarform(s, SRC);
    for (const o of s.shop) addOfferBuff(o, 'Apples', 2, 4); // the spell's branch, verbatim
    expect(sfStats(s)).toEqual([3, 5]);
    s = act(s, { type: 'roll' });
    expect(sfStats(s)).toEqual([3, 5]);
    expect(starformOf(s)!.uid).toBe(sf.uid);
    for (const o of s.shop.filter((o) => !o.starform)) expect(o.buffs?.some((b) => b.source === 'Apples') ?? false).toBe(false);
  });

  it('a this-turn shop buff (Wishing Star shape) is banked on the token and survives the rollover that clears it', () => {
    let s = runOpen();
    createStarform(s, SRC);
    addTurnShopBuff(s, 3, 3);
    expect(s.tavernBuyBonusTurn).toEqual({ atk: 3, hp: 3 });
    expect(sfStats(s), 'baked, not read live (no double count)').toEqual([4, 4]);
    s = act(s, { type: 'roll' });
    expect(sfStats(s)).toEqual([4, 4]);
    const settled = act(act(s, { type: 'faceOmen' }), { type: 'settleCombat' });
    s = act(settled, { type: 'resolveCombat' });
    expect(s.tavernBuyBonusTurn, 'the channel cleared for everyone else').toBeUndefined();
    expect(sfStats(s), '…the Starform kept it').toEqual([4, 4]);
  });

  it('a permanent shop buff lands on it once, under its source name, and the live channel is NOT re-read', () => {
    const s = runOpen();
    const sf = createStarform(s, SRC);
    applyRunShopBuff(s, 2, 1, 'Contract Butcher');
    expect(sfStats(s)).toEqual([3, 2]);
    expect(sf.buffs?.find((b) => b.source === 'Contract Butcher')).toMatchObject({ attack: 2, health: 1 });
    expect(offerBuyStats(s, sf), 'offerBuyStats agrees with the printed counter').toEqual({ attack: 3, health: 2 });
  });

  it('a spell cast on the offer folds only its stat delta in — a transform never rewrites the token', () => {
    const s = run();
    const sf = createStarform(s, SRC);
    const fortify = Object.values(CARD_INDEX).find((c) => c.spell && c.effects.some((e) => e.do === 'spellBuffTarget'))!;
    castSpellOnOffer(s, fortify, sf);
    expect(sf.cardId).toBe(STARFORM_ID);
    const st = starformStats(s)!;
    expect(st.attack + st.health).toBeGreaterThan(2);
  });
});

describe('rule 7 — consume = 100% to one; collapse = 50% to 2 unique + extras (with replacement), rounded up; base included', () => {
  it('consumeStarform removes the token and returns its FULL stats (base 1/1 included)', () => {
    const s = runOpen({ board: [body('c', 'ce3_courier'), body('z', removedWatcher.id)] });
    createStarform(s, SRC);
    buffStarform(s, 6, 9, 'test'); // 7/10
    expect(consumeStarform(s, s.board[0]!)).toEqual({ attack: 7, health: 10 });
    expect(hasStarform(s)).toBe(false);
    expect(s.board[1]!.attack, 'starformRemoved(consume)').toBe(2 + 5);
  });

  it('collapseStarform returns the halves rounded UP', () => {
    const s = runOpen();
    createStarform(s, SRC);
    buffStarform(s, 6, 9, 'test'); // 7/10 → 4/5
    expect(collapseStarform(s)).toEqual({ attack: 4, health: 5 });
    expect(hasStarform(s)).toBe(false);
  });

  it('with no Starform, both do nothing', () => {
    const s = run();
    expect(consumeStarform(s, body('c', 'ce3_courier'))).toBeNull();
    expect(collapseStarform(s)).toBeNull();
    expect(starformStats(s)).toBeNull();
  });

  it('collapseHits: 2 UNIQUE originals, then the extras WITH replacement; fewer Celestials → fewer originals; none → empty', () => {
    const cel = (uid: string) => body(uid, 'ce3_courier');
    const s = run({ board: [cel('a'), cel('b'), cel('c'), body('n', 'sandbag')] });
    for (let seed = 0; seed < 20; seed++) {
      s.rngCursor = seed;
      const two = collapseHits(s, 2, 0);
      expect(two).toHaveLength(2);
      expect(new Set(two.map((c) => c.uid)).size, 'unique').toBe(2);
      expect(two.some((c) => c.uid === 'n'), 'never a non-Celestial').toBe(false);
    }
    // Extras may repeat: over many seeds, at least one draw of 2 + 3 extras lands 3 on a single body.
    let tripled = false;
    for (let seed = 0; seed < 60 && !tripled; seed++) {
      s.rngCursor = seed;
      const hits = collapseHits(s, 2, 3);
      expect(hits).toHaveLength(5);
      const counts = new Map<string, number>();
      for (const h of hits) counts.set(h.uid, (counts.get(h.uid) ?? 0) + 1);
      if ([...counts.values()].some((n) => n >= 3)) tripled = true;
    }
    expect(tripled, 'replacement lets one Celestial take three').toBe(true);
    const one = run({ board: [cel('a'), body('n', 'sandbag')] });
    expect(collapseHits(one, 2, 2).map((c) => c.uid), '1 original + every extra on it').toEqual(['a', 'a', 'a']);
    const none = run({ board: [body('n', 'sandbag')] });
    expect(collapseHits(none, 2, 4)).toEqual([]);
    // The run-wide counter feeds the default extras.
    const wide = run({ board: [cel('a')], collapseExtraTargets: 3 } as Partial<RunState>);
    expect(collapseHits(wide)).toHaveLength(4);
  });
});

describe('rule 8 — the watcher triggers', () => {
  it('starformGained fires from buffStarform, from the Starform\'s own consume (Accretion), and from any other growth path — once each', () => {
    let s = run({ board: [body('t', gainedWatcher.id)] });
    s = act(s, { type: 'buy', uid: s.shop[0]!.uid }); // an open slot: creation itself gains nothing
    createStarform(s, SRC);
    expect(s.board[0]!.attack, 'creation into an open slot: no gain').toBe(2);
    buffStarform(s, 1, 1, 'test');
    expect(s.board[0]!.attack, 'buffStarform → +1').toBe(3);
    expect(starformConsumeShopMinion(s, 0), 'the token eats offer 0').toBe(true);
    expect(s.board[0]!.attack, 'a consume is a gain → +1').toBe(4);
    expect(s.shopMinionsEaten, 'and a real Shop consume').toBe(1);
    // A growth path that never calls buffStarform — Apples' banked next-shop buff, folded onto every offer by
    // `refreshTavern` — is caught by the action-boundary diff in `reduce`, exactly once.
    s = act(s, { type: 'roll' }); // a clean action boundary first (the probe stays at 4)
    expect(s.board[0]!.attack).toBe(4);
    s.nextShopBuff = { attack: 2, health: 4 };
    const before = sfStats(s);
    s = act(s, { type: 'roll' });
    expect(sfStats(s)).toEqual([before[0] + 2, before[1] + 4]);
    expect(s.board[0]!.attack, 'the boundary diff fired it once').toBe(5);
  });

  it('starformGained does not fire on a refresh that grows nothing, and the remainder diff never double-counts a booked gain', () => {
    let s = run({ board: [body('t', gainedWatcher.id)], rightmostSlotBuff: { attack: 1, health: 1 } });
    createStarform(s, SRC); // creation eats the right-most: one gain
    expect(s.board[0]!.attack).toBe(3);
    s = act(s, { type: 'roll' }); // Market Tormentor lands ONCE (a boundary-diff gain)
    expect(s.board[0]!.attack).toBe(4);
    s = act(s, { type: 'roll' });
    s = act(s, { type: 'roll' });
    expect(s.board[0]!.attack, 'nothing grew → nothing fired').toBe(4);
  });

  it('starformRemoved carries the reason for every exit that IS an exit — consume, collapse, the buy — and never for the Star Destroyer', () => {
    for (const exit of ['consume', 'collapse', 'buy', 'destroy'] as const) {
      let s = run({ board: [body('z', removedWatcher.id)] });
      const sf = createStarform(s, SRC);
      if (exit === 'consume') consumeStarform(s, s.board[0]!);
      else if (exit === 'collapse') collapseStarform(s);
      else if (exit === 'buy') s = act(s, { type: 'buy', uid: sf.uid });
      else destroyStarform(s);
      // The buy also hands the token's stats to the watcher (it is the left-most Celestial) — at least +1.
      if (exit === 'buy') expect(s.board[0]!.attack, 'buy').toBeGreaterThanOrEqual(2 + 5 + 1);
      else expect(s.board[0]!.attack, `${exit}`).toBe(exit === 'destroy' ? 2 : 2 + 5);
      expect(hasStarform(s)).toBe(false);
    }
  });
});
