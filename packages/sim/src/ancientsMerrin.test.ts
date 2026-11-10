/**
 * ANCIENTS × MERRIN (owner pairings 2026-11-10). Pocket Magic (1 Gold, untargeted, once per turn): "Get a random Shop
 * spell." (your Shop tier or lower). Every pairing in the phase(s) it fires in.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import {
  ANCIENT_IDS, activePowers, ancientAvengeCountdown, ancientCombatMods, ancientOfferText, createRun, enableAncients, heroPowerText, reduce,
  type AncientId, type BoardCard, type BoardSnapshot, type RunState,
} from './index';
import { destroyMinionInShop, makeContext, spellCasts } from './recruit';
import { runSpells } from './spellPool';

const BASE = 'Get a random Shop spell.';
/** Three minions of three different types and one that shares a type (so "one of each type" skips it). */
const TYPED = ['beatboxer', 'dw_edward', 'gnash'];

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const base = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, 'merrin'), phase: 'recruit', tier: 3, embers: 40, heroReady: true, hand: [], board: [], shop: [], spell: null, ...over } as RunState);
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
const spellIds = (s: RunState): string[] => runSpells(s).filter((c) => c.tier <= s.tier).map((c) => c.id);
const spellsInHand = (s: RunState): BoardCard[] => s.hand.filter((c) => !!CARD_INDEX[c.cardId]?.spell);
/** A Gift that changes no stats: one clean "spell cast" for the counters. */
const gift = (uid: string): BoardCard => card(uid, 'gift_arcane_clearance');
const cast = (s: RunState, uid: string): RunState => reduce(s, { type: 'play', uid });
/** A board that casts a spell mid-fight: three bodies die, then Riftwalker's Avenge (3) casts Waking Rift. */
const riftBoard = (): BoardCard[] => [
  card('f1', 'sandbag', { attack: 1, health: 1 }), card('f2', 'sandbag', { attack: 1, health: 1 }), card('f3', 'sandbag', { attack: 1, health: 1 }),
  card('rw', 'd3_riftwalker', { attack: 1, health: 5000 }),
];

describe('Merrin × every Ancient has a written pairing', () => {
  it('all six are written (no "Not written yet."), and none uses an em dash', () => {
    for (const id of ANCIENT_IDS) {
      expect(ancientOfferText('merrin', id)).not.toBe('Not written yet.');
      expect(ancientOfferText('merrin', id)).not.toMatch(/—|--/);
    }
  });
});

describe('Merrin × DEATH: "Avenge (3): get a random Shop spell."', () => {
  it('Shop: the 3rd friendly Shop death gets a random Shop spell; the count runs on', () => {
    let s = picked('death', { board: [card('d', 'sandbag')] });
    expect(heroPowerText(s)).toBe(`${BASE} **Avenge (3):** get a random Shop spell (**3** more to go).`);
    s = structuredClone({ ...s, ancients: { ...s.ancients!, batchBDeaths: 2 } });
    expect(ancientAvengeCountdown(s)).toBe(1);
    destroyMinionInShop(makeContext(s), at(s, 'd'));
    expect(s.ancients!.batchBDeaths).toBe(0);
    expect(spellsInHand(s).length).toBe(1);
    expect(spellIds(s)).toContain(s.hand[0]!.cardId);
  });
  it('Shop: a death short of the 3rd gets nothing', () => {
    const s = structuredClone(picked('death', { board: [card('d', 'sandbag')] }));
    destroyMinionInShop(makeContext(s), at(s, 'd'));
    expect(s.ancients!.batchBDeaths).toBe(1);
    expect(s.hand.length).toBe(0);
  });
  it('combat: the carried count fires mid-fight (a live card to hand) and settle keeps the count', () => {
    let s = picked('death', { board: [card('a', 'sandbag', { attack: 1, health: 1 })] });
    s = { ...s, ancients: { ...s.ancients!, batchBDeaths: 2 } };
    expect(ancientCombatMods(s).ancientGorrAvenge).toEqual({ every: 3, tick: 2, ids: spellIds(s), label: 'Ancient of Death' });
    s = fightNow(s, 100, 1000);
    const flew = (s.lastCombat!.events ?? []).filter((e) => e.type === 'toHand' && e.side === 'player');
    expect(flew.length).toBe(1);
    s = reduce(s, { type: 'resolveCombat' });
    expect(spellsInHand(s).length).toBe(1);
    expect(s.ancients!.batchBDeaths).toBe(0);
  });
  it('combat: without the pairing the same fight sends nothing to hand', () => {
    const s = fightNow(picked('war', { board: [card('a', 'sandbag', { attack: 1, health: 1 })] }), 100, 1000);
    expect((s.lastCombat!.events ?? []).filter((e) => e.type === 'toHand' && e.side === 'player').length).toBe(0);
  });
});

