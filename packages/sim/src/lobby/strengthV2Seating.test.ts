import { afterEach, describe, expect, it } from 'vitest';
import type { BoardSnapshot } from '../snapshot';
import { OPPONENT_POOL, registerOpponentRuns } from '../opponents';
import { playableHeroes } from '../heroes';
import { createRunLobby, resetLobbyDrivers } from './runLobby';
import { playerRunByKey, playerRunsFrom, runCanBeSeated, seatablePlayerRuns } from './snapshotSeats';
import { STRENGTH_BANDS, bandSteps, runInStrengthBand } from './strengthBands';

/**
 * STRENGTH V2 AT THE TABLE (owner 2026-11-16).
 *  - "we should never have any snapshots of boards that are below 7 rounds" ("exclude them"): a run whose recording
 *    ends before round 7 is never seated at a new table.
 *  - Ruling 1: "Unscored runs are kept out of Bronze, Silver and Gold lobbies."
 */
const HEROES = playableHeroes().map((h) => h.id);
const run = (author: string, heroId: string, seed: number, rounds: number, strengths?: { strength?: number; early?: number; late?: number }): BoardSnapshot[] =>
  Array.from({ length: rounds }, (_, i) => ({
    v: 1, wave: i + 1, heroId, resolve: 30, tier: Math.min(6, 1 + Math.floor((i + 1) / 3)), triples: 0, tribes: [], threat: 'glass',
    power: (i + 1) * 10, seed, origin: 'self', author, setId: 'set1', ownerId: `u-${author}`,
    ...(strengths?.strength === undefined ? {} : { runStrength: strengths.strength }),
    ...(strengths?.early === undefined ? {} : { runStrengthEarly: strengths.early }),
    ...(strengths?.late === undefined ? {} : { runStrengthLate: strengths.late }),
    minions: [{ cardId: 'pack', attack: i + 1, health: i + 1, keywords: [], golden: false }],
  } as unknown as BoardSnapshot));

afterEach(() => { OPPONENT_POOL.length = 0; });

const seatedKeys = (seed: number, band: (typeof STRENGTH_BANDS)[keyof typeof STRENGTH_BANDS] = null): string[] => {
  const lobby = createRunLobby(seed, HEROES[HEROES.length - 1]!, {}, 'set1', band ? { strengthBand: band } : {});
  resetLobbyDrivers(lobby.seats);
  return lobby.seats.filter((x) => x.kind === 'snapshot').map((x) => x.runKey!);
};

describe('the 7-round floor', () => {
  it('a run that ends on round 6 cannot be seated; one that ends on round 7 can', () => {
    registerOpponentRuns([run('Six', HEROES[0]!, 1, 6), run('Seven', HEROES[1]!, 2, 7)]);
    const by = new Map(playerRunsFrom(undefined, undefined, 'set1').map((r) => [r.author, r]));
    expect(runCanBeSeated(by.get('Six')!)).toBe(false);
    expect(runCanBeSeated(by.get('Seven')!)).toBe(true);
    expect(seatablePlayerRuns(undefined, 'set1').map((r) => r.author)).toEqual(['Seven']);
  });

  it('no table ever seats a run under the floor, however empty the pool is', () => {
    registerOpponentRuns([
      ...Array.from({ length: 6 }, (_, i) => run(`Short${i}`, HEROES[i]!, 10 + i, 6)),
      ...Array.from({ length: 3 }, (_, i) => run(`Long${i}`, HEROES[6 + i]!, 20 + i, 7)),
    ]);
    let seatedLong = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const keys = seatedKeys(seed);
      expect(keys.some((k) => k.startsWith('Short')), `seed ${seed}`).toBe(false);
      seatedLong += keys.length;
    }
    expect(seatedLong).toBe(40 * 3); // the three long runs are seated every time; generated seats fill the rest
  });

  it('a run under the floor can still be looked up (a saved game, a replay, the fight ledger)', () => {
    registerOpponentRuns([run('Six', HEROES[0]!, 1, 6)]);
    const key = playerRunsFrom(undefined, undefined, 'set1')[0]!.key;
    expect(playerRunByKey(key, undefined, 'set1')).not.toBeNull();
  });
});

describe('an unscored run is outside every band', () => {
  it('Bronze, Silver, Gold and every widened step, the last one included; inside when there is no band', () => {
    for (const medal of ['Bronze', 'Silver', 'Gold'] as const) {
      for (const step of bandSteps(STRENGTH_BANDS[medal])) {
        expect(runInStrengthBand({}, step), `${medal} ${JSON.stringify(step)}`).toBe(false);
        expect(runInStrengthBand({ early: 10, late: 10 }, step), `${medal}: early and late but no Game strength`).toBe(false);
      }
    }
    expect(runInStrengthBand({}, null)).toBe(true);
    expect(runInStrengthBand({ strength: 10, early: 10, late: 10 }, STRENGTH_BANDS.Bronze)).toBe(true);
  });

  it('a Bronze table whose only recorded runs are unscored is filled by generated seats', () => {
    registerOpponentRuns(Array.from({ length: 12 }, (_, i) => run(`U${i}`, HEROES[i]!, 30 + i, 8)));
    for (let seed = 1; seed <= 20; seed++) expect(seatedKeys(seed, STRENGTH_BANDS.Bronze), `seed ${seed}`).toEqual([]);
    // The same pool with no band seats them as before.
    expect(seatedKeys(1).length).toBe(7);
  });

  it('a Bronze table seats the scored in-band runs and never the unscored ones beside them', () => {
    registerOpponentRuns([
      ...Array.from({ length: 8 }, (_, i) => run(`In${i}`, HEROES[i]!, 40 + i, 8, { strength: 10, early: 10, late: 10 })),
      ...Array.from({ length: 8 }, (_, i) => run(`U${i}`, HEROES[8 + i]!, 60 + i, 8)),
    ]);
    for (let seed = 1; seed <= 20; seed++) {
      const keys = seatedKeys(seed, STRENGTH_BANDS.Bronze);
      expect(keys.length, `seed ${seed}`).toBe(7);
      expect(keys.every((k) => k.startsWith('In')), `seed ${seed}`).toBe(true);
    }
  });
});
