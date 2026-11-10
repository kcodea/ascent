/**
 * ANCIENTS × EMERALD WARDEN (owner pairings 2026-11-10). Vanguard (passive): "When you tier up, get a random minion from
 * the new tier." Every pairing in the phase(s) it fires in. War / Genesis / Bonds turn Vanguard into a button from Shop
 * tier 6 (and only then).
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import {
  ANCIENT_IDS, activePowers, ancientAvengeCountdown, ancientCombatMods, ancientOfferText, createRun, enableAncients, heroPowerText, offerBuyPrice, reduce,
  type AncientId, type BoardCard, type BoardSnapshot, type RunState,
} from './index';
import { destroyMinionInShop, makeContext } from './recruit';
import { poolOf } from './cardPool';

const BASE = 'When you tier up, get a random minion from the new tier.';

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const base = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, 'emeraldwarden'), phase: 'recruit', tier: 3, embers: 40, heroReady: true, hand: [], board: [], shop: [], spell: null, ...over } as RunState);
const picked = (id: AncientId, over: Partial<RunState> = {}): RunState => {
  let s = enableAncients(base(over));
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  s = reduce(s, { type: 'pickAncient', id });
  expect(s.ancients!.picked).toBe(id);
  return s;
};
const foes = (wave: number, attack: number, health: number): BoardSnapshot => ({
  v: 1, wave, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: health,
  minions: [{ cardId: 'sandbag', attack, health, keywords: [] }], seed: 1, origin: 'self',
});
const fightNow = (s: RunState, attack = 0, health = 400): RunState => reduce({ ...s, servedBoards: { [s.wave]: foes(s.wave, attack, health) } }, { type: 'faceOmen' });
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const tierIds = (s: RunState): string[] => poolOf(s).buyable.filter((c) => !c.spell && !c.ruby && c.tier === s.tier).map((c) => c.id);
const minionOfTier = (s: RunState, tier: number): string => poolOf(s).buyable.find((c) => !c.spell && !c.ruby && c.tier === tier)!.id;
const mechs = (): BoardCard[] => [card('m1', 'beatboxer', { attack: 1, health: 1 }), card('m2', 'beatboxer', { attack: 1, health: 1 }), card('dw', 'dw_brakka', { attack: 1, health: 1 })];

describe('Emerald Warden × every Ancient has a written pairing', () => {
  it('all six are written (no "Not written yet."), and none uses an em dash', () => {
    for (const id of ANCIENT_IDS) {
      expect(ancientOfferText('emeraldwarden', id)).not.toBe('Not written yet.');
      expect(ancientOfferText('emeraldwarden', id)).not.toMatch(/—|--/);
    }
  });
});

describe('Emerald Warden × DEATH: "Avenge (6): get a random minion of your Tier."', () => {
  it('Shop: the 6th friendly Shop death gets a random minion of your Shop tier', () => {
    let s = picked('death', { board: [card('d', 'sandbag')] });
    expect(heroPowerText(s)).toBe(`${BASE} **Avenge (6):** get a random minion of your Tier (**6** more to go).`);
    s = structuredClone({ ...s, ancients: { ...s.ancients!, batchBDeaths: 5 } });
    expect(ancientAvengeCountdown(s)).toBe(1);
    destroyMinionInShop(makeContext(s), at(s, 'd'));
    expect(s.ancients!.batchBDeaths).toBe(0);
    expect(s.hand.length).toBe(1);
    expect(CARD_INDEX[s.hand[0]!.cardId]!.tier).toBe(3);
  });
  it('Shop: a death short of the 6th gets nothing', () => {
    const s = structuredClone(picked('death', { board: [card('d', 'sandbag')] }));
    destroyMinionInShop(makeContext(s), at(s, 'd'));
    expect(s.hand.length).toBe(0);
  });
  it('combat: the carried count fires mid-fight (a live card to hand); without the pairing nothing flies', () => {
    let s = picked('death', { board: [card('a', 'sandbag', { attack: 1, health: 1 })] });
    s = { ...s, ancients: { ...s.ancients!, batchBDeaths: 5 } };
    expect(ancientCombatMods(s).ancientGorrAvenge).toEqual({ every: 6, tick: 5, ids: tierIds(s), label: 'Ancient of Death' });
    s = fightNow(s, 100, 1000);
    expect((s.lastCombat!.events ?? []).filter((e) => e.type === 'toHand' && e.side === 'player').length).toBe(1);
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.hand.filter((c) => CARD_INDEX[c.cardId]!.tier === 3 && !CARD_INDEX[c.cardId]!.spell).length).toBe(1);
    expect(s.ancients!.batchBDeaths).toBe(0);
    const plain = fightNow(picked('fortune', { board: [card('a', 'sandbag', { attack: 1, health: 1 })] }), 100, 1000);
    expect((plain.lastCombat!.events ?? []).filter((e) => e.type === 'toHand' && e.side === 'player').length).toBe(0);
  });
});

describe('Emerald Warden × FORTUNE: "Minions of your tier cost 2g."', () => {
  it('a minion of your Shop tier costs 2 Gold; other tiers cost their price; it follows the tier', () => {
    const s = picked('fortune');
    expect(heroPowerText(s)).toBe(`${BASE} Minions of your Tier (Tier **3**) cost **2 Gold**.`);
    const t3 = minionOfTier(s, 3), t2 = minionOfTier(s, 2);
    expect(offerBuyPrice(s, { cardId: t3 }).cost).toBe(2);
    expect(offerBuyPrice(s, { cardId: t2 }).cost).toBe(3);
    expect(offerBuyPrice({ ...s, tier: 2 }, { cardId: t2 }).cost).toBe(2);
    const bought = reduce({ ...s, shop: [{ uid: 'o', cardId: t3 }] }, { type: 'buy', uid: 'o' });
    expect(bought.embers).toBe(s.embers - 2);
    expect(offerBuyPrice(picked('death'), { cardId: t3 }).cost).toBe(3);
  });
});

describe('Emerald Warden × WAR: "At tier 6, Vanguard can be activated for 1g to cast Waking Rift."', () => {
  it('below Tier 6 Vanguard is still passive: no button, a press does nothing, and the text says so', () => {
    const s = picked('war', { tier: 5, board: mechs() });
    expect(activePowers(s)[0]!.passive).toBe(true);
    expect(heroPowerText(s)).toBe(`${BASE} At Tier **6**, use it for **1 Gold** to cast **Waking Rift**. Once each turn. You are Tier **5**.`);
    expect(reduce(s, { type: 'heroPower' })).toBe(s);
  });
  it('reaching Tier 6 turns it into a 1 Gold button that casts Waking Rift, once per turn', () => {
    let s = picked('war', { tier: 5, board: mechs(), upgradeCost: 0 });
    s = reduce(s, { type: 'upgrade' });
    expect(s.tier).toBe(6);
    expect(s.hand.length).toBe(1); // Vanguard's own tier-up minion still arrives
    expect(activePowers(s)[0]).toMatchObject({ passive: false, untargeted: true, cost: 1 });
    expect(heroPowerText(s)).toContain('**Active now.**');
    const gold = s.embers;
    s = reduce(s, { type: 'heroPower' });
    expect(s.embers).toBe(gold - 1);
    expect(at(s, 'm1').attack).toBe(11); // Waking Rift: +5/+5 twice
    expect(at(s, 'dw').health).toBe(11);
    expect(s.heroReady).toBe(false);
    expect(reduce(s, { type: 'heroPower' })).toBe(s);
  });
  it('picked at Tier 6 it is a button right away; an empty board refuses the press and keeps the Gold', () => {
    const s = picked('war', { tier: 6 });
    expect(activePowers(s)[0]!.passive).toBe(false);
    expect(reduce(s, { type: 'heroPower' })).toBe(s);
  });
  it('without the pairing Vanguard never becomes a button', () => {
    const s = picked('death', { tier: 6, board: mechs() });
    expect(activePowers(s)[0]!.passive).toBe(true);
    expect(reduce(s, { type: 'heroPower' })).toBe(s);
  });
});

describe('Emerald Warden × GENESIS: "At tier 6, Vanguard can be activated for 4g to discover a Tier 7 minion."', () => {
  it('at Tier 6 it costs 4 Gold and opens a Discover of Tier 7 minions', () => {
    let s = picked('genesis', { tier: 6 });
    expect(heroPowerText(s)).toBe(`${BASE} At Tier **6**, use it for **4 Gold** to **Discover** a **Tier 7** minion. Once each turn. **Active now.**`);
    expect(activePowers(s)[0]).toMatchObject({ passive: false, untargeted: true, cost: 4 });
    const gold = s.embers;
    s = reduce(s, { type: 'heroPower' });
    expect(s.embers).toBe(gold - 4);
    expect(s.discover!.length).toBeGreaterThan(0);
    expect(s.discover!.every((id) => CARD_INDEX[id]!.tier === 7)).toBe(true);
    const id = s.discover![0]!;
    s = reduce(s, { type: 'discover', index: 0 });
    expect(s.hand.map((c) => c.cardId)).toEqual([id]);
  });
  it('with 3 Gold, or below Tier 6, the press is refused', () => {
    const poor = picked('genesis', { tier: 6, embers: 3 });
    expect(reduce(poor, { type: 'heroPower' })).toBe(poor);
    const low = picked('genesis', { tier: 5 });
    expect(activePowers(low)[0]!.passive).toBe(true);
    expect(reduce(low, { type: 'heroPower' })).toBe(low);
  });
});

describe('Emerald Warden × TIME: "Vanguard gains End of Turn: Get a random minion of your tier."', () => {
  it('End of Turn puts a random minion of your Shop tier in hand', () => {
    let s = picked('time');
    expect(heroPowerText(s)).toBe(`${BASE} **End of Turn:** get a random minion of your Tier (Tier **3**).`);
    s = fightNow(s);
    expect(s.hand.length).toBe(1);
    expect(tierIds(s)).toContain(s.hand[0]!.cardId);
  });
  it('without the pairing End of Turn gets nothing', () => {
    expect(fightNow(picked('fortune')).hand.length).toBe(0);
  });
});

describe('Emerald Warden × BONDS: "At tier 6, Vanguard can be activated for 1g to get a minion of your most common type."', () => {
  it('at Tier 6 it costs 1 Gold and gets a minion of your most common type', () => {
    let s = picked('bonds', { tier: 6, board: mechs() });
    expect(heroPowerText(s)).toBe(`${BASE} At Tier **6**, use it for **1 Gold** to get a random minion of your most common type (**Mech**). Once each turn. **Active now.**`);
    const gold = s.embers;
    s = reduce(s, { type: 'heroPower' });
    expect(s.embers).toBe(gold - 1);
    expect(s.hand.length).toBe(1);
    const def = CARD_INDEX[s.hand[0]!.cardId]!;
    expect([def.tribe, def.tribe2].includes('mech') || !!def.universalTribe).toBe(true);
    expect(def.tier).toBeLessThanOrEqual(6);
    expect(reduce(s, { type: 'heroPower' })).toBe(s);
  });
  it('with no typed minion on the board, or below Tier 6, the press is refused', () => {
    const empty = picked('bonds', { tier: 6 });
    expect(reduce(empty, { type: 'heroPower' })).toBe(empty);
    const low = picked('bonds', { tier: 5, board: mechs() });
    expect(reduce(low, { type: 'heroPower' })).toBe(low);
    expect(heroPowerText(low)).toContain('You are Tier **5**.');
  });
});

describe('Emerald Warden × Ancients: save / restore and determinism', () => {
  it('a JSON round trip keeps the button and the running count', () => {
    const s = picked('bonds', { tier: 6, board: mechs() });
    const back = JSON.parse(JSON.stringify(s)) as RunState;
    expect(back.ancients).toEqual(s.ancients);
    expect(reduce(back, { type: 'heroPower' }).hand.map((c) => c.cardId)).toEqual(reduce(s, { type: 'heroPower' }).hand.map((c) => c.cardId));
  });
  it('the same seed gets the same minions', () => {
    const eot = () => fightNow(picked('time')).hand.map((c) => c.cardId);
    expect(eot()).toEqual(eot());
  });
});
