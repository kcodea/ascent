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

interface Call { table: string; op: 'update' | 'insert' | 'upsert' | 'rpc' | 'invoke'; payload: Record<string, unknown> }

const calls: Call[] = [];
let existingRows: Array<{ user_id: string }> = [];
let functionErrors = false; // when true, the submit-rating Edge Function fails → the client falls back to the RPC

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
    functions: {
      invoke: async (fn: string, opts: { body: Record<string, unknown> }) => {
        calls.push({ table: fn, op: 'invoke', payload: opts.body });
        return { data: null, error: functionErrors ? { message: 'not deployed' } : null };
      },
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

// `currentIdentity` is read for the denormalised `email` column (C2b); a real account here.
vi.mock('./identity', () => ({
  currentUserId: () => 'u-1',
  currentIdentity: () => ({ userId: 'u-1', displayName: 'Orangez', anonymous: false, email: 'o@x.com' }),
}));

const load = async () => (await import('./remoteBoards')).uploadPlayerProfile;
// A LOBBY run carries a placement + runId (C3); rating is only the pre-deploy fallback value.
const lobby = { author: 'Orangez', rating: 548, gamesPlayed: 4, favoriteHero: 'guardian', patch: 'test', runId: 'seed-1', placement: 2 };

beforeEach(() => { calls.length = 0; functionErrors = false; vi.resetModules(); });
afterEach(() => vi.restoreAllMocks());

describe('writing a player profile', () => {
  it('NEVER sends rating on the update path — that is what the RLS policy rejects', async () => {
    existingRows = [{ user_id: 'u-1' }]; // the row already exists → update path
    await (await load())(lobby);
    const update = calls.find((c) => c.op === 'update');
    expect(update, 'an existing profile must be UPDATEd, not upserted').toBeTruthy();
    expect(Object.keys(update!.payload), 'rating in the display-column write is the original bug').not.toContain('rating');
    expect(update!.payload.games_played, 'the games count must actually be written').toBe(4);
  });

  it('does not fall back to an insert when the update landed', async () => {
    existingRows = [{ user_id: 'u-1' }];
    await (await load())(lobby);
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(0);
  });

  it('C3: rating goes through the submit-rating EDGE FUNCTION with {runId, placement} — not a client rating', async () => {
    existingRows = [{ user_id: 'u-1' }];
    await (await load())(lobby);
    const invoke = calls.find((c) => c.op === 'invoke');
    expect(invoke, 'the server must be asked to derive the rating').toBeTruthy();
    expect(invoke!.table).toBe('submit-rating');
    expect(invoke!.payload, 'the client sends placement + runId, never a rating').toEqual({ runId: 'seed-1', placement: 2 });
    expect(calls.some((c) => c.op === 'rpc'), 'the legacy RPC must NOT run when the function succeeds').toBe(false);
  });

  it('C3: falls back to the submit_own_rating RPC only when the function fails (pre-deploy)', async () => {
    existingRows = [{ user_id: 'u-1' }];
    functionErrors = true; // the Edge Function isn't deployed yet
    await (await load())(lobby);
    const rpc = calls.find((c) => c.op === 'rpc');
    expect(rpc, 'without a deployed function the client must still move the rating').toBeTruthy();
    expect(rpc!.table).toBe('submit_own_rating');
    expect(rpc!.payload).toEqual({ new_rating: 548 });
  });

  it('inserts a rating-0 PLACEHOLDER when there is no row — the server fills the real value', async () => {
    existingRows = []; // no profile yet
    await (await load())(lobby);
    const insert = calls.find((c) => c.op === 'insert');
    expect(insert, 'a first-time player must still get a row').toBeTruthy();
    expect(insert!.payload, 'the client never persists a rating it computed itself').toMatchObject({ user_id: 'u-1', rating: 0, games_played: 4 });
  });

  it('a NON-lobby run (no placement) never touches the rating at all', async () => {
    existingRows = [{ user_id: 'u-1' }];
    await (await load())({ author: 'Orangez', rating: 548, gamesPlayed: 4, patch: 'test' }); // no runId/placement
    expect(calls.some((c) => c.op === 'invoke'), 'no lobby placement → no rating submission').toBe(false);
    expect(calls.some((c) => c.op === 'rpc')).toBe(false);
  });

  it('an UNRATED (offline) run upserts the profile but never submits rating', async () => {
    existingRows = [{ user_id: 'u-1' }];
    await (await load())({ ...lobby, unrated: true });
    expect(calls.some((c) => c.op === 'update'), 'the display columns still upsert').toBe(true);
    expect(calls.some((c) => c.op === 'invoke' || c.op === 'rpc'), 'an offline run is unrated — no rating').toBe(false);
  });

  it('never uses upsert for profiles — one statement cannot satisfy a write-once column', async () => {
    for (const rows of [[{ user_id: 'u-1' }], []]) {
      calls.length = 0;
      existingRows = rows;
      vi.resetModules();
      await (await load())(lobby);
      expect(calls.some((c) => c.table === 'profiles' && c.op === 'upsert')).toBe(false);
    }
  });
});
