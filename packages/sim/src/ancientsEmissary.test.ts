/**
 * ANCIENTS × EMISSARY (hero id `vale`; owner pairings 2026-11-10). United Front (passive): "Start of Combat: give a
 * friendly minion of each type +1/+1 for every spell cast this game." Every pairing in the phase(s) it fires in.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import {
  ANCIENT_IDS, ancientAvengeCountdown, ancientCombatMods, ancientOfferText, createRun, enableAncients, heroPowerText, reduce,
  type AncientId, type BoardCard, type BoardSnapshot, type RunState,
} from './index';
import { destroyMinionInShop, fireShopUnitedFront, makeContext } from './recruit';
import { runSpells } from './spellPool';

const SPELLS = 5;
const BASE = `**Start of Combat:** give a friendly minion of each type **+${SPELLS}/+${SPELLS}** (1 per spell cast this game).`;

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
/** A Mech, a Dwarf, a second Mech and a typeless body: "one of each type" is the first Mech and the Dwarf. */
const board = (): BoardCard[] => [
  card('m1', 'beatboxer', { attack: 1, health: 5000 }), card('dw', 'dw_brakka', { attack: 1, health: 5000 }),
  card('m2', 'beatboxer', { attack: 1, health: 5000 }), card('n', 'sandbag', { attack: 1, health: 5000 }),
];
const base = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, 'vale'), phase: 'recruit', tier: 3, embers: 40, heroReady: true, hand: [], board: [], shop: [], spell: null, spellsCast: SPELLS, ...over } as RunState);
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
/** How many United Front buffs each run uid took in the fight (by `sourceUid` on the combat bodies' start snapshot). */
const frontBuffs = (s: RunState): number => (s.lastCombat!.events ?? []).filter((e) => e.type === 'buff' && e.source === 'United Front').length;
const frontTriggers = (s: RunState): number => (s.lastCombat!.events ?? []).filter((e) => e.type === 'questTrigger' && e.side === 'player' && e.flag === 'unitedFront').length;
const gift = (uid: string): BoardCard => card(uid, 'gift_arcane_clearance');
const cast = (s: RunState, uid: string): RunState => reduce(s, { type: 'play', uid });
const spellsInHand = (s: RunState): BoardCard[] => s.hand.filter((c) => !!CARD_INDEX[c.cardId]?.spell && !CARD_INDEX[c.cardId]?.gift);
const riftBoard = (): BoardCard[] => [
  card('f1', 'sandbag', { attack: 1, health: 1 }), card('f2', 'sandbag', { attack: 1, health: 1 }), card('f3', 'sandbag', { attack: 1, health: 1 }),
  card('rw', 'd3_riftwalker', { attack: 1, health: 5000 }),
];

describe('Emissary × every Ancient has a written pairing', () => {
  it('all six are written (no "Not written yet."), and none uses an em dash', () => {
    for (const id of ANCIENT_IDS) {
      expect(ancientOfferText('vale', id)).not.toBe('Not written yet.');
      expect(ancientOfferText('vale', id)).not.toMatch(/—|--/);
    }
  });
});

describe('Emissary × DEATH: "Avenge (4): Trigger United Front."', () => {
  it('Shop: the 4th friendly Shop death fires United Front right then, permanently', () => {
    let s = picked('death', { board: [...board(), card('d', 'sandbag')] });
    expect(heroPowerText(s)).toBe(`${BASE} **Avenge (4):** trigger it again (**4** more to go).`);
    s = structuredClone({ ...s, ancients: { ...s.ancients!, batchBDeaths: 3 } });
    expect(ancientAvengeCountdown(s)).toBe(1);
    destroyMinionInShop(makeContext(s), at(s, 'd'));
    expect(s.ancients!.batchBDeaths).toBe(0);
    expect(at(s, 'm1').attack).toBe(1 + SPELLS);
    expect(at(s, 'dw').health).toBe(5000 + SPELLS);
    expect(at(s, 'm2').attack).toBe(1);
    expect(at(s, 'n').attack).toBe(1);
  });
  it('Shop: a death short of the 4th fires nothing', () => {
    const s = structuredClone(picked('death', { board: [...board(), card('d', 'sandbag')] }));
    destroyMinionInShop(makeContext(s), at(s, 'd'));
    expect(at(s, 'm1').attack).toBe(1);
  });
  it('combat: the carried count fires a second United Front mid-fight; without the pairing there is one', () => {
    const fodder = (): BoardCard[] => [card('f', 'sandbag', { attack: 1, health: 1 }), card('m1', 'beatboxer', { attack: 1, health: 5000 })];
    let s = picked('death', { board: fodder() });
    s = { ...s, ancients: { ...s.ancients!, batchBDeaths: 3 } };
    expect(ancientCombatMods(s).ancientFrontShape).toEqual({ label: 'Ancient of Death', avenge: { every: 4, tick: 3, mult: 1 } });
    s = fightNow(s, 100, 100000);
    expect(frontTriggers(s)).toBe(2);
    expect(frontTriggers(fightNow(picked('fortune', { board: fodder() }), 100, 100000))).toBe(1);
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.ancients!.batchBDeaths).toBe((3 + (s.lastCombat?.playerDeaths ?? 0)) % 4);
    // A combat buff: the Shop body is unchanged.
    expect(s.board.find((c) => c.uid === 'm1')?.attack ?? 1).toBe(1);
  });
});

