/**
 * ANCIENTS × JUGGLER (owner pairings 2026-11-10). Carnival Coin (passive): "Every 3 minions you buy, get a Carnival Coin."
 * The Coin: "Gain 1 Gold. Give your minions +1/+1." Every pairing in the phase(s) it fires in.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import {
  ANCIENT_IDS, ancientAvengeCountdown, ancientCombatMods, ancientOfferText, carnivalCoinLive, createRun, enableAncients,
  heroPowerText, poolOf, reduce, type AncientId, type BoardCard, type BoardSnapshot, type RunState,
} from './index';
import { defIsTribe, destroyMinionInShop, dominantBoardTribe, makeContext, spellDisplayText } from './recruit';

const BASE = 'Every **3** minions you buy, get a **Carnival Coin**.';
const COIN = 'carnivalcoin';
const N = (i: number) => ['beatboxer', 'dw_edward', 'attachmentconductor', 'sandbag'][i % 4]!;

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const base = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, 'juggler'), phase: 'recruit', embers: 60, heroReady: true, hand: [], board: [], shop: [], spell: null, tier: 2, ...over } as RunState);
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
const coins = (s: RunState): number => s.hand.filter((c) => c.cardId === COIN).length;
const buyFromRow = (s: RunState, cardId: string): RunState => {
  const withOffer: RunState = { ...s, shop: [...s.shop, { uid: `o_${cardId}_${s.uidSeq}`, cardId }] };
  return reduce(withOffer, { type: 'buy', uid: withOffer.shop[withOffer.shop.length - 1]!.uid });
};
/** Buy a minion and clear the bought body out of the hand (the Coins stay), so the hand never fills. */
const buy = (s: RunState, cardId: string): RunState => {
  const t = buyFromRow(s, cardId);
  return { ...t, hand: t.hand.filter((c) => c.cardId === COIN) };
};
const coinText = (s: RunState): string => spellDisplayText(COIN, 0, 0, 0, 0, 0, 0, { carnivalCoin: carnivalCoinLive(s) });

describe('Juggler × every Ancient has a written pairing', () => {
  it('all six are written, with no em dash and none of the banned words', () => {
    for (const id of ANCIENT_IDS) {
      const t = ancientOfferText('juggler', id);
      expect(t).not.toBe('Not written yet.');
      expect(t).not.toMatch(/—|--|[Oo]ath|climb/);
    }
  });
  it('a plain Juggler: 3 buys, one Coin, worth 1 Gold and +1/+1', () => {
    let s = picked('death', { board: [card('a', N(3))] });
    s = buy(buy(s, N(0)), N(1));
    expect(coins(s)).toBe(0);
    s = buy(s, N(2));
    expect(coins(s)).toBe(1);
    expect(s.jugglerBuys).toBe(0);
    expect(carnivalCoinLive(s)).toBeUndefined();
    const before = s.embers;
    s = reduce(s, { type: 'play', uid: s.hand.find((c) => c.cardId === COIN)!.uid });
    expect(s.embers).toBe(before + 1);
    expect(at(s, 'a').attack).toBe(CARD_INDEX[N(3)]!.attack + 1);
  });
});

describe('Juggler × DEATH: "Avenge (4): get a Carnival Coin."', () => {
  it('Shop: the 4th friendly death puts a Carnival Coin in hand', () => {
    let s = picked('death', { board: [card('d', N(0))] });
    expect(heroPowerText(s)).toBe(`${BASE} **Avenge (4):** get a **Carnival Coin** (**4** more to go).`);
    s = structuredClone({ ...s, ancients: { ...s.ancients!, gildDeaths: 3 } });
    destroyMinionInShop(makeContext(s), at(s, 'd'));
    expect(coins(s)).toBe(1);
    expect(s.ancients!.gildDeaths).toBe(0);
  });
  it('combat: the carried count fires mid-fight and the Coin flies to hand', () => {
    let s = picked('death', { board: [card('a', N(0), { attack: 1, health: 1 })] });
    s = { ...s, ancients: { ...s.ancients!, gildDeaths: 3 } };
    expect(ancientCombatMods(s).ancientGorrAvenge).toEqual({ every: 4, tick: 3, ids: [COIN], label: 'Ancient of Death' });
    expect(ancientAvengeCountdown(s)).toBe(1);
    s = fightNow(s, 100, 1000);
    expect((s.lastCombat!.events ?? []).filter((e) => e.type === 'toHand' && e.side === 'player' && e.cardId === COIN).length).toBe(1);
    s = reduce(s, { type: 'resolveCombat' });
    expect(coins(s)).toBe(1);
  });
  it('without Death nothing arrives', () => {
    const s = structuredClone(picked('war', { board: [card('d', N(0))] }));
    destroyMinionInShop(makeContext(s), at(s, 'd'));
    expect(coins(s)).toBe(0);
  });
});

