/**
 * ANCIENTS × RE-PETE (owner pairings 2026-10-02). Second Hand (passive): "At the end of every 3rd turn, get a plain copy
 * of the left-most card in your hand." Every pairing in the phase(s) it fires in.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { CombatEvent } from '@game/core';
import {
  ANCIENT_IDS, ancientCombatMods, ancientOfferText, createRun, enableAncients, heroPowerText, reduce,
  type AncientId, type BoardCard, type BoardSnapshot, type RunState, type ShopCard,
} from './index';

const BASE = 'At the end of every 3rd turn, get a plain copy of the left-most card in your hand.';
const plain = (c: (typeof CARD_INDEX)[string]) => !!c && !c.spell && !c.ruby && !c.token && c.effects.length === 0 && c.keywords.length === 0 && !c.universalTribe;
const NEUTRALS = Object.values(CARD_INDEX).filter((c) => plain(c) && c.tribe === 'neutral' && !c.tribe2 && !c.henchman).map((c) => c.id);
const N = (i: number) => NEUTRALS[i % NEUTRALS.length]!;
/** Shop spells with no target and no Discover of their own: safe to hold, buy and lock. */
const SPELLS = Object.values(CARD_INDEX).filter((c) => !!c && c.spell && !c.token && !c.gift && !c.ruby && !(c.chooseOne?.length) && (c.cost ?? 0) <= 3).map((c) => c.id);

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const base = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, 'repete'), phase: 'recruit', embers: 99, hand: [], ...over } as RunState);
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
/** Buy `ids` one at a time from a fresh shop row (never 3 of a card, so no triple). */
const buyAll = (s: RunState, ids: string[]): RunState => ids.reduce((t, id, i) => {
  const u = `o${i}`;
  const next = reduce({ ...t, shop: [offer(u, id)] }, { type: 'buy', uid: u });
  expect(next, `bought ${id}`).not.toBe(t);
  return next;
}, s);

describe('Re-Pete × every Ancient has a written pairing', () => {
  it('all six are written (no "Not written yet."), and none uses an em dash', () => {
    for (const id of ANCIENT_IDS) {
      expect(ancientOfferText('repete', id)).not.toBe('Not written yet.');
      expect(ancientOfferText('repete', id)).not.toMatch(/—|--/);
    }
  });
  it('the fixtures are what the tests assume', () => {
    expect(NEUTRALS.length).toBeGreaterThanOrEqual(8);
    expect(SPELLS.length).toBeGreaterThanOrEqual(6);
  });
  it('without Ancients, Second Hand copies the left-most hand card at the end of turn 3 only', () => {
    const s3 = fightNow(base({ wave: 3, hand: [card('h', N(0), { attack: 9 })] }));
    expect(s3.hand.map((c) => c.cardId)).toEqual([N(0), N(0)]);
    expect(s3.hand[1]!.attack, 'plain').toBe(CARD_INDEX[N(0)]!.attack);
    const s2 = fightNow(base({ wave: 2, hand: [card('h', N(0))] }));
    expect(s2.hand.length).toBe(1);
  });
});

describe('Re-Pete × DEATH: "Get a copy of the last minion that died in combat"', () => {
  it('when the fight ends, a plain copy of the LAST friendly minion that died flies to hand (a live toHand)', () => {
    let s = picked('death', { wave: 1, board: [card('a', N(0), { attack: 1, health: 5 }), card('b', N(1), { attack: 1, health: 5 })] });
    expect(ancientCombatMods(s).ancientLastDeathCopy).toEqual({ label: 'Ancient of Death' });
    s = fightNow(s, 50, 1000);
    const ev = events(s);
    const deaths = ev.filter((e): e is Extract<CombatEvent, { type: 'death' }> => e.type === 'death' && e.side === 'player');
    expect(deaths.length).toBe(2);
    const lastUid = deaths[deaths.length - 1]!.target;
    const lastCard = s.lastCombat!.initial.player.find((m) => m.uid === lastUid)!.cardId;
    const toHand = ev.filter((e): e is Extract<CombatEvent, { type: 'toHand' }> => e.type === 'toHand' && e.side === 'player');
    expect(toHand.map((e) => e.cardId)).toEqual([lastCard]);
    expect(ev.indexOf(toHand[0]!), 'after the last death').toBeGreaterThan(ev.indexOf(deaths[1]!));
    s = reduce(s, { type: 'resolveCombat' });
    const copy = s.hand.find((c) => c.cardId === lastCard)!;
    expect(copy).toBeDefined();
    expect(copy.attack, 'plain: the base Attack, not the 1 the body had').toBe(CARD_INDEX[lastCard]!.attack);
  });
  it('no friendly death: nothing', () => {
    const s = fightNow(picked('death', { wave: 1, board: [card('a', N(0), { attack: 50, health: 50 })] }), 0, 1);
    expect(events(s).some((e) => e.type === 'toHand')).toBe(false);
  });
  it('the mod is absent without the pairing', () => {
    expect(ancientCombatMods(picked('war')).ancientLastDeathCopy).toBeUndefined();
  });
});