describe('Emissary × FORTUNE: "Your first Shop Spell each turn is free."', () => {
  const slot = (uid: string) => ({ uid, cardId: 'sparkplug' });
  const price = CARD_INDEX['sparkplug']!.cost ?? 0;
  it('the first Shop spell bought each turn costs 0; the second costs its price; a new turn is free again', () => {
    let s = picked('fortune', { spell: slot('s1') });
    expect(price).toBeGreaterThan(0);
    expect(heroPowerText(s)).toBe(`${BASE} Your first Shop spell each turn is free. Ready this turn.`);
    const gold = s.embers;
    s = reduce(s, { type: 'buy', uid: 's1' });
    expect(s.hand.length).toBe(1);
    expect(s.embers).toBe(gold);
    expect(heroPowerText(s)).toContain('Used this turn.');
    s = reduce({ ...s, spell: slot('s2') }, { type: 'buy', uid: 's2' });
    expect(s.embers).toBe(gold - price);
    const next = { ...s, wave: s.wave + 1, spell: slot('s3') };
    expect(reduce(next, { type: 'buy', uid: 's3' }).embers).toBe(next.embers);
  });
  it('a spell offer in the minion row is free too, and without the pairing it costs its price', () => {
    let s = picked('fortune', { shop: [{ uid: 'o1', cardId: 'sparkplug' }] });
    const gold = s.embers;
    s = reduce(s, { type: 'buy', uid: 'o1' });
    expect(s.embers).toBe(gold);
    const plain = picked('death', { spell: slot('s1') });
    expect(reduce(plain, { type: 'buy', uid: 's1' }).embers).toBe(plain.embers - price);
  });
});

describe('Emissary × WAR: "United Front triggers twice."', () => {
  it('combat: two Start of Combat triggers, each its own beat', () => {
    const s = picked('war', { board: board() });
    expect(heroPowerText(s)).toBe(`${BASE} It triggers **twice**.`);
    expect(ancientCombatMods(s).ancientFrontShape).toEqual({ label: 'Ancient of War', reps: 2 });
    const f = fightNow(s);
    expect(frontTriggers(f)).toBe(2);
    expect(frontBuffs(f)).toBe(4); // the first Mech and the Dwarf, twice
    expect(frontBuffs(fightNow(picked('fortune', { board: board() })))).toBe(2);
  });
  it('Shop: a Shop United Front fires twice too', () => {
    const s = structuredClone(picked('war', { board: board() }));
    fireShopUnitedFront(s);
    expect(at(s, 'm1').attack).toBe(1 + 2 * SPELLS);
    expect(at(s, 'm2').attack).toBe(1);
  });
});

