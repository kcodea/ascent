import { describe, it, expect, beforeAll } from 'vitest';
import type { BoardSnapshot } from '../snapshot';
import { registerOpponents } from '../opponents';
import { createRunLobby } from './runLobby';
import { playerRunsFrom } from './snapshotSeats';

/**
 * SEAT FILL IS A SEEDED SHUFFLE — every eligible run reachable, uniformly, at every pool size.
 *
 * History: the filler used to walk `available[(seed + i * 7) % n]`, a stride that is only a permutation when 7
 * is coprime with n, so a pool of exactly 7 runs collapsed to ONE reachable run (14 → 2, …) and a lobby would
 * "randomly have no player snapshots" (owner report 2026-08-03, #838). The 2026-09-13 rewrite draws the table
 * with a seeded Fisher–Yates instead (owner: "completely random"), which has no collapse at any size. The
 * multiple-of-7 cases below are kept as the historical regression; the last block pins the new properties:
 * same seed → same table (restore/replay), different seeds → different tables, and every run reachable.
 *
 * This file registers boards into the module-global pool, so like `snapshotSeats.test.ts` it lives apart from
 * the other lobby tests rather than mutating the pool under them.
 */

const board = (author: string, heroId: string, seed: number, wave: number): BoardSnapshot => ({
  v: 1, wave, heroId, resolve: 30, tier: Math.min(6, 1 + Math.floor(wave / 3)), triples: 0,
  tribes: ['beast', 'undead', 'mech', 'dragon', 'demon'], threat: 'glass', power: 10,
  minions: [{ cardId: 'pack', attack: 3, health: 3, keywords: [], golden: false }],
  seed, origin: 'self', author, setId: 'set1',
} as BoardSnapshot);

/** A distinct 8-wave run per author — enough waves to clear MIN_WAVES and field a round-1 board. */
const run = (author: string, heroId: string, seed: number): BoardSnapshot[] =>
  Array.from({ length: 8 }, (_, i) => board(author, heroId, seed, i + 1));

// EXACTLY SEVEN runs — the pool size that collapses a stride-7 rotation to a single reachable entry.
const HEROES7 = ['drakko', 'soren', 'cassen', 'myra', 'coran', 'nadja', 'tiff'];
beforeAll(() => {
  registerOpponents(HEROES7.flatMap((h, i) => run(`Seven${i}`, h, 9000 + i)));
});

describe('a pool whose size is a multiple of 7 still fills the table', () => {
  it('the pool really does hold at least 7 seatable runs', () => {
    expect(playerRunsFrom(undefined, undefined, 'set1').length).toBeGreaterThanOrEqual(7);
  });

  it('seats real player runs rather than collapsing onto one (or none)', () => {
    // Several seeds: the collapse is arithmetic, not seed-specific, so EVERY seed must fill.
    for (const seed of [1, 2, 3, 7, 14, 12345, 99991]) {
      const lobby = createRunLobby(seed, 'warden', {}, 'set1');
      const snaps = lobby.seats.filter((s) => s.kind === 'snapshot');
      expect(snaps.length, `seed ${seed} seated ${snaps.length} player runs`).toBeGreaterThan(1);
      // …and they must be DISTINCT runs — the same run may never sit twice.
      const keys = snaps.map((s) => s.runKey);
      expect(new Set(keys).size, `seed ${seed} seated a duplicate run`).toBe(keys.length);
    }
  });

  it('fills every non-player seat with a real run when the pool can cover the table', () => {
    // 7 opponent seats, ≥7 runs available → the owner's rule ("player boards > synthetic ALWAYS up to 7
    // slots") means a full table of snapshots.
    const lobby = createRunLobby(4242, 'warden', {}, 'set1');
    expect(lobby.seats.filter((s) => s.kind === 'snapshot').length).toBe(7);
  });
});

describe('the seeded shuffle', () => {
  it('is deterministic per seed (a restored / replayed lobby seats the identical table)', () => {
    const a = createRunLobby(777, 'warden', {}, 'set1').seats.map((s) => s.runKey ?? s.heroId);
    const b = createRunLobby(777, 'warden', {}, 'set1').seats.map((s) => s.runKey ?? s.heroId);
    expect(a).toEqual(b);
  });

  it('varies with the seed — nearby seeds no longer see near-identical tables', () => {
    const tables = [1, 2, 3, 4, 5, 6].map((seed) => createRunLobby(seed, 'warden', {}, 'set1').seats.filter((s) => s.kind === 'snapshot').map((s) => s.runKey).join('|'));
    expect(new Set(tables).size, 'six consecutive seeds should not all produce the same seat order').toBeGreaterThan(1);
  });

  it('reaches every run in the pool across seeds (no run is structurally unreachable)', () => {
    const all = new Set(playerRunsFrom(undefined, undefined, 'set1').map((r) => r.key));
    const seen = new Set<string>();
    for (let seed = 1; seed <= 60 && seen.size < all.size; seed++) {
      for (const s of createRunLobby(seed, 'warden', {}, 'set1').seats) if (s.runKey) seen.add(s.runKey);
    }
    expect([...all].filter((k) => !seen.has(k))).toEqual([]);
  });
});

describe('unique heroes per lobby (owner 2026-09-13)', () => {
  it('all eight seats wear different heroes, the player included, across seeds', () => {
    for (const seed of [1, 2, 3, 7, 14, 4242, 99991]) {
      const lobby = createRunLobby(seed, 'drakko', {}, 'set1'); // 'drakko' is also a seated run's hero above
      const heroes = lobby.seats.map((s) => s.heroId);
      expect(new Set(heroes).size, `seed ${seed}: ${heroes.join(',')}`).toBe(heroes.length);
      expect(heroes[0]).toBe('drakko');
    }
  });

  it('a second player run on an already-seated hero is passed over, not seated', () => {
    // The pool holds one run per hero (HEROES7); seat the player on one of them and every OTHER hero's run
    // still fills a seat, while the duplicated hero's run is skipped in favour of a hybrid on a fresh hero.
    const lobby = createRunLobby(4242, 'soren', {}, 'set1');
    const snapHeroes = lobby.seats.filter((s) => s.kind === 'snapshot').map((s) => s.heroId);
    expect(snapHeroes).not.toContain('soren');
    expect(new Set(lobby.seats.map((s) => s.heroId)).size).toBe(lobby.seats.length);
  });
});
