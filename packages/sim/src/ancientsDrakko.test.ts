/**
 * ANCIENTS × DRAKKO (owner pairings 2026-10-09). Drumline (passive): "After you buy 5 Shout minions, get Drakko." Drakko is
 * the `drummer` card ("Your Shouts trigger twice"). Every pairing in the phase(s) it fires in.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { CombatEvent } from '@game/core';
import {
  ANCIENT_IDS, DRAKKO_CARD_ID, ancientCombatMods, ancientOfferText, createRun, enableAncients, heroPowerText, offerBuyPrice, reduce,
  type AncientId, type BoardCard, type BoardSnapshot, type RunState, type ShopCard,
} from './index';
import { isTribe } from './recruit';

const BASE = 'After you buy 5 **Shout** minions, get **Drakko**.';
const plain = (c: (typeof CARD_INDEX)[string]) => !!c && !c.spell && !c.ruby && !c.token && c.effects.length === 0 && c.keywords.length === 0 && !c.universalTribe;
const NEUTRALS = Object.values(CARD_INDEX).filter((c) => plain(c) && c.tribe === 'neutral' && !c.tribe2 && !c.henchman).map((c) => c.id);
const N = (i: number) => NEUTRALS[i % NEUTRALS.length]!;
/** Untargeted Shout minions, all different (so a run of buys never triples). */
const SHOUTS = ['hoarder', 'buddy', 'alley', 'dw_pimm', 'deathswarmer', 'feed', 'k_chipwick', 'dw_orin', 'cinder', 'dm_butcher', 'k_deepvein', 'ce3_vendor'];

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const base = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, 'drakko'), phase: 'recruit', embers: 99, hand: [], ...over } as RunState);
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
const offer = (uid: string, cardId: string): ShopCard => ({ uid, cardId } as ShopCard);
const buy = (s: RunState, id: string, u = 'o'): RunState => {
  const next = reduce({ ...s, shop: [offer(u, id)] }, { type: 'buy', uid: u });
  expect(next, `bought ${id}`).not.toBe(s);
  return next;
};
const drakkos = (s: RunState) => [...s.board, ...s.hand].filter((c) => c.cardId === DRAKKO_CARD_ID);

describe('Drakko × every Ancient has a written pairing', () => {
  it('all six are written (no "Not written yet."), and none uses an em dash', () => {
    for (const id of ANCIENT_IDS) {
      expect(ancientOfferText('drakko', id)).not.toBe('Not written yet.');
      expect(ancientOfferText('drakko', id)).not.toMatch(/—|--/);
    }
  });
  it('the Shout fixtures are untargeted Shout minions', () => {
    for (const id of SHOUTS) expect(CARD_INDEX[id]!.effects.some((e) => e.on === 'onPlay'), id).toBe(true);
    expect(CARD_INDEX[DRAKKO_CARD_ID]!.tribe).toBe('neutral');
  });
});

describe('Drakko × DEATH: "Your Drakkos become Undead/Beast."', () => {
  it('every Drakko (held, new, in combat) is Undead and Beast; its printed no-type is replaced', () => {
    let s = picked('death', { board: [card('d', DRAKKO_CARD_ID)] });
    expect(s.cardTribes?.[DRAKKO_CARD_ID]).toEqual(['undead', 'beast']);
    const d = s.board[0]!;
    expect(isTribe(d, 'undead') && isTribe(d, 'beast')).toBe(true);
    expect(heroPowerText(s)).toBe(`${BASE} Your Drakkos are **Undead** and **Beast**.`);
    s = fightNow(s);
    const body = s.lastCombat!.initial.player.find((m) => m.cardId === DRAKKO_CARD_ID)!;
    expect(body).toBeTruthy();
  });
  it('Rune of Drakko still adds Dragon / Spirit on top', () => {
    let s = picked('death', { board: [card('d', DRAKKO_CARD_ID)] });
    s = reduce(s, { type: 'devGrant', kind: 'rune', id: 'rune_drakko' });
    expect([...(s.cardTribes?.[DRAKKO_CARD_ID] ?? [])].sort()).toEqual(['beast', 'dragon', 'spirit', 'undead']);
    for (const c of drakkos(s)) for (const t of ['undead', 'beast', 'dragon', 'spirit'] as const) expect(isTribe(c, t), t).toBe(true);
  });
});

