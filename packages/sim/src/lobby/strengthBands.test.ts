import { afterEach, describe, expect, it } from 'vitest';
import type { BoardSnapshot } from '../snapshot';
import { OPPONENT_POOL, registerOpponentRuns } from '../opponents';
import { playableHeroes } from '../heroes';
import { RANK_MEDALS, rankDivisionCount, medalOf } from '../rank';
import { MAX_SEATS_PER_PLAYER, playerRunsFrom, runOwnerOf } from './snapshotSeats';
import { createRunLobby, lobbyPoolTelemetryOf, resetLobbyDrivers } from './runLobby';
import { BAND_WIDEN_STEP, OPPONENT_SEATS, STRENGTH_BANDS, bandSteps, inStrengthBand, seatableRuns, strengthBandForDivision, widenBand } from './strengthBands';

/**
 * MATCHMAKING BANDS (R-LOBBY-09, owner 2026-09-30): "serve for example 0-30 for bronze, 10-40 in silver, 20-65 in
 * gold, and then uncap plat", then "maybe plat should be 50 and then diamond is like 55 average and ascendant is 60
 * average? i dont want every game to just be insanely sweaty and unwinnable". Registers into the module-global pool, so it lives in its own file.
 */

const HEROES = playableHeroes().map((h) => h.id);
const snap = (author: string, heroId: string, seed: number, wave: number, strength?: number, ownerId?: string): BoardSnapshot => ({
  v: 1, wave, heroId, resolve: 30, tier: Math.min(6, 1 + Math.floor(wave / 3)), triples: 0, tribes: [], threat: 'glass',
  power: wave * 10, seed, origin: 'self', author, setId: 'set1', ...(ownerId ? { ownerId } : {}),
  ...(strength !== undefined ? { runStrength: strength } : {}),
  minions: [{ cardId: 'pack', attack: wave, health: wave, keywords: [], golden: false }],
} as unknown as BoardSnapshot);
const run = (author: string, heroId: string, seed: number, strength?: number, ownerId?: string): BoardSnapshot[] =>
  Array.from({ length: 8 }, (_, i) => snap(author, heroId, seed, i + 1, strength, ownerId));

afterEach(() => { OPPONENT_POOL.length = 0; });
it('has enough distinct heroes for these tables', () => { expect(HEROES.length).toBeGreaterThanOrEqual(20); });

describe('the bands', () => {
  it('every division of a medal shares its band: Bronze 0-30, Silver 10-40, Gold 15-65, Platinum 15-100, Diamond 25-100, Ascendant 35-100 (owner 2026-10-03)', () => {
    for (let d = 0; d < rankDivisionCount(); d++) expect(strengthBandForDivision(d), `division ${d}`).toEqual(STRENGTH_BANDS[medalOf(d)]);
    expect(STRENGTH_BANDS.Bronze).toEqual({ min: 0, max: 30 });
    expect(STRENGTH_BANDS.Silver).toEqual({ min: 10, max: 40 });
    expect(STRENGTH_BANDS.Gold).toEqual({ min: 15, max: 65 });
    expect(STRENGTH_BANDS.Platinum).toEqual({ min: 15, max: 100 });
    expect(STRENGTH_BANDS.Diamond).toEqual({ min: 25, max: 100 });
    expect(STRENGTH_BANDS.Ascendant).toEqual({ min: 35, max: 100 });
    expect(RANK_MEDALS).toEqual(['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Ascendant']);
  });

  it('widens by 10 on each capped side until uncapped', () => {
    expect(BAND_WIDEN_STEP).toBe(10);
    expect(bandSteps({ min: 0, max: 30 })).toEqual([{ min: 0, max: 30 }, { min: 0, max: 40 }, { min: 0, max: 50 }, { min: 0, max: 60 }, { min: 0, max: 70 }, { min: 0, max: 80 }, { min: 0, max: 90 }, null]);
    expect(bandSteps({ min: 20, max: 65 })).toEqual([{ min: 20, max: 65 }, { min: 10, max: 75 }, { min: 0, max: 85 }, { min: 0, max: 95 }, null]);
    // Diamond and Ascendant have only a floor: widening lowers it by 10 a step.
    expect(bandSteps({ min: 20, max: 100 })).toEqual([{ min: 20, max: 100 }, { min: 10, max: 100 }, null]);
    expect(bandSteps({ min: 10, max: 100 })).toEqual([{ min: 10, max: 100 }, null]);
    // The 2026-10-03 bands: Gold 15-65, and the floor-only Platinum / Diamond / Ascendant.
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
  const strengthsOf = (seed: number, band: { min: number; max: number } | null) => {
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
});
