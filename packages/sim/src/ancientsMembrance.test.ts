/**
 * ANCIENTS × MEMBRANCE (owner pairings 2026-11-10). Memory (1 Gold, once per turn): "Refresh the Shop with plain copies of
 * your last opponent's board." A "Memory minion" is one of those offers. Every pairing through the real reducer.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { Keyword } from '@game/core';
import {
  ANCIENT_IDS, ancientOfferText, createRun, enableAncients, heroPowerText, offerBuyPrice, reduce,
  type AncientId, type BoardCard, type BoardSnapshot, type RunState, type ShopCard,
} from './index';

const BASE = "Refresh the Shop with plain copies of your last opponent's board.";
const plain = (c: (typeof CARD_INDEX)[string]) => !!c && !c.spell && !c.ruby && !c.token && c.effects.length === 0 && c.keywords.length === 0 && !c.universalTribe;
const NEUTRALS = Object.values(CARD_INDEX).filter((c) => plain(c) && c.tribe === 'neutral' && !c.tribe2 && !c.henchman && c.id !== 'sandbag').map((c) => c.id);
const N = (i: number) => NEUTRALS[i % NEUTRALS.length]!;
const ECHO = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && !c.ruby && c.keywords.length === 0
  && c.effects.length === 1 && c.effects[0]!.on === 'onDeath' && c.effects[0]!.do === 'deathrattleSummon')!.id;

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const base = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, 'membrance'), phase: 'recruit', embers: 60, hand: [], board: [], ...over } as RunState);
const picked = (id: AncientId, over: Partial<RunState> = {}): RunState => {
  let s = enableAncients(base(over));
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  s = reduce(s, { type: 'pickAncient', id });
  expect(s.ancients!.picked).toBe(id);
  return s;
};
type Foe = { cardId: string; attack: number; health: number; keywords?: Keyword[]; golden?: boolean };
const foes = (wave: number, minions: Foe[]): BoardSnapshot => ({
  v: 1, wave, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: 1,
  minions: minions.map((m) => ({ keywords: [], ...m })), seed: 1, origin: 'self',
});
/** Fight `enemy`, settle, and open the next Shop (Start of Turn has run). */
const fight = (s: RunState, enemy: Foe[]): RunState =>
  reduce(reduce({ ...s, servedBoards: { [s.wave]: foes(s.wave, enemy) } }, { type: 'faceOmen' }), { type: 'resolveCombat' });
const memory = (s: RunState): RunState => {
  const t = reduce({ ...s, heroReady: true, embers: 60, hand: [], discover: undefined, discoverQueue: undefined }, { type: 'heroPower' });
  expect(t, 'Memory fired').not.toBe(s);
  return t;
};
const minionOffers = (s: RunState): ShopCard[] => s.shop.filter((o) => !o.starform);
const buyUid = (s: RunState, uid: string): RunState => {
  const next = reduce(s, { type: 'buy', uid });
  expect(next, `bought ${uid}`).not.toBe(s);
  return next;
};
const offer = (uid: string, cardId: string): ShopCard => ({ uid, cardId } as ShopCard);
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const count = (s: RunState, id: string) => s.hand.filter((c) => c.cardId === id).length;
const ENEMY: Foe[] = [{ cardId: ECHO, attack: 4, health: 400, keywords: ['T'] }, { cardId: N(1), attack: 7, health: 9, keywords: ['DS'] }];
const afterFight = (id: AncientId | null, over: Partial<RunState> = {}): RunState => fight(id ? picked(id, over) : base(over), ENEMY);

