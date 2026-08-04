import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { boardIntel, seatResults } from './runLobby';
import type { RunLobby } from './runLobby';
import type { PreparedBoard } from './types';

/**
 * The lobby rail's SCOUT data — the dominant-tribe / tier / triples read, and the last-3-fights log.
 *
 * These are read by a hover card, so the tempting implementation is to derive them on demand. That would be a
 * bad trade: `prepare()` costs 200-900 ms for a bot seat, so scouting a seat would stall the shop phase. Intel
 * is therefore RECORDED at settle, where the boards are already built — and these tests pin the reading logic
 * that runs there.
 */
const minion = (cardId: string) => ({ cardId, attack: 1, health: 1 });
const board = (cardIds: string[], tier = 4, triples = 0): PreparedBoard => ({
  minions: cardIds.map(minion) as PreparedBoard['minions'],
  tier,
  snapshot: { triples } as PreparedBoard['snapshot'],
});

describe('boardIntel — what a board reads as', () => {
  const beast = Object.values(CARD_INDEX).find((c) => c.tribe === 'beast' && !c.spell && !c.token)!;
  const dragon = Object.values(CARD_INDEX).find((c) => c.tribe === 'dragon' && !c.spell && !c.token)!;
  const neutral = Object.values(CARD_INDEX).find((c) => c.tribe === 'neutral' && !c.spell && !c.token)!;

  it('reports the DOMINANT tribe, not merely a present one', () => {
    const i = boardIntel(board([beast.id, beast.id, beast.id, dragon.id]), 5);
    expect(i.topTribe).toBe('beast');
  });

  it('counts the BODIES rather than trusting the snapshot tribe list', () => {
    // The snapshot's `tribes` is the run's five ACTIVE tribes — what the shop could offer — which is a different
    // question from what this board is made of. A run that could offer Dragons but fielded Beasts reads Beasts.
    const i = boardIntel({ ...board([beast.id, beast.id]), snapshot: { triples: 0, tribes: ['dragon'] } as never }, 5);
    expect(i.topTribe).toBe('beast');
  });

  it('ignores neutral — it is the absence of a tribe, not one to lead with', () => {
    const i = boardIntel(board([neutral.id, neutral.id, neutral.id, beast.id]), 5);
    expect(i.topTribe).toBe('beast');
  });

  it('reports no tribe for an all-neutral or empty board', () => {
    expect(boardIntel(board([neutral.id, neutral.id]), 5).topTribe).toBeUndefined();
    expect(boardIntel(board([]), 5).topTribe).toBeUndefined();
  });

  it('carries tier, triples and the round it was read', () => {
    const i = boardIntel(board([beast.id], 6, 3), 9);
    expect(i).toMatchObject({ tier: 6, triples: 3, round: 9 });
  });
});

describe('seatResults — the last fights, from one seat\'s side', () => {
  const lobby = (encounters: RunLobby['encounters']): RunLobby => ({
    version: 1, seed: 1, round: 9, finished: false,
    seats: [
      { id: 'a', label: 'Orange' }, { id: 'b', label: 'Lemon' }, { id: 'c', label: 'Plum' },
    ] as RunLobby['seats'],
    encounters,
    rules: {} as RunLobby['rules'],
  });
  const enc = (over: Partial<RunLobby['encounters'][number]>) => ({
    round: 1, a: 'a', b: 'b', outcome: 'win' as const, damageToA: 0, damageToB: 0, fought: true, ...over,
  });

  it('is newest first and capped', () => {
    const l = lobby([enc({ round: 1 }), enc({ round: 2 }), enc({ round: 3 }), enc({ round: 4 })]);
    expect(seatResults(l, 'a', 3).map((r) => r.round)).toEqual([4, 3, 2]);
  });

  it('inverts the outcome for seat B — `outcome` is written from A\'s side', () => {
    // Getting this wrong would show every opponent winning the same fight you won.
    const l = lobby([enc({ round: 1, outcome: 'win', damageToA: 0, damageToB: 30 })]);
    expect(seatResults(l, 'a', 3)[0]).toMatchObject({ outcome: 'win', dealt: 30, taken: 0, foeLabel: 'Lemon' });
    expect(seatResults(l, 'b', 3)[0]).toMatchObject({ outcome: 'lose', dealt: 0, taken: 30, foeLabel: 'Orange' });
  });

  it('leaves a draw a draw from both sides', () => {
    const l = lobby([enc({ outcome: 'draw' })]);
    expect(seatResults(l, 'a', 3)[0]!.outcome).toBe('draw');
    expect(seatResults(l, 'b', 3)[0]!.outcome).toBe('draw');
  });

  it('skips rounds that were never fought', () => {
    // `fought: false` exists because a 0-damage draw and a seat that could not field a board are otherwise
    // indistinguishable — listing the latter would read as a stalemate that never happened.
    const l = lobby([enc({ round: 1, fought: false }), enc({ round: 2 })]);
    expect(seatResults(l, 'a', 3).map((r) => r.round)).toEqual([2]);
  });

  it('ignores fights the seat was not in', () => {
    const l = lobby([enc({ round: 1, a: 'b', b: 'c' }), enc({ round: 2 })]);
    expect(seatResults(l, 'a', 3).map((r) => r.round)).toEqual([2]);
  });

  it('returns nothing for a seat that has never fought', () => {
    expect(seatResults(lobby([]), 'a', 3)).toEqual([]);
  });
});
