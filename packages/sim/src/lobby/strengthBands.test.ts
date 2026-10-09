import { afterEach, describe, expect, it } from 'vitest';
import type { BoardSnapshot } from '../snapshot';
import { OPPONENT_POOL, registerOpponentRuns } from '../opponents';
import { playableHeroes } from '../heroes';
import { RANK_MEDALS, rankDivisionCount, medalOf } from '../rank';
import { MAX_SEATS_PER_PLAYER, playerRunsFrom, runOwnerOf } from './snapshotSeats';
import { createRunLobby, lobbyPoolTelemetryOf, resetLobbyDrivers } from './runLobby';
import { BAND_WIDEN_STEP, OPPONENT_SEATS, STRENGTH_BANDS, STRENGTH_BANDS_VERSION, bandSteps, inStrengthBand, matchScoreOf, runInStrengthBand, runUnderOverallCap, sameBand, seatableRuns, strengthBandForDivision, widenBand } from './strengthBands';
import { EARLY_LAST_ROUND, earlyLateStrengthOf, rankAmongRuns } from './boardStrength';

/**
 * MATCHMAKING BANDS (R-LOBBY-09, owner 2026-09-30): "serve for example 0-30 for bronze, 10-40 in silver, 20-65 in
 * gold, and then uncap plat", then "maybe plat should be 50 and then diamond is like 55 average and ascendant is 60
 * average? i dont want every game to just be insanely sweaty and unwinnable". Registers into the module-global pool, so it lives in its own file.
 */

const HEROES = playableHeroes().map((h) => h.id);
const snap = (author: string, heroId: string, seed: number, wave: number, strength?: number, ownerId?: string, el?: { early?: number; late?: number }): BoardSnapshot => ({
  v: 1, wave, heroId, resolve: 30, tier: Math.min(6, 1 + Math.floor(wave / 3)), triples: 0, tribes: [], threat: 'glass',
  power: wave * 10, seed, origin: 'self', author, setId: 'set1', ...(ownerId ? { ownerId } : {}),
  ...(strength !== undefined ? { runStrength: strength } : {}),
  ...(el?.early !== undefined ? { runStrengthEarly: el.early } : {}), ...(el?.late !== undefined ? { runStrengthLate: el.late } : {}),
  minions: [{ cardId: 'pack', attack: wave, health: wave, keywords: [], golden: false }],
} as unknown as BoardSnapshot);
const run = (author: string, heroId: string, seed: number, strength?: number, ownerId?: string, el?: { early?: number; late?: number }): BoardSnapshot[] =>
  Array.from({ length: 8 }, (_, i) => snap(author, heroId, seed, i + 1, strength, ownerId, el));

afterEach(() => { OPPONENT_POOL.length = 0; });
it('has enough distinct heroes for these tables', () => { expect(HEROES.length).toBeGreaterThanOrEqual(20); });

