/**
 * ANCIENTS × GORR (owner pairings 2026-10-02). Four Peat (passive): "When you buy 3 minions in a turn, get a plain copy of
 * one of them at random." Every pairing in the phase(s) it fires in.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { CombatEvent } from '@game/core';
import {
  ANCIENT_IDS, ancientAvengeCountdown, ancientCombatMods, ancientOfferText, createRun, enableAncients, heroPowerText, offerBuyPrice, reduce,
  type AncientId, type BoardCard, type BoardSnapshot, type RunState, type ShopCard,
} from './index';
import { destroyMinionInShop, makeContext } from './recruit';

const BASE = 'When you buy 3 minions in a turn, get a plain copy of one of them at random.';
const plain = (c: (typeof CARD_INDEX)[string]) => !!c && !c.spell && !c.ruby && !c.token && c.effects.length === 0 && c.keywords.length === 0 && !c.universalTribe;
const NEUTRALS = Object.values(CARD_INDEX).filter((c) => plain(c) && c.tribe === 'neutral' && !c.tribe2 && !c.henchman).map((c) => c.id);
const N = (i: number) => NEUTRALS[i % NEUTRALS.length]!;
const SPELLS = Object.values(CARD_INDEX).filter((c) => !!c && c.spell && !c.token && !c.gift && !c.ruby && !(c.chooseOne?.length) && (c.cost ?? 0) <= 3).map((c) => c.id);

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const base = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, 'gorr'), phase: 'recruit', embers: 99, hand: [], ...over } as RunState);
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
const events = (s: RunState): CombatEvent[] => s.lastCombat!.events as CombatEvent[];
const toHands = (s: RunState) => events(s).filter((e): e is Extract<CombatEvent, { type: 'toHand' }> => e.type === 'toHand' && e.side === 'player');
const offer = (uid: string, cardId: string): ShopCard => ({ uid, cardId } as ShopCard);
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const buy = (s: RunState, id: string, u = 'o'): RunState => {
  const next = reduce({ ...s, shop: [offer(u, id)] }, { type: 'buy', uid: u });
  expect(next, `bought ${id}`).not.toBe(s);
  return next;
};
const buyAll = (s: RunState, ids: string[]): RunState => ids.reduce((t, id, i) => buy(t, id, `o${i}`), s);
const count = (s: RunState, id: string) => s.hand.filter((c) => c.cardId === id).length;

describe('Gorr × every Ancient has a written pairing', () => {
  it('all six are written (no "Not written yet."), and none uses an em dash', () => {
    for (const id of ANCIENT_IDS) {
      expect(ancientOfferText('gorr', id)).not.toBe('Not written yet.');
      expect(ancientOfferText('gorr', id)).not.toMatch(/—|--/);
    }
  });
  it('without Ancients, Four Peat still copies one of the three on the 3rd minion buy, and buys cost the normal price', () => {
    let s = base();
    expect(offerBuyPrice({ ...s, shop: [offer('o', N(0))] }, offer('o', N(0))).cost).toBe(3);
    s = buyAll(s, [N(0), N(1), N(2)]);
    expect(s.hand.length).toBe(4);
    expect(s.ancients).toBeUndefined();
  });
});

describe('Gorr × DEATH: "Avenge (6): Get a copy of a minion you bought last turn."', () => {
  it('Shop: the 6th friendly death gets a plain copy of a minion bought LAST turn (the buy log survives the turn)', () => {
    let s = picked('death', { wave: 4 });
    s = buyAll(s, [N(0), N(1)]); // turn 4's buys
    s = reduce(fightNow({ ...s, hand: [] }, 0, 1), { type: 'resolveCombat' });
    expect(s.wave).toBe(5);
    s = structuredClone({ ...s, hand: [], board: ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'].map((u) => card(u, N(3))) });
    for (const u of ['d1', 'd2', 'd3', 'd4', 'd5']) destroyMinionInShop(makeContext(s), at(s, u));
    expect(s.ancients!.gorrDeaths).toBe(5);
    expect(s.hand.length).toBe(0);
    expect(heroPowerText(s)).toBe(`${BASE} **Avenge (6):** get a plain copy of a minion you bought last turn (**1** more to go).`);
    destroyMinionInShop(makeContext(s), at(s, 'd6'));
    expect(s.ancients!.gorrDeaths).toBe(0);
    expect(s.hand.length).toBe(1);
    expect([N(0), N(1)]).toContain(s.hand[0]!.cardId);
    expect(s.hand[0]!.attack, 'plain').toBe(CARD_INDEX[s.hand[0]!.cardId]!.attack);
  });
  it('combat: the carried count fires MID-FIGHT (a toHand of a last-turn buy), and settle carries the remainder', () => {
    let s = picked('death', { wave: 4 });
    s = buyAll(s, [N(0)]);
    s = reduce(fightNow({ ...s, hand: [] }, 0, 1), { type: 'resolveCombat' });
    s = { ...s, hand: [], board: ['a', 'b', 'c'].map((u) => card(u, N(2), { attack: 1, health: 1 })), ancients: { ...s.ancients!, gorrDeaths: 5 } };
    expect(ancientCombatMods(s).ancientGorrAvenge).toEqual({ every: 6, tick: 5, ids: [N(0)], label: 'Ancient of Death' });
    expect(ancientAvengeCountdown(s)).toBe(1);
    s = fightNow(s, 100, 1000);
    const th = toHands(s);
    expect(th.map((e) => e.cardId)).toEqual([N(0)]);
    const firstDeath = events(s).findIndex((e) => e.type === 'death' && e.side === 'player');
    expect(events(s).indexOf(th[0]!)).toBeGreaterThan(firstDeath);
    const deaths = s.lastCombat!.playerDeaths ?? 0;
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.ancients!.gorrDeaths).toBe((5 + deaths) % 6);
    expect(s.hand.some((c) => c.cardId === N(0))).toBe(true);
  });
  it('nothing bought last turn: the Avenge pays nothing', () => {
    const s = { ...picked('death', { wave: 4, board: [card('a', N(2), { attack: 1, health: 1 })] }) };
    const t = fightNow({ ...s, ancients: { ...s.ancients!, gorrDeaths: 5 } }, 100, 1000);
    expect(toHands(t)).toEqual([]);
  });
});

describe('Gorr × FORTUNE: "The first minion you buy each turn is free."', () => {
  it('the first minion costs 0 (the shared price the coin and bots read), the second costs 3; it resets next turn', () => {
    let s = picked('fortune', { wave: 3 });
    expect(heroPowerText(s)).toBe(`${BASE} The first minion you buy each turn is **free**. Ready this turn.`);
    expect(offerBuyPrice({ ...s, shop: [offer('o', N(0))] }, offer('o', N(0))).cost).toBe(0);
    const gold = s.embers;
    s = buy(s, N(0));
    expect(s.embers).toBe(gold);
    expect(heroPowerText(s)).toContain('Used this turn.');
    expect(offerBuyPrice({ ...s, shop: [offer('o', N(1))] }, offer('o', N(1))).cost).toBe(3);
    s = buy(s, N(1));
    expect(s.embers).toBe(gold - 3);
    s = reduce(fightNow({ ...s, hand: [] }, 0, 1), { type: 'resolveCombat' });
    expect(offerBuyPrice({ ...s, shop: [offer('o', N(2))] }, offer('o', N(2))).cost).toBe(0);
  });
  it('a spell bought first is not "a minion": the next minion is still free', () => {
    let s = picked('fortune', { wave: 3 });
    const gold = s.embers;
    s = buy(s, SPELLS[0]!);
    expect(s.embers).toBeLessThan(gold);
    expect(offerBuyPrice({ ...s, shop: [offer('o', N(1))] }, offer('o', N(1))).cost).toBe(0);
  });
});

describe('Gorr × WAR: "pummel (200): get a copy of a minion in your warband."', () => {
  it('every 200 friendly damage dealt sends a plain copy of a random living friendly minion to hand, repeating, and the tally carries', () => {
    let s = picked('war', { wave: 3, board: [card('a', N(0), { attack: 90, health: 500 }), card('b', N(1), { attack: 90, health: 500 })] });
    expect(heroPowerText(s)).toContain('(**0/200**)');
    expect(ancientCombatMods(s).ancientPummelCopy).toEqual({ every: 200, dealt: 0, label: 'Ancient of War' });
    s = fightNow(s, 1, 2000);
    const dealt = s.lastCombat!.playerAncientPummelDealt!;
    expect(dealt).toBeGreaterThanOrEqual(400);
    const th = toHands(s);
    expect(th.length).toBe(Math.floor(dealt / 200));
    for (const e of th) expect([N(0), N(1)]).toContain(e.cardId);
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.ancients!.pummelDealt).toBe(dealt);
    expect(heroPowerText(s)).toContain(`(**${dealt % 200}/200**)`);
    expect(heroPowerText(s, 0, { friendlyDamage: 1 })).toContain(`(**${(dealt + 1) % 200}/200**)`);
  });
  it('the tally carried in counts toward the first crossing', () => {
    let s = picked('war', { wave: 3, board: [card('a', N(0), { attack: 10, health: 500 })] });
    s = { ...s, ancients: { ...s.ancients!, pummelDealt: 195 } };
    s = fightNow(s, 1, 10);
    expect(toHands(s).length).toBe(1);
  });
});

describe('Gorr × GENESIS: "get a second copy of the first minion you buy each turn"', () => {
  it('the first minion bought also gives a plain copy to hand; the second does not', () => {
    let s = picked('genesis', { wave: 3 });
    expect(heroPowerText(s)).toContain('Ready this turn.');
    s = buy(s, N(0));
    expect(count(s, N(0))).toBe(2);
    expect(heroPowerText(s)).toContain('Used this turn.');
    s = buy(s, N(1), 'o2');
    expect(count(s, N(1))).toBe(1);
  });
  it('a spell first does not use it up', () => {
    let s = buy(picked('genesis', { wave: 3 }), SPELLS[0]!);
    s = buy(s, N(1), 'o2');
    expect(count(s, N(1))).toBe(2);
  });
});

describe('Gorr × TIME: "End of Turn: Get a random copy of a minion you bought this turn."', () => {
  it('End of Turn: a plain copy of one of this turn\'s minion buys; no buys, nothing', () => {
    let s = picked('time', { wave: 3 });
    expect(heroPowerText(s)).toContain('(**0** bought)');
    s = buyAll(s, [N(0), N(1)]);
    expect(heroPowerText(s)).toContain('(**2** bought)');
    s = { ...s, board: [...s.hand], hand: [] };
    s = fightNow(s);
    expect(s.hand.length).toBe(1);
    expect([N(0), N(1)]).toContain(s.hand[0]!.cardId);
    expect(fightNow(picked('time', { wave: 3 })).hand.length).toBe(0);
  });
});

describe('Gorr × BONDS: "When you buy 3 cards, give them +2/+2 and improve this."', () => {
  it('every 3rd card bought gives the minions among those 3 +X/+X wherever they are (X: 2, then 4); spells get nothing', () => {
    let s = picked('bonds', { wave: 3 });
    expect(heroPowerText(s)).toContain('**+2/+2** and improve this by **+2/+2** (**3** more to go)');
    s = buy(s, N(0), 'a');
    const first = s.hand[0]!;
    s = reduce(s, { type: 'play', uid: first.uid }); // the first one moves to the board before the payout
    s = buy(s, SPELLS[0]!, 'b');
    s = buy(s, N(1), 'c');
    expect(at(s, first.uid)).toMatchObject({ attack: CARD_INDEX[N(0)]!.attack + 2, health: CARD_INDEX[N(0)]!.health + 2 });
    const second = s.hand.find((c) => c.cardId === N(1))!;
    expect(second).toMatchObject({ attack: CARD_INDEX[N(1)]!.attack + 2, health: CARD_INDEX[N(1)]!.health + 2 });
    expect(s.hand.find((c) => c.cardId === SPELLS[0])!.buffs ?? []).toEqual([]);
    expect(s.ancients!.gorrBondsGain).toBe(4);
    expect(heroPowerText(s)).toContain('**+4/+4**');
    s = buyAll(s, [N(2), N(3), N(4)]);
    const third = s.hand.find((c) => c.cardId === N(4))!;
    expect(third.attack).toBe(CARD_INDEX[N(4)]!.attack + 4);
    expect(s.ancients!.gorrBondsGain).toBe(6);
  });
});

describe('Gorr × save / restore and determinism', () => {
  it('the logs and counters survive a JSON round trip', () => {
    let s = buyAll(picked('bonds', { wave: 3 }), [N(0), N(1)]);
    s = JSON.parse(JSON.stringify(s)) as RunState;
    expect(heroPowerText(s)).toContain('(**1** more to go)');
    s = buy(s, N(2), 'z');
    expect(s.ancients!.gorrBondsGain).toBe(4);
    let d = buyAll(picked('death', { wave: 4 }), [N(0)]);
    d = reduce(fightNow({ ...d, hand: [] }, 0, 1), { type: 'resolveCombat' });
    d = JSON.parse(JSON.stringify(d)) as RunState;
    expect(ancientCombatMods(d).ancientGorrAvenge!.ids).toEqual([N(0)]);
  });
  it('every pairing replays identically from the same state', () => {
    for (const id of ANCIENT_IDS) {
      const run = () => {
        let s = picked(id, { wave: 4, board: [card('a', N(5), { attack: 80, health: 3 }), card('b', N(6), { attack: 80, health: 2 })] });
        s = buyAll(s, [N(0), SPELLS[0]!, N(1), N(2)]);
        s = { ...s, ancients: { ...s.ancients!, gorrDeaths: 5, pummelDealt: 150 } };
        return reduce(fightNow(s, 60, 1000), { type: 'resolveCombat' });
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