describe('Drakko × FORTUNE: "Shout minions cost 1 Gold less."', () => {
  it('a Shout minion offer costs 1 less (floored at 0); a non-Shout minion does not', () => {
    const s = picked('fortune');
    const before = offerBuyPrice(base(), { cardId: 'hoarder' }).cost;
    expect(offerBuyPrice(s, { cardId: 'hoarder' }).cost).toBe(Math.max(0, before - 1));
    expect(offerBuyPrice(s, { cardId: N(0) }).cost).toBe(offerBuyPrice(base(), { cardId: N(0) }).cost);
    const t = buy(s, 'hoarder');
    expect(s.embers - t.embers).toBe(Math.max(0, before - 1));
    expect(offerBuyPrice({ ...s, minionCostOffTurn: 9 } as RunState, { cardId: 'hoarder' }).cost).toBe(0);
  });
});

describe('Drakko × WAR: "Start of Combat: Give a minion +1/+1. Repeat for every Shout triggered this turn."', () => {
  it('the base step plus one per Shout fired this turn, each its own beat on a random friendly minion', () => {
    let s = picked('war', { board: [card('a', N(0), { health: 50 }), card('b', N(1), { health: 50 })] });
    expect(heroPowerText(s)).toContain('(**0** this turn: **1** times)');
    s = { ...s, shoutFiresThisTurn: 3 };
    expect(heroPowerText(s)).toContain('(**3** this turn: **4** times)');
    expect(ancientCombatMods(s).ancientSocRandomBuffs).toEqual({ reps: 4, attack: 1, health: 1, label: 'Ancient of War' });
    s = fightNow(s);
    const grants = events(s).filter((e) => e.type === 'buff' && e.source === 'Ancient of War');
    expect(grants.length).toBe(4);
  });
  it('a Shout played in the Shop (Drakko-doubled) counts every fire', () => {
    let s = picked('war', { board: [card('d', DRAKKO_CARD_ID)], hand: [card('h', 'hoarder')] });
    s = reduce(s, { type: 'play', uid: 'h' });
    expect(s.shoutFiresThisTurn).toBe(2);
    expect(ancientCombatMods(s).ancientSocRandomBuffs!.reps).toBe(3);
  });
});

describe('Drakko × GENESIS: "Drumline can be completed 3 times and costs 1 Shout less per reset."', () => {
  it('5 Shout buys, then 4, then 3: three Drakkos, then it is done', () => {
    let s = picked('genesis');
    expect(heroPowerText(s)).toBe('After you buy **5** **Shout** minions, get **Drakko**. Completions left: **3**.');
    let i = 0;
    let got = 0; // Drakkos granted (taken out of hand as they land, so three never triple)
    const buyShouts = (n: number) => {
      for (let k = 0; k < n; k++) {
        s = buy({ ...s, hand: [] }, SHOUTS[i++ % SHOUTS.length]!);
        got += drakkos(s).length;
      }
    };
    buyShouts(4);
    expect(got).toBe(0);
    buyShouts(1);
    expect(got).toBe(1);
    expect(s.heroPowerSpent).toBeFalsy();
    expect(s.drakkoBuys).toBe(0);
    expect(heroPowerText(s)).toBe('After you buy **4** **Shout** minions, get **Drakko**. Completions left: **2**.');
    buyShouts(4);
    expect(got).toBe(2);
    expect(heroPowerText(s)).toContain('After you buy **3**');
    buyShouts(2);
    expect(got).toBe(2);
    buyShouts(1);
    expect(got).toBe(3);
    expect(s.heroPowerSpent).toBe(true);
    buyShouts(5);
    expect(got).toBe(3);
  });
  it('without Ancients Drumline completes once', () => {
    let s = base();
    for (let k = 0; k < 10; k++) s = buy({ ...s, hand: s.hand.filter((c) => c.cardId === DRAKKO_CARD_ID) }, SHOUTS[k]!);
    expect(drakkos(s).length).toBe(1);
  });
  it('a Drumline completed before the pick counts as the first completion and reopens at 4', () => {
    let s = base();
    for (let k = 0; k < 5; k++) s = buy({ ...s, hand: [] }, SHOUTS[k]!);
    expect(s.heroPowerSpent).toBe(true);
    s = enableAncients(s);
    s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: ['genesis', 'death', 'war'] } };
    s = reduce(s, { type: 'pickAncient', id: 'genesis' });
    expect(s.heroPowerSpent).toBe(false);
    expect(heroPowerText(s)).toContain('After you buy **4**');
  });
});

