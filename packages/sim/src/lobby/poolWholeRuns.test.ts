import { afterEach, describe, expect, it } from 'vitest';
import type { BoardSnapshot } from '../snapshot';
import { OPPONENT_POOL, registerOpponentRuns } from '../opponents';
import { playableHeroes } from '../heroes';
import { makeRng } from '@game/core';
import { MAX_FIRST_WAVE, MAX_MISSING_WAVES, boardAt, recordedSeat } from './seats';
import { MAX_SEATS_PER_PLAYER, runOwnerOf } from './snapshotSeats';
import { createRunLobby, resetLobbyDrivers } from './runLobby';

/**
 * R-LOBBY-08 (2026-09-29), the lobby half: a recorded seat serves its OWN board for the round (never a later one,
 * except the stale final board past the run's end), the pool registers whole runs or nothing, one player holds at
 * most four seats, and your own runs sit at your table like anyone else's, under the same cap (owner 2026-09-30). This file registers into the module-global pool, so it
 * lives in its own file.
 */

const HEROES = playableHeroes().map((h) => h.id);
const snap = (author: string, heroId: string, seed: number, wave: number, ownerId?: string, cardId = 'pack'): BoardSnapshot => ({
  v: 1, wave, heroId, resolve: 30, tier: Math.min(6, 1 + Math.floor(wave / 3)), triples: 0, tribes: [], threat: 'glass',
  power: wave * 10, seed, origin: 'self', author, setId: 'set1', ...(ownerId ? { ownerId } : {}),
  minions: [{ cardId, attack: wave, health: wave, keywords: [], golden: false }],
} as unknown as BoardSnapshot);
const run = (author: string, heroId: string, seed: number, last: number, ownerId?: string): BoardSnapshot[] =>
  Array.from({ length: last }, (_, i) => snap(author, heroId, seed, i + 1, ownerId));

afterEach(() => { OPPONENT_POOL.length = 0; });

describe('the round-exact rule', () => {
  it('serves the exact wave, a single missing wave from one earlier, and wave 2 on round 1', () => {
    const snaps = [2, 3, 5, 6].map((w) => snap('A', 'x', 1, w));
    expect(boardAt(snaps, 3)!.wave).toBe(3);
    expect(boardAt(snaps, 4)!.wave).toBe(3); // wave 4 was empty (not uploaded)
    expect(boardAt(snaps, 1)!.wave).toBe(2); // the wave-1 board was empty
    expect(MAX_FIRST_WAVE - 1).toBe(1);
    expect(MAX_MISSING_WAVES).toBe(1);
  });

  it('never serves a board from further ahead than the one tolerated wave, over random recordings', () => {
    const rng = makeRng(5);
    for (let t = 0; t < 500; t++) {
      const waves = Array.from({ length: 17 }, (_, i) => i + 1).filter(() => rng.next() < 0.6);
      if (!waves.length) continue;
      const snaps = waves.map((w) => snap('A', 'x', t, w));
      const seat = recordedSeat('A', snaps);
      for (let round = 1; round <= 20; round++) {
        const b = seat.prepare(round);
        if (round > seat.lastWave) { expect(b).toBeNull(); continue; } // past the end: the lobby's repeatFinal
        expect(b, `round ${round}`).not.toBeNull();
        const w = b!.snapshot?.wave;
        if (w === undefined) { expect(b!.minions.length).toBe(0); expect(waves[0]! - round).toBeGreaterThan(MAX_FIRST_WAVE - 1); continue; }
        if (w > round) expect(w - round, `round ${round} served wave ${w} of [${waves.join(',')}]`).toBeLessThanOrEqual(MAX_FIRST_WAVE - 1);
        if (w > round) expect(round < waves[0]!).toBe(true); // "ahead" only before the recording begins
      }
    }
  });

  it('a recording that starts late serves an EMPTY board early, never its later (final) board', () => {
    const seat = recordedSeat('Late', [10, 11, 12].map((w) => snap('Late', 'x', 1, w)));
    const b = seat.prepare(5);
    expect(b).not.toBeNull(); // null would make the lobby serve the FINAL board in round 5
    expect(b!.minions.length).toBe(0);
  });
});

