/**
 * ANCIENTS × UNDERDWELLER (owner pairings 2026-11-10). Soulkeeper (2 Gold, once per turn): "Discover a minion that died
 * last combat, from either side." A "Soulkeeper minion" is the minion that Discover hands over. Every pairing through the
 * real reducer / simulator, in the phase(s) it fires in.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { CombatEvent, Keyword } from '@game/core';
import {
  ANCIENT_IDS, activePowers, ancientCombatMods, ancientOfferText, createRun, enableAncients, heroPowerText, reduce,
  type AncientId, type BoardCard, type BoardSnapshot, type RunState, type ShopCard,
} from './index';

const BASE = 'Discover a minion that died last combat, from **either** side.';
const plain = (c: (typeof CARD_INDEX)[string]) => !!c && !c.spell && !c.ruby && !c.token && c.effects.length === 0 && c.keywords.length === 0 && !c.universalTribe;
const NEUTRALS = Object.values(CARD_INDEX).filter((c) => plain(c) && c.tribe === 'neutral' && !c.tribe2 && !c.henchman && c.id !== 'sandbag').map((c) => c.id);
const N = (i: number) => NEUTRALS[i % NEUTRALS.length]!;
/** A minion with an Echo and no printed Rise. */
const ECHO = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && !c.ruby && c.keywords.length === 0
  && c.effects.length === 1 && c.effects[0]!.on === 'onDeath' && c.effects[0]!.do === 'deathrattleSummon')!.id;

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const base = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, 'underdweller'), phase: 'recruit', embers: 60, hand: [], board: [], ...over } as RunState);
const picked = (id: AncientId, over: Partial<RunState> = {}): RunState => {
  let s = enableAncients(base(over));
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  s = reduce(s, { type: 'pickAncient', id });
  expect(s.ancients!.picked).toBe(id);
  return s;
};
type Foe = { cardId: string; attack: number; health: number; keywords?: Keyword[] };
const foes = (wave: number, minions: Foe[]): BoardSnapshot => ({
  v: 1, wave, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: 1,
  minions: minions.map((m) => ({ keywords: [], ...m })), seed: 1, origin: 'self',
});
const WALL: Foe = { cardId: 'sandbag', attack: 0, health: 400 };
/** Fight `enemy`, settle, and open the next Shop (Start of Turn has run). */
const fight = (s: RunState, enemy: Foe[] = [WALL]): RunState =>
  reduce(reduce({ ...s, servedBoards: { [s.wave]: foes(s.wave, enemy) } }, { type: 'faceOmen' }), { type: 'resolveCombat' });
const events = (s: RunState): CombatEvent[] => s.lastCombat!.events as CombatEvent[];
const soulkeeper = (s: RunState): RunState => reduce({ ...s, heroReady: true, embers: 60, discover: undefined, discoverQueue: undefined }, { type: 'heroPower' });
/** Use Soulkeeper and take `pick` (the offer is narrowed to `offer`, as a real three-option offer would hold them). */
const take = (s: RunState, pick: string, offer: string[] = [pick]): RunState => {
  const t = soulkeeper(s);
  expect(t.discover?.length, 'Soulkeeper opened its Discover').toBeGreaterThan(0);
  return reduce({ ...t, discover: offer }, { type: 'discover', index: offer.indexOf(pick) });
};
const offer = (uid: string, cardId: string): ShopCard => ({ uid, cardId } as ShopCard);
const buy = (s: RunState, id: string, u = 'o'): RunState => {
  const next = reduce({ ...s, shop: [offer(u, id)] }, { type: 'buy', uid: u });
  expect(next, `bought ${id}`).not.toBe(s);
  return next;
};
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const count = (s: RunState, id: string) => s.hand.filter((c) => c.cardId === id).length;

