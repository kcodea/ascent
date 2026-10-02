/**
 * ANCIENTS × ROBIN (owner pairings 2026-10-02). Spoils (passive): "For each minion you sell, gain 1 Gold next turn." A
 * Spoils count is one sale. Every pairing in the phase(s) it fires in.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { CombatEvent } from '@game/core';
import {
  ANCIENT_IDS, ancientCombatMods, ancientOfferText, createRun, enableAncients, heroPowerText, offerBuyPrice, reduce,
  type AncientId, type BoardCard, type BoardSnapshot, type RunState, type ShopCard,
} from './index';

const BASE = 'For each minion you sell, gain 1 Gold next turn.';
const plain = (c: (typeof CARD_INDEX)[string]) => !!c && !c.spell && !c.ruby && !c.token && c.effects.length === 0 && c.keywords.length === 0 && !c.universalTribe;
/** Effect-less bodies, so a sale, a play or a summon never muddies the numbers. */
const NEUTRALS = Object.values(CARD_INDEX).filter((c) => plain(c) && c.tribe === 'neutral' && !c.tribe2 && !c.henchman).map((c) => c.id);
const typed = (t: string) => Object.values(CARD_INDEX).find((c) => plain(c) && c.tribe === t && !c.tribe2)!.id;
const BEAST = typed('beast');
const DEMON = typed('demon');
const N1 = NEUTRALS[0]!;
const ALL = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.ruby && !c.token && c.universalTribe)!.id;
/** An Echo that summons a fixed body count (the Soren fixture). */
const ECHO = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && !c.ruby && c.keywords.length === 0
  && c.effects.length === 1 && c.effects[0]!.on === 'onDeath' && c.effects[0]!.do === 'deathrattleSummon'
  && !(c.effects[0]!.params as { fixed?: boolean }).fixed)!;

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const base = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, 'robin'), phase: 'recruit', embers: 60, hand: [], ...over } as RunState);
const picked = (id: AncientId, over: Partial<RunState> = {}): RunState => {
  let s = enableAncients(base(over));
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  s = reduce(s, { type: 'pickAncient', id });
  expect(s.ancients!.picked).toBe(id);
  return s;
};
const sell = (s: RunState, uid: string): RunState => {
  const t = reduce(s, { type: 'sell', uid });
  expect(t, `sold ${uid}`).not.toBe(s);
  return t;
};
const sellAll = (s: RunState, uids: string[]): RunState => uids.reduce(sell, s);
const foes = (wave: number, attack: number, health: number): BoardSnapshot => ({
  v: 1, wave, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: health,
  minions: [{ cardId: 'sandbag', attack, health, keywords: [] }], seed: 1, origin: 'self',
});
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const fightNow = (s: RunState, attack = 0, health = 400): RunState => reduce({ ...s, servedBoards: { [s.wave]: foes(s.wave, attack, health) } }, { type: 'faceOmen' });
const events = (s: RunState): CombatEvent[] => s.lastCombat!.events as CombatEvent[];
const buffsFrom = (ev: CombatEvent[], source: string) =>
  ev.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.source === source);
const offer = (uid: string, cardId: string): ShopCard => ({ uid, cardId } as ShopCard);
/** Hand of `n` distinct neutral bodies (never three of one card, so a sale never touches a triple). */
const handOf = (n: number, prefix = 'h'): BoardCard[] => Array.from({ length: n }, (_, i) => card(`${prefix}${i}`, NEUTRALS[i % NEUTRALS.length]!));

