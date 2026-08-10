import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * VIEWING ANOTHER PLAYER'S CAREER from the leaderboard (owner ask 2026-08-04).
 *
 * The whole feature turns on ONE thing: fetching a career by a `user_id` that is not yours. Two rules make
 * that safe to get wrong, and both are pinned here:
 *
 *  1. **Look up by `user_id`, never by `author`.** The display name is mutable and not unique — the exact
 *     mistake the C1 accounts work existed to fix, where renaming yourself to someone else's name inherited
 *     their leaderboard slot. So `fetchTopPlayers` must carry `user_id` through, and the Career must key on it.
 *  2. **Your OWN fetch still requires a session.** A foreign fetch only needs the id it was handed, but an
 *     un-identified client asking for "my career" must get null (couldn't ask), not [] (no runs) — the caller
 *     distinguishes those, and conflating them once clobbered a profile's games-played with a zero.
 */

interface Query { table: string; select?: string; eqs: [string, unknown][] }

const queries: Query[] = [];
let rows: unknown[] = [];
let userId: string | null = 'me-1';

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
        gt: () => chain, // fetchTopPlayers filters `games_played > 0` (leaderboard omits 0-game rows)
        order: () => chain,
        limit: () => Promise.resolve({ data: rows, error: null }),
        then: (res: (v: unknown) => unknown) => res({ data: rows, error: null }),
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

beforeEach(() => { queries.length = 0; rows = []; userId = 'me-1'; vi.resetModules(); });

describe('the leaderboard carries the id a career is fetched by', () => {
  it('selects user_id, and surfaces it on the row', async () => {
    rows = [{ user_id: 'them-9', author: 'LazerLemon', rating: 455, games_played: 3, favorite_hero: 'gildmaster' }];
    const players = await (await load()).fetchTopPlayers(10);
    const profileQuery = queries.find((q) => q.table === 'profiles');
    expect(profileQuery?.select, 'without user_id in the SELECT the row cannot open a career').toContain('user_id');
    expect(players[0]).toMatchObject({ userId: 'them-9', author: 'LazerLemon', rating: 455, gamesPlayed: 3 });
  });
});

describe('fetching a career', () => {
  it('reads MY rows when no target is given', async () => {
    await (await load()).fetchRunHistory(50);
    const q = queries.find((x) => x.table === 'run_history');
    expect(q?.eqs).toContainEqual(['user_id', 'me-1']);
  });

  it('reads THEIR rows when a target is given — by user_id, never by name', async () => {
    await (await load()).fetchRunHistory(50, 'them-9');
    const q = queries.find((x) => x.table === 'run_history');
    expect(q?.eqs).toContainEqual(['user_id', 'them-9']);
    expect(q?.eqs.some(([col]) => col === 'author'), 'author is a mutable display name — never a lookup key')
      .toBe(false);
  });

  it('a foreign career is still fetchable with no session of my own', async () => {
    // Opening a leaderboard career must not depend on being signed in — only on the id we were handed.
    userId = null;
    await (await load()).fetchRunHistory(50, 'them-9');
    expect(queries.find((x) => x.table === 'run_history')?.eqs).toContainEqual(['user_id', 'them-9']);
  });

  it('MY career with no session returns null (could not ask), not [] (no runs)', async () => {
    userId = null;
    await expect((await load()).fetchRunHistory(50)).resolves.toBeNull();
    expect(queries.some((x) => x.table === 'run_history'), 'it should not even ask').toBe(false);
  });
});
