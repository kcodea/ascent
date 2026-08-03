import { describe, it, expect, beforeAll } from 'vitest';
import type { BoardSnapshot } from '../snapshot';
import { registerOpponents } from '../opponents';
import { createRunLobby } from './runLobby';
import { playerRunsFrom } from './snapshotSeats';

/**
 * SEAT ROTATION MUST REACH EVERY RUN IN THE POOL.
 *
 * The seat filler walks the available runs as `available[(seed + i * 7) % available.length]`. That is only a
 * PERMUTATION when the stride is coprime with the pool size — and 7 is not coprime with any multiple of 7. So
 * a pool of exactly 7 runs collapsed to ONE reachable run (and 14 → 2, 21 → 3, …), which is why a table could
 * suddenly seat no player snapshots at all after several lobbies that seated plenty: the pool grows by a run
 * per finished upload, and the moment its size hit a multiple of 7 the rotation folded (owner report
 * 2026-08-03 — "I just played 3 or 4 games with multiple player snapshots, this lobby randomly has none").
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