describe('Robin × every Ancient has a written pairing', () => {
  it('all six are written (no "Not written yet."), and none uses an em dash', () => {
    for (const id of ANCIENT_IDS) {
      expect(ancientOfferText('robin', id)).not.toBe('Not written yet.');
      expect(ancientOfferText('robin', id)).not.toMatch(/—|--/);
    }
  });
  it('the fixtures are what the tests assume', () => {
    expect(NEUTRALS.length).toBeGreaterThanOrEqual(8);
    expect(CARD_INDEX[BEAST]!.tribe).toBe('beast');
    expect(CARD_INDEX[DEMON]!.tribe).toBe('demon');
    expect(CARD_INDEX[ALL]!.universalTribe).toBe(true);
  });
  it('without Ancients, a sale still banks Spoils (+1 Gold next turn) and nothing else', () => {
    let s = base({ board: [card('a', N1), card('b', NEUTRALS[1]!)] });
    const bonus = s.bonusEmbersNextTurn ?? 0;
    const rolls = s.freeRolls;
    s = sell(s, 'b');
    expect(s.bonusEmbersNextTurn).toBe(bonus + 1);
    expect(s.freeRolls).toBe(rolls);
    expect(at(s, 'a').attack).toBe(CARD_INDEX[N1]!.attack);
    expect(s.ancients).toBeUndefined();
  });
});

describe('Robin × DEATH: "Summoned minions gain +3/+2 for every count of Spoils this turn."', () => {
  it('a minion played after two sales this turn gains +6/+4, permanently; the power prints the live value', () => {
    let s = picked('death', { hand: [card('p', N1), ...handOf(2, 'x').map((c, i) => ({ ...c, cardId: NEUTRALS[i + 1]! }))] });
    expect(heroPowerText(s)).toBe(`${BASE} Minions you summon gain **+3/+2** for every minion you sold this turn (**0** sold: **+0/+0**).`);
    s = sellAll(s, ['x0', 'x1']);
    expect(heroPowerText(s)).toContain('(**2** sold: **+6/+4**)');
    s = reduce(s, { type: 'play', uid: 'p' });
    expect(at(s, 'p')).toMatchObject({ attack: CARD_INDEX[N1]!.attack + 6, health: CARD_INDEX[N1]!.health + 4 });
  });
  it('no sales this turn, no gain; a new turn starts the count at 0', () => {
    let s = picked('death', { hand: [card('p', N1)] });
    s = reduce(s, { type: 'play', uid: 'p' });
    expect(at(s, 'p').attack).toBe(CARD_INDEX[N1]!.attack);
    const t = { ...s, ancients: { ...s.ancients!, robinSpoils: { wave: s.wave - 1, n: 5 } } };
    expect(heroPowerText(t)).toContain('(**0** sold: **+0/+0**)');
  });
  it('combat: every friendly summon gains the turn\'s amount as a combat buff (an Echo\'s bodies here)', () => {
    let s = picked('death', { board: [card('e', ECHO.id, { attack: 1, health: 1 })], hand: handOf(3) });
    s = sellAll(s, ['h0', 'h1', 'h2']);
    expect(ancientCombatMods(s).ancientSummonGain).toEqual({ attack: 9, health: 6, label: 'Ancient of Death' });
    s = fightNow(s, 100, 1000);
    const summons = events(s).filter((e): e is Extract<CombatEvent, { type: 'summon' }> => e.type === 'summon' && e.side === 'player');
    expect(summons.length).toBeGreaterThan(0);
    const grants = buffsFrom(events(s), 'Ancient of Death');
    expect(grants.length).toBe(summons.length);
    for (const g of grants) expect(g).toMatchObject({ attack: 9, health: 6 });
  });
  it('the combat mod is absent with no sales this turn', () => {
    expect(ancientCombatMods(picked('death')).ancientSummonGain).toBeUndefined();
  });
});

describe('Robin × FORTUNE: "Every 2 minions sold also grants a free refresh."', () => {
  it('every 2nd sale banks a free Refresh right then; the power prints the sales left', () => {
    let s = picked('fortune', { hand: handOf(4) });
    const rolls = s.freeRolls;
    expect(heroPowerText(s)).toContain('(**2** more to go)');
    s = sell(s, 'h0');
    expect(s.freeRolls).toBe(rolls);
    expect(heroPowerText(s)).toContain('(**1** more to go)');
    s = sell(s, 'h1');
    expect(s.freeRolls).toBe(rolls + 1);
    expect(heroPowerText(s)).toContain('(**2** more to go)');
    s = sellAll(s, ['h2', 'h3']);
    expect(s.freeRolls).toBe(rolls + 2);
  });
  it('a spell that sells (Feed the Alpha) counts as a sale, once', () => {
    let s = picked('fortune', { board: [card('a', N1), card('b', BEAST)], hand: [card('h0', NEUTRALS[1]!), card('sp', 'feedalpha')] });
    const rolls = s.freeRolls;
    s = sell(s, 'h0');
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: 'a' });
    expect(s.board.some((c) => c.uid === 'a')).toBe(false);
    expect(s.freeRolls).toBe(rolls + 1);
    expect(s.ancients!.robinSpoils!.n).toBe(2);
  });
  it('the banked Refresh is free (the Tradesman bank)', () => {
    let s = sellAll(picked('fortune', { hand: handOf(2) }), ['h0', 'h1']);
    const gold = s.embers;
    s = reduce(s, { type: 'roll' });
    expect(s.embers).toBe(gold);
  });
});