describe('the bands', () => {
  it('every division of a medal shares its band: Bronze early-only 0-20 capped at 40, Silver 80% early 10-30 capped at 60, Gold 60% early 10-50 capped at 75, open from Platinum (R-LOBBY-13 + R-LOBBY-15)', () => {
    for (let d = 0; d < rankDivisionCount(); d++) expect(strengthBandForDivision(d), `division ${d}`).toEqual(STRENGTH_BANDS[medalOf(d)]);
    expect(STRENGTH_BANDS.Bronze).toEqual({ min: 0, max: 20, earlyWeight: 1, overallCap: 40 });
    expect(STRENGTH_BANDS.Silver).toEqual({ min: 10, max: 30, earlyWeight: 0.8, overallCap: 60 });
    expect(STRENGTH_BANDS.Gold).toEqual({ min: 10, max: 50, earlyWeight: 0.6, overallCap: 75 });
    expect(STRENGTH_BANDS.Platinum).toBeNull();
    expect(STRENGTH_BANDS.Diamond).toBeNull();
    expect(STRENGTH_BANDS.Ascendant).toBeNull();
    expect(RANK_MEDALS).toEqual(['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Ascendant']);
    expect(STRENGTH_BANDS_VERSION).toBe('B0-20/e100/c40 S10-30/e80/c60 G10-50/e60/c75 P* D* A*');
  });

  it('early is rounds 1-9 and late is 10+, each a plain mean of the board percentiles, then ranked among runs', () => {
    expect(EARLY_LAST_ROUND).toBe(9);
    // Rounds 1-9 mean (10 + 20 + 31) / 3 = 20.33 -> 20; rounds 10-11 mean (80 + 91) / 2 = 85.5 -> 86 (half up).
    expect(earlyLateStrengthOf([{ round: 1, value: 10 }, { round: 5, value: 20 }, { round: 9, value: 31 }, { round: 10, value: 80 }, { round: 11, value: 91 }, { round: 12, value: null }]))
      .toEqual({ early: 20, late: 86 });
    expect(earlyLateStrengthOf([{ round: 1, value: 40 }, { round: 8, value: 60 }])).toEqual({ early: 50, late: null }); // ended before round 10
    expect(earlyLateStrengthOf([])).toEqual({ early: null, late: null });
    // Ranked: the same tie-halving rule as a run's strength. 4 runs: 10, 20, 20, 90 -> 13, 50, 50, 88; null stays null.
    expect([...rankAmongRuns([['a', 10], ['b', 20], ['c', 20], ['d', 90], ['e', null]]).values()]).toEqual([13, 50, 50, 88, null]);
  });

  it('a run scores weight x EARLY + (1 - weight) x LATE; EARLY alone without LATE; the weighted strength without either', () => {
    expect(matchScoreOf({ early: 10, late: 90 }, 1)).toBe(10); // Bronze: early only
    expect(matchScoreOf({ early: 10, late: 90 }, 0.8)).toBe(26); // Silver: 8 + 18
    expect(matchScoreOf({ early: 10, late: 90 }, 0.6)).toBe(42); // Gold: 6 + 36
    expect(matchScoreOf({ early: 30, late: null, strength: 70 }, 0.6)).toBe(30); // no late: early alone
    expect(matchScoreOf({ late: 40, strength: 70 }, 0.6)).toBe(40); // only late (does not happen on real runs)
    expect(matchScoreOf({ strength: 70 }, 0.8)).toBe(70); // a server / cache from before the early/late SQL
    expect(matchScoreOf({}, 0.8)).toBeNull(); // unscored
    expect(matchScoreOf({ early: 10, late: 90, strength: 55 }, null)).toBe(55); // a band from before the split
    // Exact at the boundary (0.8 x 30 + 0.2 x 30 is 30.000000000000004 in floats): inside 10-30.
    expect(runInStrengthBand({ early: 30, late: 30 }, STRENGTH_BANDS.Silver)).toBe(true);
    expect(runInStrengthBand({ early: 18, late: 82 }, STRENGTH_BANDS.Silver)).toBe(false); // 30.8
    expect(runInStrengthBand({ early: 16, late: 84 }, STRENGTH_BANDS.Silver)).toBe(true); // 29.6
    expect(runInStrengthBand({}, STRENGTH_BANDS.Bronze)).toBe(true); // unscored: inside every band
    expect(runInStrengthBand({ early: 99, late: 99 }, null)).toBe(true);
  });

  it('widening keeps the early weight, and a band is the same band only with the same weight', () => {
    expect(bandSteps({ min: 0, max: 20, earlyWeight: 1 })).toEqual([
      { min: 0, max: 20, earlyWeight: 1 }, { min: 0, max: 30, earlyWeight: 1 }, { min: 0, max: 40, earlyWeight: 1 }, { min: 0, max: 50, earlyWeight: 1 },
      { min: 0, max: 60, earlyWeight: 1 }, { min: 0, max: 70, earlyWeight: 1 }, { min: 0, max: 80, earlyWeight: 1 }, { min: 0, max: 90, earlyWeight: 1 }, null]);
    expect(bandSteps({ min: 10, max: 50, earlyWeight: 0.6 })).toEqual([{ min: 10, max: 50, earlyWeight: 0.6 }, { min: 0, max: 60, earlyWeight: 0.6 }, { min: 0, max: 70, earlyWeight: 0.6 },
      { min: 0, max: 80, earlyWeight: 0.6 }, { min: 0, max: 90, earlyWeight: 0.6 }, null]);
    expect(sameBand({ min: 10, max: 30, earlyWeight: 0.8 }, { min: 10, max: 30 })).toBe(false);
    expect(sameBand({ min: 10, max: 30, earlyWeight: 0.8, overallCap: 60 }, { ...STRENGTH_BANDS.Silver! })).toBe(true);
    // ...and the same overall cap (R-LOBBY-15): a band cached before the caps is not today's band.
    expect(sameBand({ min: 10, max: 30, earlyWeight: 0.8 }, { ...STRENGTH_BANDS.Silver! })).toBe(false);
  });

  it('the overall cap (R-LOBBY-15) is on the WEIGHTED strength, inclusive: 40 is in Bronze, 40.1 and 41 are out', () => {
    const bronze = STRENGTH_BANDS.Bronze;
    // EARLY 5 is deep inside Bronze's 0-20 band: only the overall cap decides.
    expect(runInStrengthBand({ strength: 40, early: 5, late: 90 }, bronze)).toBe(true);
    expect(runInStrengthBand({ strength: 40.1, early: 5, late: 90 }, bronze)).toBe(false);
    expect(runInStrengthBand({ strength: 41, early: 5, late: 90 }, bronze)).toBe(false);
    expect(runInStrengthBand({ strength: 60, early: 10, late: 10 }, STRENGTH_BANDS.Silver)).toBe(true);
    expect(runInStrengthBand({ strength: 60.1, early: 10, late: 10 }, STRENGTH_BANDS.Silver)).toBe(false);
    expect(runInStrengthBand({ strength: 75, early: 10, late: 10 }, STRENGTH_BANDS.Gold)).toBe(true);
    expect(runInStrengthBand({ strength: 76, early: 10, late: 10 }, STRENGTH_BANDS.Gold)).toBe(false);
    // Both must hold: under the cap but outside the early/late band is still out.
    expect(runInStrengthBand({ strength: 30, early: 25 }, bronze)).toBe(false);
    // Unscored overall strength: inside (the cap cannot judge it); the early/late band still applies.
    expect(runUnderOverallCap({}, bronze)).toBe(true);
    expect(runInStrengthBand({ early: 5 }, bronze)).toBe(true);
    expect(runInStrengthBand({ early: 25 }, bronze)).toBe(false);
    expect(runInStrengthBand({}, bronze)).toBe(true);
    // No cap: Platinum and up (null bands), and a capless band (one saved before 2026-10-09).
    expect(runInStrengthBand({ strength: 100, early: 100, late: 100 }, STRENGTH_BANDS.Platinum)).toBe(true);
    expect(runUnderOverallCap({ strength: 100 }, { min: 0, max: 20, earlyWeight: 1 })).toBe(true);
    expect(runUnderOverallCap({ strength: 100 }, null)).toBe(true);
  });

  it('widening never relaxes the overall cap: a capped band ends with the cap alone, never null (R-LOBBY-15)', () => {
    for (const medal of ['Bronze', 'Silver', 'Gold'] as const) {
      const band = STRENGTH_BANDS[medal]!;
      const steps = bandSteps(band);
      expect(steps).not.toContain(null);
      for (const st of steps) expect(st!.overallCap, `${medal} ${JSON.stringify(st)}`).toBe(band.overallCap);
      for (const st of steps) expect(st!.earlyWeight).toBe(band.earlyWeight);
      expect(steps.at(-1)).toEqual({ min: 0, max: 100, earlyWeight: band.earlyWeight, overallCap: band.overallCap });
      expect(widenBand(steps.at(-1)!)).toBeNull(); // nothing further: bandSteps stops on the cap alone
      // Every step refuses a run just over the cap, even one with the weakest possible early/late ratings.
      for (const st of steps) expect(runInStrengthBand({ strength: band.overallCap! + 1, early: 1, late: 1 }, st)).toBe(false);
    }
    expect(bandSteps(STRENGTH_BANDS.Bronze)).toEqual([
      { min: 0, max: 20, earlyWeight: 1, overallCap: 40 }, { min: 0, max: 30, earlyWeight: 1, overallCap: 40 }, { min: 0, max: 40, earlyWeight: 1, overallCap: 40 },
      { min: 0, max: 50, earlyWeight: 1, overallCap: 40 }, { min: 0, max: 60, earlyWeight: 1, overallCap: 40 }, { min: 0, max: 70, earlyWeight: 1, overallCap: 40 },
      { min: 0, max: 80, earlyWeight: 1, overallCap: 40 }, { min: 0, max: 90, earlyWeight: 1, overallCap: 40 }, { min: 0, max: 100, earlyWeight: 1, overallCap: 40 }]);
    expect(bandSteps(STRENGTH_BANDS.Platinum)).toEqual([null]);
  });

  it('widens by 10 on each capped side until uncapped', () => {
    expect(BAND_WIDEN_STEP).toBe(10);
    expect(bandSteps({ min: 0, max: 30 })).toEqual([{ min: 0, max: 30 }, { min: 0, max: 40 }, { min: 0, max: 50 }, { min: 0, max: 60 }, { min: 0, max: 70 }, { min: 0, max: 80 }, { min: 0, max: 90 }, null]);
    expect(bandSteps({ min: 20, max: 65 })).toEqual([{ min: 20, max: 65 }, { min: 10, max: 75 }, { min: 0, max: 85 }, { min: 0, max: 95 }, null]);
    // Diamond and Ascendant have only a floor: widening lowers it by 10 a step.
    expect(bandSteps({ min: 20, max: 100 })).toEqual([{ min: 20, max: 100 }, { min: 10, max: 100 }, null]);
    expect(bandSteps({ min: 10, max: 100 })).toEqual([{ min: 10, max: 100 }, null]);
    // Other shapes (the retired 2026-10-03 final-board bands): an odd floor, and longer floor-only ladders.
    expect(bandSteps({ min: 15, max: 65 })).toEqual([{ min: 15, max: 65 }, { min: 5, max: 75 }, { min: 0, max: 85 }, { min: 0, max: 95 }, null]);
    expect(bandSteps({ min: 15, max: 100 })).toEqual([{ min: 15, max: 100 }, { min: 5, max: 100 }, null]);
    expect(bandSteps({ min: 35, max: 100 })).toEqual([{ min: 35, max: 100 }, { min: 25, max: 100 }, { min: 15, max: 100 }, { min: 5, max: 100 }, null]);
    expect(bandSteps(null)).toEqual([null]);
    expect(widenBand(null)).toBeNull();
  });

  it('an unscored run is inside every band', () => {
    expect(inStrengthBand(undefined, { min: 0, max: 30 })).toBe(true);
    expect(inStrengthBand(null, { min: 20, max: 65 })).toBe(true);
    expect(inStrengthBand(31, { min: 0, max: 30 })).toBe(false);
    expect(inStrengthBand(30, { min: 0, max: 30 })).toBe(true);
    expect(inStrengthBand(99, null)).toBe(true);
  });

  it('counts the seats a set of runs can fill under the per-player cap', () => {
    expect(seatableRuns(['a', 'a', 'a', 'a', 'a', 'a', 'b', null, null])).toBe(MAX_SEATS_PER_PLAYER + 1 + 2);
    expect(OPPONENT_SEATS).toBe(7);
  });
});

