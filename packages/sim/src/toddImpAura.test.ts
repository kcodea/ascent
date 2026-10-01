import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { createRun, reduce, type BoardCard, type BoardSnapshot, type RunState } from './index';
import { buffImpsRunWide } from './recruit';

/**
 * IMPOSSIBLE TODD — "give your Imps +2/+1 this game" is an AURA (owner bug 2026-09-30: "impossible todd should
 * buff imps that are currently alive too since it's an aura buff - they receive the buff everywhere"). R-AURA-04.
 *
 *   · combat: the Imps ALIVE when Todd triggers gain it right then (a `buff` event each, real time);
 *   · Imps summoned later that fight inherit the raised aura, paid once (not again at the trigger);
 *   · the run's Imps on the board and in hand carry it back; a starting board Imp is never paid twice.
 */
const bm = (cardId: string, uid: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion => {
  const d = CARD_INDEX[cardId]!;
  return { cardId, attack, health, sourceUid: uid, keywords: [...d.keywords], ...extra } as BoardMinion;
};
const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
type Buff = { target: string; attack: number; health: number; source?: string };
const buffsOn = (events: readonly CombatEvent[], target: string): Buff[] =>
  events.filter((e) => e.type === 'buff' && (e as unknown as Buff).target === target).map((e) => e as unknown as Buff);
const foes = (wave: number): BoardSnapshot => ({
  v: 1, wave, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: 1,
  minions: [{ cardId: 'sandbag', attack: 0, health: 9999, keywords: [] }], seed: 1, origin: 'self',
});

describe('Impossible Todd — the Imp grant reaches every Imp, in real time', () => {
  // Todd (m0) is a 0-Attack wall, the Clerk (m1) is the Demon that swings first, the Imp (m2) is alive from the start.
  const fight = (golden: boolean) => simulate(
    [bm('dm_todd', 'TD', 0, 400, { golden }), bm('dm_clerk', 'AT', 5, 400), bm('impscrap', 'IMP', 1, 1)],
    [bm('dm_clerk', 'BAG', 0, 99999)],
    makeRng(3), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 1 }));

  it('a living Imp gains +2/+1 at the very trigger (the event right after Todd swells), before its own swing', () => {
    const r = fight(false);
    const toddBuffs = buffsOn(r.events, 'm0');
    const impBuffs = buffsOn(r.events, 'm2');
    expect(impBuffs.length, 'one Imp buff per Todd trigger').toBe(toddBuffs.length);
    expect(impBuffs.every((b) => b.attack === 2 && b.health === 1 && b.source === 'm0')).toBe(true);
    // The Imp's own first swing lands AFTER the Clerk's hit triggered Todd: 1 base + 2 = 3 damage, not 1.
    const firstImpHit = r.events.find((e) => e.type === 'dmg' && (e as { source?: string }).source === 'm2') as { amount: number };
    expect(firstImpHit.amount).toBe(3);
    // The run-wide half is unchanged: every trigger still feeds the carry-back.
    expect(r.playerImpBuffGain).toEqual({ attack: 2 * toddBuffs.length, health: toddBuffs.length });
  });

  it('gilded doubles the living Imp grant (+4/+2)', () => {
    const r = fight(true);
    const impBuffs = buffsOn(r.events, 'm2');
    expect(impBuffs.length).toBeGreaterThan(0);
    expect(impBuffs.every((b) => b.attack === 4 && b.health === 2)).toBe(true);
  });

  it('an Imp summoned AFTER a trigger enters with the raised aura, and that grant is not paid to it again', () => {
    // Knocked (a 2/1 Demon, Echo: summon an Imp) swings first into a 3-Attack wall: its hit triggers Todd
    // (+2/+1 to the aura), then the retaliation kills it and the Imp arrives. A seeded +4/+2 aura is already up.
    const r = simulate(
      [bm('dm_knocked', 'KN', 2, 1), bm('dm_todd', 'TD', 0, 400)],
      [bm('dm_clerk', 'BAG', 3, 99999)],
      makeRng(3), CARD_INDEX, combatSide({ tier: 6, impAtk: 4, impHp: 2 }), combatSide({ tier: 1 }));
    const summonIdx = r.events.findIndex((e) => e.type === 'summon' && (e as { minion: { cardId: string } }).minion.cardId === 'impscrap');
    expect(summonIdx).toBeGreaterThan(-1);
    const imp = (r.events[summonIdx] as unknown as { minion: { uid: string; attack: number; health: number } }).minion;
    const grantsBefore = r.events.slice(0, summonIdx).filter((e) => e.type === 'buff' && (e as unknown as Buff).target === 'm1').length;
    expect(grantsBefore, 'Todd triggered before the Imp arrived').toBeGreaterThan(0);
    // 1/1 base + the seeded 4/2 + every +2/+1 granted so far — no more, no less.
    expect([imp.attack, imp.health]).toEqual([1 + 4 + 2 * grantsBefore, 1 + 2 + grantsBefore]);
    // While it lives it is paid each LATER trigger directly (+2/+1 apiece), never the earlier ones again.
    const direct = buffsOn(r.events, imp.uid);
    expect(direct.length).toBeGreaterThan(0);
    expect(direct.every((b) => b.attack === 2 && b.health === 1 && b.source === 'm1')).toBe(true);
    expect(r.events.findIndex((e) => e.type === 'buff' && (e as unknown as Buff).target === imp.uid)).toBeGreaterThan(summonIdx);
  });

  it('a starting Imp is not re-paid the aura at combat start (its stats were baked by the shop)', () => {
    const r = simulate(
      [bm('impscrap', 'IMP', 5, 3)],
      [bm('dm_clerk', 'BAG', 0, 99999)],
      makeRng(3), CARD_INDEX, combatSide({ tier: 6, impAtk: 4, impHp: 2 }), combatSide({ tier: 1 }));
    const imp0 = r.initial.player.find((m) => m.cardId === 'impscrap')!;
    expect([imp0.attack, imp0.health]).toEqual([5, 3]);
  });
});

