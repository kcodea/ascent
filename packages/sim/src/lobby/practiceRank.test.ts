import { afterEach, describe, expect, it } from 'vitest';
import type { BoardSnapshot } from '../snapshot';
import { OPPONENT_POOL, registerOpponentRuns } from '../opponents';
import { playableHeroes } from '../heroes';
import { DEFAULT_PRACTICE_CONFIG, type PracticeConfig, type PracticeRank } from '../state';
import { godPracticeConfig } from '../godMode';
import { createLobbyRun, createRunLobby, resetLobbyDrivers, type RunLobby } from './runLobby';
import { PRACTICE_RANKS, STRENGTH_BANDS, normalizePracticeRank, practiceStrengthBand, sameBand } from './strengthBands';

/**
 * PRACTICE "OPPONENT RANK" (owner 2026-10-13, R-PRACTICE-RANK-01): "when playing in practice mode, can we add an option
 * to select what rank the snapshots they face are in? this should be exactly what is already in place with what
 * snapshots a bronze vs silver vs gold player can face", then "we'd just add buttons that says All Ranks, Bronze,
 * Silver, Gold, Platinum". Registers into the module-global pool, so it lives in its own file.
 */

const SET = 'set1' as const;
const HEROES = playableHeroes().map((h) => h.id);
/** The player's hero: not one a pool run below is on (a table never seats one hero twice). */
const ME = HEROES[HEROES.length - 1]!;
const snap = (author: string, heroId: string, seed: number, wave: number, strength: number, ownerId: string, el: { early: number; late: number }): BoardSnapshot => ({
  v: 1, wave, heroId, resolve: 30, tier: Math.min(6, 1 + Math.floor(wave / 3)), triples: 0, tribes: [], threat: 'glass',
  power: wave * 10, seed, origin: 'self', author, setId: SET, ownerId,
  runStrength: strength, runStrengthEarly: el.early, runStrengthLate: el.late,
  minions: [{ cardId: 'pack', attack: wave, health: wave, keywords: [], golden: false }],
} as unknown as BoardSnapshot);
const run = (author: string, heroId: string, seed: number, strength: number, ownerId: string, el: { early: number; late: number }): BoardSnapshot[] =>
  Array.from({ length: 8 }, (_, i) => snap(author, heroId, seed, i + 1, strength, ownerId, el));

/** 20 players, one run each on distinct heroes, spread over the whole scale: weighted strength 5, 10, ... 100, with an
 *  early rating that climbs the same way and a late rating that falls, so the three medals' bands pick different runs. */
function seedPool(): void {
  registerOpponentRuns(HEROES.slice(0, 20).map((h, i) => run(`P${i}`, h, 100 + i, (i + 1) * 5, `u${i}`, { early: (i + 1) * 5, late: 105 - (i + 1) * 5 })));
}
const practice = (rank?: PracticeRank): PracticeConfig => ({ ...DEFAULT_PRACTICE_CONFIG, health: 'normal', ...(rank ? { rank } : {}) });
/** The recorded seats of a table, in seat order: who sat where. */
const seated = (lobby: RunLobby): string[] => {
  resetLobbyDrivers(lobby.seats);
  return lobby.seats.filter((s) => s.kind === 'snapshot').map((s) => `${s.id}:${s.runKey}`);
};

afterEach(() => { OPPONENT_POOL.length = 0; });
it('has a hero for the player that no pool run is on', () => { expect(HEROES.length).toBeGreaterThanOrEqual(21); });

describe('the Opponent Rank choices', () => {
  it('are All Ranks, Bronze, Silver, Gold and Platinum, in that order', () => {
    expect([...PRACTICE_RANKS]).toEqual(['all', 'bronze', 'silver', 'gold', 'platinum']);
  });

  it('a medal is the ranked band of that medal itself, never a copy of its numbers', () => {
    expect(practiceStrengthBand('bronze')).toEqual(STRENGTH_BANDS.Bronze);
    expect(practiceStrengthBand('silver')).toEqual(STRENGTH_BANDS.Silver);
    expect(practiceStrengthBand('gold')).toEqual(STRENGTH_BANDS.Gold);
    // Platinum has no band in ranked, so it has none here: `toEqual` on the table entry, whatever it becomes.
    expect(practiceStrengthBand('platinum')).toEqual(STRENGTH_BANDS.Platinum);
    for (const [rank, medal] of [['bronze', 'Bronze'], ['silver', 'Silver'], ['gold', 'Gold'], ['platinum', 'Platinum']] as const) {
      expect(sameBand(practiceStrengthBand(rank), STRENGTH_BANDS[medal])).toBe(true);
    }
  });

  it('All Ranks is no band, and so is anything that is not one of the five (an older draft or run)', () => {
    expect(practiceStrengthBand('all')).toBeNull();
    for (const raw of [undefined, null, '', 'Bronze', 'diamond', 3, {}]) {
      expect(normalizePracticeRank(raw)).toBe('all');
      expect(practiceStrengthBand(raw)).toBeNull();
    }
    for (const rank of PRACTICE_RANKS) expect(normalizePracticeRank(rank)).toBe(rank);
  });

  it('a new Practice setup starts on All Ranks, and God Mode always plays All Ranks', () => {
    expect(DEFAULT_PRACTICE_CONFIG.rank).toBe('all');
    expect(godPracticeConfig(practice('bronze')).rank).toBe('all');
  });
});