describe('Juggler × FORTUNE: "Carnival Coins give 3 Gold."', () => {
  it('a Carnival Coin gives 3 Gold, and its text says so', () => {
    let s = picked('fortune', { hand: [card('c', COIN)], board: [card('a', N(3))] });
    expect(heroPowerText(s)).toBe(`${BASE} **Carnival Coins** give **3 Gold**.`);
    expect(carnivalCoinLive(s)).toEqual({ gold: 3, attack: 0, health: 0 });
    expect(coinText(s)).toBe('Gain {{3 Gold}}. Give your minions **+1/+1**.');
    const before = s.embers;
    s = reduce(s, { type: 'play', uid: 'c' });
    expect(s.embers).toBe(before + 3);
    expect(at(s, 'a').attack).toBe(CARD_INDEX[N(3)]!.attack + 1);
  });
  it('another Gold spell is unchanged', () => {
    let s = picked('fortune', { hand: [card('p', 'emberpouch')] });
    const before = s.embers;
    s = reduce(s, { type: 'play', uid: 'p' });
    expect(s.embers).toBe(before + 1);
  });
});

describe('Juggler × WAR: "Each Coin you cast improves future Coin buffs by +1/+1."', () => {
  it('each cast improves the NEXT Coins: +1/+1, then +2/+2, then +3/+3; the text follows', () => {
    let s = picked('war', { hand: [card('c1', COIN), card('c2', COIN), card('c3', COIN)], board: [card('a', N(3))] });
    const a0 = CARD_INDEX[N(3)]!.attack, h0 = CARD_INDEX[N(3)]!.health;
    expect(heroPowerText(s)).toBe(`${BASE} Each **Carnival Coin** you cast improves future Coin buffs by **+1/+1** (**+0/+0** so far).`);
    expect(coinText(s)).toBe(CARD_INDEX[COIN]!.text);
    s = reduce(s, { type: 'play', uid: 'c1' });
    expect(at(s, 'a')).toMatchObject({ attack: a0 + 1, health: h0 + 1 });
    expect(s.ancients!.jugglerCoinBonus).toEqual({ attack: 1, health: 1 });
    expect(coinText(s)).toContain('+2/+2');
    s = reduce(s, { type: 'play', uid: 'c2' });
    expect(at(s, 'a')).toMatchObject({ attack: a0 + 3, health: h0 + 3 });
    s = reduce(s, { type: 'play', uid: 'c3' });
    expect(at(s, 'a')).toMatchObject({ attack: a0 + 6, health: h0 + 6 });
    expect(heroPowerText(s)).toContain('(**+3/+3** so far)');
  });
  it('another spell cast does not improve Coins, and without War a Coin stays +1/+1', () => {
    let s = picked('war', { hand: [card('p', 'emberpouch')] });
    s = reduce(s, { type: 'play', uid: 'p' });
    expect(s.ancients!.jugglerCoinBonus).toBeUndefined();
    let t = picked('fortune', { hand: [card('c1', COIN), card('c2', COIN)], board: [card('a', N(3))] });
    t = reduce(reduce(t, { type: 'play', uid: 'c1' }), { type: 'play', uid: 'c2' });
    expect(at(t, 'a').attack).toBe(CARD_INDEX[N(3)]!.attack + 2);
  });
});

