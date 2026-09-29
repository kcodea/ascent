import { afterEach, describe, expect, it } from 'vitest';
import { activeSet } from '@game/content';
import type { BoardSnapshot } from '../snapshot';
import { OPPONENT_POOL, registerOpponents } from '../opponents';
import { playableHeroes } from '../heroes';
import { createLobbyRun, lobbyPoolTelemetryOf, lobbyPoolStatsOf } from './runLobby';

/**
 * HEADLESS REPRO of the all-bot rated lobby (owner report 2026-09-28, lobby seed 309102059). With no pool
 * registered, the lobby seats seven generated hybrids; once the player pool is present, the same seed seats
 * real runs. The client-side fix (`packages/ui/src/opponentPool/`) makes sure the pool IS present before a
 * rated lobby is built; this pins the sim half: the pool alone decides it, deterministically, and the new
 * telemetry reads it correctly.
 *
 * This file registers boards into the module-global pool, so it lives apart and empties the pool after each
 * test.
 */
const SET = activeSet().id;
const SEED = 309102059;
const PLAYER_HERO = playableHeroes()[0]!.id;

const board = (author: string, heroId: string, seed: number, wave: number): BoardSnapshot => ({
  v: 1, wave, heroId, resolve: 30, tier: 1, triples: 0, tribes: [], threat: 'glass', power: 10,
  minions: [{ cardId: 'pack', attack: 3, health: 3, keywords: [], golden: false }],
  seed, origin: 'self', author, setId: SET,
} as unknown as BoardSnapshot);

const playerPool = (): BoardSnapshot[] =>
  playableHeroes().slice(1, 11).flatMap((h, i) => Array.from({ length: 8 }, (_, w) => board(`Real${i}`, h.id, 4100 + i, w + 1)));

afterEach(() => { OPPONENT_POOL.length = 0; });

describe('seed 309102059: the pool decides recorded vs generated seats', () => {
  it('with NO pool registered, every opponent seat is generated (the reported lobby)', () => {
    const run = createLobbyRun(SEED, PLAYER_HERO, {}, 'lobby');
    const t = lobbyPoolTelemetryOf(run.lobby!);
    expect(t.seats).toEqual({ recorded: 0, hybrid: 7, bot: 0, authored: 0 });
    expect(t.allGenerated).toBe(true);
    expect(t.poolBoards).toBe(0);
    expect(t.poolRuns).toBe(0);
  });

  it('with the pool present, the same seed seats seven real runs', () => {
    registerOpponents(playerPool());
    const run = createLobbyRun(SEED, PLAYER_HERO, {}, 'lobby');
    const t = lobbyPoolTelemetryOf(run.lobby!);
    expect(t.seats.recorded).toBe(7);
    expect(t.allGenerated).toBe(false);
    expect(t.poolBoards).toBe(80);
    expect(t.poolRuns).toBe(10);
    expect(t.poolBoardsByWave).toEqual(Array.from({ length: 8 }, () => 10));
    expect(t.poolSource).toBeNull(); // stamped by the client, never by the sim
  });

  it('determinism is unchanged: the same seed and pool seat the identical table', () => {
    registerOpponents(playerPool());
    const a = createLobbyRun(SEED, PLAYER_HERO, {}, 'lobby').lobby!;
    const b = createLobbyRun(SEED, PLAYER_HERO, {}, 'lobby').lobby!;
    expect(b.seats).toEqual(a.seats);
    expect(b.poolAtStart).toEqual(a.poolAtStart);
  });

  it('pool stats ignore synthetic boards and other sets', () => {
    const other = SET === 'set1' ? 'set2' : 'set1';
    const pool = [
      board('A', 'x', 1, 1),
      { ...board('B', 'x', 2, 1), origin: 'synthetic' } as BoardSnapshot,
      { ...board('C', 'x', 3, 2), setId: other } as BoardSnapshot,
    ];
    expect(lobbyPoolStatsOf(pool, SET)).toEqual({ boards: 1, runs: 0, boardsByWave: [1] });
  });
});