describe('Membrance × every Ancient has a written pairing', () => {
  it('all six are written (no "Not written yet."), and none uses an em dash, "Oath" or "climb"', () => {
    for (const id of ANCIENT_IDS) {
      expect(ancientOfferText('membrance', id)).not.toBe('Not written yet.');
      expect(ancientOfferText('membrance', id)).not.toMatch(/—|--|Oath|climb/);
      expect(heroPowerText(picked(id))).not.toMatch(/—|--|\{|Oath|climb/);
    }
  });
  it('without Ancients, Memory makes plain unmarked offers at the normal price', () => {
    const s = memory(afterFight(null));
    expect(minionOffers(s).map((o) => o.cardId)).toEqual([ECHO, N(1)]);
    for (const o of minionOffers(s)) {
      expect(o.memory).toBeUndefined();
      expect(o.keywords ?? []).toEqual([]);
      expect(offerBuyPrice(s, o).cost).toBe(3);
    }
    expect(heroPowerText(s)).toBe(BASE);
  });
});

describe('Membrance × DEATH: "Memory minions with an Echo gain Rise."', () => {
  it('the Echo offer carries Rise and buys in with it; the other does not', () => {
    let s = memory(afterFight('death'));
    expect(heroPowerText(s)).toBe(`${BASE} Those with an **Echo** gain **Rise**.`);
    const [echo, other] = minionOffers(s);
    expect(echo!.memory).toBe(true);
    expect(echo!.keywords).toContain('R');
    expect(other!.keywords ?? []).not.toContain('R');
    s = buyUid(s, echo!.uid);
    expect(s.hand.find((c) => c.cardId === ECHO)!.keywords).toContain('R');
  });
  it('another Ancient gives no Rise', () => {
    expect(minionOffers(memory(afterFight('time')))[0]!.keywords ?? []).not.toContain('R');
  });
});

describe('Membrance × FORTUNE: "Memory minions cost 2 Gold."', () => {
  it('each Memory offer costs 2 Gold, and the buy charges 2', () => {
    let s = memory(afterFight('fortune'));
    for (const o of minionOffers(s)) expect(offerBuyPrice(s, o).cost).toBe(2);
    const gold = s.embers;
    s = buyUid(s, minionOffers(s)[1]!.uid);
    expect(s.embers).toBe(gold - 2);
  });
  it('a later ordinary Refresh is back to the normal price', () => {
    const s = reduce(memory(afterFight('fortune')), { type: 'roll' });
    for (const o of minionOffers(s)) { expect(o.memory).toBeUndefined(); expect(offerBuyPrice(s, o).cost).toBe(3); }
  });
});

describe('Membrance × WAR: "Memory minions are exact copies, but cost 6 gold."', () => {
  it('the offers carry the opponent\'s stats and keywords, cost 6 Gold, and buy in exactly', () => {
    let s = memory(afterFight('war'));
    expect(heroPowerText(s)).toBe("Refresh the Shop with **exact** copies of your last opponent's board. They cost **6 Gold**.");
    const [, o] = minionOffers(s);
    expect(offerBuyPrice(s, o!).cost).toBe(6);
    const gold = s.embers;
    s = buyUid(s, o!.uid);
    expect(s.embers).toBe(gold - 6);
    const got = s.hand.find((c) => c.cardId === N(1))!;
    expect(got).toMatchObject({ attack: 7, health: 9, golden: false });
    expect(got.keywords).toContain('DS');
  });
  it('a Gilded opponent minion is a Gilded offer with its exact stats', () => {
    let s = memory(fight(picked('war'), [{ cardId: N(2), attack: 30, health: 40, golden: true }]));
    const o = minionOffers(s)[0]!;
    expect(o.golden).toBe(true);
    s = buyUid(s, o.uid);
    expect(s.hand.find((c) => c.cardId === N(2))).toMatchObject({ attack: 30, health: 40, golden: true });
  });
  it('without the pairing the copy is plain', () => {
    let s = memory(afterFight('time'));
    s = buyUid(s, minionOffers(s)[1]!.uid);
    expect(s.hand.find((c) => c.cardId === N(1))).toMatchObject({ attack: CARD_INDEX[N(1)]!.attack, health: CARD_INDEX[N(1)]!.health, keywords: [] });
  });
});

describe('Membrance × GENESIS: "The first minion you buy from Memory each turn comes with a plain copy."', () => {
  it('the first Memory buy each turn gives a plain copy; the second does not; printed live', () => {
    let s = memory(afterFight('genesis'));
    expect(heroPowerText(s)).toBe(`${BASE} The first minion you buy from it each turn comes with a plain copy. Ready this turn.`);
    const [a, b] = minionOffers(s);
    s = buyUid(s, b!.uid);
    expect(count(s, N(1))).toBe(2);
    expect(heroPowerText(s)).toContain('Used this turn.');
    s = buyUid(s, a!.uid);
    expect(count(s, ECHO)).toBe(1);
  });
  it('a minion that is not from Memory gives no copy and does not spend it', () => {
    let s = afterFight('genesis');
    s = buyUid({ ...s, shop: [offer('x', N(3))] }, 'x');
    expect(count(s, N(3))).toBe(1);
    expect(heroPowerText(s)).toContain('Ready this turn.');
  });
  it('another Ancient gives no copy', () => {
    let s = memory(afterFight('fortune'));
    s = buyUid(s, minionOffers(s)[1]!.uid);
    expect(count(s, N(1))).toBe(1);
  });
});

describe('Membrance × TIME: "Start of Turn: get a plain copy of a random minion from your last opponent\'s board."', () => {
  it('the next Shop opens with a plain copy of one of the opponent\'s minions (seeded), on its own beat', () => {
    const run = () => afterFight('time');
    const s = run();
    const got = s.hand.filter((c) => c.cardId === ECHO || c.cardId === N(1));
    expect(got.length).toBe(1);
    expect(got[0]).toMatchObject({ attack: CARD_INDEX[got[0]!.cardId]!.attack, health: CARD_INDEX[got[0]!.cardId]!.health, golden: false });
    expect(s.sotBeatFx?.some((b) => b.source.label === 'Ancient of Time')).toBe(true);
    expect(run().hand.map((c) => c.cardId)).toEqual(s.hand.map((c) => c.cardId));
  });
  it('no combat yet, or another Ancient: nothing', () => {
    expect(picked('time').hand.length).toBe(0);
    expect(afterFight('fortune').hand.length).toBe(0);
  });
});

describe('Membrance × BONDS: "When you buy a copy of a minion that you control, give your Gilded minions +5/+5."', () => {
  const board = () => [card('a', N(0)), card('g', N(3), { golden: true, attack: 10, health: 10 }), card('h', N(4), { attack: 1, health: 1 })];
  it('buying a copy of a board minion gives every Gilded board minion +5/+5', () => {
    let s = picked('bonds', { board: board() });
    s = buyUid({ ...s, shop: [offer('x', N(0))] }, 'x');
    expect(at(s, 'g')).toMatchObject({ attack: 15, health: 15 });
    expect(at(s, 'h')).toMatchObject({ attack: 1, health: 1 });
    expect(at(s, 'a').attack).toBe(CARD_INDEX[N(0)]!.attack);
  });
  it('a minion you do not control, or another Ancient: nothing', () => {
    let s = picked('bonds', { board: board() });
    s = buyUid({ ...s, shop: [offer('x', N(5))] }, 'x');
    expect(at(s, 'g')).toMatchObject({ attack: 10, health: 10 });
    let t = picked('time', { board: board() });
    t = buyUid({ ...t, shop: [offer('x', N(0))] }, 'x');
    expect(at(t, 'g')).toMatchObject({ attack: 10, health: 10 });
  });
});

describe('Membrance × save / restore and determinism', () => {
  it('the Memory marks and the per-turn count survive a JSON round trip', () => {
    let s = memory(afterFight('genesis'));
    s = JSON.parse(JSON.stringify(s)) as RunState;
    s = buyUid(s, minionOffers(s)[1]!.uid);
    expect(count(s, N(1))).toBe(2);
    s = JSON.parse(JSON.stringify(s)) as RunState;
    expect(heroPowerText(s)).toContain('Used this turn.');
  });
  it('every pairing replays identically from the same state', () => {
    for (const id of ANCIENT_IDS) {
      const run = () => {
        let s = memory(afterFight(id, { board: [card('a', N(1)), card('g', N(3), { golden: true })] }));
        s = buyUid(s, minionOffers(s)[1]!.uid);
        return s;
      };
      const a = run();
      const b = run();
      expect(JSON.stringify(a.shop), id).toBe(JSON.stringify(b.shop));
      expect(JSON.stringify(a.hand), id).toBe(JSON.stringify(b.hand));
      expect(JSON.stringify(a.board), id).toBe(JSON.stringify(b.board));
      expect(JSON.stringify(a.ancients), id).toBe(JSON.stringify(b.ancients));
    }
  });
});
