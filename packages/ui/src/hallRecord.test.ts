import { describe, expect, it } from 'vitest';
import { hallHistoryFor, hallHistoryKeyOf, hallRowsOf, hallRunKeyOf, parseRunKey, recordText, winRateText, type HallFightRecord, type HallOwnFacts } from './leaderboardData';

/**
 * The Hall of Champions rows (owner 2026-09-22): "we want the hall of champions to answer 'what board has been
 * the best against everything else' basically, and what the top 10 are in that category … overall win/loss
 * across games. so a 15 round game may mean it was 12-3". Top 10 by the Wilson lower bound of the win rate, at
 * least 10 fights (owner: "let's start at 10"), every recorded run a candidate.
 */
const rec = (runKey: string, over: Partial<HallFightRecord> = {}): { runKey: string } & HallFightRecord => ({
  runKey, fights: 20, wins: 14, losses: 6, draws: 0, lobbies: 3, winRate: 0.7, wilsonLb: 0.48, lastFightAt: '2026-09-20T10:00:00Z', ...over,
});
type Facts = HallOwnFacts<{ minions: unknown[]; runes?: string[] }>;
const facts = (over: Partial<Facts> = {}): Facts => ({ author: null, heroId: null, rank: null, record: null, placement: null, board: null, ...over });

describe('parseRunKey', () => {
  it('reads author | hero | seed FROM THE RIGHT, so an author name with a pipe in it survives', () => {
    expect(parseRunKey('Mike|warden|1234')).toEqual({ author: 'Mike', heroId: 'warden', seed: 1234 });
    expect(parseRunKey('a|b|warden|1234')).toEqual({ author: 'a|b', heroId: 'warden', seed: 1234 });
    expect(parseRunKey('anon|gorr|7')).toEqual({ author: 'anon', heroId: 'gorr', seed: 7 });
  });
  it('is null for a bot key or anything without a numeric seed', () => {
    expect(parseRunKey('bot:hybrid:warden')).toBeNull();
    expect(parseRunKey('Mike|warden')).toBeNull();
    expect(parseRunKey('Mike|warden|seven')).toBeNull();
    expect(parseRunKey('')).toBeNull();
  });
  it('round-trips the key the reporter is served under', () => {
    const key = hallRunKeyOf({ author: 'Mike', heroId: 'warden', seed: 1234 })!;
    expect(parseRunKey(key)).toEqual({ author: 'Mike', heroId: 'warden', seed: 1234 });
    expect(hallRunKeyOf({ heroId: 'warden', seed: 7 }, 'Nadja')).toBe('Nadja|warden|7');
    expect(hallRunKeyOf({ heroId: 'warden' })).toBeNull();
  });
});

describe('winRateText + recordText', () => {
  it('the raw win rate across everything (a draw is not a win), and the W–L–D with the draw only when there is one', () => {
    expect(winRateText({ wins: 31, fights: 39 })).toBe('79%');
    expect(winRateText({ wins: 12, fights: 15 })).toBe('80%');
    expect(winRateText({ wins: 0, fights: 0 })).toBe('—');
    expect(recordText({ wins: 31, losses: 7, draws: 1 })).toBe('31–7–1');
    expect(recordText({ wins: 12, losses: 3, draws: 0 })).toBe('12–3');
  });
});

