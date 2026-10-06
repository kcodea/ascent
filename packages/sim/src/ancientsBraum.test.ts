/**
 * ANCIENTS × BRAUM (hero id `bram`; owner pairings 2026-10-06). Investment (1 Gold, once per turn): "Invest 1 Gold. After
 * investing 5, get a random Gilded minion, then reset." Every pairing in the phase(s) it fires in.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { CombatEvent } from '@game/core';
import {
  ANCIENT_IDS, activePowers, ancientCombatMods, ancientInvestmentTally, ancientOfferText, createRun, enableAncients, heroPowerText, reduce,
  type AncientId, type BoardCard, type BoardSnapshot, type RunState,
} from './index';
import { destroyMinionInShop, makeContext } from './recruit';
import { handCap } from './state';

const plain = (c: (typeof CARD_INDEX)[string]) => !!c && !c.spell && !c.ruby && !c.token && c.effects.length === 0 && c.keywords.length === 0 && !c.universalTribe;
const NEUTRALS = Object.values(CARD_INDEX).filter((c) => plain(c) && c.tribe === 'neutral' && !c.tribe2 && !c.henchman).map((c) => c.id);
const N = (i: number) => NEUTRALS[i % NEUTRALS.length]!;

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const gilded = (uid: string, cardId: string): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return card(uid, cardId, { golden: true, attack: d.attack * 2, health: d.health * 2 });
};
const base = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, 'bram'), phase: 'recruit', embers: 20, heroReady: true, hand: [], ...over } as RunState);
const withAncients = (over: Partial<RunState> = {}): RunState => enableAncients(base(over));
const pick = (s0: RunState, id: AncientId): RunState => {
  const s = { ...s0, ancients: { ...s0.ancients!, points: s0.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  const t = reduce(s, { type: 'pickAncient', id });
  expect(t.ancients!.picked).toBe(id);
  return t;
};
const picked = (id: AncientId, over: Partial<RunState> = {}): RunState => pick(withAncients(over), id);
const foes = (wave: number, attack: number, health: number): BoardSnapshot => ({
  v: 1, wave, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: health,
  minions: [{ cardId: 'sandbag', attack, health, keywords: [] }], seed: 1, origin: 'self',
});
const fightNow = (s: RunState, attack = 0, health = 400): RunState => reduce({ ...s, servedBoards: { [s.wave]: foes(s.wave, attack, health) } }, { type: 'faceOmen' });
const events = (s: RunState): CombatEvent[] => s.lastCombat!.events as CombatEvent[];
const toHands = (s: RunState) => events(s).filter((e): e is Extract<CombatEvent, { type: 'toHand' }> => e.type === 'toHand' && e.side === 'player');
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const invest = (s: RunState): RunState => reduce({ ...s, heroReady: true }, { type: 'heroPower' } as never);

describe('Braum × every Ancient has a written pairing', () => {
  it('all six are written (no "Not written yet."), and none uses an em dash', () => {
    for (const id of ANCIENT_IDS) {
      expect(ancientOfferText('bram', id)).not.toBe('Not written yet.');
      expect(ancientOfferText('bram', id)).not.toMatch(/—|--/);
    }
  });
  it('without a pick, Investment is unchanged: 1 Gold a use, the 5th pays a Gilded minion', () => {
    let s = withAncients({ bramInvested: 4, tier: 3 });
    expect(activePowers(s)[0]!.cost).toBe(1);
    s = invest(s);
    expect([s.bramInvested, s.embers, s.hand.length, s.hand[0]!.golden]).toEqual([0, 19, 1, true]);
    expect(ancientInvestmentTally(s)).toBeUndefined();
  });
});

describe('Braum × DEATH: "Investment becomes: When 16 friendly minions die, get a random Gilded minion."', () => {
  it('Investment turns passive: pressing it does nothing and costs nothing', () => {
    const s = picked('death', { bramInvested: 4 });
    expect(activePowers(s)[0]!.passive).toBe(true);
    const after = invest(s);
    expect([after.embers, after.bramInvested, after.hand.length]).toEqual([20, 4, 0]);
  });
  it('Shop: the 16th friendly death pays a random Gilded minion (up to your tier), then the count repeats', () => {
    let s = picked('death', { tier: 3 });
    s = structuredClone({ ...s, board: Array.from({ length: 7 }, (_, i) => card(`d${i}`, N(i))) });
    for (let i = 0; i < 7; i++) destroyMinionInShop(makeContext(s), at(s, `d${i}`));
    expect(s.ancients!.bramDeaths, 'each Shop death ticks once').toBe(7);
    s = structuredClone({ ...s, ancients: { ...s.ancients!, bramDeaths: 14 }, board: [card('x', N(1)), card('y', N(2))] });
    destroyMinionInShop(makeContext(s), at(s, 'x'));
    expect(s.ancients!.bramDeaths).toBe(15);
    expect(s.hand.length).toBe(0);
    expect(heroPowerText(s)).toBe('When **16** friendly minions die, get a random **Gilded** minion (**1** more to go).');
    expect(ancientInvestmentTally(s)).toBe('15/16');
    destroyMinionInShop(makeContext(s), at(s, 'y'));
    expect(s.ancients!.bramDeaths).toBe(0);
    expect(s.hand.length).toBe(1);
    expect(s.hand[0]!.golden).toBe(true);
    expect(CARD_INDEX[s.hand[0]!.cardId]!.tier).toBeLessThanOrEqual(3);
  });
  it('combat: the carried count pays MID-FIGHT (a live toHand), it arrives Gilded at settle, and the remainder carries', () => {
    let s = picked('death', { wave: 4, tier: 3 });
    s = { ...s, board: ['a', 'b', 'c'].map((u, i) => card(u, N(i), { attack: 1, health: 1 })), ancients: { ...s.ancients!, bramDeaths: 15 } };
    expect(ancientCombatMods(s).ancientBramDeaths).toEqual({ every: 16, tick: 15, label: 'Ancient of Death' });
    s = fightNow(s, 100, 1000);
    const th = toHands(s);
    expect(th.length).toBe(1);
    const firstDeath = events(s).findIndex((e) => e.type === 'death' && e.side === 'player');
    expect(events(s).indexOf(th[0]!)).toBeGreaterThan(firstDeath);
    expect(heroPowerText(s, 0, { friendlyDeaths: 1 })).toContain('(**16** more to go)');
    const deaths = s.lastCombat!.playerDeaths ?? 0;
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.ancients!.bramDeaths).toBe((15 + deaths) % 16);
    const got = s.hand.find((c) => c.cardId === th[0]!.cardId)!;
    expect(got.golden, 'gilded at settle').toBe(true);
    expect(got.attack).toBe(CARD_INDEX[got.cardId]!.attack * 2);
  });
});

describe('Braum × FORTUNE: "Investment is free. Triple rewards also grant 3 gold."', () => {
  it('Investment costs 0 but still banks one count per use; the 5th pays', () => {
    let s = picked('fortune', { tier: 3 });
    expect(activePowers(s)[0]!.cost).toBe(0);
    for (let i = 1; i <= 4; i++) { s = invest(s); expect(s.bramInvested).toBe(i); }
    s = invest(s);
    expect([s.embers, s.bramInvested, s.hand.length, s.hand[0]!.golden]).toEqual([20, 0, 1, true]);
  });
  it('getting a Triple Reward (playing a Gilded minion) also gains 3 Gold, printed live', () => {
    let s = picked('fortune', { hand: [gilded('g', N(0))] });
    s = reduce(s, { type: 'play', uid: 'g' });
    expect(s.hand.map((c) => c.cardId)).toEqual(['discoverspell']);
    expect(s.embers).toBe(23);
    expect(heroPowerText(s)).toContain('(**3 Gold** so far)');
  });
  it('a Triple Reward the hand cap drops pays nothing', () => {
    let s = picked('fortune');
    // handCap + 1 cards: the play frees one slot, the reward finds none.
    // Distinct cards, so no triple frees a slot.
    const fill = Object.values(CARD_INDEX).filter((c) => plain(c) && c.id !== N(0)).slice(0, handCap(s)).map((c, i) => card(`h${i}`, c.id));
    s = { ...s, hand: [gilded('g', N(0)), ...fill] };
    s = reduce(s, { type: 'play', uid: 'g' });
    expect(s.hand.length).toBe(handCap(s));
    expect(s.hand.some((c) => c.cardId === 'discoverspell')).toBe(false);
    expect(s.embers).toBe(20);
  });
});

describe('Braum × WAR: "Start of Combat: Give your minions +8/+8 for every Gilded minion you\'ve played this game."', () => {
  it('Gilded plays count from the run start (before the pick too); the fight grants +8/+8 per play to every minion, combat only', () => {
    let s = withAncients({ hand: [gilded('g1', N(0)), gilded('g2', N(1)), card('p', N(2))] });
    s = reduce(s, { type: 'play', uid: 'g1' });
    s = pick(s, 'war');
    s = reduce(s, { type: 'play', uid: 'g2' });
    s = reduce(s, { type: 'play', uid: 'p' }); // a plain play does not count
    expect(s.ancients!.bramGildedPlays).toBe(2);
    expect(heroPowerText(s)).toContain('(**2** played: **+16/+16**)');
    expect(ancientCombatMods(s).ancientSocBuffAll).toEqual({ attack: 16, health: 16, label: 'Ancient of War' });
    const before = s.board.map((c) => [c.uid, c.attack, c.health]);
    s = fightNow(s, 0, 400);
    const buffs = events(s).filter((e) => e.type === 'buff' && e.source === 'Ancient of War');
    expect(buffs.length).toBe(3);
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.board.map((c) => [c.uid, c.attack, c.health]), 'a combat buff: the run cards are untouched').toEqual(before);
  });
  it('no Gilded minion played: no grant', () => {
    expect(ancientCombatMods(picked('war')).ancientSocBuffAll).toBeUndefined();
  });
});

describe('Braum × GENESIS: "Discover the minion from Investment. It is always of your current tier."', () => {
  it('the 5th investment opens a Discover of minions of EXACTLY your tier; the pick arrives Gilded', () => {
    let s = picked('genesis', { tier: 4, bramInvested: 4 });
    expect(heroPowerText(s)).toContain('(Tier **4**)');
    s = invest(s);
    expect(s.bramInvested).toBe(0);
    expect(s.discover!.length).toBeGreaterThan(0);
    for (const id of s.discover!) expect(CARD_INDEX[id]!.tier).toBe(4);
    const id = s.discover![0]!;
    s = reduce(s, { type: 'discover', index: 0 });
    const got = s.hand.find((c) => c.cardId === id)!;
    expect(got.golden).toBe(true);
  });
  it('before the 5th, the bank simply advances', () => {
    const s = invest(picked('genesis', { tier: 4 }));
    expect([s.bramInvested, s.discover]).toEqual([1, undefined]);
  });
});

describe('Braum × TIME: "Investment becomes: Discover a Tier 5 minion. Start of Turn: Get another copy."', () => {
  it('once per game, 1 Gold: Discover a Tier 5 minion; every Start of Turn after, a plain copy of the pick', () => {
    let s = picked('time', { tier: 2, wave: 3 });
    expect(activePowers(s)[0]!.oncePerGame).toBe(true);
    s = invest(s);
    expect(s.embers).toBe(19);
    for (const id of s.discover!) expect(CARD_INDEX[id]!.tier).toBe(5);
    const id = s.discover![0]!;
    s = reduce(s, { type: 'discover', index: 0 });
    expect(s.ancients!.bramTimeCardId).toBe(id);
    expect(heroPowerText(s)).toContain(`Copying: **${CARD_INDEX[id]!.name}**.`);
    expect(invest(s).embers, 'once per game: a second press does nothing').toBe(19);
    s = { ...s, hand: [] };
    s = reduce(fightNow(s, 0, 1), { type: 'resolveCombat' });
    expect(s.hand.filter((c) => c.cardId === id).length).toBe(1);
    expect(s.hand.find((c) => c.cardId === id)!.golden).toBe(false);
    s = reduce(fightNow(s, 0, 1), { type: 'resolveCombat' });
    expect(s.hand.filter((c) => c.cardId === id).length, 'every Start of Turn').toBe(2);
  });
  it('another Discover (a Triple Reward) never becomes the copied minion', () => {
    let s = picked('time', { tier: 2, hand: [gilded('g', N(0))] });
    s = reduce(s, { type: 'play', uid: 'g' });
    const tr = s.hand.find((c) => c.cardId === 'discoverspell')!;
    s = reduce(s, { type: 'play', uid: tr.uid });
    s = reduce(s, { type: 'discover', index: 0 });
    expect(s.ancients!.bramTimeCardId).toBeUndefined();
  });
});

describe('Braum × BONDS: "When you play a Gilded minion, give your minions +8/+8."', () => {
  it('a Gilded play gives every board minion (the played one included) +8/+8, permanently; a plain play gives nothing', () => {
    let s = picked('bonds', { board: [card('a', N(0)), card('b', N(1))], hand: [gilded('g', N(2)), card('p', N(3))] });
    s = reduce(s, { type: 'play', uid: 'g' });
    expect(at(s, 'a').attack).toBe(CARD_INDEX[N(0)]!.attack + 8);
    expect(at(s, 'b').health).toBe(CARD_INDEX[N(1)]!.health + 8);
    expect(at(s, 'g').attack).toBe(CARD_INDEX[N(2)]!.attack * 2 + 8);
    s = reduce(s, { type: 'play', uid: 'p' });
    expect(at(s, 'a').attack).toBe(CARD_INDEX[N(0)]!.attack + 8);
    s = reduce(fightNow(s, 0, 1), { type: 'resolveCombat' });
    expect(at(s, 'a').attack, 'permanent').toBe(CARD_INDEX[N(0)]!.attack + 8);
  });
});
