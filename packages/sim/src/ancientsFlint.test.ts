/**
 * ANCIENTS × FOREMAN FLINT (owner pairings 2026-11-10). Company Rate (passive): "Dwarves cost 2 Gold." "A Dwarf" is any
 * minion that counts as one. Every pairing in the phase(s) it fires in.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import {
  ANCIENT_IDS, ancientAvengeCountdown, ancientCombatMods, ancientOfferText, createRun, enableAncients,
  heroPowerText, offerBuyPrice, poolOf, reduce, type AncientId, type BoardCard, type BoardSnapshot, type RunState,
} from './index';
import { defIsTribe, destroyMinionInShop, makeContext } from './recruit';

const BASE = 'Dwarves cost 2 Gold.';

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const base = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, 'flint'), phase: 'recruit', embers: 40, heroReady: true, hand: [], board: [], shop: [], spell: null, tier: 2, ...over } as RunState);
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
const buyFromRow = (s: RunState, cardId: string): RunState => {
  const withOffer: RunState = { ...s, shop: [...s.shop, { uid: `o_${cardId}_${s.uidSeq}`, cardId }] };
  return reduce(withOffer, { type: 'buy', uid: withOffer.shop[withOffer.shop.length - 1]!.uid });
};
const PROBE = base();
/** Plain Dwarves and a plain non-Dwarf from the run's own pool (no effects: nothing reacts to the buys below). */
const plainOf = (dwarf: boolean): string[] => poolOf(PROBE).buyable
  .filter((c) => !c.spell && !c.ruby && !c.token && c.tier <= 2 && defIsTribe(c, 'dwarf', PROBE) === dwarf && (dwarf || c.effects.length === 0))
  .map((c) => c.id);
const DWARVES = plainOf(true);
const D = (i: number): string => DWARVES[i % DWARVES.length]!;
const OTHER = plainOf(false)[0]!;
const isDwarf = (s: RunState, cardId: string): boolean => defIsTribe(CARD_INDEX[cardId], 'dwarf', s);

describe('Flint × every Ancient has a written pairing', () => {
  it('all six are written, with no em dash and none of the banned words', () => {
    expect(DWARVES.length).toBeGreaterThan(1);
    for (const id of ANCIENT_IDS) {
      const t = ancientOfferText('flint', id);
      expect(t).not.toBe('Not written yet.');
      expect(t).not.toMatch(/—|--|[Oo]ath|climb/);
    }
  });
});

describe('Flint × DEATH: "Avenge (4): get a random Dwarf."', () => {
  it('Shop: the 4th friendly death puts a Dwarf of your Shop tier or lower in hand', () => {
    let s = picked('death', { board: [card('d', OTHER)] });
    expect(heroPowerText(s)).toBe(`${BASE} **Avenge (4):** get a random Dwarf (**4** more to go).`);
    s = structuredClone({ ...s, ancients: { ...s.ancients!, flintDeaths: 3 } });
    destroyMinionInShop(makeContext(s), at(s, 'd'));
    expect(s.ancients!.flintDeaths).toBe(0);
    expect(s.hand.length).toBe(1);
    expect(isDwarf(s, s.hand[0]!.cardId)).toBe(true);
    expect(CARD_INDEX[s.hand[0]!.cardId]!.tier).toBeLessThanOrEqual(2);
  });
  it('combat: the carried count fires mid-fight and the Dwarf flies to hand', () => {
    let s = picked('death', { board: [card('a', OTHER, { attack: 1, health: 1 })] });
    s = { ...s, ancients: { ...s.ancients!, flintDeaths: 3 } };
    const mod = ancientCombatMods(s).ancientGorrAvenge!;
    expect(mod).toMatchObject({ every: 4, tick: 3, label: 'Ancient of Death' });
    expect(mod.ids.length).toBeGreaterThan(0);
    expect(mod.ids.every((id) => isDwarf(s, id) && CARD_INDEX[id]!.tier <= 2)).toBe(true);
    expect(ancientAvengeCountdown(s)).toBe(1);
    s = fightNow(s, 100, 1000);
    const flown = (s.lastCombat!.events ?? []).filter((e) => e.type === 'toHand' && e.side === 'player');
    expect(flown.length).toBe(1);
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.hand.some((c) => isDwarf(s, c.cardId))).toBe(true);
    expect(s.ancients!.flintDeaths).toBe(0);
  });
  it('without Death nothing arrives', () => {
    const s = structuredClone(picked('war', { board: [card('d', OTHER)] }));
    destroyMinionInShop(makeContext(s), at(s, 'd'));
    expect(s.hand.length).toBe(0);
  });
});

