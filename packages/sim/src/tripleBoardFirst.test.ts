/**
 * TRIPLES PULL FROM THE BOARD FIRST (owner rule 2026-09-25, R-GILD-03).
 *
 * "minions on board should be pulled into triple FIRST. so if i have 2 copies on board and use the genesis indy
 * hero power, that should pull the 2 off board and triple them, and then im left over with an extra base version
 * in hand."
 *
 * `checkTriples` used to consume HAND copies first, so whenever more copies were held than a Gild needs, a board
 * copy was stranded and a spare hand copy eaten. Every triple route funnels through the one `pullCopies`
 * helper, so each test below drives a DIFFERENT entry into it and checks the same outcome: the board copies are
 * consumed (left-most first), only the shortfall comes from the hand (newest first), and the surplus stays where
 * it was.
 */
import { describe, it, expect } from 'vitest';
import { createRun, reduce, type Action, type BoardCard, type RunState } from './index';

const ID = 'sandbag'; // Target Dummy: a vanilla T1 neutral with no Shout, so nothing but the triple moves
const copy = (uid: string, over: Partial<BoardCard> = {}): BoardCard =>
  ({ uid, cardId: ID, tribe: 'neutral', attack: 0, health: 4, keywords: ['T'], golden: false, ...over } as BoardCard);
const other = (uid: string): BoardCard =>
  ({ uid, cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false } as BoardCard);

function run(over: Partial<RunState> = {}): RunState {
  const s = createRun(7, 'warden');
  return { ...s, wave: 3, tier: 3, embers: 30, phase: 'recruit', shop: [], board: [], hand: [], ...over } as RunState;
}

const goldens = (s: RunState): BoardCard[] => [...s.board, ...s.hand].filter((c) => c.cardId === ID && c.golden);
const plainIn = (arr: BoardCard[]): string[] => arr.filter((c) => c.cardId === ID && !c.golden).map((c) => c.uid);
const win = { events: [], result: 'win' as const, playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } };

describe('triples consume board copies first', () => {
  it("owner example: two on board + an effect that gives TWO copies to hand -> both board copies gild, one plain copy stays in hand", () => {
    // Rune of Copies at two stacks is a real "get 2 copies to hand" effect: at the shop open it copies a random
    // board minion twice, and the only minion on the board is the pair. The shop-open `checkTriples` (the same
    // call that catches End-of-Turn and combat carry-back grants) then combines.
    const s0 = run({
      phase: 'combat', wave: 6, runeCopies: true, runeStacks: { rune_copies: 2 },
      board: [copy('b1', { attack: 2, health: 6, buffs: [{ source: 'Test', attack: 2, health: 2, count: 1 }] }), copy('b2')],
      lastCombat: win,
    } as Partial<RunState>);
    const s = reduce(s0, { type: 'resolveCombat' } as Action);

    const g = goldens(s);
    expect(g, 'exactly one golden').toHaveLength(1);
    expect(plainIn(s.board), 'both board copies were consumed').toEqual([]);
    expect(plainIn(s.hand), 'one plain copy is left over in hand').toHaveLength(1);
    expect(s.hand.some((c) => c.uid === g[0]!.uid), 'the golden goes to hand as usual').toBe(true);
    // The existing merge rule is unchanged: golden = the two best copies stacked, buffs carried.
    expect(g[0]!.attack).toBe(2 + 0);
    expect(g[0]!.health).toBe(6 + 4);
    expect(g[0]!.buffs?.some((b) => b.source === 'Test')).toBe(true);
  });

  it('buy: a bought copy completes the triple with the two board copies, not a spare hand copy', () => {
    const s0 = run({ board: [copy('b1'), copy('b2')], hand: [copy('h_old')], shop: [{ uid: 'o1', cardId: ID }] } as Partial<RunState>);
    const s = reduce(s0, { type: 'buy', uid: 'o1' } as Action);
    expect(goldens(s)).toHaveLength(1);
    expect(plainIn(s.board)).toEqual([]);
    expect(plainIn(s.hand), 'the older spare hand copy survives; the new one was consumed').toEqual(['h_old']);
  });

  it('Discover: a discovered copy completes the triple with the board copies', () => {
    const s0 = run({ board: [copy('b1'), copy('b2')], hand: [copy('h_old')], discover: [ID, 'alley', 'alley'] } as Partial<RunState>);
    const s = reduce(s0, { type: 'discover', index: 0 } as Action);
    expect(goldens(s)).toHaveLength(1);
    expect(plainIn(s.board)).toEqual([]);
    expect(plainIn(s.hand)).toEqual(['h_old']);
  });

  it('summon onto the board: playing a copy that completes the triple takes the three board bodies', () => {
    const s0 = run({ board: [copy('b1'), copy('b2')], hand: [copy('h_old'), copy('h_new')] });
    const s = reduce(s0, { type: 'play', uid: 'h_new' } as Action);
    expect(goldens(s)).toHaveLength(1);
    expect(plainIn(s.board), 'all three board bodies gilded').toEqual([]);
    expect(plainIn(s.hand), 'the hand copy was never touched').toEqual(['h_old']);
  });

  it('hero power (Gildmaster): the granted third copy gilds the board pair, carrying their buffs', () => {
    const s0 = run({
      heroId: 'gildmaster', heroReady: true,
      board: [copy('b1', { attack: 3, health: 7, buffs: [{ source: 'Test', attack: 3, health: 3, count: 1 }] }), other('x'), copy('b2')],
    } as Partial<RunState>);
    const s = reduce({ ...createRun(7, 'gildmaster'), ...s0, heroId: 'gildmaster' } as RunState, { type: 'heroPower' } as Action);
    expect(goldens(s)).toHaveLength(1);
    expect(plainIn(s.board)).toEqual([]);
    expect(goldens(s)[0]!.buffs?.some((b) => b.source === 'Test')).toBe(true);
  });

  it('tie-break inside the board is LEFT-MOST first (Twin Gilding, needs 2)', () => {
    // An unusual held state (three board copies under a 2-copy Gild) makes the board order observable.
    const s0 = run({ runeTwinGilding: true, board: [copy('L'), other('x'), copy('M')], hand: [copy('h')] } as Partial<RunState>);
    const s = reduce(s0, { type: 'play', uid: 'h' } as Action);
    expect(goldens(s)).toHaveLength(1);
    expect(plainIn(s.board), 'the two left-most copies gilded; the right-most (just played) stays').toEqual(['h']);
  });

  it('only the shortfall comes from the hand: newest hand copy first', () => {
    // One on board + two already in hand + a fresh bought one: board copy + the two NEWEST hand copies.
    const s0 = run({ board: [copy('b1')], hand: [copy('h_old'), copy('h_mid')], shop: [{ uid: 'o1', cardId: ID }] } as Partial<RunState>);
    // Four copies once the buy lands; need 3 -> b1 + the bought copy + h_mid; h_old stays.
    const s = reduce(s0, { type: 'buy', uid: 'o1' } as Action);
    expect(goldens(s)).toHaveLength(1);
    expect(plainIn(s.board)).toEqual([]);
    expect(plainIn(s.hand)).toEqual(['h_old']);
  });
});