describe('seat selection inside a band', () => {
  /** 20 players, one run each on distinct heroes, strengths 5, 10, ... 100; plus `extra` runs. */
  function seedPool(extra: BoardSnapshot[][] = []): void {
    const runs = HEROES.slice(0, 20).map((h, i) => run(`P${i}`, h, 100 + i, (i + 1) * 5, `u${i}`));
    registerOpponentRuns([...runs, ...extra]);
  }
  const strengthsOf = (seed: number, band: { min: number; max: number; earlyWeight?: number } | null) => {
    const lobby = createRunLobby(seed, 'zz-none', {}, 'set1', { strengthBand: band });
    resetLobbyDrivers(lobby.seats);
    const byKey = new Map(playerRunsFrom(undefined, undefined, 'set1').map((r) => [r.key, r.strength]));
    return { lobby, strengths: lobby.seats.filter((s) => s.kind === 'snapshot').map((s) => byKey.get(s.runKey!)) };
  };

  it('draws only runs inside the band while they can fill the table', () => {
    // 10 runs at strength <= 50: enough for a Bronze-like band of 0-50.
    seedPool();
    for (let seed = 1; seed <= 30; seed++) {
      const { lobby, strengths } = strengthsOf(seed, { min: 0, max: 50 });
      expect(strengths.length).toBe(7);
      for (const st of strengths) expect(st!).toBeLessThanOrEqual(50);
      expect(lobby.poolAtStart?.band).toEqual({ requested: { min: 0, max: 50 }, used: { min: 0, max: 50 }, widenings: 0 });
    }
  });

  it('widens step by step when the band cannot fill the table, logging each step', () => {
    seedPool();
    // 0-30 holds 6 runs (5..30): one widening step (0-40) fills the seventh seat.
    const { lobby, strengths } = strengthsOf(3, { min: 0, max: 30 });
    expect(strengths.length).toBe(7);
    expect(strengths.filter((st) => st! <= 30).length).toBe(6); // every in-band run was seated first
    expect(strengths.every((st) => st! <= 40)).toBe(true);
    expect(lobby.poolAtStart?.band).toEqual({ requested: { min: 0, max: 30 }, used: { min: 0, max: 40 }, widenings: 1 });
    const t = lobbyPoolTelemetryOf(lobby);
    expect([t.strengthBand, t.strengthBandUsed, t.bandWidenings]).toEqual(['0-30', '0-40', 1]);
  });

  it('an Ascendant band (20-100) draws the strong runs and lowers its floor when they cannot fill the table', () => {
    seedPool(); // strengths 5..100, one run each: 17 runs at 20+
    for (let seed = 1; seed <= 10; seed++) {
      const { lobby, strengths } = strengthsOf(seed, { min: 20, max: 100 });
      expect(strengths.length).toBe(7);
      for (const st of strengths) expect(st!).toBeGreaterThanOrEqual(20);
      expect(lobby.poolAtStart?.band?.widenings).toBe(0);
    }
    OPPONENT_POOL.length = 0;
    // Only 4 runs at 20+ (strengths 5, 10, 15 below): the floor drops to 10, then to 0 (uncapped).
    registerOpponentRuns(HEROES.slice(0, 7).map((h, i) => run(`A${i}`, h, 900 + i, [5, 10, 15, 20, 40, 60, 80][i], `a${i}`)));
    const { lobby, strengths } = strengthsOf(2, { min: 20, max: 100 });
    expect(strengths.length).toBe(7);
    expect(lobby.poolAtStart?.band).toEqual({ requested: { min: 20, max: 100 }, used: null, widenings: 2 });
  });

  it('falls back to generated seats only after the band is fully widened', () => {
    registerOpponentRuns(HEROES.slice(0, 3).map((h, i) => run(`Q${i}`, h, 300 + i, 95, `q${i}`)));
    const lobby = createRunLobby(5, 'zz-none', {}, 'set1', { strengthBand: { min: 0, max: 30 } });
    resetLobbyDrivers(lobby.seats);
    expect(lobby.seats.filter((s) => s.kind === 'snapshot').length).toBe(3); // the three strong runs, after widening
    expect(lobby.seats.length).toBe(8); // generated seats fill the rest
    expect(lobby.poolAtStart?.band?.used).toBeNull();
    expect(lobby.poolAtStart?.band?.widenings).toBe(7);
  });

  it('counts unscored runs as inside the band (nothing changes before the backfill)', () => {
    registerOpponentRuns(HEROES.slice(0, 10).map((h, i) => run(`U${i}`, h, 400 + i, undefined, `v${i}`)));
    const a = createRunLobby(9, 'zz-none', {}, 'set1', { strengthBand: { min: 0, max: 30 } });
    resetLobbyDrivers(a.seats);
    const b = createRunLobby(9, 'zz-none', {}, 'set1');
    resetLobbyDrivers(b.seats);
    expect(a.seats.map((s) => s.runKey)).toEqual(b.seats.map((s) => s.runKey)); // seat for seat the unbanded table
    expect(a.poolAtStart?.band?.widenings).toBe(0);
  });

  it('with no band the table is exactly the selection of before', () => {
    seedPool();
    const a = createRunLobby(12, 'zz-none', {}, 'set1', { strengthBand: null });
    resetLobbyDrivers(a.seats);
    const b = createRunLobby(12, 'zz-none', {}, 'set1');
    resetLobbyDrivers(b.seats);
    expect(a.seats.map((s) => s.runKey)).toEqual(b.seats.map((s) => s.runKey));
    expect(a.poolAtStart?.band).toBeUndefined();
  });

  it('a split band seats runs by their blended score, not their weighted strength (R-LOBBY-13)', () => {
    // 20 runs on distinct heroes: early 5..100, late 100 - early + 5, weighted strength 50 for everyone. Under the old
    // rule (weighted strength) a Bronze 0-20 band would hold nothing; the early-only band holds runs 1-4.
    registerOpponentRuns(HEROES.slice(0, 20).map((h, i) => run(`E${i}`, h, 1100 + i, 50, `e${i}`, { early: (i + 1) * 5, late: 100 - (i + 1) * 5 + 5 })));
    const byKey = new Map(playerRunsFrom(undefined, undefined, 'set1').map((r) => [r.key, r]));
    for (let seed = 1; seed <= 10; seed++) {
      const lobby = createRunLobby(seed, 'zz-none', {}, 'set1', { strengthBand: STRENGTH_BANDS.Silver });
      resetLobbyDrivers(lobby.seats);
      const seated = lobby.seats.filter((s) => s.kind === 'snapshot').map((s) => byKey.get(s.runKey!)!);
      expect(seated.length).toBe(7);
      // Silver 10-30 at 80% early: 0.8 e + 0.2 (105 - e) = 0.6 e + 21 <= 30 -> e <= 15: runs 1-3 (e 5, 10, 15) are in;
      // then 0-40 (e <= 31.67: runs up to e 30), then 0-50 (e <= 48.3): 3 + 3 + 3 = 9 >= 7 after two widenings.
      for (const r of seated) expect(matchScoreOf(r, 0.8)!).toBeLessThanOrEqual(50);
      expect(seated.filter((r) => matchScoreOf(r, 0.8)! <= 30).length).toBe(3); // every in-band run seated first
      expect(lobby.poolAtStart?.band?.requested).toEqual({ min: 10, max: 30, earlyWeight: 0.8, overallCap: 60 });
      expect(lobby.poolAtStart?.band?.used).toEqual({ min: 0, max: 50, earlyWeight: 0.8, overallCap: 60 });
    }
  });

  it('a run delivered without early / late (before the SQL) is banded on its weighted strength', () => {
    seedPool(); // strengths 5..100, no early / late
    const { strengths } = strengthsOf(4, STRENGTH_BANDS.Bronze);
    expect(strengths.length).toBe(7);
    expect(strengths.filter((st) => st! <= 20).length).toBe(4); // 5, 10, 15, 20 first
    expect(strengths.every((st) => st! <= 40)).toBe(true); // then 0-30, 0-40
  });

  it(`still caps a player at ${MAX_SEATS_PER_PLAYER} seats inside a band; your own runs count like anyone's`, () => {
    // One prolific player with 10 weak runs, three others with one weak run each, and the viewer's own weak run (your
    // own runs sit at your table like anyone else's, owner 2026-09-30).
    const prolific = HEROES.slice(0, 10).map((h, i) => run('Big', h, 500 + i, 10, 'big'));
    const others = HEROES.slice(10, 13).map((h, i) => run(`O${i}`, h, 600 + i, 15, `o${i}`));
    const mine = [run('Me', HEROES[13]!, 700, 5, 'me')];
    const strong = HEROES.slice(14, 20).map((h, i) => run(`S${i}`, h, 800 + i, 90, `s${i}`));
    registerOpponentRuns([...prolific, ...others, ...mine, ...strong]);
    for (let seed = 1; seed <= 20; seed++) {
      const lobby = createRunLobby(seed, 'zz-none', {}, 'set1', { strengthBand: { min: 0, max: 30 } });
      resetLobbyDrivers(lobby.seats);
      const runs = new Map(playerRunsFrom(undefined, undefined, 'set1').map((r) => [r.key, r]));
      const owners = lobby.seats.filter((s) => s.kind === 'snapshot').map((s) => runOwnerOf(runs.get(s.runKey!)!));
      expect(owners.filter((o) => o === 'id:big').length).toBe(MAX_SEATS_PER_PLAYER);
      expect(owners.length).toBe(7);
      // 4 + 3 + your 1 = 8 weak candidates for 7 seats: the table fills inside the band, no strong run needed.
      expect(owners.filter((o) => o?.startsWith('id:s')).length).toBe(0);
    }
  });

  it('the overall cap holds through every widening: over-cap runs are never seated, generated seats fill instead (R-LOBBY-15)', () => {
    // 3 runs under Bronze's cap inside its early band, 1 under the cap with EARLY 95 (reached only by the last widening
    // step), and 10 runs whose EARLY rating is perfect for Bronze but whose overall strength is 41+.
    const under = HEROES.slice(0, 3).map((h, i) => run(`Ok${i}`, h, 1300 + i, [12, 30, 40][i], `ok${i}`, { early: 5, late: 60 }));
    const lateUnder = run('Late', HEROES[3]!, 1350, 38, 'late', { early: 95, late: 10 });
    const over = HEROES.slice(4, 14).map((h, i) => run(`Hot${i}`, h, 1400 + i, 41 + i * 5, `hot${i}`, { early: 5, late: 95 }));
    registerOpponentRuns([...under, lateUnder, ...over]);
    const byKey = new Map(playerRunsFrom(undefined, undefined, 'set1').map((r) => [r.key, r]));
    for (let seed = 1; seed <= 10; seed++) {
      const lobby = createRunLobby(seed, 'zz-none', {}, 'set1', { strengthBand: strengthBandForDivision(0) });
      resetLobbyDrivers(lobby.seats);
      const seated = lobby.seats.filter((x) => x.kind === 'snapshot').map((x) => byKey.get(x.runKey!)!);
      expect(seated.map((r) => r.strength).sort((a, b) => a! - b!)).toEqual([12, 30, 38, 40]); // exactly 40 is in
      expect(lobby.seats.length).toBe(8); // generated seats fill the rest, as for any thin band
      // The band widened all the way (8 steps), but only to the cap alone: never uncapped.
      expect(lobby.poolAtStart?.band).toEqual({
        requested: { min: 0, max: 20, earlyWeight: 1, overallCap: 40 }, used: { min: 0, max: 100, earlyWeight: 1, overallCap: 40 }, widenings: 8,
      });
    }
  });

  it('Platinum has no band and no cap: a run at 100 is seated (R-LOBBY-15)', () => {
    registerOpponentRuns(HEROES.slice(0, 7).map((h, i) => run(`Top${i}`, h, 1500 + i, 100, `top${i}`, { early: 100, late: 100 })));
    const plat = RANK_MEDALS.indexOf('Platinum');
    let division = 0;
    while (medalOf(division) !== RANK_MEDALS[plat]) division++;
    expect(strengthBandForDivision(division)).toBeNull();
    const lobby = createRunLobby(3, 'zz-none', {}, 'set1', { strengthBand: strengthBandForDivision(division) });
    resetLobbyDrivers(lobby.seats);
    expect(lobby.seats.filter((x) => x.kind === 'snapshot').length).toBe(7);
  });

  it('a run delivered by a server WITHOUT the caps SQL is still refused over the cap: the cap holds client-side (R-LOBBY-15)', () => {
    // A server before 2026-10-09-strength-overall-caps.sql filters only the early/late band, so it delivers runs whose
    // overall strength is over the cap. They carry `runStrength` (pool_runs.strength), so seat selection refuses them.
    const delivered = HEROES.slice(0, 12).map((h, i) => run(`D${i}`, h, 1600 + i, i < 8 ? 20 + i : 61 + i, `d${i}`, { early: 15, late: 25 }));
    registerOpponentRuns(delivered);
    const byKey = new Map(playerRunsFrom(undefined, undefined, 'set1').map((r) => [r.key, r]));
    for (let seed = 1; seed <= 10; seed++) {
      const lobby = createRunLobby(seed, 'zz-none', {}, 'set1', { strengthBand: STRENGTH_BANDS.Silver });
      resetLobbyDrivers(lobby.seats);
      const seated = lobby.seats.filter((x) => x.kind === 'snapshot').map((x) => byKey.get(x.runKey!)!);
      expect(seated.length).toBe(7);
      for (const r of seated) expect(r.strength!).toBeLessThanOrEqual(60);
    }
  });
});