describe('Flint × FORTUNE: "Your first Dwarf each turn is free."', () => {
  it('the first Dwarf each turn costs 0; the next costs the Company Rate; a non-Dwarf is never free', () => {
    let s = picked('fortune');
    expect(heroPowerText(s)).toBe(`${BASE} Your first Dwarf each turn is **free**. Ready this turn.`);
    expect(offerBuyPrice(s, { cardId: D(0) })).toMatchObject({ cost: 0, freeBuy: true });
    expect(offerBuyPrice(s, { cardId: OTHER }).freeBuy).toBe(false);
    const before = s.embers;
    s = buyFromRow(s, D(0));
    expect(s.embers).toBe(before);
    expect(offerBuyPrice(s, { cardId: D(1) })).toMatchObject({ cost: 2, freeBuy: false });
    expect(heroPowerText(s)).toContain('Used this turn.');
    expect(offerBuyPrice({ ...s, wave: s.wave + 1, freeBuyUsedThisTurn: false }, { cardId: D(1) }).cost, 'a new turn').toBe(0);
  });
  it('without Fortune a Dwarf costs 2', () => {
    expect(offerBuyPrice(picked('war'), { cardId: D(0) })).toMatchObject({ cost: 2, freeBuy: false });
  });
});

describe('Flint × WAR: "Start of Combat: give your Dwarves +1/+1 for each Dwarf bought this game."', () => {
  it('counts every Dwarf bought this game (before the pick too) and buffs only Dwarves at Start of Combat', () => {
    let s = enableAncients(base());
    s = buyFromRow(s, D(0));
    s = buyFromRow(s, OTHER);
    s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: ['war', 'death', 'time'] } };
    s = reduce(s, { type: 'pickAncient', id: 'war' });
    s = buyFromRow(s, D(1));
    expect(s.ancients!.flintDwarvesBought).toBe(2);
    expect(heroPowerText(s)).toBe(`${BASE} **Start of Combat:** give your Dwarves **+2/+2** (+1/+1 for each Dwarf bought this game: **2** so far).`);
    expect(ancientCombatMods(s).ancientSocBuffAll).toEqual({ attack: 2, health: 2, label: 'Ancient of War', tribe: 'dwarf' });
    s = fightNow({ ...s, hand: [], board: [card('dw', D(0)), card('no', OTHER)] });
    const buffs = (s.lastCombat!.events ?? []).filter((e) => e.type === 'buff' && e.source === 'Ancient of War');
    expect(buffs.length).toBe(1);
    expect(buffs[0]).toMatchObject({ attack: 2, health: 2 });
    s = reduce(s, { type: 'resolveCombat' });
    expect(at(s, 'dw').attack, 'a combat buff: gone after the fight').toBe(CARD_INDEX[D(0)]!.attack);
  });
  it('no Dwarf bought: nothing', () => {
    expect(ancientCombatMods(picked('war')).ancientSocBuffAll).toBeUndefined();
  });
});

describe('Flint × GENESIS: "Your first Refresh each turn is filled with Dwarves."', () => {
  const minions = (s: RunState): string[] => s.shop.filter((o) => { const d = CARD_INDEX[o.cardId]; return !!d && !d.spell && !d.ruby && !o.starform; }).map((o) => o.cardId);
  it('the first Refresh each turn is all Dwarves; the second is an ordinary one', () => {
    let s = picked('genesis');
    expect(heroPowerText(s)).toBe(`${BASE} Your first Refresh each turn is filled with Dwarves. Ready this turn.`);
    s = reduce(s, { type: 'roll' });
    expect(minions(s).length).toBeGreaterThan(0);
    expect(minions(s).every((id) => isDwarf(s, id))).toBe(true);
    expect(heroPowerText(s)).toContain('Used this turn.');
    let mixed = false;
    for (let seed = 1; seed <= 12 && !mixed; seed++) mixed = minions(reduce({ ...s, rngCursor: seed * 7919 }, { type: 'roll' })).some((id) => !isDwarf(s, id));
    expect(mixed, 'later Refreshes this turn are not narrowed').toBe(true);
    const next = reduce({ ...s, wave: s.wave + 1 }, { type: 'roll' });
    expect(minions(next).every((id) => isDwarf(next, id)), 'a new turn: the first Refresh again').toBe(true);
  });
  it('picked mid-turn: the next Refresh that turn is the Dwarf one', () => {
    let s = enableAncients(base());
    s = reduce(s, { type: 'roll' });
    s = reduce(s, { type: 'roll' });
    s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: ['genesis', 'death', 'time'], picked: undefined } };
    s = reduce(s, { type: 'pickAncient', id: 'genesis' });
    s = reduce(s, { type: 'roll' });
    expect(minions(s).every((id) => isDwarf(s, id))).toBe(true);
  });
  it('without Genesis a Refresh is ordinary', () => {
    let mixed = false;
    for (let seed = 1; seed <= 12 && !mixed; seed++) {
      const s = reduce({ ...picked('war'), rngCursor: seed * 7919 }, { type: 'roll' });
      mixed = minions(s).some((id) => !isDwarf(s, id));
    }
    expect(mixed).toBe(true);
  });
});

