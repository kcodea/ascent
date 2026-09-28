/**
 * SET 3 RUNE DESIGN PASS, TRANCHE 3 (owner 2026-09-27): the Spirit + Dwarf runes, SHOP / END OF TURN / settle halves
 * through the real reducer. The combat halves are `packages/core/src/combat/set3RuneDesignT3.test.ts`. No Beckoning
 * (owner); its Spirit Basic slot is the owner's pick, the Kindred Hand.
 */
import { describe, expect, it } from 'vitest';
import type { CardDef } from '@game/core';
import { CARD_INDEX, RUNE_INDEX } from '@game/content';
import { applyEndOfTurn, fireShopRally, kindredHandValue } from './recruit';
import { createRun, reduce, type BoardCard, type BoardSnapshot, type RunState } from './index';

const probe = (id: string, over: Partial<CardDef>): CardDef => ({ id, name: id, tribe: 'spirit', tier: 1, attack: 1, health: 1, keywords: [], effects: [], text: '', ...over });
const SPIRIT_SHOUT = probe('dbg_t3_sshout', { effects: [{ on: 'onPlay', do: 'battlecryBuffAdjacent', params: { attack: 1, health: 1 } }] });
const SPIRIT_RALLY = probe('dbg_t3_srally', { keywords: ['RL'], effects: [{ on: 'onAttack', do: 'rallyBuffSelf', params: { attack: 1, health: 1 } }] });
const SPIRIT = probe('dbg_t3_spirit', { attack: 2, health: 2 });
const SPIRIT_B = probe('dbg_t3_spiritb', { attack: 2, health: 2 });
const HELD = probe('dbg_t3_held', { tribe: 'neutral', attack: 1, health: 1 });
const DWARF = probe('dbg_t3_dwarf', { tribe: 'dwarf', attack: 2, health: 2 });
const DWARF_B = probe('dbg_t3_dwarfb', { tribe: 'dwarf', attack: 2, health: 2 });
const NEU = probe('dbg_t3_neu', { tribe: 'neutral', attack: 2, health: 2 });
for (const c of [SPIRIT_SHOUT, SPIRIT_RALLY, SPIRIT, SPIRIT_B, HELD, DWARF, DWARF_B, NEU]) CARD_INDEX[c.id] = c;

const card = (id: string, uid: string): BoardCard => {
  const c = CARD_INDEX[id]!;
  return { uid, cardId: id, tribe: c.tribe, attack: c.attack, health: c.health, keywords: [...c.keywords], golden: false } as BoardCard;
};
const run = (board: BoardCard[], runes: string[], hand: BoardCard[] = []): RunState => {
  let s: RunState = { ...createRun(11, 'warden', 'ascent', undefined, 'set3'), phase: 'recruit', embers: 30, hand: [], board } as RunState;
  for (const id of runes) s = reduce(s, { type: 'devGrant', kind: 'rune', id });
  return { ...s, discover: undefined, discoverQueue: undefined, hand };
};
const at = (s: RunState, uid: string) => [...s.board, ...s.hand].find((c) => c.uid === uid)!;
const stats = (s: RunState, uid: string): [number, number] => [at(s, uid).attack, at(s, uid).health];

describe('the tranche 3 roster (owner 2026-09-27)', () => {
  it('four Spirit + three Dwarf runes at the doc costs, Set 3 only, tribe-gated; the Kindred Hand replaces the Beckoning', () => {
    const want: [string, number, boolean, string][] = [
      ['rune_call_and_answer', 3, false, 'spirit'], ['rune_encore', 3, false, 'spirit'], ['rune_overture', 4, false, 'spirit'], ['rune_kindred_hand', 3, false, 'spirit'],
      ['rune_whetstone', 3, false, 'dwarf'], ['rune_anvil', 5, true, 'dwarf'], ['rune_satchel', 4, true, 'dwarf'],
    ];
    for (const [id, cost, epic, tribe] of want) {
      const r = RUNE_INDEX[id]!;
      expect([r.cost, !!r.epic, r.sets, r.tribes], id).toEqual([cost, epic, ['set3'], [tribe]]);
      expect(r.text, `${id}: no em dash`).not.toMatch(/—|--/);
    }
    expect(RUNE_INDEX['rune_beckoning']).toBeUndefined();
    expect(RUNE_INDEX['rune_kindred_hand']!.text).toBe('After you play a **Spirit**, give the left-most minion in your hand **+1/+1** for each **Spirit** you control.');
  });
});

