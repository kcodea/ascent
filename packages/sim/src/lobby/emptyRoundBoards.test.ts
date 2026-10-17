import { afterEach, describe, expect, it } from 'vitest';
import { activeSet } from '@game/content';
import type { BoardSnapshot } from '../snapshot';
import { snapshotBoard } from '../snapshot';
import { createRun } from '../state';
import { reduce } from '../reducer';
import { OPPONENT_POOL, pickOpponent, registerOpponentRuns } from '../opponents';
import { makeRng } from '@game/core';
import { createRunLobby, driverFor, resetLobbyDrivers, seatScoutIntel } from './runLobby';
import { playerRunsFrom } from './snapshotSeats';

/**
 * EMPTY ROUNDS ARE PART OF A RUN (owner 2026-10-17, R-LOBBY-08). Owner report: "i just faced this board on round 1 -
 * how is that possible that he is shop tier 2? i feel like somethings wrong with our snapshots again". The seat was a
 * recorded Disco Dan. His turn 1 is a pure Setlist (no shop action, 0 Gold), so his real round-1 board is EMPTY at
 * tier 1. Empty boards were never uploaded, so the recording started at wave 2, and the recorded seat served that
 * wave-2 board (tier 2, his Tier 2 pick already played) in round 1. Ruling: "empty boards are never uploaded is a
 * problem. this has to be fixed". This file registers into the module-global pool, so it lives in its own file.
 */

const SET = activeSet().id;
const snap = (author: string, heroId: string, seed: number, wave: number, empty = false): BoardSnapshot => ({
  v: 1, wave, heroId, resolve: 30, tier: wave === 1 ? 1 : Math.min(6, 1 + Math.floor(wave / 2)), triples: 0, tribes: [],
  threat: 'glass', power: empty ? 0 : wave * 10, seed, origin: 'self', author, setId: SET, ownerId: `${author}-id`,
  minions: empty ? [] : [{ cardId: 'pack', attack: wave + 3, health: 3, keywords: [], golden: false }],
} as unknown as BoardSnapshot);

/** A recorded Disco Dan run: waves `from`..8, its wave-1 board EMPTY when present (a recording made since the fix). */
const discoRun = (author: string, seed: number, from: 1 | 2): BoardSnapshot[] =>
  Array.from({ length: 9 - from }, (_, i) => snap(author, 'discodan', seed, from + i, from + i === 1));

const lobbies: ReturnType<typeof createRunLobby>[] = [];
afterEach(() => { OPPONENT_POOL.length = 0; for (const l of lobbies.splice(0)) resetLobbyDrivers(l.seats); });

describe("Disco Dan's turn 1 records an empty wave-1 board", () => {
  it('after the Setlist, ending turn 1 captures wave 1, tier 1, nothing on board', () => {
    let s = createRun(4242, 'discodan', 'lobby');
    for (let i = 0; i < 3 && s.discover; i++) s = reduce(s, { type: 'discover', index: 0 });
    expect(s.discover ?? null).toBeNull();
    s = reduce(s, { type: 'faceOmen' });
    expect(s.lastCombat).toBeTruthy();
    const b = snapshotBoard(s);
    expect(b.wave).toBe(1);
    expect(b.tier).toBe(1);
    expect(b.minions).toEqual([]);
  });
});

describe('round 1 against a recorded Disco Dan is EMPTY at tier 1', () => {
  for (const from of [1, 2] as const) {
    it(from === 1 ? 'a new recording (its empty wave 1 uploaded)' : 'an old recording (starts at wave 2, wave 1 never uploaded)', () => {
      const res = registerOpponentRuns([discoRun('Orangez', 777, from)]);
      expect(res).toEqual({ runs: 1, boards: 9 - from, dropped: 0 }); // the empty board does not refuse the run
      expect(playerRunsFrom(OPPONENT_POOL, undefined, SET).map((r) => r.snaps[0]!.wave)).toEqual([from]);
      const lobby = createRunLobby(9001, 'warden', { snapshotSeats: 1 }, SET);
      lobbies.push(lobby);
      const seat = lobby.seats.find((x) => x.kind === 'snapshot' && x.heroId === 'discodan');
      expect(seat, 'the recorded Disco Dan is seated').toBeTruthy();
      const r1 = driverFor(seat!, SET)!.prepare(1)!;
      expect(r1.minions).toEqual([]);
      expect(r1.tier).toBe(1);
      expect(seatScoutIntel(lobby, seat!)?.tier).toBe(1); // the scout card agrees with the fight
      const r2 = driverFor(seat!, SET)!.prepare(2)!;
      expect(r2.tier).toBe(2); // round 2 is round 2's board, not round 3's
      expect(r2.minions.map((m) => m.attack)).toEqual([5]);
    });
  }
});

describe('readers tolerate an empty board', () => {
  it('a per-wave opponent pick never serves an empty board', () => {
    registerOpponentRuns([discoRun('Orangez', 778, 1)]);
    for (let i = 0; i < 20; i++) {
      const pick = pickOpponent(1, 0, makeRng(i), OPPONENT_POOL, new Set(), 0, SET);
      expect(pick === null || pick.minions.length > 0).toBe(true);
    }
  });

  it('a run with no minions in ANY board is refused', () => {
    const allEmpty = Array.from({ length: 6 }, (_, i) => snap('Ghost', 'discodan', 5, i + 1, true));
    expect(registerOpponentRuns([allEmpty])).toEqual({ runs: 0, boards: 0, dropped: 1 });
  });
});