describe('Impossible Todd — the run carries it to every Imp you hold, exactly once', () => {
  it('board + hand Imps bake the fight\'s gain; a board Imp enters the next fight at its stored stats', () => {
    let s = {
      ...createRun(7), phase: 'recruit', embers: 60,
      hand: [card('h1', 'impscrap')],
      board: [card('b1', 'impscrap'), card('t', 'dm_todd'), card('c', 'dm_clerk')],
    } as RunState;
    buffImpsRunWide(s, 3, 3, 'test'); // a prior shop Imp grant: board + hand Imps now 4/4, aura 3/3
    expect([s.board[0]!.attack, s.board[0]!.health]).toEqual([4, 4]);
    s = reduce({ ...s, servedBoards: { [s.wave]: foes(s.wave) } }, { type: 'faceOmen' });
    const start = s.lastCombat!.initial.player.find((m) => m.cardId === 'impscrap')!;
    expect([start.attack, start.health], 'no double count at combat start').toEqual([4, 4]);
    const gain = s.lastCombat!.playerImpBuffGain!;
    expect(gain.attack).toBeGreaterThan(0);
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.impBuff).toEqual({ attack: 3 + gain.attack, health: 3 + gain.health });
    // Both held Imps carry the fight's grant exactly once — stored = base + the whole aura.
    expect([s.board[0]!.attack, s.board[0]!.health]).toEqual([1 + s.impBuff!.attack, 1 + s.impBuff!.health]);
    expect([s.hand[0]!.attack, s.hand[0]!.health]).toEqual([1 + s.impBuff!.attack, 1 + s.impBuff!.health]);
    // The next fight starts the board Imp at its stored stats — not stored + aura.
    s = { ...s, phase: 'recruit' } as RunState;
    s = reduce({ ...s, servedBoards: { [s.wave]: foes(s.wave) } }, { type: 'faceOmen' });
    const next = s.lastCombat!.initial.player.find((m) => m.cardId === 'impscrap')!;
    expect([next.attack, next.health]).toEqual([1 + 3 + gain.attack, 1 + 3 + gain.health]);
  });
});
