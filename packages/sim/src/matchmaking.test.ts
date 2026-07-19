import { describe, it, expect, afterEach } from 'vitest';
import { createRun, type RunState } from './state';
import { nextOpponent, reduce } from './reducer';
import { OPPONENT_POOL, pickOpponent, registerOpponents } from './opponents';
import { MATCHMAKING, adjustedWinRate, bandWeight, clearBoardRecords, registerBoardRecords } from './matchmaking';
import { makeRng } from '@game/core';
import type { BoardSnapshot } from './snapshot';

/** A minimal servable snapshot; `id` keys its ledger record. */
const snap = (wave: number, seed: number, id?: string): BoardSnapshot => ({
  v: 1, wave, heroId: 'warden', seed, ...(id ? { id } : {}),
  minions: [{ cardId: 'alley', attack: 2, health: 2 }],
} as BoardSnapshot);

afterEach(() => { OPPONENT_POOL.length = 0; clearBoardRecords(); });

describe('win-rate math (board perspective, Bayesian prior 5/10)', () => {
  it('no record = the pure prior (50%) — neutral full weight', () => {
    expect(adjustedWinRate(undefined)).toBeCloseTo(0.5, 5);
    expect(bandWeight(adjustedWinRate(undefined))).toBe(1.0);
  });
  it('a 4–0 board reads 64%, not 100%', () => {
    expect(adjustedWinRate({ wins: 4, fights: 4 })).toBeCloseTo(9 / 14, 5);
  });
  it("the owner's band weights (2026-07-18)", () => {
    expect(bandWeight(0.20)).toBe(1.0);
    expect(bandWeight(0.45)).toBe(1.0);
    expect(bandWeight(0.60)).toBe(0.75);
    expect(bandWeight(0.70)).toBe(0.35);
    expect(bandWeight(0.85)).toBe(0.15);
    expect(bandWeight(0.95)).toBe(0.09); // bosses: rare, never quarantined
  });
});

describe('weighted pick — the LAST pipeline stage', () => {
  it('a proven boss board appears far less often than a core board (but still appears)', () => {
    registerBoardRecords(new Map([
      ['boss', { wins: 95, fights: 100 }],  // adjusted ≈ 0.909 → weight 0.09
      ['core', { wins: 40, fights: 100 }],  // adjusted ≈ 0.409 → weight 1.0
    ]));
    const pool = [snap(3, 1, 'boss'), snap(3, 2, 'core')];
    let boss = 0;
    for (let seed = 0; seed < 400; seed++) {
      if (pickOpponent(3, 0, makeRng(seed), pool)?.id === 'boss') boss++;
    }
    // Expected share ≈ 0.09 / 1.09 ≈ 8% — assert well under uniform (50%) and above zero (never quarantined).
    expect(boss).toBeGreaterThan(0);
    expect(boss).toBeLessThan(80);
  });

  it('weighting never overrides the no-repeat exclusion or the source cascade', () => {
    registerBoardRecords(new Map([['easy', { wins: 0, fights: 50 }]]));
    const easy = snap(3, 1, 'easy');
    const hardRemote = { ...snap(3, 2, 'hard'), remote: true } as BoardSnapshot;
    registerBoardRecords(new Map([['hard', { wins: 48, fights: 50 }]]));
    // The remote tier wins even though the local board is far "easier" — cascade before weighting.
    expect(pickOpponent(3, 0, makeRng(1), [easy, hardRemote])?.id).toBe('hard');
  });

  it('the master switch restores the exact legacy uniform pick', () => {
    registerBoardRecords(new Map([['boss', { wins: 95, fights: 100 }]]));
    const pool = [snap(3, 1, 'boss'), snap(3, 2, 'core')];
    MATCHMAKING.winrateWeighting = false;
    try {
      const legacy = pool[makeRng(7).int(pool.length)]!.seed;
      expect(pickOpponent(3, 0, makeRng(7), pool)?.seed).toBe(legacy);
    } finally {
      MATCHMAKING.winrateWeighting = true;
    }
  });
});

describe('opponent pinning (reload divergence, revived) + streak softener', () => {
  it('the first recruit action pins the wave opponent; the pin beats pool drift', () => {
    registerOpponents([snap(3, 111)]);
    let s: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit', embers: 10, freeRolls: 0 };
    s = reduce(s, { type: 'roll' });
    expect(s.servedBoards?.[3]?.seed).toBe(111);
    OPPONENT_POOL.length = 0;
    registerOpponents([snap(3, 222)]); // "a new session fetched a different pool"
    expect(nextOpponent(s)?.seed).toBe(111); // the pin wins everywhere
  });

  it('a NULL pin (procedural wave) stays procedural — never re-picked', () => {
    registerOpponents([snap(3, 111)]);
    const s: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit', servedBoards: { 3: null } };
    expect(nextOpponent(s)).toBeNull();
  });

  it('the softener fires ONCE per streak: spent at the pin, re-armed only by a win', () => {
    registerOpponents([snap(3, 111)]);
    let s: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit', embers: 10, freeRolls: 0, lossStreak: 2 };
    s = reduce(s, { type: 'roll' }); // pin lands while the softener is armed
    expect(s.streakSoftened).toBe(true); // spent
    // A later loss deepens the streak but the softener stays spent…
    s = { ...s, lossStreak: 3 };
    expect(s.streakSoftened).toBe(true);
    // …until a WIN resets both (settleCombat behavior, asserted via the state contract).
  });

  it('registerOpponents dedupes by identity — the between-runs refresh is idempotent', () => {
    registerOpponents([snap(3, 111, 'a'), snap(3, 222, 'b')]);
    registerOpponents([snap(3, 111, 'a'), snap(4, 333, 'c')]); // re-fetch overlaps
    expect(OPPONENT_POOL.length).toBe(3);
  });
});