describe('Flint × TIME: "End of Turn: give your minions +3/+3 for each Dwarf you bought this turn."', () => {
  it('pays +3/+3 per Dwarf bought this turn to every minion at End of Turn; a non-Dwarf buy does not count', () => {
    let s = picked('time', { board: [card('a', OTHER), card('b', D(0))] });
    expect(heroPowerText(s)).toBe(`${BASE} **End of Turn:** give your minions **+3/+3** for each Dwarf you bought this turn (**0** bought: **+0/+0**).`);
    s = buyFromRow(s, D(0));
    s = buyFromRow(s, D(1));
    s = buyFromRow(s, OTHER);
    expect(heroPowerText(s)).toContain('(**2** bought: **+6/+6**)');
    s = fightNow({ ...s, hand: [] });
    expect(at(s, 'a')).toMatchObject({ attack: CARD_INDEX[OTHER]!.attack + 6, health: CARD_INDEX[OTHER]!.health + 6 });
    expect(at(s, 'b').attack).toBe(CARD_INDEX[D(0)]!.attack + 6);
    s = reduce(s, { type: 'resolveCombat' });
    expect(heroPowerText(s), 'a new turn starts at 0').toContain('(**0** bought: **+0/+0**)');
  });
  it('without Time nothing is paid', () => {
    let s = picked('war', { board: [card('a', OTHER)] });
    s = buyFromRow(s, D(0));
    s = fightNow({ ...s, hand: [] });
    expect(at(s, 'a').attack).toBe(CARD_INDEX[OTHER]!.attack);
  });
});

describe('Flint × BONDS: "When you buy a Dwarf, give your other Dwarves +2/+2."', () => {
  it('your other board Dwarves gain +2/+2; a non-Dwarf and the bought Dwarf do not', () => {
    let s = picked('bonds', { board: [card('x', D(0)), card('y', D(1)), card('n', OTHER)] });
    s = buyFromRow(s, D(0));
    expect(at(s, 'x')).toMatchObject({ attack: CARD_INDEX[D(0)]!.attack + 2, health: CARD_INDEX[D(0)]!.health + 2 });
    expect(at(s, 'y').attack).toBe(CARD_INDEX[D(1)]!.attack + 2);
    expect(at(s, 'n').attack).toBe(CARD_INDEX[OTHER]!.attack);
    expect(s.hand[0]!.attack).toBe(CARD_INDEX[D(0)]!.attack);
    expect(s.recruitBuffFx.some((f) => f.fromHeroPower), 'its own beat, from the power button').toBe(true);
    const t = buyFromRow(s, OTHER);
    expect(at(t, 'x').attack, 'a non-Dwarf buy gives nothing').toBe(CARD_INDEX[D(0)]!.attack + 2);
  });
  it('without Bonds a Dwarf buy gives nothing', () => {
    let s = picked('war', { board: [card('x', D(0))] });
    s = buyFromRow(s, D(1));
    expect(at(s, 'x').attack).toBe(CARD_INDEX[D(0)]!.attack);
  });
});

describe('Flint × save / restore and determinism', () => {
  it('the Dwarf tallies survive a JSON round trip, and the same seed draws the same Dwarf Refresh', () => {
    let s = picked('time', { board: [card('a', OTHER)] });
    s = buyFromRow(s, D(0));
    const back = JSON.parse(JSON.stringify(s)) as RunState;
    expect(back.ancients).toEqual(s.ancients);
    expect(heroPowerText(back)).toBe(heroPowerText(s));
    const mk = (): RunState => ({ ...picked('genesis'), rngCursor: 31337 });
    const a = reduce(mk(), { type: 'roll' });
    const b = reduce(JSON.parse(JSON.stringify(mk())) as RunState, { type: 'roll' });
    expect(b.shop).toEqual(a.shop);
    expect(b.rngCursor).toBe(a.rngCursor);
  });
});