describe('Rune of Call and Answer — Shop', () => {
  it('a Spirit Shout pays the left-most MINION in hand +2/+2 (a spell in front is skipped)', () => {
    let s = run([], ['rune_call_and_answer'], [card('crescendo', 'sp'), card(HELD.id, 'h'), card(SPIRIT_SHOUT.id, 'p')]);
    s = reduce(s, { type: 'play', uid: 'p', toIndex: 0 });
    expect(stats(s, 'h')).toEqual([3, 3]);
  });
  it('a Spirit\'s Shop Rally (End of Turn replay) pays too; a non-Spirit Shout does not', () => {
    const s = run([card(SPIRIT_RALLY.id, 'r')], ['rune_call_and_answer'], [card(HELD.id, 'h')]);
    fireShopRally(s, s.board[0]!);
    expect(stats(s, 'h')).toEqual([3, 3]);
    let s2 = run([], ['rune_call_and_answer'], [card(HELD.id, 'h'), card(NEU.id, 'n')]);
    s2 = { ...s2, hand: [card(HELD.id, 'h'), { ...card(NEU.id, 'n') }] };
    CARD_INDEX[NEU.id] = { ...NEU, effects: [{ on: 'onPlay', do: 'battlecryBuffAdjacent', params: { attack: 1, health: 1 } }] };
    s2 = reduce(s2, { type: 'play', uid: 'n', toIndex: 0 });
    CARD_INDEX[NEU.id] = NEU;
    expect(stats(s2, 'h')).toEqual([1, 1]);
  });
});

describe('Rune of the Encore', () => {
  it('the first Reveler sold each turn also pays its bonus to the left-most hand minion; the second does not', () => {
    let s = run([card('sp3_flamereveler', 'f1'), card('sp3_flamereveler', 'f2'), card(SPIRIT.id, 'sp')], ['rune_encore'], [card(HELD.id, 'h')]);
    const x = s.revelerX ?? 1;
    s = reduce(s, { type: 'sell', uid: 'f1' });
    // Flame Reveler pays Attack only: the Spirit and the held card both +X Attack.
    expect(stats(s, 'sp')).toEqual([2 + x, 2]);
    expect(stats(s, 'h')).toEqual([1 + x, 1]);
    expect(s.encoreUsedThisTurn).toBe(true);
    const held = at(s, 'h').attack;
    s = reduce(s, { type: 'sell', uid: 'f2' });
    expect(at(s, 'h').attack, 'second sale: the hand is not paid').toBe(held);
  });
});

describe('Rune of the Overture', () => {
  it('gets a Crescendo now and arms the every-2-turns cadence', () => {
    const s = run([], ['rune_overture']);
    // `run` clears the hand afterwards; read the cadence and grant it recorded.
    expect(s.runeCadenceGrants).toContainEqual(expect.objectContaining({ cardId: 'crescendo', everyTurns: 2, sourceId: 'rune_overture' }));
    let g: RunState = { ...createRun(11, 'warden', 'ascent', undefined, 'set3'), phase: 'recruit', hand: [], board: [] } as RunState;
    g = reduce(g, { type: 'devGrant', kind: 'rune', id: 'rune_overture' });
    expect(g.hand.map((c) => c.cardId)).toContain('crescendo');
  });
});