describe('Underdweller × every Ancient has a written pairing', () => {
  it('all six are written (no "Not written yet."), and none uses an em dash, "Oath" or "climb"', () => {
    for (const id of ANCIENT_IDS) {
      expect(ancientOfferText('underdweller', id)).not.toBe('Not written yet.');
      expect(ancientOfferText('underdweller', id)).not.toMatch(/—|--|Oath|climb/);
      expect(heroPowerText(picked(id))).not.toMatch(/—|--|\{|Oath|climb/);
    }
  });
  it('without Ancients, Soulkeeper costs 2 Gold and hands over the plain card', () => {
    let s = fight(base({ board: [card('a', N(0), { attack: 50, health: 2, keywords: ['T'] })] }), [{ cardId: 'sandbag', attack: 5, health: 400 }]);
    expect(s.ancients).toBeUndefined();
    expect(s.lastCombat!.playerAncientGraves).toBeUndefined();
    const gold = 60;
    s = take(s, N(0));
    expect(s.embers).toBe(gold - 2);
    const got = s.hand.find((c) => c.cardId === N(0))!;
    expect(got).toMatchObject({ attack: CARD_INDEX[N(0)]!.attack, health: CARD_INDEX[N(0)]!.health, keywords: [] });
    expect(heroPowerText(s)).toBe(BASE);
  });
});

describe('Underdweller × DEATH: "Soulkeeper minions with an Echo gain Rise."', () => {
  const after = (id: AncientId | null) => {
    const start = id ? picked(id) : base();
    return fight({ ...start, board: [card('a', N(0), { attack: 90, health: 90 })] }, [{ cardId: ECHO, attack: 0, health: 1, keywords: ['T'] }, { cardId: N(1), attack: 0, health: 1 }]);
  };
  it('an Echo pick gains Rise; a pick without an Echo does not', () => {
    const s = after('death');
    expect(heroPowerText(s)).toBe(`${BASE} If it has an **Echo**, it gains **Rise**.`);
    const t = soulkeeper(s);
    expect(t.ancients!.discoverTag).toBe('soulkeeper');
    expect(take(s, ECHO).hand.find((c) => c.cardId === ECHO)!.keywords).toContain('R');
    expect(take(s, N(1)).hand.find((c) => c.cardId === N(1))!.keywords).not.toContain('R');
  });
  it('without the pairing an Echo pick has no Rise', () => {
    expect(take(after(null), ECHO).hand.find((c) => c.cardId === ECHO)!.keywords).not.toContain('R');
    expect(take(after('time'), ECHO).hand.find((c) => c.cardId === ECHO)!.keywords).not.toContain('R');
  });
});

describe('Underdweller × FORTUNE: "Soulkeeper costs 0 Gold."', () => {
  it('the power costs 0, and a use spends nothing', () => {
    let s = picked('fortune', { board: [card('a', N(0), { attack: 90, health: 90 })] });
    expect(activePowers(s)[0]!.cost).toBe(0);
    expect(heroPowerText(s)).toBe(`${BASE} It costs **0 Gold**.`);
    s = fight(s, [{ cardId: N(1), attack: 0, health: 1 }]);
    const t = soulkeeper(s);
    expect(t.discover).toEqual([N(1)]);
    expect(t.embers).toBe(60);
  });
  it('any other Ancient leaves it at 2 Gold', () => {
    expect(activePowers(picked('war'))[0]!.cost).toBe(2);
  });
});

describe('Underdweller × WAR: "Soulkeeper minions keep the stats and keywords they died with."', () => {
  const dead = (id: AncientId) =>
    fight(picked(id, { board: [card('a', N(0), { attack: 50, health: 2, keywords: ['T'] })] }), [{ cardId: 'sandbag', attack: 5, health: 400 }]);
  it('the pick arrives with the Attack, Health and keywords the body died with', () => {
    const s = dead('war');
    expect(ancientCombatMods(s).ancientGraves).toBe(true);
    expect(s.lastCombat!.playerAncientGraves).toEqual([{ cardId: N(0), side: 'player', attack: 50, health: 2, keywords: ['T'] }]);
    const got = take(s, N(0)).hand.find((c) => c.cardId === N(0))!;
    expect(got).toMatchObject({ attack: 50, health: 2, golden: false });
    expect(got.keywords).toContain('T');
    expect(got.buffs?.some((b) => b.source === 'Ancient of War')).toBe(true);
  });
  it('an enemy minion is kept as it died too', () => {
    const s = fight(picked('war', { board: [card('a', N(0), { attack: 90, health: 90 })] }), [{ cardId: N(1), attack: 7, health: 9, keywords: ['T'] }]);
    const got = take(s, N(1)).hand.find((c) => c.cardId === N(1))!;
    expect(got).toMatchObject({ attack: 7, health: 9 });
    expect(got.keywords).toContain('T');
  });
  it('without the pairing nothing is recorded and the pick is the plain card', () => {
    const s = dead('time');
    expect(s.lastCombat!.playerAncientGraves).toBeUndefined();
    expect(take(s, N(0)).hand.find((c) => c.cardId === N(0))).toMatchObject({ attack: CARD_INDEX[N(0)]!.attack, health: CARD_INDEX[N(0)]!.health, keywords: [] });
  });
});

describe('Underdweller × GENESIS: "Soulkeeper also gets a plain copy of a minion you didn\'t pick."', () => {
  const s0 = (id: AncientId) => fight(picked(id, { board: [card('a', N(0), { attack: 90, health: 90 })] }), [{ cardId: N(1), attack: 0, health: 1 }]);
  it('one of the options not picked also arrives, as a plain copy', () => {
    const s = take(s0('genesis'), N(1), [N(1), N(2), N(3)]);
    expect(count(s, N(1))).toBe(1);
    expect(count(s, N(2)) + count(s, N(3))).toBe(1);
    const extra = s.hand.find((c) => c.cardId === N(2) || c.cardId === N(3))!;
    expect(extra).toMatchObject({ attack: CARD_INDEX[extra.cardId]!.attack, health: CARD_INDEX[extra.cardId]!.health, golden: false });
  });
  it('a single option gives nothing extra; without the pairing nothing extra', () => {
    expect(take(s0('genesis'), N(1)).hand.length).toBe(1);
    expect(take(s0('time'), N(1), [N(1), N(2), N(3)]).hand.filter((c) => c.cardId !== N(1)).length).toBe(0);
  });
});

describe('Underdweller × TIME: "After combat: get a plain copy of the first enemy minion that died."', () => {
  const enemy: Foe[] = [{ cardId: N(1), attack: 0, health: 1, keywords: ['T'] }, { cardId: N(2), attack: 0, health: 1 }];
  it('the first enemy death comes home as a plain copy, as the fight ends', () => {
    const s = fight(picked('time', { board: [card('a', N(0), { attack: 90, health: 90 })] }), enemy);
    expect(count(s, N(1))).toBe(1);
    expect(count(s, N(2))).toBe(0);
    const ev = events(s);
    const toHand = ev.findIndex((e) => e.type === 'toHand' && e.side === 'player');
    const lastDeath = ev.map((e) => e.type).lastIndexOf('death');
    expect(toHand).toBeGreaterThan(lastDeath);
  });
  it('no enemy death, or no pairing: nothing', () => {
    const none = fight(picked('time', { board: [card('a', N(0), { attack: 1, health: 90 })] }), [{ cardId: N(1), attack: 0, health: 4000, keywords: ['T'] }]);
    expect(none.hand.length).toBe(0);
    expect(fight(picked('war', { board: [card('a', N(0), { attack: 90, health: 90 })] }), enemy).hand.length).toBe(0);
  });
});

describe('Underdweller × BONDS: "When you get a copy of a minion you control, give both copies +2/+2 and improve this."', () => {
  it('buying a copy of a board minion gives both +2/+2, then +4/+4 the next time; printed live', () => {
    let s = picked('bonds', { board: [card('a', N(0)), card('b', N(1))] });
    expect(heroPowerText(s)).toContain('give both copies **+2/+2** and improve this by **+2/+2**');
    const d0 = CARD_INDEX[N(0)]!;
    s = buy(s, N(0));
    expect(s.hand.find((c) => c.cardId === N(0))).toMatchObject({ attack: d0.attack + 2, health: d0.health + 2 });
    expect(at(s, 'a')).toMatchObject({ attack: d0.attack + 2, health: d0.health + 2 });
    expect(at(s, 'b').attack).toBe(CARD_INDEX[N(1)]!.attack);
    expect(s.ancients!.underBondsGain).toBe(4);
    expect(heroPowerText(s)).toContain('give both copies **+4/+4**');
    s = buy({ ...s, hand: [] }, N(1), 'p');
    expect(at(s, 'b').attack).toBe(CARD_INDEX[N(1)]!.attack + 4);
    expect(s.ancients!.underBondsGain).toBe(6);
  });
  it('a minion you do not control, or a different Ancient: nothing', () => {
    const s = buy(picked('bonds', { board: [card('a', N(0))] }), N(2));
    expect(s.hand[0]!.attack).toBe(CARD_INDEX[N(2)]!.attack);
    expect(s.ancients!.underBondsGain).toBe(2);
    const t = buy(picked('time', { board: [card('a', N(0))] }), N(0));
    expect(t.hand[0]!.attack).toBe(CARD_INDEX[N(0)]!.attack);
  });
  it('a Soulkeeper pick that copies a board minion counts', () => {
    let s = fight(picked('bonds', { board: [card('a', N(0), { attack: 90, health: 90 }), card('b', N(1), { attack: 1, health: 90 })] }), [{ cardId: N(1), attack: 0, health: 1 }]);
    s = take(s, N(1));
    expect(s.hand.find((c) => c.cardId === N(1))!.attack).toBe(CARD_INDEX[N(1)]!.attack + 2);
    expect(at(s, 'b').attack).toBe(1 + 2);
  });
});

describe('Underdweller × save / restore and determinism', () => {
  it('the Bonds amount and the War graves survive a JSON round trip', () => {
    let s = buy(picked('bonds', { board: [card('a', N(0))] }), N(0));
    s = JSON.parse(JSON.stringify(s)) as RunState;
    expect(heroPowerText(s)).toContain('**+4/+4**');
    let w = fight(picked('war', { board: [card('a', N(0), { attack: 50, health: 2 })] }), [{ cardId: 'sandbag', attack: 5, health: 400 }]);
    w = JSON.parse(JSON.stringify(w)) as RunState;
    expect(take(w, N(0)).hand.find((c) => c.cardId === N(0))).toMatchObject({ attack: 50, health: 2 });
  });
  it('every pairing replays identically from the same state', () => {
    for (const id of ANCIENT_IDS) {
      const run = () => {
        const s = fight(picked(id, { board: [card('a', N(0), { attack: 90, health: 3 }), card('b', ECHO, { attack: 90, health: 2 })] }),
          [{ cardId: N(1), attack: 9, health: 1 }, { cardId: N(2), attack: 9, health: 1 }, { cardId: ECHO, attack: 9, health: 300 }]);
        return take(s, s.discover?.[0] ?? soulkeeper(s).discover![0]!, soulkeeper(s).discover!);
      };
      const a = run();
      const b = run();
      expect(JSON.stringify(a.lastCombat?.events), id).toBe(JSON.stringify(b.lastCombat?.events));
      expect(JSON.stringify(a.hand), id).toBe(JSON.stringify(b.hand));
      expect(JSON.stringify(a.board), id).toBe(JSON.stringify(b.board));
      expect(JSON.stringify(a.ancients), id).toBe(JSON.stringify(b.ancients));
    }
  });
});