describe('Merrin × FORTUNE: "Pocket Magic is free and can be used twice each turn."', () => {
  it('two free uses a turn, then it is spent; the text counts them down', () => {
    let s = picked('fortune');
    expect(activePowers(s)[0]).toMatchObject({ cost: 0, usesPerTurn: 2 });
    expect(heroPowerText(s)).toBe(`${BASE} It is free. Use it **twice** each turn (**2** left this turn).`);
    const gold = s.embers;
    s = reduce(s, { type: 'heroPower' });
    expect(heroPowerText(s)).toContain('(**1** left this turn)');
    s = reduce(s, { type: 'heroPower' });
    expect(spellsInHand(s).length).toBe(2);
    expect(s.embers).toBe(gold);
    expect(s.heroReady).toBe(false);
    expect(reduce(s, { type: 'heroPower' })).toBe(s);
  });
  it('without the pairing it costs 1 Gold and fires once', () => {
    let s = picked('death');
    const gold = s.embers;
    s = reduce(s, { type: 'heroPower' });
    expect(s.embers).toBe(gold - 1);
    expect(reduce(s, { type: 'heroPower' })).toBe(s);
  });
});

describe('Merrin × WAR: "Spells you get from Pocket Magic cast again an additional time."', () => {
  it('the spell Pocket Magic makes is stamped to cast twice; a spell from elsewhere is not', () => {
    let s = picked('war', { hand: [card('own', 'sparkplug')] });
    expect(heroPowerText(s)).toBe(`${BASE} That spell casts **twice**.`);
    s = reduce(s, { type: 'heroPower' });
    const made = s.hand.find((c) => c.uid !== 'own')!;
    expect(made.castMult).toBe(2);
    expect(s.hand.find((c) => c.uid === 'own')!.castMult).toBeUndefined();
    const def = CARD_INDEX[made.cardId]!;
    if (!def.singleCast) expect(spellCasts(s, def, made)).toBe(2 * spellCasts(s, def));
  });
  it('the stamped spell really resolves twice when cast from hand', () => {
    let s = picked('war', { board: [card('m', 'sandbag', { attack: 1, health: 1 })], hand: [card('r', 'sparkplug', { castMult: 2 })] });
    const once = reduce({ ...s, hand: [card('r', 'sparkplug')] }, { type: 'play', uid: 'r' });
    s = reduce(s, { type: 'play', uid: 'r' });
    expect(at(s, 'm').attack - 1).toBe(2 * (at(once, 'm').attack - 1));
  });
  it('without the pairing the spell is plain', () => {
    const s = reduce(picked('death'), { type: 'heroPower' });
    expect(s.hand[0]!.castMult).toBeUndefined();
  });
});

describe('Merrin × GENESIS: "Pocket Magic Discovers the spell instead."', () => {
  it('Pocket Magic opens a Discover of Shop spells; the pick lands in hand', () => {
    let s = picked('genesis');
    expect(heroPowerText(s)).toBe('**Discover** a Shop spell.');
    const gold = s.embers;
    s = reduce(s, { type: 'heroPower' });
    expect(s.embers).toBe(gold - 1);
    expect(s.hand.length).toBe(0);
    expect(s.discover!.length).toBeGreaterThan(0);
    expect(s.discover!.every((id) => !!CARD_INDEX[id]?.spell)).toBe(true);
    const id = s.discover![0]!;
    s = reduce(s, { type: 'discover', index: 0 });
    expect(s.hand.map((c) => c.cardId)).toEqual([id]);
  });
  it('without the pairing there is no Discover', () => {
    const s = reduce(picked('death'), { type: 'heroPower' });
    expect(s.discover ?? undefined).toBeUndefined();
    expect(s.hand.length).toBe(1);
  });
});