describe('Re-Pete × FORTUNE: "When you buy 6 cards, discover one of them. It\'s locked in your hand for 1 turn."', () => {
  it('the 6th buy opens a Discover of those cards; the pick is locked until next turn; the power counts down', () => {
    let s = picked('fortune', { wave: 4 });
    expect(heroPowerText(s)).toBe(`${BASE} Every **6** cards you buy, Discover one of them. It is locked in your hand for **1** turn (**6** more to go).`);
    const ids = [N(0), N(1), N(2), N(3), N(4)];
    s = buyAll(s, ids);
    expect(heroPowerText(s)).toContain('(**1** more to go)');
    expect(s.discover).toBeFalsy();
    s = buyAll(s, [N(5)]);
    expect(s.discover!.length).toBe(3);
    for (const id of s.discover!) expect([...ids, N(5)]).toContain(id);
    expect(heroPowerText(s)).toContain('(**6** more to go)');
    const pick = s.discover![0]!;
    s = reduce(s, { type: 'discover', index: 0 });
    const locked = s.hand[s.hand.length - 1]!;
    expect(locked.cardId).toBe(pick);
    expect(locked.lockedUntilWave).toBe(5);
    expect(reduce(s, { type: 'play', uid: locked.uid }), 'unplayable this turn').toBe(s);
  });
  it('owner ruling "Offer spells too": a window of all spells offers spells, and a locked SPELL cannot be cast this turn', () => {
    let s = picked('fortune', { wave: 4 });
    const six = SPELLS.slice(0, 6);
    s = buyAll(s, six);
    expect(s.discover!.length).toBe(3);
    for (const id of s.discover!) expect(six).toContain(id);
    s = reduce(s, { type: 'discover', index: 0 });
    const locked = s.hand[s.hand.length - 1]!;
    expect(CARD_INDEX[locked.cardId]!.spell).toBe(true);
    expect(locked.lockedUntilWave).toBe(5);
    expect(reduce(s, { type: 'play', uid: locked.uid }), 'a locked spell is not cast').toBe(s);
  });
  it('a mixed window offers from both minions and spells (the draw sees all six)', () => {
    const mixed = [N(0), SPELLS[0]!, N(1), SPELLS[1]!, N(2), SPELLS[2]!];
    const seen = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      let s = picked('fortune', { wave: 4, seed, rngCursor: seed * 7919 });
      s = buyAll(s, mixed);
      for (const id of s.discover!) { expect(mixed).toContain(id); seen.add(id); }
    }
    expect([...seen].some((id) => CARD_INDEX[id]!.spell)).toBe(true);
    expect([...seen].some((id) => !CARD_INDEX[id]!.spell)).toBe(true);
  });
});

describe('Re-Pete × WAR: "Copied cards gain +10/+10. Improve this every time Second Hand triggers."', () => {
  it('a minion copy gains the current +X/+X, then X improves by 10 (+10 on turn 3, +20 on turn 6)', () => {
    let s = picked('war', { wave: 3, hand: [card('h', N(0))] });
    expect(heroPowerText(s)).toBe(`${BASE} Minions it copies gain **+10/+10**. This improves by **+10/+10** every time it triggers.`);
    s = fightNow(s);
    const c1 = s.hand[1]!;
    expect(c1).toMatchObject({ attack: CARD_INDEX[N(0)]!.attack + 10, health: CARD_INDEX[N(0)]!.health + 10 });
    expect(s.ancients!.repeteWarGain).toBe(20);
    expect(heroPowerText(s)).toContain('**+20/+20**');
    s = fightNow({ ...s, phase: 'recruit', wave: 6, hand: [card('h2', N(1))] });
    expect(s.hand[1]).toMatchObject({ attack: CARD_INDEX[N(1)]!.attack + 20, health: CARD_INDEX[N(1)]!.health + 20 });
    expect(s.ancients!.repeteWarGain).toBe(30);
  });
  it('a spell copy gains nothing, but the trigger still improves X', () => {
    let s = picked('war', { wave: 3, hand: [card('sp', SPELLS[0]!)] });
    s = fightNow(s);
    expect(s.hand[1]!.cardId).toBe(SPELLS[0]);
    expect(s.hand[1]!.buffs ?? []).toEqual([]);
    expect(s.ancients!.repeteWarGain).toBe(20);
  });
  it('no trigger (turn 2, or an empty hand): X does not improve', () => {
    expect(fightNow(picked('war', { wave: 2, hand: [card('h', N(0))] })).ancients!.repeteWarGain).toBe(10);
    expect(fightNow(picked('war', { wave: 3, hand: [] })).ancients!.repeteWarGain).toBe(10);
  });
});

