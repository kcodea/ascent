/**
 * ANCIENTS × PETE (owner pairings 2026-11-10). Contrabanana (passive): "Every third refresh, the right-most Shop minion is
 * from the tier above your Shop tier." A Contrabanana minion is that offer (`ShopCard.banana`, Ancients runs only).
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import {
  ANCIENT_IDS, ANCIENT_REFRESH_AVENGE_FLAG, ancientAvengeCountdown, ancientCombatMods, ancientContrabandEvery, ancientOfferText, createRun, enableAncients,
  heroPowerArmed, heroPowerText, poolOf, reduce, type AncientId, type BoardCard, type RunState, type ShopCard,
} from './index';
import { defIsTribe, destroyMinionInShop, dominantBoardTribe, makeContext } from './recruit';

const BASE = 'Every third refresh, the right-most Shop minion is from the tier above your Shop tier.';
const N = (i: number) => ['beatboxer', 'dw_edward', 'attachmentconductor', 'sandbag'][i % 4]!;
const KEYS = ['T', 'DS', 'R', 'W', 'CR', 'V', 'ST', 'EG'];

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const base = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, 'pete'), phase: 'recruit', embers: 40, heroReady: true, hand: [], board: [], spell: null, tier: 2, ...over } as RunState);
const picked = (id: AncientId, over: Partial<RunState> = {}): RunState => {
  let s = enableAncients(base(over));
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  s = reduce(s, { type: 'pickAncient', id });
  expect(s.ancients!.picked).toBe(id);
  return s;
};
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const bananas = (s: RunState): ShopCard[] => s.shop.filter((o) => o.banana);
const minionOffers = (s: RunState): ShopCard[] => s.shop.filter((o) => { const d = CARD_INDEX[o.cardId]; return !!d && !d.spell && !d.ruby && !o.starform; });
/** One Refresh away from a Contrabanana (the 3rd refresh, or the 2nd under Time). */
const primed = (s: RunState): RunState => ({ ...s, refreshCount: ancientContrabandEvery(s) - 1 });

describe('Pete × every Ancient has a written pairing', () => {
  it('all six are written, with no em dash and none of the banned words', () => {
    for (const id of ANCIENT_IDS) {
      const t = ancientOfferText('pete', id);
      expect(t).not.toBe('Not written yet.');
      expect(t).not.toMatch(/—|--|[Oo]ath|climb/);
    }
  });
  it('the Contrabanana mark is stamped on an Ancients run only', () => {
    const plain = reduce(primed(base()), { type: 'roll' });
    expect(plain.shop.some((o) => o.contraband)).toBe(true);
    expect(plain.shop.some((o) => o.banana)).toBe(false);
    const anc = reduce(primed(picked('fortune')), { type: 'roll' });
    expect(bananas(anc).length).toBe(1);
    expect(CARD_INDEX[bananas(anc)[0]!.cardId]!.tier).toBe(3);
  });
});

describe('Pete × DEATH: "Avenge (3): gain a free Refresh."', () => {
  it('Shop: the 3rd friendly death banks a free Refresh', () => {
    let s = picked('death', { board: [card('d', N(0))] });
    expect(heroPowerText(s)).toBe(`${BASE} **Avenge (3):** gain a free Refresh (**3** more to go). Free Refreshes banked: **0**.`);
    s = structuredClone({ ...s, ancients: { ...s.ancients!, tradesDeaths: 2 } });
    destroyMinionInShop(makeContext(s), at(s, 'd'));
    expect(s.freeRolls).toBe(1);
    expect(s.ancients!.tradesDeaths).toBe(0);
  });
  it('combat: the carried count fires mid-fight and the free Refresh comes home', () => {
    let s = picked('death', { board: [card('a', N(0), { attack: 1, health: 1 })] });
    s = { ...s, ancients: { ...s.ancients!, tradesDeaths: 2 } };
    expect(ancientCombatMods(s).ancientRefreshAvenge).toEqual({ every: 3, tick: 2, flag: ANCIENT_REFRESH_AVENGE_FLAG, label: 'Ancient of Death' });
    expect(ancientAvengeCountdown(s)).toBe(1);
    const free = s.freeRolls ?? 0;
    s = reduce({ ...s, servedBoards: { [s.wave]: { v: 1, wave: s.wave, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: 1000, minions: [{ cardId: 'sandbag', attack: 100, health: 1000, keywords: [] }], seed: 1, origin: 'self' } } }, { type: 'faceOmen' });
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.freeRolls).toBe(free + 1);
  });
});

describe('Pete × FORTUNE: "Buying a Contrabanana minion gives a free Refresh."', () => {
  it('buying the Contrabanana minion banks a free Refresh; another minion does not', () => {
    let s = reduce(primed(picked('fortune')), { type: 'roll' });
    expect(heroPowerText(s)).toBe(`${BASE} Buying that minion gives a free Refresh. Free Refreshes banked: **0**.`);
    const banana = bananas(s)[0]!;
    const other = minionOffers(s).find((o) => !o.banana)!;
    const t = reduce(s, { type: 'buy', uid: other.uid });
    expect(t.hand.length).toBe(1);
    expect(t.freeRolls ?? 0).toBe(0);
    s = reduce(s, { type: 'buy', uid: banana.uid });
    expect(s.hand.length).toBe(1);
    expect(s.freeRolls).toBe(1);
    expect(heroPowerText(s)).toContain('Free Refreshes banked: **1**.');
  });
  it('without Fortune the buy banks nothing', () => {
    let s = reduce(primed(picked('time')), { type: 'roll' });
    s = reduce(s, { type: 'buy', uid: bananas(s)[0]!.uid });
    expect(s.freeRolls ?? 0).toBe(0);
  });
});