describe('Rune of the Kindred Hand (owner pick 2026-09-27)', () => {
  it('a Spirit played gives the left-most hand minion +1/+1 per Spirit you control (the played one included)', () => {
    let s = run([card(SPIRIT.id, 'a'), card(SPIRIT_B.id, 'b'), card(NEU.id, 'n')], ['rune_kindred_hand'], [card(HELD.id, 'h'), card(SPIRIT_SHOUT.id, 'p')]);
    expect(kindredHandValue(s, 1), 'the badge: the next Spirit played pays +3/+3').toBe(3);
    s = reduce(s, { type: 'play', uid: 'p', toIndex: 0 });
    expect(stats(s, 'h')).toEqual([4, 4]);
  });
  it('a non-Spirit played pays nothing', () => {
    let s = run([card(SPIRIT.id, 'a')], ['rune_kindred_hand'], [card(HELD.id, 'h'), card(DWARF.id, 'd')]);
    s = reduce(s, { type: 'play', uid: 'd', toIndex: 0 });
    expect(stats(s, 'h')).toEqual([1, 1]);
  });
});

describe('Rune of the Whetstone + the Anvil — Shop and End of Turn', () => {
  it('Whetstone: a Dwarf played gives your OTHER Dwarves +1 Attack', () => {
    let s = run([card(DWARF.id, 'a'), card(NEU.id, 'n')], ['rune_whetstone'], [card(DWARF_B.id, 'p')]);
    s = reduce(s, { type: 'play', uid: 'p', toIndex: 0 });
    expect(stats(s, 'a')).toEqual([3, 2]);
    expect(stats(s, 'p'), 'not the played Dwarf').toEqual([2, 2]);
    expect(stats(s, 'n')).toEqual([2, 2]);
  });
  it('Anvil: that Attack gain also gives that much Health (Shop)', () => {
    let s = run([card(DWARF.id, 'a')], ['rune_whetstone', 'rune_anvil'], [card(DWARF_B.id, 'p')]);
    s = reduce(s, { type: 'play', uid: 'p', toIndex: 0 });
    expect(stats(s, 'a')).toEqual([3, 3]);
  });
  it('Anvil at End of Turn: a Striker\'s per-tick Attack gains each also give Health', () => {
    const s = run([card(DWARF.id, 'a'), card('dw3_striker', 's')], ['rune_anvil']);
    s.playedThisTurn = ['x']; // one card played: the base tick + one repeat = +2 Attack in two ticks
    applyEndOfTurn(s);
    const [atk, hp] = stats(s, 'a');
    expect(atk).toBe(4);
    expect(hp, 'the same +2 as Health').toBe(4);
  });
});

describe('Rune of the Satchel — Shop and settle', () => {
  it('a card added to your hand (a buy) gives your board Dwarves +1/+1', () => {
    let s = run([card(DWARF.id, 'a'), card(NEU.id, 'n')], ['rune_satchel']);
    const offer = s.shop.find((o) => { const d = CARD_INDEX[o.cardId]; return !!d && !d.spell && !o.starform; })!;
    s = reduce(s, { type: 'buy', uid: offer.uid });
    expect(stats(s, 'a')).toEqual([3, 3]);
    expect(stats(s, 'n')).toEqual([2, 2]);
  });
  it('combat: a card reaching the hand mid-fight pays the living Dwarves there, and its arrival pays the board at settle', () => {
    CARD_INDEX['dbg_t3_rubyecho'] = probe('dbg_t3_rubyecho', { tribe: 'neutral', effects: [{ on: 'onDeath', do: 'deathrattleGetRubies', params: { count: 1 } }] });
    let s = run([card('dbg_t3_rubyecho', 'e'), card(DWARF.id, 'a')], ['rune_satchel']);
    const foes: BoardSnapshot = { v: 1, wave: s.wave, heroId: 'indy', resolve: 30, tier: 1, triples: 0, tribes: [], threat: 'glass', power: 1, minions: [{ cardId: 'sandbag', attack: 50, health: 500, keywords: [] }], seed: 1, origin: 'self' };
    s = reduce({ ...s, servedBoards: { [s.wave]: foes } }, { type: 'faceOmen' });
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.lastCombat!.events.some((e) => e.type === 'questTrigger' && e.flag === 'runeSatchel')).toBe(true);
    expect(s.hand.some((c) => CARD_INDEX[c.cardId]?.ruby)).toBe(true);
    expect(stats(s, 'a')[0]).toBeGreaterThanOrEqual(3);
  });
});