describe('registration is by whole run', () => {
  it('a run with one unservable board is refused whole; a clean run is kept, one board per wave', () => {
    const bad = run('Bad', HEROES[0]!, 1, 6);
    bad[2] = snap('Bad', HEROES[0]!, 1, 3, undefined, 'no_such_card_anymore');
    const good = [...run('Good', HEROES[1]!, 2, 6), snap('Good', HEROES[1]!, 2, 4)]; // a duplicate wave-4 board
    const res = registerOpponentRuns([bad, good]);
    expect(res).toEqual({ runs: 1, boards: 6, dropped: 1 });
    expect(OPPONENT_POOL.some((s) => s.author === 'Bad')).toBe(false);
    expect(OPPONENT_POOL.filter((s) => s.author === 'Good').map((s) => s.wave)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(registerOpponentRuns([good]).boards).toBe(6); // idempotent: the pool does not grow
    expect(OPPONENT_POOL.length).toBe(6);
  });
});

describe('seat selection: at most four seats per player, your own runs included', () => {
  it(`no player ever holds more than ${MAX_SEATS_PER_PLAYER} seats, over many seeded lobbies`, () => {
    // One prolific player with a run on every hero, two small ones.
    const runs = [
      ...HEROES.slice(0, 14).map((h, i) => run('Prolific', h, 100 + i, 8, 'u-prolific')),
      ...HEROES.slice(0, 3).map((h, i) => run('Small', h, 200 + i, 8, 'u-small')),
      ...HEROES.slice(3, 6).map((h, i) => run('Tiny', h, 300 + i, 8, 'u-tiny')),
    ];
    registerOpponentRuns(runs);
    let capped = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const lobby = createRunLobby(seed, HEROES[HEROES.length - 1]!, {}, 'set1');
      const byOwner = new Map<string, number>();
      for (const s of lobby.seats.filter((x) => x.kind === 'snapshot')) {
        const owner = s.runKey!.split('|')[0]!;
        byOwner.set(owner, (byOwner.get(owner) ?? 0) + 1);
      }
      expect(Math.max(0, ...byOwner.values()), `seed ${seed}`).toBeLessThanOrEqual(MAX_SEATS_PER_PLAYER);
      if (byOwner.get('Prolific') === MAX_SEATS_PER_PLAYER) capped++;
      resetLobbyDrivers(lobby.seats);
    }
    expect(capped).toBeGreaterThan(100); // the cap is what binds for the prolific player
  });

  it('runs of players under the cap stay equally likely (the cap does not weight the draw)', () => {
    // 3 runs per hero on 12 heroes, one run per player: symmetric, so every run should sit equally often.
    const runs = HEROES.slice(0, 12).flatMap((h, i) => [0, 1, 2].map((k) => run(`Solo${i}_${k}`, h, 1000 + i * 3 + k, 8, `u-${i}-${k}`)));
    registerOpponentRuns(runs);
    const freq = new Map<string, number>();
    const LOBBIES = 360;
    for (let seed = 1; seed <= LOBBIES; seed++) {
      const lobby = createRunLobby(seed, HEROES[HEROES.length - 1]!, {}, 'set1');
      for (const s of lobby.seats.filter((x) => x.kind === 'snapshot')) freq.set(s.runKey!, (freq.get(s.runKey!) ?? 0) + 1);
      resetLobbyDrivers(lobby.seats);
    }
    const expected = (LOBBIES * 7) / runs.length; // 70
    expect(freq.size).toBe(runs.length);
    for (const [k, n] of freq) { expect(n, k).toBeGreaterThan(expected * 0.6); expect(n, k).toBeLessThan(expected * 1.4); }
  });

  it('a pool of ONE player fills four seats and generates the rest, never breaking accuracy', () => {
    registerOpponentRuns(HEROES.slice(0, 10).map((h, i) => run('Only', h, 500 + i, 8, 'u-only')));
    const lobby = createRunLobby(3, HEROES[HEROES.length - 1]!, {}, 'set1');
    expect(lobby.seats.filter((s) => s.kind === 'snapshot').length).toBe(MAX_SEATS_PER_PLAYER);
    expect(lobby.seats.length).toBe(8);
    resetLobbyDrivers(lobby.seats);
  });

  it('your own runs sit at your table too, at most four of them (owner 2026-09-30)', () => {
    // Owner: "this is a problem - you should face your own boards too. you should also be able to occupy up to 4 of your own snapshots. please fix this"
    registerOpponentRuns([
      ...HEROES.slice(0, 8).map((h, i) => run('Me', h, 600 + i, 8, 'u-me')),
      ...HEROES.slice(8, 16).map((h, i) => run(`Friend${i}`, h, 700 + i, 8, `u-f${i}`)),
    ]);
    let seenMine = 0; let seenFour = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const lobby = createRunLobby(seed, HEROES[HEROES.length - 1]!, {}, 'set1');
      const mine = lobby.seats.filter((s) => s.runKey?.startsWith('Me|')).length;
      expect(mine, `seed ${seed}`).toBeLessThanOrEqual(MAX_SEATS_PER_PLAYER);
      if (mine > 0) seenMine++;
      if (mine === MAX_SEATS_PER_PLAYER) seenFour++;
      resetLobbyDrivers(lobby.seats);
    }
    expect(seenMine).toBeGreaterThan(50); // 8 of 16 runs are yours: you almost always meet some
    expect(seenFour).toBeGreaterThan(0);  // and the cap, not an exclusion, is what stops you
  });

  it('a pool of ONLY your own runs fills four seats and generates the rest', () => {
    registerOpponentRuns(HEROES.slice(0, 10).map((h, i) => run('Me', h, 800 + i, 8, 'u-me')));
    const lobby = createRunLobby(4, HEROES[HEROES.length - 1]!, {}, 'set1');
    expect(lobby.seats.filter((s) => s.runKey?.startsWith('Me|')).length).toBe(MAX_SEATS_PER_PLAYER);
    expect(lobby.seats.length).toBe(8);
    expect(lobby.unrated).toBeUndefined(); // your own runs are real runs: the lobby is rated
    resetLobbyDrivers(lobby.seats);
  });

  it('a run is owned by its account when stamped, else by its display name', () => {
    expect(runOwnerOf({ ownerId: 'abc', author: 'X' })).toBe('id:abc');
    expect(runOwnerOf({ author: 'Kevin' })).toBe('name:kevin');
    expect(runOwnerOf({ author: 'anon' })).toBeNull();
  });
});
