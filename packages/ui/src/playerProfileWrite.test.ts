import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * THE LEADERBOARD FROZE AT ONE GAME.
 *
 * `profiles` is written with `user_id` as the conflict key, and the C1 RLS policy makes `rating` WRITE-ONCE
 * from the client: its `with check` requires the incoming rating to equal the row's currently stored value.
 *
 * A single `upsert()` sends EVERY column. So the moment a player's rating moved, the incoming rating no longer
 * matched the stored one and Postgres rejected the whole row — not just the rating. `games_played`, `author`
 * and `favorite_hero` all froze at their first-insert values, and the rejection was swallowed by the
 * best-effort catch. That is the owner's report (2026-08-04): the leaderboard read "1 game" for a player whose
 * Career listed four runs. The count was never computed wrong; it was never written after run one.
 *
 * The fix splits the write: UPDATE the mutable columns WITHOUT rating (leaving it equal to itself, which the
 * policy permits), and INSERT — which may set rating — only when no row exists yet.
 *
 * THEN THE LEADERBOARD FROZE AGAIN — at the rating this time (owner report 2026-08-06). The write-once policy
 * deferred rating movement to a "C3 Edge Function" that was never built, so NO path could move a stored
 * rating at all. The third leg of the shape: after a successful UPDATE, rating travels through the
 * `submit_own_rating` RPC (a security-definer function scoped to the caller's own row — schema.sql
 * 2026-08-06), never through the row statement.
 *
 * These tests drive a fake Supabase client, so they pin the SHAPE of the calls: what a real Postgres would
 * accept or reject is the thing under test, and it is decided entirely by which columns we send.
 */

interface Call { table: string; op: 'update' | 'insert' | 'upsert' | 'rpc'; payload: Record<string, unknown> }

const calls: Call[] = [];
let existingRows: Array<{ user_id: string }> = [];

// `client()` builds its Supabase handle from `createClient` + the two VITE_ env vars, so the seam to fake is
// the driver itself. `vi.stubEnv` supplies the config that makes `client()` return non-null.
vi.stubEnv('VITE_SUPABASE_URL', 'http://test.local');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key');

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ table: fn, op: 'rpc', payload: args });
      return { data: null, error: null };
    },
    from: (table: string) => ({
      update: (payload: Record<string, unknown>) => {
        calls.push({ table, op: 'update', payload });
        return { eq: () => ({ select: async () => ({ data: existingRows, error: null }) }) };
      },
      insert: async (payload: Record<string, unknown>) => {
        calls.push({ table, op: 'insert', payload });
        return { data: null, error: null };
      },
      upsert: async (payload: Record<string, unknown>) => {
        calls.push({ table, op: 'upsert', payload });
        return { data: null, error: null };
      },
    }),
  }),
}));

vi.mock('./identity', () => ({ currentUserId: () => 'u-1' }));

const load = async () => (await import('./remoteBoards')).uploadPlayerProfile;
const profile = { author: 'Orangez', rating: 548, gamesPlayed: 4, favoriteHero: 'guardian', patch: 'test' };

beforeEach(() => { calls.length = 0; vi.resetModules(); });
afterEach(() => vi.restoreAllMocks());

describe('writing a player profile', () => {
  it('NEVER sends rating on the update path — that is what the RLS policy rejects', async () => {
    existingRows = [{ user_id: 'u-1' }]; // the row already exists → update path
    await (await load())(profile);
    const update = calls.find((c) => c.op === 'update');
    expect(update, 'an existing profile must be UPDATEd, not upserted').toBeTruthy();
    expect(Object.keys(update!.payload), 'rating in the payload is the whole bug').not.toContain('rating');
    expect(update!.payload.games_played, 'the games count must actually be written').toBe(4);
  });

  it('does not fall back to an insert when the update landed', async () => {
    existingRows = [{ user_id: 'u-1' }];
    await (await load())(profile);
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(0);
  });

  it('moves the rating through the submit_own_rating RPC on the update path — the only door the policy leaves open', async () => {
    existingRows = [{ user_id: 'u-1' }];
    await (await load())(profile);
    const rpc = calls.find((c) => c.op === 'rpc');
    expect(rpc, 'without this call the MMR leaderboard is frozen forever').toBeTruthy();
    expect(rpc!.table).toBe('submit_own_rating');
    expect(rpc!.payload).toEqual({ new_rating: 548 });
  });

  it('the insert path needs no RPC — the first insert may carry rating itself', async () => {
    existingRows = [];
    await (await load())(profile);
    expect(calls.filter((c) => c.op === 'rpc')).toHaveLength(0);
  });

  it('inserts (with rating) when there is no row yet — an UPDATE matching nothing is a 0-row success', async () => {
    existingRows = []; // no profile yet
    await (await load())(profile);
    const insert = calls.find((c) => c.op === 'insert');
    expect(insert, 'a first-time player must still get a row').toBeTruthy();
    expect(insert!.payload).toMatchObject({ user_id: 'u-1', rating: 548, games_played: 4 });
  });

  it('never uses upsert for profiles — one statement cannot satisfy a write-once column', async () => {
    for (const rows of [[{ user_id: 'u-1' }], []]) {
      calls.length = 0;
      existingRows = rows;
      vi.resetModules();
      await (await load())(profile);
      expect(calls.some((c) => c.table === 'profiles' && c.op === 'upsert')).toBe(false);
    }
  });
});
