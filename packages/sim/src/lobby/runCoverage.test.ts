import { describe, it, expect, beforeAll } from 'vitest';
import type { BoardSnapshot } from '../snapshot';
import { registerOpponents } from '../opponents';
import { autoplayRun } from '../snapshot';
import { createRunLobby, driverFor, resetLobbyDrivers } from './runLobby';
import { MAX_FIRST_WAVE, maxPlausibleTier, playerRunsFrom, runCoversItsRounds, runTiersPlausible } from './snapshotSeats';

/**
 * R-LOBBY-07: a recorded seat never serves a board from later in its run than the round being played.
 *
 * The bug (owner report 2026-09-29): the client pulls the shared pool per wave (newest N boards of each wave).
 * Early waves hold many more rows than late ones, so an OLDER run kept only its waves 10 to 17. Reassembled, it
 * still looked like a run (8 waves, above the 4-wave minimum), and on round 5 its seat fell through to "the
 * earliest board it has": its wave-10 board, tier 6, seven Beasts. This file registers into the module-global
 * pool, so it lives in its own file (as `snapshotSeats.test.ts` does).
 */

const board = (author: string, heroId: string, seed: number, wave: number, tier = Math.min(6, 1 + Math.floor(wave / 3))): BoardSnapshot => ({
  v: 1, wave, heroId, resolve: 30, tier, triples: 0,
  tribes: ['beast', 'undead', 'mech', 'dragon', 'demon'], threat: 'glass', power: wave * 10,
  minions: [{ cardId: 'pack', attack: wave, health: wave, keywords: [], golden: false }],
  seed, origin: 'self', author, setId: 'set1',
} as BoardSnapshot);

const waves = (author: string, heroId: string, seed: number, ws: number[]): BoardSnapshot[] => ws.map((w) => board(author, heroId, seed, w));
const range = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** The live case: a run whose waves 2 to 9 were cut off by the per-wave pull (Orangez|soren|1129878061). */
const TRUNCATED = waves('Orangez', 'soren', 1129878061, range(10, 17));
/** A run with a hole in the middle (waves 4 to 8 cut): rounds 4 to 8 would serve its wave-3 board. */
const HOLED = waves('Hole', 'drakko', 2, [1, 2, 3, 9, 10, 11, 12]);
/** A complete run with one missing wave (an empty board is not uploaded): kept. */
const ONE_GAP = waves('Gap', 'cassen', 3, [1, 2, 4, 5, 6, 7, 8]);
/** A complete run that starts at wave 2 (wave 1 board empty): kept. */
const FROM_TWO = waves('Two', 'vale', 4, range(2, 9));
/** A tier-6 board filed under wave 2: no real game builds that. */
const CHEATED = [...waves('Cheat', 'robin', 5, [1, 3, 4, 5]), board('Cheat', 'robin', 5, 2, 6)];

describe('a run is seated only when its recording covers the rounds it will be asked for', () => {
  it('drops a run whose early waves are missing (the live bug)', () => {
    expect(runCoversItsRounds(TRUNCATED)).toBe(false);
    expect(playerRunsFrom(TRUNCATED).length).toBe(0);
  });

  it('drops a run with a multi-wave hole', () => {
    expect(runCoversItsRounds(HOLED)).toBe(false);
  });

  it('keeps a complete run with a single missing wave, and one that starts at wave 2', () => {
    expect(runCoversItsRounds(ONE_GAP)).toBe(true);
    expect(runCoversItsRounds(FROM_TWO)).toBe(true);
    expect(MAX_FIRST_WAVE).toBe(2);
    expect(playerRunsFrom([...ONE_GAP, ...FROM_TWO]).map((r) => r.author).sort()).toEqual(['Gap', 'Two']);
  });
});

describe('the plausible-tier bound is generous', () => {
  it('follows the all-in tavern-up curve plus slack', () => {
    // greedy 1,2,2,3,4,4,5,6 → +2
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(maxPlausibleTier)).toEqual([3, 4, 4, 5, 6, 6, 7, 8, 8]);
  });

  it('rejects a board no real game could have built by its wave, and never a normal one', () => {
    expect(runTiersPlausible(CHEATED)).toBe(false);
    expect(playerRunsFrom(CHEATED).length).toBe(0);
    for (const w of range(1, 17)) expect(maxPlausibleTier(w)).toBeGreaterThanOrEqual(Math.min(6, 1 + Math.floor(w / 3)));
  });
});

describe('end to end: no seat serves a board from ahead of the round', () => {
  beforeAll(() => { registerOpponents([...TRUNCATED, ...HOLED, ...ONE_GAP, ...FROM_TWO, ...CHEATED]); });

  it('the truncated, holed and cheated runs never take a seat', () => {
    const lobby = createRunLobby(7, 'myra');
    const keys = lobby.seats.map((s) => s.runKey ?? '');
    expect(keys.some((k) => k.startsWith('Orangez|'))).toBe(false);
    expect(keys.some((k) => k.startsWith('Hole|'))).toBe(false);
    expect(keys.some((k) => k.startsWith('Cheat|'))).toBe(false);
    expect(keys.filter((k) => k.startsWith('Gap|') || k.startsWith('Two|')).length).toBe(2);
  });

  it('every recorded seat serves a board from at most one wave ahead, rounds 1 to 12', () => {
    const lobby = createRunLobby(7, 'myra');
    resetLobbyDrivers(lobby.seats);
    for (const seat of lobby.seats.filter((s) => s.kind === 'snapshot')) {
      const d = driverFor(seat)!;
      for (let round = 1; round <= 12; round++) {
        const b = d.prepare(round) ?? d.finalBoard?.() ?? null;
        const wave = b?.snapshot?.wave;
        if (wave !== undefined) expect(wave, `${seat.runKey} served wave ${wave} on round ${round}`).toBeLessThanOrEqual(round + 1);
      }
    }
  });
});

describe('a generated seat forges a rune like a real player (round-6 report, 2026-09-29)', () => {
  it('autoplayRun buys a rune at the turn-6 Runeforge when it can afford one', () => {
    // Every real run in the live pool owns a rune from wave 6 (141 of 146); the recording that plays a generated
    // seat used to SKIP the forge, so the player met "an opponent with no rune" on round 6.
    for (const [seed, hero] of [[7, 'drakko'], [11, 'soren'], [42, 'cassen']] as const) {
      const snaps = autoplayRun(seed, hero);
      const late = snaps.filter((s) => s.wave >= 7);
      expect(late.length, `${hero} recording too short`).toBeGreaterThan(0);
      expect(late.every((s) => (s.runes ?? []).length > 0), `${hero} reached wave 7 with no rune`).toBe(true);
    }
  });
});
