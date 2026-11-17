import { afterEach, describe, expect, it } from 'vitest';
import type { BoardSnapshot } from '../snapshot';
import { OPPONENT_POOL, registerOpponentRuns } from '../opponents';
import { playableHeroes } from '../heroes';
import { createRunLobby, resetLobbyDrivers } from './runLobby';
import { playerRunsFrom } from './snapshotSeats';
import { STRENGTH_BANDS, STRENGTH_BANDS_VERSION, bandSteps, bandVersionLabel, practiceStrengthBand, runInStrengthBand, runUnderPeakCap, sameBand, widenBand, type StrengthBand } from './strengthBands';
import { selectRankedDuosTable, type SoloRunCandidate } from '../versus/rankedDuosSeating';

/**
 * THE PEAK CAP (owner 2026-11-16, asked which peak caps Bronze, Silver and Gold get: "90 for all"). A run's PEAK is
 * its best real board from round 3 on, as a percentile. A Bronze, Silver or Gold table never seats a recorded run
 * whose peak is above 90, however ordinary the rest of that game was. The cap is hard, like the overall cap: every
 * widening step keeps it.
 */
const HEROES = playableHeroes().map((h) => h.id);
const run = (author: string, heroId: string, seed: number, s: { strength?: number; early?: number; late?: number; peak?: number }): BoardSnapshot[] =>
  Array.from({ length: 8 }, (_, i) => ({
    v: 1, wave: i + 1, heroId, resolve: 30, tier: Math.min(6, 1 + Math.floor((i + 1) / 3)), triples: 0, tribes: [], threat: 'glass',
    power: (i + 1) * 10, seed, origin: 'self', author, setId: 'set1', ownerId: `u-${author}`,
    ...(s.strength === undefined ? {} : { runStrength: s.strength }),
    ...(s.early === undefined ? {} : { runStrengthEarly: s.early }),
    ...(s.late === undefined ? {} : { runStrengthLate: s.late }),
    ...(s.peak === undefined ? {} : { runStrengthPeak: s.peak }),
    minions: [{ cardId: 'pack', attack: i + 1, health: i + 1, keywords: [], golden: false }],
  } as unknown as BoardSnapshot));

afterEach(() => { OPPONENT_POOL.length = 0; });

const seatedKeys = (seed: number, band: StrengthBand | null): string[] => {
  const lobby = createRunLobby(seed, HEROES[HEROES.length - 1]!, {}, 'set1', band ? { strengthBand: band } : {});
  resetLobbyDrivers(lobby.seats);
  return lobby.seats.filter((x) => x.kind === 'snapshot').map((x) => x.runKey!);
};

describe('the peak cap on a band', () => {
  it('Bronze, Silver and Gold cap the peak at 90; Platinum, Diamond and Ascendant have no band at all', () => {
    expect(STRENGTH_BANDS.Bronze).toEqual({ min: 0, max: 20, earlyWeight: 1, overallCap: 40, peakCap: 90 });
    expect(STRENGTH_BANDS.Silver).toEqual({ min: 10, max: 30, earlyWeight: 0.8, overallCap: 60, peakCap: 90 });
    expect(STRENGTH_BANDS.Gold).toEqual({ min: 10, max: 50, earlyWeight: 0.6, overallCap: 75, peakCap: 90 });
    expect([STRENGTH_BANDS.Platinum, STRENGTH_BANDS.Diamond, STRENGTH_BANDS.Ascendant]).toEqual([null, null, null]);
  });

  it('exactly the cap is inside, one above is outside', () => {
    const inBronze = { strength: 10, early: 10, late: 10 };
    expect(runInStrengthBand({ ...inBronze, peak: 90 }, STRENGTH_BANDS.Bronze)).toBe(true);
    expect(runInStrengthBand({ ...inBronze, peak: 91 }, STRENGTH_BANDS.Bronze)).toBe(false);
    expect(runUnderPeakCap({ peak: 90 }, STRENGTH_BANDS.Bronze)).toBe(true);
    expect(runUnderPeakCap({ peak: 91 }, STRENGTH_BANDS.Bronze)).toBe(false);
    expect(runUnderPeakCap({ peak: 100 }, null)).toBe(true);
    expect(runUnderPeakCap({ peak: 100 }, { min: 0, max: 20 })).toBe(true); // a band with no peak cap
  });

  it('the freak board: a run that ended on round 7 with one board at 95 is outside Bronze, though its Game strength is 30', () => {
    expect(runInStrengthBand({ strength: 30, early: 15, late: 15, peak: 95 }, STRENGTH_BANDS.Bronze)).toBe(false);
    expect(runInStrengthBand({ strength: 30, early: 15, late: 15, peak: 60 }, STRENGTH_BANDS.Bronze)).toBe(true);
  });

  it('an unscored run is outside (it has no strength); a scored run whose peak was not delivered is inside', () => {
    // A scored run always has a peak once the server has the peak SQL. Without it (an older server, hub or cached
    // run) no row carries one, and treating that as "over the cap" would empty every Bronze, Silver and Gold table.
    expect(runInStrengthBand({ peak: 10 }, STRENGTH_BANDS.Bronze)).toBe(false);
    expect(runInStrengthBand({ strength: 10, early: 10, late: 10 }, STRENGTH_BANDS.Bronze)).toBe(true);
    expect(runInStrengthBand({ strength: 10, early: 10, late: 10, peak: null }, STRENGTH_BANDS.Bronze)).toBe(true);
  });

  it('the cap is never widened away: every step keeps it, and the last step is the two caps alone', () => {
    for (const medal of ['Bronze', 'Silver', 'Gold'] as const) {
      const steps = bandSteps(STRENGTH_BANDS[medal]);
      expect(steps.every((s) => s?.peakCap === 90), medal).toBe(true);
      expect(steps.at(-1), medal).toEqual({ min: 0, max: 100, earlyWeight: STRENGTH_BANDS[medal]!.earlyWeight, overallCap: STRENGTH_BANDS[medal]!.overallCap, peakCap: 90 });
    }
    // A band with ONLY a peak cap ends on the cap alone too, never on "no band".
    const onlyPeak = bandSteps({ min: 40, max: 60, peakCap: 80 });
    expect(onlyPeak.at(-1)).toEqual({ min: 0, max: 100, peakCap: 80 });
    expect(onlyPeak.every((s) => s?.peakCap === 80)).toBe(true);
    expect(widenBand({ min: 0, max: 100, peakCap: 80 })).toBeNull(); // the one step `bandSteps` never takes
  });

  it('Practice inherits it from the medal; All Ranks has no band', () => {
    expect(practiceStrengthBand('gold')?.peakCap).toBe(90);
    expect(practiceStrengthBand('bronze')?.peakCap).toBe(90);
    expect(practiceStrengthBand('all')).toBeNull();
    expect(practiceStrengthBand('platinum')).toBeNull();
  });

  it('the regime stamp names it, and two bands that differ only by the peak cap are different bands', () => {
    expect(bandVersionLabel(STRENGTH_BANDS.Bronze)).toBe('0-20/e100/c40/p90');
    expect(bandVersionLabel({ min: 0, max: 20 })).toBe('0-20');
    expect(STRENGTH_BANDS_VERSION).toBe('B0-20/e100/c40/p90 S10-30/e80/c60/p90 G10-50/e60/c75/p90 P* D* A*');
    expect(sameBand({ min: 0, max: 20, peakCap: 90 }, { min: 0, max: 20, peakCap: 90 })).toBe(true);
    expect(sameBand({ min: 0, max: 20, peakCap: 90 }, { min: 0, max: 20 })).toBe(false);
    expect(sameBand({ min: 0, max: 20, peakCap: 90 }, { min: 0, max: 20, peakCap: 80 })).toBe(false);
  });
});

