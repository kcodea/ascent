/**
 * RECENT GAMES PRACTICE TAB (owner ask 2026-09-24) — the data half, against a mocked Supabase client:
 *  - `fetchPracticeGames` / `asPracticeGameRow`: reads ONLY `practice_games` (never a ladder table), maps the
 *    practice options, never offers a replay; `[]` when the table does not exist yet (pre-migration);
 *  - `uploadPracticeGame`: inserts into `practice_games` alone, and not at all without a session;
 *  - `practiceGameOf`: the placement the practice end screen shows, the record, the length and the options.
 * THE CAREER PRACTICE TAB + PRACTICE REPLAYS (owner 2026-09-27, R-CAREER-PRACTICE-01):
 *  - `fetchMyPracticeGames`: ONE player's rows, filtered by `user_id` server-side; `[]` without a user id, `null`
 *    when the read fails (the tab's Retry);
 *  - the lists probe `replay->v2->version` only (never the payload) and fall back to a select without it on a
 *    backend that has not run the `replay` migration; `hasReplay` = that probe is 2;
 *  - `uploadPracticeGame` sends the replay, and retries WITHOUT it on an unknown-column error so the result
 *    still records; `fetchPracticeReplay` reads one row's `replay->v2` by id.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLobbyRun, DEFAULT_PRACTICE_CONFIG, type RunState } from '@game/sim';
import { practiceGameOf } from './practiceGames';

interface Query { table: string; select?: string; eqs: [string, unknown][]; limit?: number; insert?: unknown[] }

const queries: Query[] = [];
let userId: string | null = 'me-1';
let respond: (q: Query) => { data: unknown[] | null; error: unknown } = () => ({ data: [], error: null });

vi.stubEnv('VITE_SUPABASE_URL', 'http://test.local');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key');

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const q: Query = { table, eqs: [] };
      queries.push(q);
      const chain = {
        select: (sel: string) => { q.select = sel; return chain; },
        eq: (col: string, val: unknown) => { q.eqs.push([col, val]); return chain; },
        order: () => chain,
        limit: (n: number) => { q.limit = n; return Promise.resolve(respond(q)); },
        // `insert(rows)` is awaitable on its own AND chains `.select('id')` (return=representation), like supabase-js.
        insert: (rows: unknown[]) => {
          q.insert = rows;
          return Object.assign(Promise.resolve(respond(q)), { select: (sel: string) => { q.select = sel; return Promise.resolve(respond(q)); } });
        },
      };
      return chain;
    },
  }),
}));

vi.mock('./identity', () => ({
  currentUserId: () => userId,
  currentIdentity: () => (userId ? { userId, displayName: '', anonymous: true } : null),
  setIdentity: () => {},
}));

const load = async () => await import('./remoteBoards');
vi.setConfig({ testTimeout: 30000 });

beforeEach(() => { queries.length = 0; userId = 'me-1'; respond = () => ({ data: [], error: null }); vi.resetModules(); });

const PRACTICE_ROW = {
  id: 5, user_id: 'u-top', author: 'Nadja', hero_id: 'brackus', wins: 7, placement: 3, created_at: '2026-09-24T10:00:00Z',
  picked_runes: ['rune_spellslinging'], record: { wins: 7, losses: 6, draws: 1 }, wave: 15, duration_ms: 1_200_000,
  final_board: { minions: [{ cardId: 'alleycat', attack: 3, health: 3 }], runes: [] },
  config: { opponents: 'bots', botDifficulty: 5, health: 'unlimited' },
};

describe('fetchPracticeGames / asPracticeGameRow', () => {
  it('reads practice_games only, newest first, and maps the practice options; never offers a replay', async () => {
    respond = () => ({ data: [PRACTICE_ROW], error: null });
    const rows = await (await load()).fetchPracticeGames(20);
    expect(queries.map((q) => q.table)).toEqual(['practice_games']);
    expect(queries[0]!.limit).toBe(20);
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r).toMatchObject({ userId: 'u-top', author: 'Nadja', heroId: 'brackus', placement: 3, rowId: 5, hasReplay: false, wave: 15, durationMs: 1_200_000, runes: ['rune_spellslinging'] });
    expect(r.record).toEqual({ wins: 7, losses: 6, draws: 1 });
    expect(r.board?.minions).toHaveLength(1);
    expect(r.practice).toEqual({ opponents: 'bots', botDifficulty: 5, health: 'unlimited' });
  });
  it('a sparse row maps without throwing (no options, no board, no length)', async () => {
    const r = (await load()).asPracticeGameRow({ id: 1, hero_id: 'sable', wins: 0 });
    expect(r.practice).toBeNull();
    expect(r.board).toBeNull();
    expect(r.durationMs).toBeNull();
    expect(r.placement).toBeNull();
  });
  it('R-MATCH-LENGTH-01: the replay probe\'s active time is the length; a legacy duration_ms shows up to 35 min, "35+" past it', async () => {
    const m = await load();
    expect(m.asPracticeGameRow({ ...PRACTICE_ROW, wave: 16, duration_ms: 246 * 60_000, active_ms: '1860000' }).durationMs).toBe(1_860_000);
    expect(m.asPracticeGameRow({ ...PRACTICE_ROW, wave: 16, duration_ms: 246 * 60_000 }).durationMs).toBeNull();
    expect(m.asPracticeGameRow({ ...PRACTICE_ROW, wave: 16, duration_ms: 246 * 60_000 }).lengthOverCap).toBe(true);
    expect(m.asPracticeGameRow({ ...PRACTICE_ROW, wave: 16, duration_ms: 31 * 60_000 }).durationMs).toBe(31 * 60_000);
  });
  it('pre-migration (the table does not exist yet) reads as an empty list', async () => {
    respond = () => ({ data: null, error: { code: 'PGRST205' } });
    expect(await (await load()).fetchPracticeGames()).toEqual([]);
  });
});

describe('uploadPracticeGame', () => {
  const g = { author: 'Kev', patch: 'p', heroId: 'sable', placement: 2, wins: 5, record: { wins: 5, losses: 4, draws: 0 }, wave: 12, finalBoard: null, runes: [], durationMs: 60_000, config: { opponents: 'players' as const, botDifficulty: 3, health: 'normal' as const } };
  it('inserts ONE row into practice_games, owned by the session, and touches no ladder table', async () => {
    await (await load()).uploadPracticeGame(g);
    expect(queries.map((q) => q.table)).toEqual(['practice_games']);
    expect(queries[0]!.insert).toEqual([expect.objectContaining({ user_id: 'me-1', hero_id: 'sable', placement: 2, wins: 5, wave: 12, duration_ms: 60_000, config: g.config })]);
  });
  it('without a session it is dropped (no insert, no queue)', async () => {
    userId = null;
    expect(await (await load()).uploadPracticeGame(g)).toBeNull();
    expect(queries).toHaveLength(0);
  });
  it('resolves to the new row id (the practice XP source), or null when nothing was recorded', async () => {
    respond = () => ({ data: [{ id: 77 }], error: null });
    expect(await (await load()).uploadPracticeGame(g)).toBe(77);
    expect(queries[0]!.select).toBe('id');
    respond = () => ({ data: null, error: { code: '22P02', message: 'bad' } });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await (await load()).uploadPracticeGame(g)).toBeNull();
    err.mockRestore();
    respond = () => ({ data: [], error: null });
    expect(await (await load()).uploadPracticeGame(g)).toBeNull();
  });
});

describe('fetchMyPracticeGames (the Career Practice tab)', () => {
  it('reads practice_games filtered by THIS user id, newest first, and maps the rows', async () => {
    respond = () => ({ data: [{ ...PRACTICE_ROW, user_id: 'me-1', replay_v2_version: 2 }], error: null });
    const rows = await (await load()).fetchMyPracticeGames('me-1', 25);
    expect(queries.map((q) => q.table)).toEqual(['practice_games']);
    expect(queries[0]!.eqs).toEqual([['user_id', 'me-1']]);
    expect(queries[0]!.limit).toBe(25);
    expect(rows).toHaveLength(1);
    expect(rows![0]).toMatchObject({ userId: 'me-1', rowId: 5, hasReplay: true, practice: { opponents: 'bots', botDifficulty: 5, health: 'unlimited' } });
  });
  it('without a user id there is nothing to ask ([] and no query); a failed read is null (the Retry), not "no games"', async () => {
    expect(await (await load()).fetchMyPracticeGames(null)).toEqual([]);
    expect(queries).toHaveLength(0);
    respond = () => ({ data: null, error: { code: '500' } });
    expect(await (await load()).fetchMyPracticeGames('me-1')).toBeNull();
  });
});

describe('practice replays (owner 2026-09-27)', () => {
  it('the list probes replay->v2->version only, never the payload; hasReplay = a v2 probe on a row with an id', async () => {
    respond = () => ({ data: [{ ...PRACTICE_ROW, replay_v2_version: 2 }, { ...PRACTICE_ROW, id: 6, replay_v2_version: null }], error: null });
    const rows = await (await load()).fetchPracticeGames(20);
    // The precomputed replay-facts column first (2026-10-09): the replay itself is never opened by a list read.
    expect(queries[0]!.select).toContain('replay_v2_version:tp_v2_version');
    expect(queries[0]!.select).not.toMatch(/replay->|frames/);
    expect(rows.map((r) => r.hasReplay)).toEqual([true, false]);
  });
  it('a backend without the replay column falls back to the plain select (rows, no Watch)', async () => {
    respond = (q) => (q.select?.includes('replay') ? { data: null, error: { code: '42703' } } : { data: [PRACTICE_ROW], error: null });
    const rows = await (await load()).fetchMyPracticeGames('me-1');
    expect(queries).toHaveLength(3); // the facts columns, the JSON-path probe, then the plain select
    expect(queries[1]!.select).toContain('replay_v2_version:replay->v2->version');
    expect(queries[2]!.select).not.toContain('replay');
    expect(rows).toHaveLength(1);
    expect(rows![0]!.hasReplay).toBe(false);
  });
  const replay = { seed: 42, heroId: 'sable', mode: 'practice', actions: [{ type: 'roll' }], v2: { version: 2, seed: 42, heroId: 'sable', frames: [], result: { placement: 2 } } as never };
  const g = { author: 'Kev', patch: 'p', heroId: 'sable', placement: 2, wins: 5, record: { wins: 5, losses: 4, draws: 0 }, wave: 12, finalBoard: null, runes: [], durationMs: 60_000, config: { opponents: 'bots' as const, botDifficulty: 6, health: 'unlimited' as const }, replay };
  it('the upload carries the replay payload (the action log + v2), the same shape a ranked row uploads', async () => {
    await (await load()).uploadPracticeGame(g);
    expect(queries).toHaveLength(1);
    expect(queries[0]!.insert).toEqual([expect.objectContaining({ user_id: 'me-1', config: g.config, replay })]);
  });
  it('no replay column yet (42703 / PGRST204): the result row is retried WITHOUT the replay, so it still records', async () => {
    for (const code of ['42703', 'PGRST204']) {
      queries.length = 0;
      respond = (q) => (q.insert && 'replay' in (q.insert[0] as object) ? { data: null, error: { code } } : { data: [], error: null });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      await (await load()).uploadPracticeGame(g);
      expect(queries).toHaveLength(2);
      expect(queries[1]!.insert).toEqual([expect.objectContaining({ user_id: 'me-1', hero_id: 'sable', placement: 2 })]);
      expect('replay' in (queries[1]!.insert![0] as object)).toBe(false);
      expect(warn).toHaveBeenCalled();
      expect(err).not.toHaveBeenCalled();
      warn.mockRestore(); err.mockRestore();
    }
  });
  it('any other rejection is NOT retried (it is logged)', async () => {
    respond = () => ({ data: null, error: { code: '22P02', message: 'bad' } });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await (await load()).uploadPracticeGame(g);
    expect(queries).toHaveLength(1);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
  it('fetchPracticeReplay reads ONE row\'s replay->v2 by id from practice_games; a malformed payload is null', async () => {
    const v2 = { version: 2, seed: 42, heroId: 'sable', mode: 'practice', frames: [{ tMs: 0 }], result: { placement: 2, record: { wins: 1, losses: 0, draws: 0 }, finalBoard: null } };
    respond = () => ({ data: [{ v2 }], error: null });
    const got = await (await load()).fetchPracticeReplay(5);
    expect(queries.map((q) => [q.table, q.select])).toEqual([['practice_games', 'v2:replay->v2']]);
    expect(queries[0]!.eqs).toEqual([['id', 5]]);
    expect(got).toMatchObject({ version: 2, seed: 42 });
    respond = () => ({ data: [{ v2: { version: 1 } }], error: null });
    expect(await (await load()).fetchPracticeReplay(5)).toBeNull();
  });
});

describe('practiceGameOf', () => {
  const run = (over: Partial<RunState> = {}): RunState => ({ ...createLobbyRun(42, 'brackus', {}, 'practice', { ...DEFAULT_PRACTICE_CONFIG, opponents: 'bots', botDifficulty: 7 }), ...over });
  it('R-MATCH-LENGTH-01: the stored length is the ACTIVE play time, never the wall-clock frame span', () => {
    const r = run({ wave: 16 });
    const frames = [{ tMs: 0 }, { tMs: 246 * 60_000 }];
    expect(practiceGameOf(r, { author: 'Kev', patch: 'p', finalBoard: null, frames, activeMs: 1_860_000.4 }).durationMs).toBe(1_860_000);
    // Unknown active time (resumed from a pre-clock save): the raw span is stored; its replay has no activeMs, so
    // the reader treats it as legacy and prints "35+ min".
    expect(practiceGameOf(r, { author: 'Kev', patch: 'p', finalBoard: null, frames, activeMs: null }).durationMs).toBe(246 * 60_000);
  });
  it('placement = the seat’s stamped placement, record from the history, length from the frame clocks, the options', () => {
    const r = run({ wave: 9, history: ['win', 'lose', 'win', 'win', 'lose', 'draw', 'win', 'win', 'lose'] });
    r.lobby!.seats.find((s) => s.id === 's0')!.placement = 4;
    const row = practiceGameOf(r, { author: 'Kev', patch: 'p', finalBoard: null, frames: [{ tMs: 1000 }, { tMs: 5000 }, { tMs: 61_000 }] });
    expect(row.placement).toBe(4);
    expect(row.heroId).toBe('brackus');
    expect(row.wave).toBe(9);
    expect(row.wins).toBe(row.record.wins);
    expect(row.durationMs).toBe(60_000);
    expect(row.config).toEqual({ opponents: 'bots', botDifficulty: 7, health: 'unlimited', timeMult: 1 });
    expect(row.runes).toEqual([]);
  });
  it('the length is WHOLE milliseconds: the frame clock is fractional and duration_ms is an int column (2026-09-27)', () => {
    // A fractional length (23031.7) made Postgres reject every practice row with 22P02, so nothing ever recorded.
    const row = practiceGameOf(run(), { author: null, patch: 'p', finalBoard: null, frames: [{ tMs: 1000.25 }, { tMs: 24031.95 }] });
    expect(row.durationMs).toBe(23032);
    expect(Number.isInteger(row.durationMs)).toBe(true);
  });
  it('an unplaced seat (the round-15 curtain on unlimited Health) reads the standing count, as the end screen does', () => {
    const r = run({ wave: 15 });
    const standing = r.lobby!.seats.filter((s) => s.alive).length;
    const row = practiceGameOf(r, { author: null, patch: 'p', finalBoard: null, frames: [] });
    expect(row.placement).toBe(standing);
    expect(row.durationMs).toBeNull(); // no frames, no length
  });
  it('a default-options practice run (no pinned config) records the default options', () => {
    const r = run();
    delete r.practiceConfig;
    expect(practiceGameOf(r, { author: null, patch: 'p', finalBoard: null, frames: [] }).config).toEqual({ opponents: 'players', botDifficulty: 3, health: 'unlimited', timeMult: 1 });
  });
  it('records the turn timer (achievements 2026-09-28: a no-timer Practice never counts for "any game" feats)', () => {
    const r = run();
    r.practiceConfig = { ...r.practiceConfig!, health: 'normal', timeMult: 0 };
    expect(practiceGameOf(r, { author: null, patch: 'p', finalBoard: null, frames: [] }).config).toMatchObject({ health: 'normal', timeMult: 0 });
  });
});