describe('Re-Pete × GENESIS: "Copied minions are now exact copies"', () => {
  it('the copy keeps the current stats, buffs and keywords, under a fresh uid', () => {
    let s = picked('genesis', { wave: 3, hand: [card('h', N(0), { attack: 15, health: 22, keywords: ['T'], buffs: [{ source: 'Test', attack: 12, health: 18, count: 1 }] })] });
    expect(heroPowerText(s)).toBe('At the end of every 3rd turn, get an **exact** copy of the left-most card in your hand.');
    s = fightNow(s);
    const copy = s.hand[1]!;
    expect(copy).toMatchObject({ cardId: N(0), attack: 15, health: 22, keywords: ['T'] });
    expect(copy.buffs).toEqual([{ source: 'Test', attack: 12, health: 18, count: 1 }]);
    expect(copy.uid).not.toBe('h');
  });
});

describe('Re-Pete × TIME: "second hand triggers every 2 turns instead"', () => {
  it('fires at the end of turns 2 and 4 (not 3); the power prints the next trigger turn', () => {
    const s2 = picked('time', { wave: 2, hand: [card('h', N(0))] });
    expect(heroPowerText(s2)).toBe('At the end of every **2nd** turn, get a plain copy of the left-most card in your hand. Next: turn **2**.');
    expect(fightNow(s2).hand.length).toBe(2);
    const s3 = picked('time', { wave: 3, hand: [card('h', N(0))] });
    expect(heroPowerText(s3)).toContain('Next: turn **4**.');
    expect(fightNow(s3).hand.length).toBe(1);
    expect(fightNow(picked('time', { wave: 4, hand: [card('h', N(0))] })).hand.length).toBe(2);
  });
});

describe('Re-Pete × BONDS: "Second hand copies the Left and Right-most minions on board instead."', () => {
  it('plain copies of the left-most and right-most BOARD minions, not the hand card', () => {
    let s = picked('bonds', { wave: 3, hand: [card('h', N(5))], board: [card('l', N(0), { attack: 30 }), card('m', N(1)), card('r', N(2), { attack: 30 })] });
    s = fightNow(s);
    expect(s.hand.map((c) => c.cardId)).toEqual([N(5), N(0), N(2)]);
    expect(s.hand[1]!.attack, 'plain').toBe(CARD_INDEX[N(0)]!.attack);
  });
  it('one minion is both ends: one copy; an empty board: nothing', () => {
    expect(fightNow(picked('bonds', { wave: 3, board: [card('l', N(0))] })).hand.map((c) => c.cardId)).toEqual([N(0)]);
    expect(fightNow(picked('bonds', { wave: 3, hand: [card('h', N(5))], board: [] })).hand.map((c) => c.cardId)).toEqual([N(5)]);
  });
});

describe('Re-Pete × save / restore and determinism', () => {
  it('the counters survive a JSON round trip', () => {
    let s = buyAll(picked('fortune', { wave: 4 }), [N(0), N(1), N(2)]);
    s = JSON.parse(JSON.stringify(s)) as RunState;
    expect(heroPowerText(s)).toContain('(**3** more to go)');
    s = buyAll(s, [N(3), N(4), N(5)]);
    expect(s.discover!.length).toBe(3);
    let w = fightNow(picked('war', { wave: 3, hand: [card('h', N(0))] }));
    w = JSON.parse(JSON.stringify(w)) as RunState;
    expect(heroPowerText(w)).toContain('**+20/+20**');
  });
  it('every pairing replays identically from the same state', () => {
    for (const id of ANCIENT_IDS) {
      const run = () => {
        const s = picked(id, { wave: 6, hand: [card('h', N(5)), card('sp', SPELLS[0]!)], board: [card('a', N(0), { attack: 2, health: 3 }), card('b', N(1), { attack: 3, health: 2 })] });
        return reduce(fightNow(buyAll(s, [N(2), N(3), SPELLS[1]!]), 60, 1000), { type: 'resolveCombat' });
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
