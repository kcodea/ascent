/**
 * ANCIENTS × KINDNESS (owner pairings 2026-11-10). Great Presence (passive): "Discover a Gift every 4 turns." (turns 4,
 * 8, 12, ...). Every pairing in the phase(s) it fires in.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX, GIFT_IDS } from '@game/content';
import {
  ANCIENT_IDS, ancientOfferText, createRun, enableAncients, heroPowerText, reduce,
  type AncientId, type BoardCard, type BoardSnapshot, type RunState,
} from './index';
import { runSpells } from './spellPool';

const BASE = 'Discover a **Gift** every 4 turns. Next in **1** turn.';
const N = (i: number) => ['beatboxer', 'dw_edward', 'attachmentconductor', 'sandbag'][i % 4]!;

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
/** Turn 3 by default, so the next Start of Turn (turn 4) is a Great Presence turn. */
const base = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, 'kindness'), phase: 'recruit', wave: 3, embers: 40, heroReady: true, hand: [], board: [], shop: [], spell: null, ...over } as RunState);
const picked = (id: AncientId, over: Partial<RunState> = {}): RunState => {
  let s = enableAncients(base(over));
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  s = reduce(s, { type: 'pickAncient', id });
  expect(s.ancients!.picked).toBe(id);
  return s;
};
const foes = (wave: number): BoardSnapshot => ({
  v: 1, wave, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: 400,
  minions: [{ cardId: 'sandbag', attack: 0, health: 400, keywords: [] }], seed: 1, origin: 'self',
});
const fightNow = (s: RunState): RunState => reduce({ ...s, servedBoards: { [s.wave]: foes(s.wave) } }, { type: 'faceOmen' });
/** Fight this turn's combat and open the next Shop (its Start of Turn has run). */
const nextTurn = (s: RunState): RunState => reduce(fightNow(s), { type: 'resolveCombat' });
const count = (s: RunState, cardId: string) => s.hand.filter((c) => c.cardId === cardId).length;
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;

describe('Kindness × every Ancient has a written pairing', () => {
  it('all six are written (no "Not written yet."), and none uses an em dash', () => {
    for (const id of ANCIENT_IDS) {
      expect(ancientOfferText('kindness', id)).not.toBe('Not written yet.');
      expect(ancientOfferText('kindness', id)).not.toMatch(/—|--/);
    }
  });
});

describe('Kindness × DEATH: "Great Presence also gets you a Grave Invitation."', () => {
  it('a Great Presence turn opens the Gift Discover and puts a Grave Invitation in hand', () => {
    let s = picked('death');
    expect(heroPowerText(s)).toBe(`${BASE} It also gets you a **Grave Invitation**.`);
    s = nextTurn(s);
    expect(s.wave).toBe(4);
    expect(s.discover?.length).toBe(3);
    expect(count(s, 'gift_grave_invitation')).toBe(1);
  });
  it('a turn that is not a Great Presence turn gets nothing, and so does a run without the pairing', () => {
    expect(count(nextTurn(picked('death', { wave: 1 })), 'gift_grave_invitation')).toBe(0);
    const plain = nextTurn(picked('time'));
    expect(plain.discover?.length).toBe(3);
    expect(count(plain, 'gift_grave_invitation')).toBe(0);
  });
});

describe('Kindness × FORTUNE: "Get 2 Royal Allowances."', () => {
  it('the pick puts 2 Royal Allowances in hand, once (a later Great Presence adds none)', () => {
    let s = picked('fortune');
    expect(heroPowerText(s)).toBe(`${BASE} You got **2** **Royal Allowances** when this awakened.`);
    expect(count(s, 'gift_allowance')).toBe(2);
    s = nextTurn(s);
    expect(s.discover?.length).toBe(3);
    expect(count(s, 'gift_allowance')).toBe(2);
  });
  it('a full hand still gets both (a promised card may over-cap the hand)', () => {
    const hand = Array.from({ length: 10 }, (_, i) => card(`h${i}`, N(i)));
    expect(count(picked('fortune', { hand }), 'gift_allowance')).toBe(2);
  });
});

describe("Kindness × WAR: \"Great Presence also gets you a Champion's Regalia.\"", () => {
  it("a Great Presence turn also puts a Champion's Regalia in hand", () => {
    let s = picked('war');
    expect(heroPowerText(s)).toBe(`${BASE} It also gets you a **Champion's Regalia**.`);
    s = nextTurn(s);
    expect(s.discover?.length).toBe(3);
    expect(count(s, 'gift_regalia')).toBe(1);
  });
});

