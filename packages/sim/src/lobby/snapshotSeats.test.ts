import { describe, it, expect, beforeAll } from 'vitest';
import type { BoardSnapshot } from '../snapshot';
import { registerOpponents } from '../opponents';
import { reduce } from '../reducer';
import { replayRun } from '../snapshot';
import { DEFAULT_BOT } from '../bots/index';
import type { Action, RunState } from '../state';
import { createLobbyRun, createRunLobby, driverFor, resetLobbyDrivers } from './runLobby';
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

  it('is recording-ONLY: a dried-out seat yields to the exhaustion policy, never a live bot (owner 2026-07-31)', () => {
    // This used to pin the opposite — a live bot inheriting the seat past the recording. The live half was the
    // same perf hazard the generated hybrid seat had (a beam-search bot advanced on the main thread every End
    // Combat), and the pure-snapshot direction retires it: past the recording the seat returns null and the
    // lobby's `repeatFinal` exhaustion policy decides what that means.
    const run = playerRunByKey(playerRunsFrom().find((r) => r.author === 'Ada')!.key)!;
    const seat = snapshotSeat(run);
    expect(seat.lastRecordedWave).toBe(10);
    expect(seat.prepare(12), 'a live bot took over a dry snapshot seat').toBeNull();
    expect(seat.finalBoard?.(), 'repeatFinal needs the final recorded board').not.toBeNull();
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

  it('player runs fill EVERY seat they can cover — bots only take the remainder (owner 2026-07-31)', () => {
    // The 2026-07-29 "minority on purpose" cap of 3 is retired: the table is now MEANT to be other players'
    // runs. With 2 eligible runs in the pool, both are seated and bots fill the other 5 non-player seats.
    const lobby = createRunLobby(7, 'drakko');
    const snaps = lobby.seats.filter((s) => s.kind === 'snapshot').length;
    expect(snaps, 'an eligible player run was left unseated').toBe(playerRunsFrom().length);
    expect(lobby.seats).toHaveLength(8); // bots still complete the table
  });

  it('an explicit rules.snapshotSeats still pins a smaller mix', () => {
    const lobby = createRunLobby(7, 'drakko', { snapshotSeats: 1 });
    expect(lobby.seats.filter((s) => s.kind === 'snapshot').length).toBe(1);
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

describe('a lobby run replays faithfully — so it can save its snapshots', () => {
  it('needs its mode: replayed as an Ascent run it diverges into a different run entirely', () => {
    /**
     * `replayRun` built its start state with `createRun(seed, heroId)` and `Replay` carried no mode, so a lobby
     * run was replayed as an ASCENT run. It diverges from the first combat (different opponents, different
     * damage), so the boards captured at run end were from a run nobody ever played — the bug behind "lobby runs
     * don't save snapshots" (owner 2026-07-29). `createRun(…, 'lobby')` alone is not enough either: the seats are
     * attached by `createLobbyRun`.
     */
    const actions: Action[] = [];
    let s: RunState = createLobbyRun(21, 'drakko');
    let guard = 0;
    while (s.phase !== 'gameover' && s.phase !== 'victory' && guard++ < 6000) {
      const a = DEFAULT_BOT.act(s);
      const n = reduce(s, a);
      if (n === s) break;
      actions.push(a);
      s = n;
    }
    expect(s.history.length, 'the lobby run never got going').toBeGreaterThan(3);

    const sig = (r: RunState): string =>
      `${r.history.length}|${r.history.filter((x) => x === 'win').length}|${r.board.map((c) => `${c.cardId}:${c.attack}/${c.health}`).join(',')}`;

    const asLobby = replayRun({ seed: 21, heroId: 'drakko', mode: 'lobby', actions }, createLobbyRun(21, 'drakko'));
    expect(sig(asLobby.final), 'the lobby replay did not reproduce the run').toBe(sig(s));
    expect(asLobby.snapshots.length, 'no boards were captured').toBeGreaterThan(3);

    const asAscent = replayRun({ seed: 21, heroId: 'drakko', actions });
    expect(sig(asAscent.final), 'replaying without the mode should NOT reproduce the run').not.toBe(sig(s));
  }, 60_000);
});

describe('a player may hold several seats through DIFFERENT runs (owner call 2026-07-31)', () => {
  it('seats both of an author\'s runs, under distinct numbered labels', () => {
    // The 2026-07-29 one-seat-per-author rule is removed (for now) so two people can fill whole lobbies with
    // each other's runs while the set-2 pool is young. The surviving rules: the exact same RUN never sits
    // twice, and duplicate names are numbered so two seats never render identically.
    registerOpponents([
      ...Array.from({ length: 8 }, (_, i) => board('Dup', 'drakko', 4444, i + 1, 3 + i)),
      ...Array.from({ length: 8 }, (_, i) => board('Dup', 'soren', 5555, i + 1, 4 + i)),
    ]);
    expect(playerRunsFrom().filter((r) => r.author === 'Dup').length, 'both runs should exist in the pool').toBe(2);
    for (const seed of [1, 3, 7]) {
      const snaps = createRunLobby(seed, 'drakko').seats.filter((s) => s.kind === 'snapshot');
      const dupSeats = snaps.filter((s) => s.runKey?.startsWith('dup|') || s.label.toLowerCase().startsWith('dup'));
      expect(dupSeats.length, `seed ${seed}: both of Dup's runs should hold seats`).toBe(2);
      expect(new Set(snaps.map((s) => s.runKey)).size, `seed ${seed}: a RUN held two seats`).toBe(snaps.length);
      expect(new Set(snaps.map((s) => s.label)).size, `seed ${seed}: two seats share a label`).toBe(snaps.length);
    }
  });
});

describe("set separation — a lobby never seats another set's boards", () => {
  /**
   * The gap this closes: Ascent matchmaking has always filtered snapshots by set (`nextOpponent`), but the
   * LOBBY path called `playerRunsFrom()` with no set at all. Flipping the live set to 2 would therefore have
   * seated set-1 recordings against a set-2 board — and it would have WORKED, fielding set-1 minions, so the
   * only symptom is cards appearing that the run could never otherwise see.
   */
  const set2Board = (author: string, wave: number): BoardSnapshot =>
    ({ ...board(author, 'drakko', 4242, wave, 3), setId: 'set2' } as BoardSnapshot);
  const SET2_RUN = [1, 2, 3, 4, 5, 6].map((w) => set2Board('set2player', w));

  beforeAll(() => { registerOpponents([...SET2_RUN]); });

  it('filters runs to the asking set', () => {
    const all = playerRunsFrom();
    const only1 = playerRunsFrom(undefined, undefined, 'set1');
    const only2 = playerRunsFrom(undefined, undefined, 'set2');
    expect(all.length, 'the unfiltered view should still see everything').toBeGreaterThan(only1.length);
    expect(only2.length, 'the set-2 run is missing').toBeGreaterThan(0);
    expect(only2.every((r) => r.author === 'set2player'), 'a set-1 run leaked into the set-2 view').toBe(true);
    expect(only1.some((r) => r.author === 'set2player'), 'the set-2 run leaked into set 1').toBe(false);
  });

  it('a set-2 lobby seats no set-1 run', () => {
    const lobby = createRunLobby(7, 'drakko', { snapshotSeats: 4 }, 'set2');
    const seated = lobby.seats.filter((x) => x.kind === 'snapshot').map((x) => x.runKey);
    // Whatever it seats must be resolvable within set 2 — a set-1 key would resolve to null here.
    for (const key of seated) {
      expect(playerRunByKey(key!, undefined, 'set2'), `seat ${key} is not a set-2 run`).not.toBeNull();
    }
  });

  it('the lobby records its set, so a RESTORE resolves against the same one', () => {
    // The seat only stores a runKey (`author|hero|seed`), which says nothing about the set — without this the
    // restore path would fall back to the unfiltered pool.
    expect(createRunLobby(7, 'drakko', {}, 'set2').setId).toBe('set2');
  });

  it('an unfiltered call still sees everything — the tools and pre-set tests depend on it', () => {
    expect(playerRunsFrom().some((r) => r.author === 'set2player')).toBe(true);
  });
});