describe('Merrin × TIME: "Pocket Magic recharges after every 3 spells you cast."', () => {
  it('the 3rd spell cast recharges a spent Pocket Magic, and the count runs on', () => {
    let s = picked('time', { hand: [gift('g1'), gift('g2'), gift('g3'), gift('g4')] });
    expect(heroPowerText(s)).toBe(`${BASE} It recharges after every **3** spells you cast (**3** more to go).`);
    s = reduce(s, { type: 'heroPower' });
    expect(s.heroReady).toBe(false);
    s = cast(cast(s, 'g1'), 'g2');
    expect(s.heroReady).toBe(false);
    expect(heroPowerText(s)).toContain('(**1** more to go)');
    s = cast(s, 'g3');
    expect(s.heroReady).toBe(true);
    expect(s.ancients!.batchBSpells).toBe(3);
    s = reduce(s, { type: 'heroPower' });
    expect(s.heroReady).toBe(false);
    s = cast(s, 'g4');
    expect(s.heroReady).toBe(false);
  });
  it('without the pairing three casts recharge nothing', () => {
    let s = picked('death', { hand: [gift('g1'), gift('g2'), gift('g3')] });
    s = reduce(s, { type: 'heroPower' });
    s = cast(cast(cast(s, 'g1'), 'g2'), 'g3');
    expect(s.heroReady).toBe(false);
  });
  it('combat casts join the count at settle', () => {
    let s = picked('time', { board: riftBoard() });
    s = reduce(fightNow(s, 100, 100000), { type: 'resolveCombat' });
    expect(s.ancients!.batchBSpells).toBeGreaterThan(0);
  });
});

describe('Merrin × BONDS: "Casting a spell gives a minion of each type +3/+4."', () => {
  const board = () => [card('a', TYPED[0]!), card('b', TYPED[1]!), card('c', TYPED[2]!), card('a2', TYPED[0]!)];
  it('Shop: each cast gives one minion of each type +3/+4, permanently; a second of a type gets nothing', () => {
    let s = picked('bonds', { board: board(), hand: [gift('g1')] });
    expect(heroPowerText(s)).toBe(`${BASE} Whenever you cast a spell, give a friendly minion of each type **+3/+4**.`);
    const was = new Map(s.board.map((c) => [c.uid, [c.attack, c.health]]));
    s = cast(s, 'g1');
    for (const uid of ['a', 'b', 'c']) {
      expect(at(s, uid).attack).toBe(was.get(uid)![0]! + 3);
      expect(at(s, uid).health).toBe(was.get(uid)![1]! + 4);
    }
    expect(at(s, 'a2').attack).toBe(was.get('a2')![0]);
  });
  it('Shop: without the pairing a cast gives nothing', () => {
    let s = picked('death', { board: board(), hand: [gift('g1')] });
    const was = at(s, 'a').attack;
    s = cast(s, 'g1');
    expect(at(s, 'a').attack).toBe(was);
  });
  it('combat: every cast buffs one living minion of each type for that combat', () => {
    const s = picked('bonds', { board: riftBoard() });
    expect(ancientCombatMods(s).ancientSpellBanners).toEqual({ attack: 3, health: 4, label: 'Pocket Magic' });
    const fought = fightNow(s, 100, 100000);
    const bonds = (fought.lastCombat!.events ?? []).filter((e) => e.type === 'buff' && e.source === 'Pocket Magic');
    expect(bonds.length).toBeGreaterThan(0);
    const plain = fightNow(picked('death', { board: riftBoard() }), 100, 100000);
    expect((plain.lastCombat!.events ?? []).filter((e) => e.type === 'buff' && e.source === 'Pocket Magic').length).toBe(0);
  });
});

describe('Merrin × Ancients: save / restore and determinism', () => {
  it('a JSON round trip keeps the running counts', () => {
    let s = picked('time', { hand: [gift('g1'), gift('g2'), gift('g3')] });
    s = cast(reduce(s, { type: 'heroPower' }), 'g1');
    const back = JSON.parse(JSON.stringify(s)) as RunState;
    expect(back.ancients).toEqual(s.ancients);
    expect(cast(cast(back, 'g2'), 'g3').heroReady).toBe(true);
  });
  it('the same seed gives the same spells', () => {
    const run = () => reduce(reduce(picked('fortune'), { type: 'heroPower' }), { type: 'heroPower' }).hand.map((c) => c.cardId);
    expect(run()).toEqual(run());
    const fight = () => reduce(fightNow({ ...picked('death', { board: [card('a', 'sandbag', { attack: 1, health: 1 })] }), ancients: { ...picked('death').ancients!, batchBDeaths: 2 } }, 100, 1000), { type: 'resolveCombat' }).hand.map((c) => c.cardId);
    expect(fight()).toEqual(fight());
  });
});
