/**
 * RECENT GAMES PRACTICE TAB (owner ask 2026-09-24) — the data half, against a mocked Supabase client:
 *  - `fetchPracticeGames` / `asPracticeGameRow`: reads ONLY `practice_games` (never a ladder table), maps the
 *    practice options, never offers a replay; `[]` when the table does not exist yet (pre-migration);
 *  - `uploadPracticeGame`: inserts into `practice_games` alone, and not at all without a session;
 *  - `practiceGameOf`: the placement the practice end screen shows, the record, the length and the options.
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
        insert: (rows: unknown[]) => { q.insert = rows; return Promise.resolve(respond(q)); },
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
    await (await load()).uploadPracticeGame(g);
    expect(queries).toHaveLength(0);
  });
});

describe('practiceGameOf', () => {
  const run = (over: Partial<RunState> = {}): RunState => ({ ...createLobbyRun(42, 'brackus', {}, 'practice', { ...DEFAULT_PRACTICE_CONFIG, opponents: 'bots', botDifficulty: 7 }), ...over });
  it('placement = the seat’s stamped placement, record from the history, length from the frame clocks, the options', () => {
    const r = run({ wave: 9, history: ['win', 'lose', 'win', 'win', 'lose', 'draw', 'win', 'win', 'lose'] });
    r.lobby!.seats.find((s) => s.id === 's0')!.placement = 4;
    const row = practiceGameOf(r, { author: 'Kev', patch: 'p', finalBoard: null, frames: [{ tMs: 1000 }, { tMs: 5000 }, { tMs: 61_000 }] });
    expect(row.placement).toBe(4);
    expect(row.heroId).toBe('brackus');
    expect(row.wave).toBe(9);
    expect(row.wins).toBe(row.record.wins);
    expect(row.durationMs).toBe(60_000);
    expect(row.config).toEqual({ opponents: 'bots', botDifficulty: 7, health: 'unlimited' });
    expect(row.runes).toEqual([]);
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
    expect(practiceGameOf(r, { author: null, patch: 'p', finalBoard: null, frames: [] }).config).toEqual({ opponents: 'players', botDifficulty: 3, health: 'unlimited' });
  });
});
