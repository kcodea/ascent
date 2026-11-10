/**
 * ANCIENTS × RASCAL (hero id `baggerben`; owner pairings 2026-11-10). All In (free, once per turn, 2 uses a game): "Gain 1
 * Gold, plus 2 for every turn since you last used this." Every pairing in the phase(s) it fires in.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import {
  ANCIENT_ALLIN_FLAG, ANCIENT_IDS, activePowers, allInPayoutOf, ancientAvengeCountdown, ancientCombatMods, ancientOfferText, createRun, enableAncients,
  heroPowerText, reduce, type AncientId, type BoardCard, type BoardSnapshot, type RunState,
} from './index';
import { destroyMinionInShop, makeContext } from './recruit';

const BASE = 'Gain **1 Gold**, plus **2** for every turn since you last used this.';
const N = (i: number) => ['beatboxer', 'dw_edward', 'attachmentconductor', 'sandbag'][i % 4]!;

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const base = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, 'baggerben'), phase: 'recruit', embers: 40, heroReady: true, hand: [], board: [], shop: [], spell: null, ...over } as RunState);
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

describe('Rascal × every Ancient has a written pairing', () => {
  it('all six are written, with no em dash and none of the banned words', () => {
    for (const id of ANCIENT_IDS) {
      const t = ancientOfferText('baggerben', id);
      expect(t).not.toBe('Not written yet.');
      expect(t).not.toMatch(/—|--|[Oo]ath|climb/);
    }
  });
});

describe('Rascal × DEATH: "All In gains a use. Avenge (4): add 1 gold to All In."', () => {
  it('All In has 3 uses a game', () => {
    expect(activePowers(base())[0]!.maxUses).toBe(2);
    const s = picked('death');
    expect(activePowers(s)[0]!.maxUses).toBe(3);
    expect(heroPowerText(s)).toBe(`${BASE} **Avenge (4):** add **1 Gold** to it (**4** more to go). It pays **1 Gold** now. Uses left: **3**.`);
  });
  it('Shop: the 4th friendly death adds 1 Gold to the next All In, which then spends it', () => {
    let s = picked('death', { wave: 3, board: [card('d', N(0))] });
    s = structuredClone({ ...s, ancients: { ...s.ancients!, rascalDeaths: 3 } });
    expect(allInPayoutOf(s)).toBe(5);
    destroyMinionInShop(makeContext(s), at(s, 'd'));
    expect(s.ancients!.rascalDeaths).toBe(0);
    expect(s.ancients!.rascalPot).toBe(1);
    expect(allInPayoutOf(s)).toBe(6);
    expect(heroPowerText(s)).toContain('It pays **6 Gold** now.');
    const before = s.embers;
    s = reduce(s, { type: 'heroPower' });
    expect(s.embers).toBe(before + 6);
    expect(s.ancients!.rascalPot).toBe(0);
    expect(allInPayoutOf(s)).toBe(1);
    expect(heroPowerText(s)).toContain('Uses left: **2**.');
  });
  it('combat: the carried count pulses mid-fight, and settle adds the Gold', () => {
    let s = picked('death', { board: [card('a', N(0), { attack: 1, health: 1 })] });
    s = { ...s, ancients: { ...s.ancients!, rascalDeaths: 3 } };
    expect(ancientCombatMods(s).ancientAvengePulse).toEqual({ every: 4, tick: 3, flag: ANCIENT_ALLIN_FLAG, label: 'Ancient of Death' });
    expect(ancientAvengeCountdown(s)).toBe(1);
    s = fightNow(s, 100, 1000);
    expect((s.lastCombat!.events ?? []).filter((e) => e.type === 'questTrigger' && e.flag === ANCIENT_ALLIN_FLAG).length).toBe(1);
    expect(heroPowerText(s, 0, { friendlyDeaths: 1 }), 'live through the fight').toContain('(**4** more to go)');
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.ancients!.rascalPot).toBe(1);
    expect(s.ancients!.rascalDeaths).toBe(0);
  });
  it('without Death nothing is added', () => {
    const s = structuredClone(picked('war', { wave: 3, board: [card('d', N(0))] }));
    destroyMinionInShop(makeContext(s), at(s, 'd'));
    expect(s.ancients!.rascalPot).toBeUndefined();
    expect(allInPayoutOf(s)).toBe(5);
  });
});

describe('Rascal × FORTUNE: "All In gains a use and climbs by 2 per turn."', () => {
  it('3 uses, and 2 more Gold per turn (4 in all)', () => {
    const plain = base({ wave: 3 });
    expect(allInPayoutOf(plain)).toBe(5);
    let s = picked('fortune', { wave: 3 });
    expect(activePowers(s)[0]!.maxUses).toBe(3);
    expect(allInPayoutOf(s)).toBe(9);
    expect(heroPowerText(s)).toBe('Gain **1 Gold**, plus **4** for every turn since you last used this. It pays **9 Gold** now. Uses left: **3**.');
    const before = s.embers;
    s = reduce(s, { type: 'heroPower' });
    expect(s.embers).toBe(before + 9);
    expect(allInPayoutOf({ ...s, wave: 5 })).toBe(9);
  });
});

describe('Rascal × WAR: "When you use All In, give your minions +2/+1 for each Gold it pays."', () => {
  it('every board minion gains +2/+1 per Gold paid, permanently', () => {
    let s = picked('war', { wave: 3, board: [card('a', N(0)), card('b', N(1))] });
    expect(heroPowerText(s)).toBe(`${BASE} Also give your minions **+2/+1** for each Gold it pays (**+10/+5** now).`);
    s = reduce(s, { type: 'heroPower' });
    expect(at(s, 'a')).toMatchObject({ attack: CARD_INDEX[N(0)]!.attack + 10, health: CARD_INDEX[N(0)]!.health + 5 });
    expect(at(s, 'b')).toMatchObject({ attack: CARD_INDEX[N(1)]!.attack + 10, health: CARD_INDEX[N(1)]!.health + 5 });
    expect(s.recruitBuffFx.some((f) => f.fromHeroPower), 'its own beat, from the power button').toBe(true);
  });
  it('without War the board is unchanged', () => {
    let s = picked('bonds', { wave: 3, board: [card('a', N(0))] });
    s = reduce(s, { type: 'heroPower' });
    expect(at(s, 'a').attack).toBe(CARD_INDEX[N(0)]!.attack);
  });
});

describe('Rascal × GENESIS: "All In also Discovers a minion of your Tier for every 5 Gold it pays."', () => {
  it('one Discover of exactly your Shop tier per 5 Gold paid', () => {
    let s = picked('genesis', { wave: 6, tier: 3 });
    expect(allInPayoutOf(s)).toBe(11);
    expect(heroPowerText(s)).toBe(`${BASE} Also **Discover** a minion of your Tier for every **5 Gold** it pays (**2** now).`);
    s = reduce(s, { type: 'heroPower' });
    expect(s.discover?.length).toBeGreaterThan(0);
    for (const id of s.discover!) expect(CARD_INDEX[id]!.tier).toBe(3);
    expect((s.discoverQueue ?? []).length).toBe(1);
  });
  it('under 5 Gold: no Discover', () => {
    let s = picked('genesis', { wave: 2, tier: 3 });
    s = reduce(s, { type: 'heroPower' });
    expect(s.discover ?? null).toBeNull();
  });
});

describe('Rascal × TIME: "All In becomes passive. Start of Turn: gain 4 Gold."', () => {
  it('All In cannot be used; the next turn opens with 4 more Gold, on its own beat', () => {
    const s = picked('time', { board: [card('a', N(3), { health: 500 })] });
    expect(heroPowerText(s)).toBe('**Start of Turn:** gain **4 Gold**.');
    expect(activePowers(s)[0]!.passive).toBe(true);
    expect(reduce(s, { type: 'heroPower' })).toBe(s);
    const plain = picked('bonds', { board: [card('a', N(3), { health: 500 })] });
    const next = reduce(fightNow(s), { type: 'resolveCombat' });
    const control = reduce(fightNow(plain), { type: 'resolveCombat' });
    expect(next.embers).toBe(control.embers + 4);
    expect((next.sotBeatFx ?? []).some((b) => b.source.label === 'Ancient of Time' && b.gold === 4)).toBe(true);
  });
});

describe('Rascal × BONDS: "All In gains: Give your Left and Right-most minions +2/+1 when you spend gold."', () => {
  it('each spend (a buy, a paid Refresh) buffs both edges once; a free Refresh spends nothing', () => {
    let s = picked('bonds', { board: [card('a', N(0)), card('m', N(1)), card('z', N(3))] });
    s = buyFromRow(s, N(2));
    expect(at(s, 'a')).toMatchObject({ attack: CARD_INDEX[N(0)]!.attack + 2, health: CARD_INDEX[N(0)]!.health + 1 });
    expect(at(s, 'z')).toMatchObject({ attack: CARD_INDEX[N(3)]!.attack + 2, health: CARD_INDEX[N(3)]!.health + 1 });
    expect(at(s, 'm').attack).toBe(CARD_INDEX[N(1)]!.attack);
    s = reduce(s, { type: 'roll' });
    expect(at(s, 'a').attack).toBe(CARD_INDEX[N(0)]!.attack + 4);
    s = reduce({ ...s, freeRolls: 1 }, { type: 'roll' });
    expect(at(s, 'a').attack).toBe(CARD_INDEX[N(0)]!.attack + 4);
  });
  it('a lone minion is both edges: it gains once', () => {
    let s = picked('bonds', { board: [card('a', N(0))] });
    s = reduce(s, { type: 'roll' });
    expect(at(s, 'a')).toMatchObject({ attack: CARD_INDEX[N(0)]!.attack + 2, health: CARD_INDEX[N(0)]!.health + 1 });
  });
  it('All In still pays', () => {
    let s = picked('bonds', { wave: 3 });
    const before = s.embers;
    s = reduce(s, { type: 'heroPower' });
    expect(s.embers).toBe(before + 5);
  });
});

describe('Rascal × save / restore and determinism', () => {
  it('the Avenge Gold survives a JSON round trip, and the same seed plays the same', () => {
    const mk = (): RunState => {
      let s = picked('death', { wave: 4, board: [card('d', N(0))] });
      s = structuredClone({ ...s, ancients: { ...s.ancients!, rascalDeaths: 3 } });
      destroyMinionInShop(makeContext(s), at(s, 'd'));
      return s;
    };
    const a = mk();
    const back = JSON.parse(JSON.stringify(a)) as RunState;
    expect(allInPayoutOf(back)).toBe(allInPayoutOf(a));
    const x = reduce(back, { type: 'heroPower' });
    const y = reduce(mk(), { type: 'heroPower' });
    expect(x.embers).toBe(y.embers);
    expect(x.ancients).toEqual(y.ancients);
    expect(x.rngCursor).toBe(y.rngCursor);
  });
});
