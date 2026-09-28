/**
 * SET 3 RUNE DESIGN PASS, TRANCHE 5 (owner 2026-09-27): the Menagerie (Set 3), Rune of Unity and the Heavy Hand, SHOP /
 * END OF TURN halves through the real reducer. The combat halves are `packages/core/src/combat/set3RuneDesignT5.test.ts`.
 * Rune of the Wishbone was restored to Set 3 in tranche 0 and is not rebuilt here.
 *
 * Unity is the prototype: the full house is read from NATURAL types only (it cannot hold itself up), it is stamped on
 * the BOARD at every action boundary and at the Shop chokepoints that change the board mid-action, and a Unity body
 * folds the whole Undead Aura (never baked).
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, Tribe } from '@game/core';
import { CARD_INDEX, RUNE_INDEX } from '@game/content';
import { applyEndOfTurn, displayedStatsOf, isTribe, kindredHandValue, raiseUndeadAuraShop, syncUnity, unityHolds, unityTypeCount, buffUndeadAttackEverywhere } from './recruit';
import { questCombatMods } from './reducer';
import { createRun, reduce, type BoardCard, type RunState } from './index';

const probe = (id: string, over: Partial<CardDef>): CardDef => ({ id, name: id, tribe: 'kobold', tier: 1, attack: 2, health: 2, keywords: [], effects: [], text: '', ...over });
const K = probe('dbg_t5s_k', {});
const D = probe('dbg_t5s_d', { tribe: 'dwarf' });
const U = probe('dbg_t5s_u', { tribe: 'undead' });
const S = probe('dbg_t5s_s', { tribe: 'spirit' });
const C = probe('dbg_t5s_c', { tribe: 'celestial' });
const N = probe('dbg_t5s_n', { tribe: 'neutral' });
for (const c of [K, D, U, S, C, N]) CARD_INDEX[c.id] = c;
const SET3: Tribe[] = ['kobold', 'dwarf', 'undead', 'spirit', 'celestial'];

const card = (id: string, uid: string): BoardCard => {
  const c = CARD_INDEX[id]!;
  return { uid, cardId: id, tribe: c.tribe, attack: c.attack, health: c.health, keywords: [...c.keywords], golden: false } as BoardCard;
};
const run = (board: BoardCard[], runes: string[], hand: BoardCard[] = []): RunState => {
  let s: RunState = { ...createRun(11, 'warden', 'ascent', undefined, 'set3'), phase: 'recruit', embers: 30, hand: [], board, tribes: [...SET3] } as RunState;
  for (const id of runes) s = reduce(s, { type: 'devGrant', kind: 'rune', id });
  return { ...s, discover: undefined, discoverQueue: undefined, hand };
};
const at = (s: RunState, uid: string) => [...s.board, ...s.hand].find((c) => c.uid === uid)!;
const fullHouse = () => [card(K.id, 'k'), card(D.id, 'd'), card(U.id, 'u'), card(S.id, 's'), card(C.id, 'c')];

describe('the tranche 5 roster (owner 2026-09-27)', () => {
  it('the Set 3 Menagerie, Unity and the Heavy Hand at the doc costs, Set 3 only; the Wishbone stays restored', () => {
    const m = RUNE_INDEX['rune_menagerie_set3']!;
    expect([m.cost, !!m.epic, m.sets, m.tribes, m.name]).toEqual([5, false, ['set3'], SET3, 'Rune of the Menagerie']);
    const u = RUNE_INDEX['rune_unity']!;
    expect([u.cost, !!u.epic, u.sets, u.tribes ?? []]).toEqual([6, true, ['set3'], []]);
    expect(u.text).toBe('While you control all **5** minion types, your minions count as **every type**.');
    const h = RUNE_INDEX['rune_heavy_hand']!;
    expect([h.cost, !!h.epic, h.sets, h.tribes ?? []]).toEqual([2, false, ['set3'], []]);
    expect(h.text).toBe('Damage your minions deal counts **double** toward **Pummel**.');
    for (const r of [m, u, h]) expect(r.text).not.toMatch(/—|--/);
    expect(RUNE_INDEX['rune_wishbone']!.sets).toContain('set3');
  });
});

describe('Rune of the Menagerie (Set 3)', () => {
  it('gets one random minion of each Set 3 tribe', () => {
    let s: RunState = { ...createRun(11, 'warden', 'ascent', undefined, 'set3'), phase: 'recruit', hand: [], board: [], tribes: [...SET3] } as RunState;
    s = reduce(s, { type: 'devGrant', kind: 'rune', id: 'rune_menagerie_set3' });
    const got = s.hand.map((c) => CARD_INDEX[c.cardId]!);
    expect(got).toHaveLength(5);
    for (const t of SET3) expect(got.some((d) => d.tribe === t || d.tribe2 === t || d.universalTribe), t).toBe(true);
  });
});

describe('Rune of Unity — Shop (prototype)', () => {
  it('four types: nothing; the fifth type played: every board minion counts as every type (hand cards do not)', () => {
    let s = run([card(K.id, 'k'), card(D.id, 'd'), card(U.id, 'u'), card(S.id, 's')], ['rune_unity'], [card(C.id, 'c'), card(N.id, 'h')]);
    expect(unityTypeCount(s)).toEqual({ have: 4, of: 5 });
    expect(isTribe(at(s, 'k'), 'spirit')).toBe(false);
    s = reduce(s, { type: 'play', uid: 'c', toIndex: 4 });
    expect(unityHolds(s)).toBe(true);
    for (const uid of ['k', 'd', 'u', 's', 'c']) for (const t of SET3) expect(isTribe(at(s, uid), t), `${uid} is ${t}`).toBe(true);
    expect(isTribe(at(s, 'h'), 'spirit'), 'a hand card is not "your minions"').toBe(false);
    expect(questCombatMods(s).runeUnity).toBe(true);
  });
  it('it cannot hold itself up: sell the only Celestial and the grant is withdrawn at once', () => {
    let s = run(fullHouse(), ['rune_unity']);
    expect(isTribe(at(s, 'k'), 'celestial')).toBe(true);
    s = reduce(s, { type: 'sell', uid: 'c' });
    expect(unityHolds(s)).toBe(false);
    for (const c of s.board) expect(c.unityTribes, c.uid).toBeUndefined();
    expect(isTribe(at(s, 'k'), 'celestial')).toBe(false);
  });
  it('without the rune a full house counts as nothing extra', () => {
    const s = run(fullHouse(), []);
    syncUnity(s);
    expect(isTribe(at(s, 'k'), 'spirit')).toBe(false);
  });
  it('a tribal payoff answers: the Kindred Hand counts every board minion as a Spirit', () => {
    const on = run(fullHouse(), ['rune_unity', 'rune_kindred_hand']);
    const off = run(fullHouse(), ['rune_kindred_hand']);
    expect(kindredHandValue(on, 1)).toBe(6);
    expect(kindredHandValue(off, 1)).toBe(2);
  });
  it('a Unity body folds the WHOLE Undead Aura; the buy channel is never baked into it (no double count)', () => {
    const s = run(fullHouse(), ['rune_unity']);
    raiseUndeadAuraShop(s, 3);
    buffUndeadAttackEverywhere(s, 2, 'test');
    // The Kobold: not baked (+0 stored), folds Lantern 3 + buy 2.
    expect(at(s, 'k').attack).toBe(2);
    expect(displayedStatsOf(s, at(s, 'k')).attack).toBe(2 + 5);
    // The natural Undead: baked +2 buy, folds the Lantern 3, exactly as before.
    expect(displayedStatsOf(s, at(s, 'u')).attack).toBe(2 + 2 + 3);
  });
  it('End of Turn reads the board as it stands', () => {
    const s = run(fullHouse(), ['rune_unity']);
    for (const c of s.board) delete c.unityTribes;
    applyEndOfTurn(s);
    expect(at(s, 'k').unityTribes).toBe(true);
  });
});

describe('Rune of the Heavy Hand — Shop', () => {
  it('threads to combat (Pummel damage is dealt only in combat)', () => {
    const s = run([], ['rune_heavy_hand']);
    expect(questCombatMods(s).runeHeavyHand).toBe(true);
  });
});