describe('Kindness × GENESIS: "Great Presence lets you pick 2 Gifts."', () => {
  it('after the first pick the offer comes back with the other two Gifts; the second pick closes it', () => {
    let s = picked('genesis');
    expect(heroPowerText(s)).toBe(`${BASE} You pick **2** of the Gifts it offers.`);
    s = nextTurn(s);
    const offer = [...s.discover!];
    expect(offer.length).toBe(3);
    expect(offer.every((id) => GIFT_IDS.includes(id))).toBe(true);
    s = reduce(s, { type: 'discover', index: 1 });
    expect(s.discover).toEqual([offer[0], offer[2]]);
    expect(count(s, offer[1]!)).toBe(1);
    s = reduce(s, { type: 'discover', index: 0 });
    expect(s.discover ?? undefined).toBeUndefined();
    expect(count(s, offer[0]!)).toBe(1);
    expect(s.hand.length).toBe(2);
    expect(s.ancients!.kindnessPicksLeft).toBeUndefined();
  });
  it('without Genesis the Discover closes after one pick; another Discover is never reopened', () => {
    let s = nextTurn(picked('death'));
    s = reduce(s, { type: 'discover', index: 0 });
    expect(s.discover ?? undefined).toBeUndefined();
    let g = picked('genesis', { tier: 3, hand: [card('b', 'beyondsummit')] });
    g = reduce(g, { type: 'play', uid: 'b' });
    expect(g.discover?.length).toBeGreaterThan(0);
    g = reduce(g, { type: 'discover', index: 0 });
    expect(g.discover ?? undefined).toBeUndefined();
  });
});

describe('Kindness × TIME: "End of Turn: Get 2 random shop spells."', () => {
  it('End of Turn puts 2 Shop spells of your tier or lower in hand; Great Presence still fires', () => {
    let s = picked('time', { tier: 2 });
    expect(heroPowerText(s)).toBe(`${BASE} **End of Turn:** get **2** random Shop spells.`);
    s = fightNow(s);
    expect(s.hand.length).toBe(2);
    const pool = runSpells(s).filter((c) => c.tier <= 2).map((c) => c.id);
    expect(s.hand.every((c) => pool.includes(c.cardId))).toBe(true);
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.discover?.length).toBe(3);
  });
  it('no pairing, no spells', () => {
    expect(fightNow(picked('death')).hand.length).toBe(0);
  });
});

describe('Kindness × BONDS: "Gifts you cast on a minion also cast on an adjacent minion."', () => {
  const board = () => [card('a', N(0)), card('b', N(1)), card('c', N(2))];
  const KEYS = ['DS', 'CR', 'W'];
  const has = (c: BoardCard) => KEYS.every((k) => c.keywords.includes(k as BoardCard['keywords'][number]));
  it('a Gift cast on an end minion is also cast on its one neighbour', () => {
    let s = picked('bonds', { board: board(), hand: [card('g', 'gift_regalia')] });
    expect(heroPowerText(s)).toBe(`${BASE} **Gifts** you cast on a minion also cast on a minion next to it.`);
    s = reduce(s, { type: 'play', uid: 'g', targetUid: 'a' });
    expect(has(at(s, 'a'))).toBe(true);
    expect(has(at(s, 'b'))).toBe(true);
    expect(has(at(s, 'c'))).toBe(false);
    expect(s.hand.length).toBe(0);
  });
  it('a Gift cast on a middle minion picks ONE neighbour; alone on the board it hits only its target', () => {
    let s = picked('bonds', { board: board(), hand: [card('g', 'gift_regalia')] });
    s = reduce(s, { type: 'play', uid: 'g', targetUid: 'b' });
    expect(has(at(s, 'b'))).toBe(true);
    expect([at(s, 'a'), at(s, 'c')].filter(has).length).toBe(1);
    let solo = picked('bonds', { board: [card('a', N(0))], hand: [card('g', 'gift_regalia')] });
    solo = reduce(solo, { type: 'play', uid: 'g', targetUid: 'a' });
    expect(has(at(solo, 'a'))).toBe(true);
  });
  it('without Bonds only the target gains it', () => {
    let s = picked('death', { board: board(), hand: [card('g', 'gift_regalia')] });
    s = reduce(s, { type: 'play', uid: 'g', targetUid: 'a' });
    expect(has(at(s, 'a'))).toBe(true);
    expect(has(at(s, 'b'))).toBe(false);
  });
  it('it is one spell cast: the cast count rises by 1, not 2', () => {
    let s = picked('bonds', { board: board(), hand: [card('g', 'gift_regalia')] });
    const before = s.spellsCast;
    s = reduce(s, { type: 'play', uid: 'g', targetUid: 'a' });
    expect(s.spellsCast).toBe(before + 1);
  });
});

describe('Kindness × Ancients: save / restore and determinism', () => {
  it('a JSON round trip mid-Genesis keeps the second pick', () => {
    let s = nextTurn(picked('genesis'));
    s = reduce(s, { type: 'discover', index: 0 });
    const back = JSON.parse(JSON.stringify(s)) as RunState;
    expect(back.ancients).toEqual(s.ancients);
    expect(reduce(back, { type: 'discover', index: 0 }).hand.map((c) => c.cardId)).toEqual(reduce(s, { type: 'discover', index: 0 }).hand.map((c) => c.cardId));
  });
  it('the same seed gives the same End-of-Turn spells and the same Bonds neighbour', () => {
    const time = () => fightNow(picked('time', { tier: 3 })).hand.map((c) => c.cardId);
    expect(time()).toEqual(time());
    const bonds = () => {
      const s = reduce(picked('bonds', { board: [card('a', N(0)), card('b', N(1)), card('c', N(2))], hand: [card('g', 'gift_regalia')] }), { type: 'play', uid: 'g', targetUid: 'b' });
      return s.board.map((c) => c.keywords.join(''));
    };
    expect(bonds()).toEqual(bonds());
  });
});