describe('Pete × WAR: "Contrabanana minions gain a random keyword."', () => {
  it('the Contrabanana offer gains one keyword it lacks, and the bought minion keeps it', () => {
    for (let seed = 1; seed <= 10; seed++) {
      let s = reduce({ ...primed(picked('war')), rngCursor: seed * 7919 }, { type: 'roll' });
      const banana = bananas(s)[0]!;
      const printed = CARD_INDEX[banana.cardId]!.keywords;
      expect(banana.keywords?.length).toBe(1);
      expect(KEYS).toContain(banana.keywords![0]);
      expect(printed).not.toContain(banana.keywords![0]);
      s = reduce(s, { type: 'buy', uid: banana.uid });
      expect(s.hand[0]!.keywords).toContain(banana.keywords![0]);
    }
  });
  it('without War it gains nothing', () => {
    const s = reduce(primed(picked('fortune')), { type: 'roll' });
    expect(bananas(s)[0]!.keywords ?? []).toEqual([]);
  });
});

describe('Pete × GENESIS: "Contrabanana upgrades your 2 right-most Shop minions."', () => {
  it('the two right-most minion offers are both from the tier above', () => {
    const s0 = primed(picked('genesis'));
    expect(heroPowerText(s0)).toBe('Every third refresh, your **2** right-most Shop minions are from the tier above your Shop tier (**1** more to go).');
    const s = reduce(s0, { type: 'roll' });
    const row = minionOffers(s);
    expect(bananas(s).length).toBe(2);
    expect(row.slice(-2).every((o) => o.banana && CARD_INDEX[o.cardId]!.tier === 3)).toBe(true);
    expect(row.slice(0, -2).every((o) => !o.banana)).toBe(true);
  });
});

describe('Pete × TIME: "Contrabanana triggers every 2 Refreshes."', () => {
  it('every second Refresh upgrades the right-most minion', () => {
    let s: RunState = { ...picked('time'), refreshCount: 0 };
    expect(heroPowerText(s)).toBe('Every second refresh, the right-most Shop minion is from the tier above your Shop tier (**2** more to go).');
    expect(heroPowerArmed(s), 'the armed glow follows the live cadence').toBe(false);
    s = reduce(s, { type: 'roll' });
    expect(bananas(s).length).toBe(0);
    expect(heroPowerText(s)).toContain('(**1** more to go)');
    expect(heroPowerArmed(s), 'the next Refresh is the second one').toBe(true);
    s = reduce(s, { type: 'roll' });
    expect(bananas(s).length).toBe(1);
    s = reduce(s, { type: 'roll' });
    expect(bananas(s).length).toBe(0);
    s = reduce(s, { type: 'roll' });
    expect(bananas(s).length).toBe(1);
  });
  it('a plain Pete still needs three', () => {
    let s: RunState = { ...picked('fortune'), refreshCount: 0 };
    s = reduce(reduce(s, { type: 'roll' }), { type: 'roll' });
    expect(bananas(s).length).toBe(0);
    s = reduce(s, { type: 'roll' });
    expect(bananas(s).length).toBe(1);
  });
});

describe('Pete × BONDS: "Contrabanana minions are of your most common type."', () => {
  it('the Contrabanana minion is drawn from your most common type', () => {
    const probe = base();
    const tribe = probe.tribes.find((t) => poolOf(probe).buyable.some((c) => !c.spell && !c.ruby && c.tier === 3 && defIsTribe(c, t, probe))
      && poolOf(probe).buyable.some((c) => !c.spell && !c.ruby && c.tier <= 2 && c.tribe === t && !c.tribe2))!;
    const body = poolOf(probe).buyable.find((c) => !c.spell && !c.ruby && c.tier <= 2 && c.tribe === tribe && !c.tribe2)!.id;
    for (let seed = 1; seed <= 10; seed++) {
      const s0 = { ...primed(picked('bonds', { board: [card('a', body), card('b', body)] })), rngCursor: seed * 7919 };
      expect(dominantBoardTribe(s0)).toBe(tribe);
      expect(heroPowerText(s0)).toBe(`${BASE} It is of your most common type (**${tribe.charAt(0).toUpperCase()}${tribe.slice(1)}**).`);
      const s = reduce(s0, { type: 'roll' });
      const banana = bananas(s)[0]!;
      expect(CARD_INDEX[banana.cardId]!.tier).toBe(3);
      expect(defIsTribe(CARD_INDEX[banana.cardId], tribe, s)).toBe(true);
    }
  });
  it('an empty board (no type) is the ordinary Contrabanana', () => {
    const s = reduce(primed(picked('bonds')), { type: 'roll' });
    expect(bananas(s).length).toBe(1);
  });
});

describe('Pete × save / restore and determinism', () => {
  it('the same seed upgrades to the same minion with the same keyword, across a JSON round trip', () => {
    const mk = (): RunState => ({ ...primed(picked('war')), rngCursor: 99991 });
    const a = reduce(mk(), { type: 'roll' });
    const b = reduce(JSON.parse(JSON.stringify(mk())) as RunState, { type: 'roll' });
    expect(b.shop).toEqual(a.shop);
    expect(b.rngCursor).toBe(a.rngCursor);
    const back = JSON.parse(JSON.stringify(a)) as RunState;
    expect(bananas(back)[0]!.keywords).toEqual(bananas(a)[0]!.keywords);
  });
});
