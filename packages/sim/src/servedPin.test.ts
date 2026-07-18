import { describe, it, expect, afterEach } from 'vitest';
import { createRun, type RunState } from './state';
import { nextOpponent, reduce } from './reducer';
import { OPPONENT_POOL, registerOpponents } from './opponents';
import type { BoardSnapshot } from './snapshot';

/**
 * Reload-divergence regression (2026-07-18 audit): combat rng was always deterministic, but the OPPONENT
 * pick wasn't durable — a reload mid-recruit re-picked from the session's pool (Supabase drift / fetch
 * timing). Contract now: the pick is PINNED into `servedBoards` on the first recruit action of the turn,
 * and `nextOpponent` always prefers the pin — so preview, fight, and a reloaded session all agree.
 */
const snap = (wave: number, seed: number): BoardSnapshot => ({
  v: 1, wave, heroId: 'warden', seed,
  minions: [{ cardId: 'alley', attack: 2, health: 2 }],
} as BoardSnapshot);

describe('served-opponent pinning (reload divergence)', () => {
  afterEach(() => { OPPONENT_POOL.length = 0; });

  it('the first recruit action pins the wave opponent; the pin survives pool drift', () => {
    registerOpponents([snap(3, 111)]);
    let s: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit', embers: 10, freeRolls: 0 };
    expect(s.servedBoards?.[3]).toBeUndefined();
    s = reduce(s, { type: 'roll' }); // ANY recruit action pins
    const pinned = s.servedBoards?.[3];
    expect(pinned?.seed).toBe(111);
    // The pool drifts (a "new session" fetched different boards) — the pin still wins everywhere.
    OPPONENT_POOL.length = 0;
    registerOpponents([snap(3, 222)]);
    expect(nextOpponent(s)?.seed).toBe(111); // preview reads the pin, not the drifted pool
  });

  it('an empty pool never pins (procedural fallback) and later actions retry once boards arrive', () => {
    let s: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit', embers: 10, freeRolls: 0 };
    s = reduce(s, { type: 'roll' });
    expect(s.servedBoards?.[3]).toBeUndefined(); // nothing to pin yet
    registerOpponents([snap(3, 333)]); // the async fetch lands mid-turn
    s = reduce(s, { type: 'roll' });
    expect(s.servedBoards?.[3]?.seed).toBe(333); // the next action pins it
  });
});