describe('a Practice game set to a rank', () => {
  it('seats exactly the table a rated lobby of that medal seats, seat for seat', () => {
    seedPool();
    for (const [rank, medal] of [['bronze', 'Bronze'], ['silver', 'Silver'], ['gold', 'Gold'], ['platinum', 'Platinum']] as const) {
      for (let seed = 1; seed <= 12; seed++) {
        const rated = createRunLobby(seed, ME, {}, SET, { strengthBand: STRENGTH_BANDS[medal] });
        const ratedSeats = seated(rated);
        const run = createLobbyRun(seed, ME, {}, 'practice', practice(rank), SET);
        expect(seated(run.lobby!), `${rank} seed ${seed}`).toEqual(ratedSeats);
        expect(ratedSeats.length).toBeGreaterThan(0);
        // The table records the band it was drawn from, as a rated one does (none for Platinum).
        expect(run.lobby!.poolAtStart?.band ?? null).toEqual(rated.poolAtStart?.band ?? null);
        expect(run.practiceConfig?.rank).toBe(rank);
        expect(run.mode).toBe('practice');
      }
    }
  });

  it('the three medals draw different tables from one pool (the choice does something)', () => {
    seedPool();
    const tables = (['bronze', 'silver', 'gold', 'all'] as const).map((rank) => seated(createLobbyRun(7, ME, {}, 'practice', practice(rank), SET).lobby!).join(','));
    expect(new Set(tables).size).toBe(4);
  });

  it('a Bronze game never seats a run over the Bronze overall cap, on any seed', () => {
    seedPool();
    const strengthOf = new Map(HEROES.slice(0, 20).map((h, i) => [`P${i}|${h}|${100 + i}`, (i + 1) * 5]));
    const cap = STRENGTH_BANDS.Bronze!.overallCap!;
    for (let seed = 1; seed <= 40; seed++) {
      const lobby = createLobbyRun(seed, ME, {}, 'practice', practice('bronze'), SET).lobby!;
      resetLobbyDrivers(lobby.seats);
      for (const s of lobby.seats.filter((x) => x.kind === 'snapshot')) expect(strengthOf.get(s.runKey!)!).toBeLessThanOrEqual(cap);
    }
  });

  it('All Ranks, and a setup with no rank at all, are Practice as it was: no band, the same table', () => {
    seedPool();
    for (let seed = 1; seed <= 12; seed++) {
      const plain = seated(createRunLobby(seed, ME, {}, SET));
      const all = createLobbyRun(seed, ME, {}, 'practice', practice('all'), SET);
      const none = createLobbyRun(seed, ME, {}, 'practice', practice(), SET);
      expect(seated(all.lobby!)).toEqual(plain);
      expect(seated(none.lobby!)).toEqual(plain);
      expect(all.lobby!.poolAtStart?.band).toBeUndefined();
    }
  });

  it('a rated lobby never reads a Practice rank: only the band it is handed', () => {
    seedPool();
    const plain = seated(createRunLobby(4, ME, {}, SET));
    expect(seated(createLobbyRun(4, ME, {}, 'lobby', practice('bronze'), SET).lobby!)).toEqual(plain);
  });
});

describe('runs fetched for another rank are passed over (excludeRuns)', () => {
  it('an excluded run is never seated, and the rest of the draw is untouched', () => {
    seedPool();
    for (let seed = 1; seed <= 20; seed++) {
      const before = createRunLobby(seed, ME, {}, SET);
      const beforeKeys = before.seats.filter((s) => s.kind === 'snapshot').map((s) => s.runKey!);
      resetLobbyDrivers(before.seats);
      const gone = new Set(beforeKeys.slice(0, 3));
      const after = createRunLobby(seed, ME, {}, SET, { excludeRuns: gone });
      const afterKeys = after.seats.filter((s) => s.kind === 'snapshot').map((s) => s.runKey!);
      resetLobbyDrivers(after.seats);
      for (const k of afterKeys) expect(gone.has(k)).toBe(false);
      expect(afterKeys.length).toBe(7); // 17 runs are left: the table is still full of recorded seats
      // The runs that were seated and not excluded still are, in the same order.
      expect(afterKeys.filter((k) => beforeKeys.includes(k))).toEqual(beforeKeys.filter((k) => !gone.has(k)));
    }
  });

  it('none, or an empty set, is the selection of before, seat for seat', () => {
    seedPool();
    for (let seed = 1; seed <= 12; seed++) {
      const plain = seated(createRunLobby(seed, ME, {}, SET, { strengthBand: STRENGTH_BANDS.Silver }));
      expect(seated(createRunLobby(seed, ME, {}, SET, { strengthBand: STRENGTH_BANDS.Silver, excludeRuns: new Set() }))).toEqual(plain);
    }
  });

  it('excluding every run leaves generated seats, never an empty table', () => {
    seedPool();
    const all = new Set(HEROES.slice(0, 20).map((h, i) => `P${i}|${h}|${100 + i}`));
    const lobby = createRunLobby(3, ME, {}, SET, { excludeRuns: all });
    resetLobbyDrivers(lobby.seats);
    expect(lobby.seats.length).toBe(8);
    expect(lobby.seats.filter((s) => s.kind === 'snapshot').length).toBe(0);
  });
});