describe('Juggler × GENESIS: "Get a Carnival Coin every 2 minions you buy."', () => {
  it('every second minion bought pays a Coin', () => {
    let s = picked('genesis');
    expect(heroPowerText(s)).toBe('Every **2** minions you buy, get a **Carnival Coin** (**2** more to go).');
    s = buy(s, N(0));
    expect(coins(s)).toBe(0);
    expect(heroPowerText(s)).toContain('(**1** more to go)');
    s = buy(s, N(1));
    expect(coins(s)).toBe(1);
    s = buy(buy(s, N(2)), N(3));
    expect(coins(s)).toBe(2);
  });
});

describe('Juggler × TIME: "The first 2 minions you buy each turn also grant a Carnival Coin."', () => {
  it('the first 2 minion buys each turn each give a Coin, on top of the every-3 Coin', () => {
    let s = picked('time');
    expect(heroPowerText(s)).toBe(`${BASE} The first **2** minions you buy each turn also give a **Carnival Coin** (**2** left this turn).`);
    s = buy(s, N(0));
    expect(coins(s)).toBe(1);
    s = buy(s, N(1));
    expect(coins(s)).toBe(2);
    expect(heroPowerText(s)).toContain('(**0** left this turn)');
    s = buy(s, N(2));
    expect(coins(s), 'the 3rd buy pays only the power own Coin').toBe(3);
    s = buy(s, N(3));
    expect(coins(s)).toBe(3);
    const next = buy({ ...s, wave: s.wave + 1 }, N(0));
    expect(coins(next), 'a new turn: the first buy again').toBe(4);
  });
  it('a spell bought is not a minion', () => {
    const s0 = picked('time');
    const spell = poolOf(s0).buyable.find((c) => c.spell && !c.token && (c.cost ?? 0) <= 3 && c.tier <= 2)?.id;
    if (!spell) return;
    const s = buyFromRow(s0, spell);
    expect(coins(s)).toBe(0);
  });
});

describe('Juggler × BONDS: "Buying a minion of your most common type counts twice for Carnival Coin."', () => {
  const probe = base();
  const tribe = probe.tribes.find((t) => poolOf(probe).buyable.filter((c) => !c.spell && !c.ruby && !c.token && c.tier <= 2 && c.tribe === t && !c.tribe2).length >= 2)!;
  const typed = poolOf(probe).buyable.filter((c) => !c.spell && !c.ruby && !c.token && c.tier <= 2 && c.tribe === tribe && !c.tribe2).map((c) => c.id);
  const untyped = poolOf(probe).buyable.find((c) => !c.spell && !c.ruby && !c.token && c.tier <= 2 && !defIsTribe(c, tribe, probe))!.id;
  it('a minion of your most common type counts twice; the extra count carries past the Coin', () => {
    let s = picked('bonds', { board: [card('a', typed[0]!), card('b', typed[0]!)] });
    expect(dominantBoardTribe(s)).toBe(tribe);
    expect(heroPowerText(s)).toBe(`${BASE} Buying a minion of your most common type (**${tribe.charAt(0).toUpperCase()}${tribe.slice(1)}**) counts **twice**.`);
    s = buy(s, typed[1]!);
    expect(s.jugglerBuys).toBe(2);
    expect(coins(s)).toBe(0);
    s = buy(s, typed[1]!);
    expect(coins(s)).toBe(1);
    expect(s.jugglerBuys).toBe(1);
    s = buy(s, untyped);
    expect(s.jugglerBuys).toBe(2);
  });
  it('without Bonds every minion counts once', () => {
    let s = picked('fortune', { board: [card('a', typed[0]!), card('b', typed[0]!)] });
    s = buy(s, typed[1]!);
    expect(s.jugglerBuys).toBe(1);
  });
});

describe('Juggler × save / restore and determinism', () => {
  it('the banked Coin improvement survives a JSON round trip and casts the same', () => {
    let s = picked('war', { hand: [card('c1', COIN), card('c2', COIN)], board: [card('a', N(3))] });
    s = reduce(s, { type: 'play', uid: 'c1' });
    const back = JSON.parse(JSON.stringify(s)) as RunState;
    expect(back.ancients).toEqual(s.ancients);
    const x = reduce(back, { type: 'play', uid: 'c2' });
    const y = reduce(s, { type: 'play', uid: 'c2' });
    expect(at(x, 'a')).toEqual(at(y, 'a'));
    expect(x.embers).toBe(y.embers);
    expect(x.rngCursor).toBe(y.rngCursor);
  });
});
