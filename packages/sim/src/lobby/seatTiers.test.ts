import { afterEach, describe, expect, it } from 'vitest';
import type { BoardSnapshot } from '../snapshot';
import { OPPONENT_POOL, registerOpponentRuns } from '../opponents';
import { playableHeroes } from '../heroes';
import { createRunLobby, resetLobbyDrivers } from './runLobby';
import { playerRunsFrom } from './snapshotSeats';
import { STRENGTH_BANDS, STRENGTH_TIER_LIMITS, strengthSeatTierOf } from './strengthBands';

/**
 * STRONG RUNS PER TABLE (owner 2026-11-16): "there should only be able to be 2 90+ strength boards and 2 80+ strength
 * boards in any given game in the plat/diamond/ascendant rank" (two in the 80s plus two in the 90s), and "in ascendant
 * there should NOT be a skew to have more higher strength boards in the game. it should remain entirely unbiased".
 */
const HEROES = playableHeroes().map((h) => h.id);
const run = (author: string, heroId: string, seed: number, strength: number | undefined): BoardSnapshot[] =>
  Array.from({ length: 8 }, (_, i) => ({
    v: 1, wave: i + 1, heroId, resolve: 30, tier: Math.min(6, 1 + Math.floor((i + 1) / 3)), triples: 0, tribes: [], threat: 'glass',
    power: (i + 1) * 10, seed, origin: 'self', author, setId: 'set1', ownerId: `u-${author}`,
    ...(strength === undefined ? {} : { runStrength: strength }),
    minions: [{ cardId: 'pack', attack: i + 1, health: i + 1, keywords: [], golden: false }],
  } as unknown as BoardSnapshot));

afterEach(() => { OPPONENT_POOL.length = 0; });

const seatedStrengths = (seed: number): number[] => {
  const lobby = createRunLobby(seed, HEROES[HEROES.length - 1]!, {}, 'set1');
  resetLobbyDrivers(lobby.seats);
  const runs = new Map(playerRunsFrom(undefined, undefined, 'set1').map((r) => [r.key, r]));
  return lobby.seats.filter((x) => x.kind === 'snapshot').map((x) => runs.get(x.runKey!)!.strength ?? -1);
};

describe('strong runs per table', () => {
  it('the tiers are 90-100 and 80-89, two seats each', () => {
    expect(STRENGTH_TIER_LIMITS).toEqual([{ min: 90, max: 100, seats: 2 }, { min: 80, max: 89, seats: 2 }]);
    expect(strengthSeatTierOf(100)).toBe(0);
    expect(strengthSeatTierOf(90)).toBe(0);
    expect(strengthSeatTierOf(89)).toBe(1);
    expect(strengthSeatTierOf(80)).toBe(1);
    expect(strengthSeatTierOf(79)).toBe(-1);
    expect(strengthSeatTierOf(undefined)).toBe(-1); // an unscored run is in no tier
  });

  it('an open table never seats more than two 90+ runs or more than two runs in the 80s', () => {
    // One player per run, one hero each: 6 runs at 95, 6 at 85, 6 at 50 (so the limits bind on most tables).
    const N = Math.min(18, HEROES.length - 1);
    registerOpponentRuns(Array.from({ length: N }, (_, i) => run(`P${i}`, HEROES[i]!, 100 + i, [95, 85, 50][i % 3]!)));
    let bound90 = 0; let bound80 = 0;
    for (let seed = 1; seed <= 80; seed++) {
      const xs = seatedStrengths(seed);
      const n90 = xs.filter((v) => v >= 90).length;
      const n80 = xs.filter((v) => v >= 80 && v < 90).length;
      expect(n90, `seed ${seed}`).toBeLessThanOrEqual(2);
      expect(n80, `seed ${seed}`).toBeLessThanOrEqual(2);
      if (n90 === 2) bound90++;
      if (n80 === 2) bound80++;
    }
    expect(bound90).toBeGreaterThan(40);
    expect(bound80).toBeGreaterThan(40);
  });

  it('a pool of only 90+ runs seats two of them and generates the rest (the limit is hard)', () => {
    registerOpponentRuns(Array.from({ length: 10 }, (_, i) => run(`P${i}`, HEROES[i]!, 300 + i, 95)));
    const lobby = createRunLobby(7, HEROES[HEROES.length - 1]!, {}, 'set1');
    expect(lobby.seats.filter((x) => x.kind === 'snapshot').length).toBe(2);
    expect(lobby.seats.length).toBe(8);
    resetLobbyDrivers(lobby.seats);
  });

  it('runs below 80 and unscored runs are never limited', () => {
    registerOpponentRuns(Array.from({ length: 12 }, (_, i) => run(`P${i}`, HEROES[i]!, 500 + i, i % 2 ? 79 : undefined)));
    for (let seed = 1; seed <= 20; seed++) expect(seatedStrengths(seed).length, `seed ${seed}`).toBe(7);
  });

  it('no rank leans toward stronger runs: Platinum and Diamond only carry a cap (no floor), Ascendant has no band', () => {
    expect(STRENGTH_BANDS.Platinum).toEqual({ min: 0, max: 100, overallCap: 80 });
    expect(STRENGTH_BANDS.Diamond).toEqual({ min: 0, max: 100, overallCap: 90 });
    expect(STRENGTH_BANDS.Ascendant).toBeNull();
  });

  it('inside the limits the draw stays unbiased: every run below 80 is equally likely on an open table', () => {
    const N = Math.min(16, HEROES.length - 1);
    registerOpponentRuns(Array.from({ length: N }, (_, i) => run(`P${i}`, HEROES[i]!, 700 + i, 10 + i * 4))); // 10..70
    const freq = new Map<number, number>();
    const LOBBIES = 400;
    for (let seed = 1; seed <= LOBBIES; seed++) for (const v of seatedStrengths(seed)) freq.set(v, (freq.get(v) ?? 0) + 1);
    const expected = (LOBBIES * 7) / N;
    expect(freq.size).toBe(N);
    for (const [v, n] of freq) { expect(n, `strength ${v}`).toBeGreaterThan(expected * 0.75); expect(n, `strength ${v}`).toBeLessThan(expected * 1.25); }
  });
});