describe('hallRowsOf', () => {
  it('ranks by the Wilson lower bound (a 30–2 run above a 3–0 run would be, and a 31–7 above a 12–3), then more fights, then recency', () => {
    const rows = hallRowsOf([
      rec('Kev|sable|8', { fights: 15, wins: 12, losses: 3, wilsonLb: 0.55 }),
      rec('Nadja|brackus|7', { fights: 39, wins: 31, losses: 7, draws: 1, wilsonLb: 0.64 }),
      rec('Robin|gorr|9', { fights: 15, wins: 12, losses: 3, wilsonLb: 0.55, lastFightAt: '2026-09-22T10:00:00Z' }),
      rec('Sam|odelle|10', { fights: 18, wins: 14, losses: 4, wilsonLb: 0.55 }),
    ], new Map(), new Map(), { minFights: 10, limit: 10, sort: 'rate' });
    expect(rows.map((r) => r.key)).toEqual(['Nadja|brackus|7', 'Sam|odelle|10', 'Robin|gorr|9', 'Kev|sable|8']);
    expect(rows[0]!.record).toEqual({ fights: 39, wins: 31, losses: 7, draws: 1, lobbies: 3, winRate: 0.7, wilsonLb: 0.64, lastFightAt: '2026-09-20T10:00:00Z' });
    expect(rows[0]).toMatchObject({ author: 'Nadja', heroId: 'brackus', seed: 7, ownRecord: null, ownPlacement: null, rank: null, board: null });
  });

  it('the 10-fight gate: a 9-0 run is not in the Hall yet; a 10-fight run is', () => {
    const rows = hallRowsOf([rec('A|h|1', { fights: 9, wins: 9, losses: 0, wilsonLb: 0.7 }), rec('B|h|2', { fights: 10, wins: 6, losses: 4, wilsonLb: 0.31 })], new Map(), new Map(), { minFights: 10, limit: 10, sort: 'rate' });
    expect(rows.map((r) => r.key)).toEqual(['B|h|2']);
  });

  it('cuts to the limit (top 10) and drops bot keys and unparseable keys', () => {
    const records = Array.from({ length: 14 }, (_, i) => rec(`P${i}|h|${i}`, { wilsonLb: 1 - i / 100 }));
    records.push(rec('bot:hybrid:gorr', { wilsonLb: 0.99 }), rec('nokey', { wilsonLb: 0.99 }));
    const rows = hallRowsOf(records, new Map(), new Map(), { minFights: 10, limit: 10, sort: 'rate' });
    expect(rows).toHaveLength(10);
    expect(rows.map((r) => r.seed)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('joins the run\'s own career row by its full run key, else the legacy seed row (guarded by hero): own record 12–3, its placement, the rank held, its board; falls back to a pool board', () => {
    const own = { minions: [{}, {}], runes: ['rune_x'] };
    const pool = new Map([['Kev|sable|8', { minions: [{}], runes: [] }]]);
    const history = new Map([
      ['Nadja|brackus|7', facts({ author: 'Nadja', heroId: 'brackus', rank: { divisionIndex: 4, points: 12 }, record: { wins: 12, losses: 3, draws: 0 }, placement: 1, board: own })],
      ['seed:8', facts({ heroId: 'sable', record: { wins: 9, losses: 5, draws: 0 }, placement: 3, board: null })],           // an older row, no author
      ['seed:9', facts({ heroId: 'warden', record: { wins: 1, losses: 1, draws: 0 }, placement: 8, board: own })], // a different hero on that seed: never joined
    ]);
    const rows = hallRowsOf([rec('Nadja|brackus|7'), rec('Kev|sable|8', { wilsonLb: 0.4 }), rec('Robin|gorr|9', { wilsonLb: 0.3 })], history, pool, { minFights: 10, limit: 10, sort: 'rate' });
    expect(rows[0]).toMatchObject({ ownRecord: { wins: 12, losses: 3, draws: 0 }, ownPlacement: 1, rank: { divisionIndex: 4, points: 12 }, board: own });
    expect(rows[1]).toMatchObject({ ownRecord: { wins: 9, losses: 5, draws: 0 }, ownPlacement: 3, rank: null, board: { minions: [{}], runes: [] } });
    expect(rows[2]).toMatchObject({ ownRecord: null, ownPlacement: null, rank: null, board: null });
  });

  it('two players who played the SAME shared seed with the same hero each join THEIR OWN row, never the first one returned (review fix 2026-09-22)', () => {
    const kevBoard = { minions: [{}, {}, {}], runes: ['rune_k'] };
    const mikeBoard = { minions: [{}], runes: ['rune_m'] };
    const history = new Map([
      [hallHistoryKeyOf('Kev', 'sable', 8), facts({ author: 'Kev', heroId: 'sable', record: { wins: 12, losses: 3, draws: 0 }, placement: 1, rank: { divisionIndex: 9, points: 30 }, board: kevBoard })],
      [hallHistoryKeyOf('Mike', 'sable', 8), facts({ author: 'Mike', heroId: 'sable', record: { wins: 4, losses: 6, draws: 0 }, placement: 6, rank: { divisionIndex: 2, points: 80 }, board: mikeBoard })],
    ]);
    expect(hallHistoryKeyOf('Kev', 'sable', 8)).toBe('Kev|sable|8');
    expect(hallHistoryKeyOf(null, 'sable', 8)).toBe('seed:8');
    expect(hallHistoryKeyOf('Kev', null, 8)).toBe('seed:8');
    const rows = hallRowsOf([rec('Mike|sable|8', { wilsonLb: 0.6 }), rec('Kev|sable|8', { wilsonLb: 0.5 })], history, new Map(), { minFights: 10, limit: 10, sort: 'rate' });
    expect(rows[0]).toMatchObject({ author: 'Mike', ownRecord: { wins: 4, losses: 6, draws: 0 }, ownPlacement: 6, rank: { divisionIndex: 2, points: 80 }, board: mikeBoard });
    expect(rows[1]).toMatchObject({ author: 'Kev', ownRecord: { wins: 12, losses: 3, draws: 0 }, ownPlacement: 1, rank: { divisionIndex: 9, points: 30 }, board: kevBoard });
    // A stamped row never answers for a different author on the same seed + hero; a legacy row still does when the hero agrees.
    expect(hallHistoryFor(history, 'Robin|sable|8')).toBeUndefined();
    const legacy = new Map([['seed:8', facts({ heroId: 'sable', placement: 4 })]]);
    expect(hallHistoryFor(legacy, 'Robin|sable|8')?.placement).toBe(4);
    expect(hallHistoryFor(legacy, 'Robin|warden|8')).toBeUndefined();
    expect(hallHistoryFor(legacy, 'bot:hybrid:sable')).toBeUndefined();
  });

  it('Most recent orders by the last fight, newest first', () => {
    const rows = hallRowsOf([
      rec('A|h|1', { lastFightAt: '2026-09-10T00:00:00Z' }),
      rec('B|h|2', { lastFightAt: '2026-09-22T00:00:00Z' }),
      rec('C|h|3', { lastFightAt: null }),
    ], new Map(), new Map(), { minFights: 10, limit: 10, sort: 'recent' });
    expect(rows.map((r) => r.key)).toEqual(['B|h|2', 'A|h|1', 'C|h|3']);
  });
});
