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
 * rating at all. C3 then built it; and MEDALS (2026-09-20) moved the ladder entirely off this write: the
 * profile row's display columns travel here, the rank settles through `submitRating` → `settle_rank` on its
 * OWN durable path (`rank/rankSubmission.ts`). This write must therefore carry NO ladder column at all — the
 * medal RLS policy rejects an update that changes `rating` or any `rank_*` column, and an insert with
 * anything but the Bronze I placeholder.
 *
 * These tests drive a fake Supabase client, so they pin the SHAPE of the calls: what a real Postgres would
 * accept or reject is the thing under test, and it is decided entirely by which columns we send.
 */

interface Call { table: string; op: 'update' | 'insert' | 'upsert' | 'rpc' | 'invoke'; payload: Record<string, unknown> }

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
    functions: {
      invoke: async (fn: string, opts: { body: Record<string, unknown> }) => {
        calls.push({ table: fn, op: 'invoke', payload: opts.body });
        return { data: null, error: null };
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
// A finished run's display payload. (`rating` is tolerated for queued pre-medal payloads and never sent.)
const lobby = { author: 'Orangez', rating: 548, gamesPlayed: 4, favoriteHero: 'guardian', patch: 'test' };
const RANK_COLUMNS = ['rating', 'rank_season', 'rank_rules_version', 'rank_division', 'rank_points', 'rank_highest_division', 'rank_highest_points', 'rank_revision', 'season2_rating'];

beforeEach(() => { calls.length = 0; vi.resetModules(); });
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

  it('MEDALS: the profile write never submits a rank, never invokes the Edge Function, never calls an RPC', async () => {
    existingRows = [{ user_id: 'u-1' }];
    await (await load())(lobby);
    expect(calls.some((c) => c.op === 'invoke'), 'the ladder settles on its own path (rank/rankSubmission.ts), never from here').toBe(false);
    expect(calls.some((c) => c.op === 'rpc'), 'the legacy submit_own_rating RPC is retired').toBe(false);
  });

  it('MEDALS: the update never carries ANY rank column — the RLS policy rejects a change to each of them', async () => {
    existingRows = [{ user_id: 'u-1' }];
    await (await load())(lobby);
    const update = calls.find((c) => c.op === 'update');
    for (const col of RANK_COLUMNS) expect(Object.keys(update!.payload), col).not.toContain(col);
  });

  it('inserts a rating-0 / Bronze I PLACEHOLDER when there is no row — the server fills the real values', async () => {
    existingRows = []; // no profile yet
    await (await load())(lobby);
    const insert = calls.find((c) => c.op === 'insert');
    expect(insert, 'a first-time player must still get a row').toBeTruthy();
    expect(insert!.payload, 'the client never persists a rating it computed itself').toMatchObject({ user_id: 'u-1', rating: 0, games_played: 4 });
    // The medal insert policy demands exactly the defaults for every rank column: sending none is the way.
    for (const col of RANK_COLUMNS.filter((c) => c !== 'rating')) expect(Object.keys(insert!.payload), col).not.toContain(col);
  });

  it('an UNRATED (offline-queued) payload still upserts the display columns', async () => {
    existingRows = [{ user_id: 'u-1' }];
    await (await load())({ ...lobby, unrated: true });
    expect(calls.some((c) => c.op === 'update'), 'the display columns still upsert').toBe(true);
    expect(calls.some((c) => c.op === 'invoke' || c.op === 'rpc')).toBe(false);
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