describe('Emissary × GENESIS: "Every 5 spells you cast, get a random Shop spell."', () => {
  it('Shop: the 5th spell cast gets a random Shop spell of your tier or lower', () => {
    let s = picked('genesis', { hand: [1, 2, 3, 4, 5].map((i) => gift(`g${i}`)) });
    expect(heroPowerText(s)).toContain('Every **5** spells you cast, get a random Shop spell (**5** more to go).');
    for (const i of [1, 2, 3, 4]) s = cast(s, `g${i}`);
    expect(spellsInHand(s).length).toBe(0);
    expect(heroPowerText(s)).toContain('(**1** more to go)');
    s = cast(s, 'g5');
    expect(spellsInHand(s).length).toBe(1);
    expect(runSpells(s).filter((c) => c.tier <= s.tier).map((c) => c.id)).toContain(spellsInHand(s)[0]!.cardId);
  });
  it('combat: the cast that lands on the 5th pays mid-fight (a live card to hand); settle keeps the count', () => {
    let s = picked('genesis', { board: riftBoard() });
    s = { ...s, ancients: { ...s.ancients!, batchBSpells: 4 } };
    expect(ancientCombatMods(s).ancientSpellCountGrant).toEqual({ every: 5, tick: 4, label: 'Ancient of Genesis' });
    s = fightNow(s, 100, 100000);
    const casts = s.lastCombat!.playerSpellsCast ?? 0;
    expect(casts).toBeGreaterThan(0);
    expect((s.lastCombat!.events ?? []).filter((e) => e.type === 'toHand' && e.side === 'player').length).toBe(Math.floor((4 + casts) / 5));
    s = reduce(s, { type: 'resolveCombat' });
    expect(spellsInHand(s).length).toBe(Math.floor((4 + casts) / 5));
    expect(s.ancients!.batchBSpells).toBe(4 + casts);
  });
  it('without the pairing nothing is granted', () => {
    let s = picked('death', { hand: [1, 2, 3, 4, 5].map((i) => gift(`g${i}`)) });
    for (const i of [1, 2, 3, 4, 5]) s = cast(s, `g${i}`);
    expect(spellsInHand(s).length).toBe(0);
  });
});

describe('Emissary × TIME: "United Front triggers at End of Turn instead."', () => {
  it('End of Turn gives one minion of each type +N/+N permanently, and there is no Start of Combat fire', () => {
    let s = picked('time', { board: board() });
    expect(heroPowerText(s)).toBe(`**End of Turn:** give a friendly minion of each type **+${SPELLS}/+${SPELLS}** permanently (1 per spell cast this game).`);
    expect(ancientCombatMods(s).ancientFrontShape).toBeUndefined();
    s = fightNow(s);
    expect(frontTriggers(s)).toBe(0);
    expect(frontBuffs(s)).toBe(0);
    s = reduce(s, { type: 'resolveCombat' });
    expect(at(s, 'm1').attack).toBe(1 + SPELLS);
    expect(at(s, 'dw').attack).toBe(1 + SPELLS);
    expect(at(s, 'm2').attack).toBe(1);
  });
  it('without the pairing the Shop bodies are unchanged after the fight', () => {
    const s = reduce(fightNow(picked('fortune', { board: board() })), { type: 'resolveCombat' });
    expect(at(s, 'm1').attack).toBe(1);
  });
});

describe('Emissary × BONDS: "United Front hits all your minions."', () => {
  it('every friendly minion collects at Start of Combat, a second of a type and a typeless one included', () => {
    const s = picked('bonds', { board: board() });
    expect(heroPowerText(s)).toBe(`**Start of Combat:** give your minions **+${SPELLS}/+${SPELLS}** (1 per spell cast this game).`);
    expect(ancientCombatMods(s).ancientFrontShape).toEqual({ label: 'Ancient of Bonds', all: true });
    const f = fightNow(s);
    expect(frontTriggers(f)).toBe(1);
    expect(frontBuffs(f)).toBe(4);
  });
});

describe('Emissary × Ancients: save / restore and determinism', () => {
  it('a JSON round trip keeps the counts and the free spell', () => {
    let s = picked('genesis', { hand: [1, 2, 3, 4, 5].map((i) => gift(`g${i}`)) });
    for (const i of [1, 2, 3]) s = cast(s, `g${i}`);
    const back = JSON.parse(JSON.stringify(s)) as RunState;
    expect(back.ancients).toEqual(s.ancients);
    expect(cast(cast(back, 'g4'), 'g5').hand.map((c) => c.cardId)).toEqual(cast(cast(s, 'g4'), 'g5').hand.map((c) => c.cardId));
  });
  it('the same seed fights the same fight', () => {
    const run = () => JSON.stringify(fightNow(picked('war', { board: board() })).lastCombat!.events);
    expect(run()).toBe(run());
  });
});