describe('Drakko × TIME: "End of turn: trigger your left-most Shout minion."', () => {
  it('End of Turn re-fires the left-most Shout (Hoarder: +1 Gold next turn); no Shout, nothing', () => {
    const board = () => [card('x', N(0)), card('h', 'hoarder'), card('c', 'ce3_wishingstar')];
    let s = picked('time', { board: board() });
    expect(heroPowerText(s)).toBe(`${BASE} **End of Turn:** trigger your left-most **Shout** minion.`);
    s = fightNow(s);
    const off = fightNow(picked('death', { board: board() }));
    expect((s.bonusEmbersNextTurn ?? 0) - (off.bonusEmbersNextTurn ?? 0), 'Hoarder (the left-most Shout) re-fired').toBeGreaterThan(0);
    expect(s.board.find((c) => c.uid === 'h')!.attack, 'Wishing Star (not the left-most) did not fire').toBe(off.board.find((c) => c.uid === 'h')!.attack);
    const none = fightNow(picked('time', { board: [card('x', N(0))] }));
    expect(none.bonusEmbersNextTurn ?? 0).toBe(0);
  });
});

describe('Drakko × BONDS: "Your Drakkos gain +2/+2 when you trigger a Shout."', () => {
  it('Shop: every Shout FIRE gives your board Drakkos +2/+2, permanently (Drakko doubles: +4/+4)', () => {
    let s = picked('bonds', { board: [card('d', DRAKKO_CARD_ID)], hand: [card('h', 'hoarder')] });
    s = reduce(s, { type: 'play', uid: 'h' });
    expect(s.board.find((c) => c.uid === 'd')).toMatchObject({ attack: CARD_INDEX[DRAKKO_CARD_ID]!.attack + 4, health: CARD_INDEX[DRAKKO_CARD_ID]!.health + 4 });
  });
  it('combat: a combat Shout fire gives the Drakko body +2/+2 and it carries home', () => {
    let s = picked('bonds', { board: [card('d', DRAKKO_CARD_ID, { health: 90 }), card('a', 'alley', { health: 90 }), card('r', 'ryme', { attack: 1, health: 1, keywords: ['T'] })] });
    expect(ancientCombatMods(s).ancientShoutBuffsCard).toEqual({ cardId: DRAKKO_CARD_ID, attack: 2, health: 2, label: 'Ancient of Bonds' });
    s = fightNow(s, 3, 200);
    const shouts = events(s).filter((e) => e.type === 'shout' && (e as { side?: string }).side !== 'enemy').length;
    const grants = events(s).filter((e) => e.type === 'buff' && e.source === 'Ancient of Bonds');
    expect(shouts).toBeGreaterThan(0);
    expect(grants.length).toBeGreaterThan(0);
    const atk = s.board.find((c) => c.uid === 'd')!.attack;
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.board.find((c) => c.uid === 'd')!.attack).toBe(atk + 2 * grants.length);
  });
});

describe('Drakko × determinism', () => {
  it('every pairing replays identically from the same state', () => {
    for (const id of ANCIENT_IDS) {
      const run = () => {
        let s = picked(id, { wave: 4, board: [card('d', DRAKKO_CARD_ID, { health: 30 }), card('h', 'hoarder', { attack: 3, health: 3 }), card('r', 'ryme', { attack: 1, health: 1 })], hand: [card('x', 'alley')] });
        s = reduce(s, { type: 'play', uid: 'x' });
        return reduce(fightNow(s, 30, 300), { type: 'resolveCombat' });
      };
      const a = run();
      const b = run();
      expect(JSON.stringify(a.lastCombat?.events), id).toBe(JSON.stringify(b.lastCombat?.events));
      expect(JSON.stringify(a.board), id).toBe(JSON.stringify(b.board));
      expect(JSON.stringify(a.ancients), id).toBe(JSON.stringify(b.ancients));
    }
  });
});