describe('Robin × WAR: "Give your left-most minion +2/+3 every time you sell a minion."', () => {
  it('each sale gives the left-most minion (after the sale) +2/+3, permanently', () => {
    let s = picked('war', { board: [card('a', N1), card('b', NEUTRALS[1]!), card('c', NEUTRALS[2]!)] });
    s = sell(s, 'a');
    expect(at(s, 'b')).toMatchObject({ attack: CARD_INDEX[NEUTRALS[1]!]!.attack + 2, health: CARD_INDEX[NEUTRALS[1]!]!.health + 3 });
    s = sell(s, 'c');
    expect(at(s, 'b')).toMatchObject({ attack: CARD_INDEX[NEUTRALS[1]!]!.attack + 4, health: CARD_INDEX[NEUTRALS[1]!]!.health + 6 });
  });
  it('a sale from hand counts; an empty board gets nothing', () => {
    let s = picked('war', { board: [card('a', N1)], hand: handOf(1) });
    s = sell(s, 'h0');
    expect(at(s, 'a').attack).toBe(CARD_INDEX[N1]!.attack + 2);
    s = sell(s, 'a');
    expect(s.board.length).toBe(0);
  });
});

describe('Robin × GENESIS: "When you sell 7 minions, get a copy of one of them."', () => {
  it('the 7th sale gives a PLAIN copy of one of the seven (seeded), and the count starts over', () => {
    const hand = handOf(7);
    let s = picked('genesis', { hand: hand.map((c, i) => (i === 3 ? { ...c, attack: 40, golden: true } : c)) });
    s = sellAll(s, ['h0', 'h1', 'h2', 'h3', 'h4', 'h5']);
    expect(s.hand.length).toBe(1);
    expect(heroPowerText(s)).toContain('(**1** more to go)');
    s = sell(s, 'h6');
    expect(s.hand.length).toBe(1);
    const copy = s.hand[0]!;
    expect(hand.map((c) => c.cardId)).toContain(copy.cardId);
    expect(copy.golden).toBe(false);
    expect(copy.attack).toBe(CARD_INDEX[copy.cardId]!.attack);
    expect(s.ancients!.robinWindow).toEqual([]);
    expect(heroPowerText(s)).toContain('(**7** more to go)');
  });
  it('the same state picks the same copy', () => {
    const run = () => sellAll(picked('genesis', { hand: handOf(7) }), ['h0', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']).hand[0]!.cardId;
    expect(run()).toBe(run());
  });
});

describe('Robin × TIME: "End of Turn: Increase your max gold by 1"', () => {
  it('each End of Turn adds 1 max Gold, permanently (no cap); the power prints the total', () => {
    let s = picked('time', { board: [card('a', N1, { health: 99 })] });
    const bonus = s.maxGoldBonus ?? 0;
    expect(heroPowerText(s)).toContain('**+0** so far');
    s = reduce(fightNow(s), { type: 'resolveCombat' });
    expect(s.maxGoldBonus).toBe(bonus + 1);
    s = reduce(fightNow(s), { type: 'resolveCombat' });
    expect(s.maxGoldBonus).toBe(bonus + 2);
    expect(heroPowerText(s)).toContain('**+2** so far');
  });
});

describe('Robin × BONDS: "Selling a minion makes the next of its tribe cost 2g."', () => {
  it('a Beast sale prices the next Beast at 2 Gold (not a Demon); the buy spends the mark', () => {
    let s = picked('bonds', { board: [card('b', BEAST)] });
    s = sell(s, 'b');
    expect(s.ancients!.robinBonds).toEqual(['beast']);
    expect(heroPowerText(s)).toContain('Ready: **Beast**.');
    s = { ...s, shop: [offer('o1', BEAST), offer('o2', DEMON), offer('o3', BEAST)] };
    expect(offerBuyPrice(s, s.shop[0]!).cost).toBe(2);
    expect(offerBuyPrice(s, s.shop[1]!).cost).toBe(3);
    const gold = s.embers;
    s = reduce(s, { type: 'buy', uid: 'o1' });
    expect(s.embers).toBe(gold - 2);
    expect(s.ancients!.robinBonds).toEqual([]);
    expect(offerBuyPrice(s, s.shop.find((o) => o.uid === 'o3')!).cost, 'one discount per mark').toBe(3);
  });
  it('the mark waits across turns until used', () => {
    let s = sell(picked('bonds', { board: [card('b', BEAST, { health: 99 }), card('k', N1, { health: 99 })] }), 'b');
    s = reduce(fightNow(s), { type: 'resolveCombat' });
    expect(s.ancients!.robinBonds).toEqual(['beast']);
  });
  it('a typeless (neutral) sale marks nothing; an All-types sale marks any type, and an All-types buy spends a mark', () => {
    let s = sell(picked('bonds', { hand: [card('n', N1)] }), 'n');
    expect(s.ancients!.robinBonds ?? []).toEqual([]);
    s = sell({ ...s, hand: [card('u', ALL)] }, 'u');
    expect(s.ancients!.robinBonds).toEqual(['all']);
    expect(offerBuyPrice({ ...s, shop: [offer('o', DEMON)] }, offer('o', DEMON)).cost).toBe(2);
    expect(offerBuyPrice({ ...s, shop: [offer('o', N1)] }, offer('o', N1)).cost, 'a neutral minion has no type').toBe(3);
    const t = { ...s, ancients: { ...s.ancients!, robinBonds: ['demon' as const] } };
    expect(offerBuyPrice(t, offer('o', ALL)).cost).toBeLessThanOrEqual(2);
  });
});

describe('Robin × save / restore and determinism', () => {
  it('the counters and marks survive a JSON round trip', () => {
    let s = sellAll(picked('genesis', { hand: handOf(3) }), ['h0', 'h1', 'h2']);
    s = JSON.parse(JSON.stringify(s)) as RunState;
    expect(s.ancients!.robinWindow!.length).toBe(3);
    expect(heroPowerText(s)).toContain('(**4** more to go)');
    let b = sell(picked('bonds', { board: [card('b', BEAST)] }), 'b');
    b = JSON.parse(JSON.stringify(b)) as RunState;
    expect(offerBuyPrice(b, offer('o', BEAST)).cost).toBe(2);
    let d = sellAll(picked('death', { hand: handOf(2) }), ['h0', 'h1']);
    d = JSON.parse(JSON.stringify(d)) as RunState;
    expect(ancientCombatMods(d).ancientSummonGain).toMatchObject({ attack: 6, health: 4 });
  });
  it('every pairing replays identically from the same state', () => {
    for (const id of ANCIENT_IDS) {
      const run = () => {
        let s = picked(id, { board: [card('e', ECHO.id, { attack: 1, health: 1 }), card('b', BEAST, { health: 40 })], hand: handOf(7) });
        s = sellAll(s, ['h0', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
        return reduce(fightNow(s, 100, 1000), { type: 'resolveCombat' });
      };
      const a = run();
      const b = run();
      expect(JSON.stringify(a.lastCombat?.events), id).toBe(JSON.stringify(b.lastCombat?.events));
      expect(JSON.stringify(a.board), id).toBe(JSON.stringify(b.board));
      expect(JSON.stringify(a.hand), id).toBe(JSON.stringify(b.hand));
      expect(JSON.stringify(a.ancients), id).toBe(JSON.stringify(b.ancients));
    }
  });
});
