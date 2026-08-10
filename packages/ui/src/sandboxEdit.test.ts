import { describe, expect, it } from 'vitest';
import type { BoardCard, BoardSnapshot } from '@game/sim';
import type { CardDef } from '@game/core';
import {
  MAX_BOARD,
  addEnemy,
  removeEnemy,
  setCardId,
  setCardStats,
  setEnemyCardId,
  setEnemyStats,
  stagedBoard,
  toggleCardKeyword,
  toggleEnemyKeyword,
} from './sandboxEdit';

const def = (id: string, attack = 3, health = 4): CardDef =>
  ({ id, name: id.toUpperCase(), tribe: 'beast', tier: 1, attack, health, keywords: [], effects: [], text: '' }) as CardDef;
const DEFS: Record<string, CardDef> = { wolf: def('wolf', 3, 4), bear: def('bear', 9, 9) };
const defOf = (id: string): CardDef | undefined => DEFS[id];

const card = (uid: string, cardId = 'wolf'): BoardCard => ({
  uid, cardId, tribe: 'beast', attack: 3, health: 4, keywords: [], golden: false,
});

describe('editing a player board card', () => {
  it('sets base stats and leaves the buff breakdown alone', () => {
    const board = [{ ...card('a'), buffs: [{ source: 'Karwind', attack: 2, health: 2 }] } as BoardCard];
    const next = setCardStats(board, 'a', { attack: 40, health: 40 });
    expect(next[0].attack).toBe(40);
    expect(next[0].health).toBe(40);
    expect(next[0].buffs).toEqual(board[0].buffs);
  });

  it('floors health at 1 and attack at 0 — a 0-health card is a corpse the sim never produces at rest', () => {
    const next = setCardStats([card('a')], 'a', { attack: -5, health: 0 });
    expect(next[0].attack).toBe(0);
    expect(next[0].health).toBe(1);
  });

  it('leaves other cards untouched and returns a new array', () => {
    const board = [card('a'), card('b')];
    const next = setCardStats(board, 'b', { attack: 7 });
    expect(next).not.toBe(board);
    expect(next[0]).toBe(board[0]);
    expect(next[1].attack).toBe(7);
  });

  it('an unknown uid is a no-op, not a throw', () => {
    const board = [card('a')];
    expect(setCardStats(board, 'nope', { attack: 9 })).toEqual(board);
  });

  it('swapping the card keeps the uid and adopts the new printed stats and tribe', () => {
    const next = setCardId([card('a')], 'a', 'bear', defOf);
    expect(next[0].uid).toBe('a');
    expect(next[0].cardId).toBe('bear');
    expect(next[0].attack).toBe(9);
    expect(next[0].health).toBe(9);
    expect(next[0].tribe).toBe('beast');
  });

  it('swapping to an unknown card id changes nothing', () => {
    const board = [card('a')];
    expect(setCardId(board, 'a', 'ghost', defOf)).toEqual(board);
  });

  it('keyword toggles are their own inverse', () => {
    const on = toggleCardKeyword([card('a')], 'a', 'T');
    expect(on[0].keywords).toEqual(['T']);
    expect(toggleCardKeyword(on, 'a', 'T')[0].keywords).toEqual([]);
  });
});

describe('the staged opponent board', () => {
  const snap = (n: number): BoardSnapshot =>
    stagedBoard(3, Array.from({ length: n }, () => ({ cardId: 'wolf', attack: 3, health: 4, keywords: [] })));

  it('carries the wave and the minions verbatim', () => {
    const s = snap(2);
    expect(s.wave).toBe(3);
    expect(s.minions).toHaveLength(2);
    expect(s.minions[0].cardId).toBe('wolf');
  });

  it('power is the sum of attack and health across the board', () => {
    expect(snap(2).power).toBe((3 + 4) * 2);
  });

  it('clamps to at most 7 minions', () => {
    expect(snap(12).minions).toHaveLength(MAX_BOARD);
    expect(addEnemy(snap(MAX_BOARD), 'wolf', defOf).minions).toHaveLength(MAX_BOARD);
  });

  it('never produces an empty board — removing the last minion is refused', () => {
    const one = snap(1);
    expect(removeEnemy(one, 0).minions).toHaveLength(1);
  });

  it('removes the named slot and leaves the others in order', () => {
    const s = setEnemyCardId(snap(3), 1, 'bear', defOf);
    const after = removeEnemy(s, 1);
    expect(after.minions).toHaveLength(2);
    expect(after.minions.every((m) => m.cardId === 'wolf')).toBe(true);
  });

  it('adds a minion with its printed stats', () => {
    const s = addEnemy(snap(1), 'bear', defOf);
    expect(s.minions).toHaveLength(2);
    expect(s.minions[1]).toMatchObject({ cardId: 'bear', attack: 9, health: 9 });
  });

  it('edits recompute power, so a served board never reports a stale strength', () => {
    const s = setEnemyStats(snap(1), 0, { attack: 10, health: 10 });
    expect(s.power).toBe(20);
  });

  it('enemy stats floor exactly like player stats', () => {
    const s = setEnemyStats(snap(1), 0, { attack: -3, health: 0 });
    expect(s.minions[0]).toMatchObject({ attack: 0, health: 1 });
  });

  it('an out-of-range index is a no-op', () => {
    const s = snap(1);
    expect(setEnemyStats(s, 9, { attack: 5 })).toEqual(s);
    expect(removeEnemy(s, -1)).toEqual(s);
  });

  it('enemy keyword toggles are their own inverse', () => {
    const on = toggleEnemyKeyword(snap(1), 0, 'DS');
    expect(on.minions[0].keywords).toEqual(['DS']);
    expect(toggleEnemyKeyword(on, 0, 'DS').minions[0].keywords).toEqual([]);
  });
});
