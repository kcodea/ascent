import { describe, expect, it } from 'vitest';
import { hallRecordOf, hallRunKeyOf, recordText } from './leaderboardData';

/**
 * The Hall of Champions record (owner 2026-09-22): "if i win a game and it gets served 30 times and wins 19, it
 * should show an overall record of 20-10 … i want to see what player's run basically wins the most times."
 * A run's wins are the lobby it won for its builder, plus every player it knocked out when served as a recorded
 * seat. Every time it was knocked out while that player still stood is a loss.
 */
describe('hallRecordOf', () => {
  it("adds the run's own victory to the tables its seat has won: served 30 times, 19 wins, 11 losses → 20–11", () => {
    const rec = hallRecordOf({ wins: 19, losses: 11 });
    expect(rec).toEqual({ wins: 20, losses: 11, games: 31 });
    expect(recordText(rec)).toBe('20–11');
  });

  it("the owner's own example, read as 30 games in all: 19 seat wins + the builder's win, 10 losses → 20–10", () => {
    expect(recordText(hallRecordOf({ wins: 19, losses: 10 }))).toBe('20–10');
  });

  it('a run nobody has been served yet reads 1–0, not as missing data', () => {
    expect(hallRecordOf(undefined)).toEqual({ wins: 1, losses: 0, games: 1 });
    expect(recordText(hallRecordOf(undefined))).toBe('1–0');
  });

  it('a run served but never winning a table keeps its one victory: 0 wins, 4 losses → 1–4', () => {
    expect(recordText(hallRecordOf({ wins: 0, losses: 4 }))).toBe('1–4');
  });

  it('has no draw column: a lobby has exactly one winner', () => {
    expect(Object.keys(hallRecordOf({ wins: 2, losses: 3 })).sort()).toEqual(['games', 'losses', 'wins']);
  });
});

describe('hallRunKeyOf', () => {
  it('builds author|heroId|seed, the key playerRunsFrom serves a recorded run under', () => {
    expect(hallRunKeyOf({ author: 'Mike', heroId: 'warden', seed: 1234 })).toBe('Mike|warden|1234');
  });

  it('falls back to anon for an unsigned board, exactly like the pool grouping', () => {
    expect(hallRunKeyOf({ heroId: 'warden', seed: 7 })).toBe('anon|warden|7');
  });

  it("uses the victory row's author when the stored board carries none, and never over the board's own", () => {
    expect(hallRunKeyOf({ heroId: 'warden', seed: 7 }, 'Nadja')).toBe('Nadja|warden|7');
    expect(hallRunKeyOf({ author: 'Mike', heroId: 'warden', seed: 7 }, 'Nadja')).toBe('Mike|warden|7');
  });

  it('is null for a board with no usable seed (never served as a seat, nothing to look up)', () => {
    expect(hallRunKeyOf({ heroId: 'warden' })).toBeNull();
    expect(hallRunKeyOf({ heroId: 'warden', seed: Number.NaN })).toBeNull();
    expect(hallRunKeyOf(null)).toBeNull();
    expect(hallRunKeyOf(undefined)).toBeNull();
  });
});
