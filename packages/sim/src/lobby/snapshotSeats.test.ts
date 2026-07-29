import { describe, it, expect, beforeAll } from 'vitest';
import type { BoardSnapshot } from '../snapshot';
import { registerOpponents } from '../opponents';
import { createRunLobby, driverFor, resetLobbyDrivers } from './runLobby';
import { playerRunByKey, playerRunsFrom, snapshotSeat } from './snapshotSeats';

/**
 * REAL PLAYER RUNS AS LOBBY SEATS.
 *
 * This file registers boards into the module-global opponent pool, which changes matchmaking for anything else
 * running in the same process — so it lives apart from `runLobby.test.ts` rather than mutating the pool under
 * those tests.
 */

const board = (author: string, heroId: string, seed: number, wave: number, atk: number): BoardSnapshot => ({
  v: 1, wave, heroId, resolve: 30, tier: Math.min(6, 1 + Math.floor(wave / 3)), triples: 0,
  tribes: ['beast', 'undead', 'mech', 'dragon', 'demon'], threat: 'glass', power: atk * 2,
  minions: [{ cardId: 'pack', attack: atk, health: atk, keywords: [], golden: false }],
  seed, origin: 'self', author, setId: 'set1',
} as BoardSnapshot);

/** Two full runs plus one too short to earn a seat. */
const RUN_A = Array.from({ length: 10 }, (_, i) => board('Ada', 'drakko', 111, i + 1, 2 + i));
const RUN_B = Array.from({ length: 8 }, (_, i) => board('Baz', 'soren', 222, i + 1, 3 + i));
const RUN_TINY = Array.from({ length: 2 }, (_, i) => board('Tiny', 'cassen', 333, i + 1, 4));

beforeAll(() => { registerOpponents([...RUN_A, ...RUN_B, ...RUN_TINY]); });

describe('grouping the pool back into runs', () => {
  it('reassembles per-wave boards into the runs they came from', () => {
    const runs = playerRunsFrom();
    const ada = runs.find((r) => r.author === 'Ada');
    expect(ada, 'Ada’s run was not reassembled').toBeDefined();
    expect(ada!.snaps).toHaveLength(10);
    expect(ada!.snaps.map((s) => s.wave), 'boards must be in wave order').toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('skips runs with too little material to hold a seat', () => {
    expect(playerRunsFrom().some((r) => r.author === 'Tiny')).toBe(false);
  });

  it('excludes synthetic boards — they were never one player’s run', () => {
    // Stringing per-wave synthetic boards together would fake a build order that never existed.
    registerOpponents([{ ...board('x', 'drakko', 999, 1, 5), origin: 'synthetic', author: undefined } as BoardSnapshot]);
    expect(playerRunsFrom().some((r) => r.key.includes('999'))).toBe(false);
  });

  it('is deterministically ordered, so seating reproduces across sessions', () => {
    expect(playerRunsFrom().map((r) => r.key)).toEqual(playerRunsFrom().map((r) => r.key));
  });
});

describe('a snapshot seat replays that player’s actual boards', () => {
  it('fields the recorded board for the round, in the run’s own order', () => {
    const run = playerRunByKey(playerRunsFrom().find((r) => r.author === 'Ada')!.key)!;
    const seat = snapshotSeat(run);
    expect(seat.label).toBe('Ada');
    // RUN_A's wave-N board has attack 2+(N-1) — so the seat must field a DIFFERENT board each round, not one
    // frozen board, which is the whole point of replaying a run rather than a single snapshot.
    expect(seat.prepare(1)!.minions[0]!.attack).toBe(2);
    expect(seat.prepare(5)!.minions[0]!.attack).toBe(6);
    expect(seat.prepare(10)!.minions[0]!.attack).toBe(11);
  });

  it('hands over to a live bot once the recording runs dry', () => {
    // A recording is finite and a lobby has no fixed length. Past the last recorded wave the seat must still
    // field something — freezing or vacating both distort the game.
    const run = playerRunByKey(playerRunsFrom().find((r) => r.author === 'Ada')!.key)!;
    const seat = snapshotSeat(run);
    expect(seat.lastRecordedWave).toBe(10);
    expect(seat.prepare(12), 'the seat vanished when the recording ended').not.toBeNull();
  });
});

describe('seating real runs into a lobby', () => {
  it('fills seats from the pool, never the same run twice', () => {
    const lobby = createRunLobby(7, 'drakko');
    const snaps = lobby.seats.filter((s) => s.kind === 'snapshot');
    expect(snaps.length, 'no real player run was seated').toBeGreaterThan(0);
    expect(new Set(snaps.map((s) => s.runKey)).size, 'a run held two seats').toBe(snaps.length);
    expect(lobby.seats).toHaveLength(8); // the rest are still generated — the table stays full
  });

  it('keeps recordings a MINORITY of the table', () => {
    // Recordings cannot react to the lobby, so a table made mostly of them stops being a game between
    // opponents. The cap is a design rule, not an accident of how many runs happen to be in the pool.
    const lobby = createRunLobby(7, 'drakko');
    expect(lobby.seats.filter((s) => s.kind === 'snapshot').length).toBeLessThanOrEqual(3);
  });

  it('seats the same runs for the same seed', () => {
    const keyOf = (seed: number): string =>
      createRunLobby(seed, 'drakko').seats.map((s) => `${s.kind}:${s.runKey ?? s.heroId}`).join(',');
    expect(keyOf(7)).toBe(keyOf(7));
  });

  it('falls back to a bot when the run is missing from THIS session’s pool', () => {
    // A saved lobby can be restored on another device, after a patch prune, or with the backend offline. The
    // seat must still drive — silently dropping it would change the shape of someone's saved game.
    const seat = {
      id: 's1', label: 'Ghost', heroId: 'drakko', kind: 'snapshot' as const,
      runKey: 'nobody|drakko|424242', seed: 5, resolve: 30, armor: 15, alive: true,
    };
    resetLobbyDrivers([seat]);
    const d = driverFor(seat);
    expect(d, 'an unresolvable run left the seat with no driver').not.toBeNull();
    expect(d!.prepare(1) ?? d!.finalBoard?.(), 'the fallback fielded no board').toBeTruthy();
  });
});
