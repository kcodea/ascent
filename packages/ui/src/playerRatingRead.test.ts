import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * A WIPED LADDER DIDN'T REACH THE CLIENT (owner report 2026-08-19).
 *
 * The Career rating is a LOCAL MIRROR of this account's `profiles` row; `syncProfileFromServer` adopts the
 * server value over it. But `fetchPlayerRating` collapsed three different situations into `null` — no backend,
 * no session, a failed query, AND "you genuinely have no row" — and the caller's `if (serverRating == null)
 * return` then kept the local number in every one of them. So truncating `profiles` cleared the leaderboard
 * while every client happily went on displaying its old rating (the owner saw "RATING 1078" beside "No runs
 * yet" after a full server wipe).
 *
 * The read now discriminates, because the two halves want OPPOSITE handling:
 *   • `undefined` — couldn't ask (offline / no session / error / timeout) → keep the local mirror, silently.
 *   • `null`      — asked and answered, no row → the server says unranked, so the mirror is stale.
 *
 * These tests drive a fake Supabase client and pin that discrimination, since it is the whole fix.
 */

let queryResult: { data: unknown[] | null; error: unknown } = { data: [{ rating: 1078 }], error: null };
let userId: string | null = 'u-1';

vi.stubEnv('VITE_SUPABASE_URL', 'http://test.local');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key');

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ limit: async () => queryResult }) }),
    }),
  }),
}));

vi.mock('./identity', () => ({
  currentUserId: () => userId,
  currentIdentity: () => (userId ? { userId, displayName: 'Kev', anonymous: false, email: null } : null),
}));

const load = async () => (await import('./remoteBoards')).fetchPlayerRating;

beforeEach(() => {
  vi.resetModules();
  queryResult = { data: [{ rating: 1078 }], error: null };
  userId = 'u-1';
});
afterEach(() => vi.restoreAllMocks());

describe('fetchPlayerRating — three-way result', () => {
  it('returns the NUMBER when the account has a rating', async () => {
    expect(await (await load())('Kev')).toBe(1078);
  });

  it('returns NULL — not undefined — when the query succeeds with no row (a wiped/deleted profile)', async () => {
    // THE REGRESSION THIS FILE EXISTS FOR: an empty result set is an ANSWER ("you are unranked"), and must be
    // distinguishable from a failure, or a server wipe can never reach the client.
    queryResult = { data: [], error: null };
    expect(await (await load())('Kev')).toBeNull();
  });

  it('returns NULL when the row exists but carries no usable rating', async () => {
    queryResult = { data: [{ rating: null }], error: null };
    expect(await (await load())('Kev')).toBeNull();
  });

  it('returns UNDEFINED when the query ERRORS — that is "couldn’t ask", not "unranked"', async () => {
    queryResult = { data: null, error: { message: 'network' } };
    expect(await (await load())('Kev')).toBeUndefined();
  });

  it('returns UNDEFINED when there is no session (signed out) rather than blanking the rating', async () => {
    userId = null;
    expect(await (await load())('Kev')).toBeUndefined();
  });
});