describe('the peak cap at the table', () => {
  it('the pool hands a run its peak', () => {
    registerOpponentRuns([run('A', HEROES[0]!, 1, { strength: 10, early: 10, late: 10, peak: 72 }), run('B', HEROES[1]!, 2, { strength: 10 })]);
    const by = new Map(playerRunsFrom(undefined, undefined, 'set1').map((r) => [r.author, r]));
    expect(by.get('A')!.peak).toBe(72);
    expect(by.get('B')!.peak).toBeUndefined();
  });

  it('20 in-band runs, 15 with a peak of 95: none of the 15 is ever seated, at any widening step', () => {
    registerOpponentRuns(Array.from({ length: 20 }, (_, i) =>
      run(`${i < 15 ? 'Spike' : 'Calm'}${i}`, HEROES[i]!, 100 + i, { strength: 10, early: 10, late: 10, peak: i < 15 ? 95 : 50 })));
    for (const medal of ['Bronze', 'Silver', 'Gold'] as const) {
      for (let seed = 1; seed <= 25; seed++) {
        const keys = seatedKeys(seed, STRENGTH_BANDS[medal]);
        expect(keys.some((k) => k.startsWith('Spike')), `${medal} seed ${seed}`).toBe(false);
        expect(keys.length, `${medal} seed ${seed}`).toBe(5); // the five calm runs; generated seats fill the other two
      }
    }
    // With no band (Platinum and up) the same runs are seated as ever.
    expect(seatedKeys(1, null).some((k) => k.startsWith('Spike'))).toBe(true);
  });

  it('exactly 90 is seated', () => {
    registerOpponentRuns(Array.from({ length: 7 }, (_, i) => run(`Edge${i}`, HEROES[i]!, 200 + i, { strength: 10, early: 10, late: 10, peak: 90 })));
    expect(seatedKeys(3, STRENGTH_BANDS.Bronze).length).toBe(7);
  });

  it('Ranked Duos: a solo run over the cap is not seated at a Bronze table; one at the cap is', () => {
    const solo = (key: string, hero: string, peak: number): SoloRunCandidate => ({ key, ownerId: key, author: key, heroId: hero, strength: 10, early: 10, late: 10, peak });
    const t = selectRankedDuosTable({
      seed: 7, liveHeroes: ['h1', 'h2'], band: STRENGTH_BANDS.Bronze, generatedHeroes: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9', 'h10'], duoRuns: [],
      soloRuns: [solo('spike1', 'h3', 95), solo('spike2', 'h4', 91), solo('ok1', 'h5', 90), solo('ok2', 'h6', 40)],
    });
    const keys = t.teams.flatMap((x) => x.members.map((m) => m.key));
    expect(keys).toEqual(expect.arrayContaining(['ok1', 'ok2']));
    expect(keys.some((k) => k.startsWith('spike'))).toBe(false);
  });
});
