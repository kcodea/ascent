// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RANK_RULES, RANK_SEASON, initialRankedProfile, settleRank } from '@game/sim';

/**
 * MEDAL RANK — the client submission seam + the durable pending queue (blueprint §6 / §11 persistence
 * criteria). A fake Supabase client stands in for the Edge Function; `localStorage` is the real jsdom one.
 *
 *   • practice/tutorial never reach this path (pinned in store.test — here: only what is queued submits);
 *   • a timeout after commit followed by a retry returns the original result exactly once (dedupe honoured);
 *   • a failed/offline attempt keeps the request byte-for-byte and marks it retryable;
 *   • a definite server refusal (409 unsupported season/rules, 400) is `rejected` and leaves the queue;
 *   • an OLD numeric-function response is `rejected` as `server_outdated`, never mistaken for a rank;
 *   • account binding: another account's items are neither flushed nor dropped.
 */

type Invoke = { body: Record<string, unknown> };
let invokeImpl: (opts: Invoke) => Promise<{ data: unknown; error: unknown }>;
const invokes: Invoke[] = [];
let userId: string | null = 'u-1';

vi.stubEnv('VITE_SUPABASE_URL', 'http://test.local');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key');

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    functions: { invoke: async (_fn: string, opts: Invoke) => { invokes.push(opts); return invokeImpl(opts); } },
    from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: [], error: null }) }) }) }),
  }),
}));
vi.mock('../identity', () => ({
  currentUserId: () => userId,
  currentIdentity: () => (userId ? { userId, displayName: 'Kev', anonymous: false, email: null } : null),
}));

/** A "server" that settles for real from a fresh profile and remembers its ledger — dedupe included. */
function fakeServer() {
  let profile = initialRankedProfile();
  const ledger = new Map<string, unknown>();
  return {
    settle: async ({ body }: Invoke) => {
      const runId = body.runId as string;
      if (body.seasonId !== RANK_SEASON) return { data: null, error: httpError(409, 'unsupported_season') };
      if (body.rulesVersion !== RANK_RULES.rulesVersion) return { data: null, error: httpError(409, 'unsupported_rules') };
      if (ledger.has(runId)) return { data: { status: 'confirmed', deduped: true, result: ledger.get(runId), profile }, error: null };
      const s = settleRank(profile, body.placement as number, runId);
      profile = s.profile;
      ledger.set(runId, s.result);
      return { data: { status: 'confirmed', deduped: false, result: s.result, profile }, error: null };
    },
    get profile() { return profile; },
    get settledRuns() { return [...ledger.keys()]; },
  };
}
function httpError(status: number, code: string) {
  return { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context: { status, json: async () => ({ error: code }) } };
}

const load = async () => ({
  ...(await import('./rankSubmission')),
  submitRating: (await import('../remoteBoards')).submitRating,
});

beforeEach(() => {
  vi.resetModules();
  invokes.length = 0;
  userId = 'u-1';
  localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('submitRating — typed outcomes', () => {
  it('confirmed: returns the server result + profile, deduped=false on first settle', async () => {
    const server = fakeServer();
    invokeImpl = server.settle;
    const { submitRating, rankRequestFor } = await load();
    const out = await submitRating(rankRequestFor('run-1', 2, 777));
    expect(out.status).toBe('confirmed');
    if (out.status !== 'confirmed') throw new Error('unreachable');
    expect(out.deduped).toBe(false);
    expect(out.result.placement).toBe(2);
    expect(out.result.after).toEqual({ divisionIndex: 0, points: 28, demotionReady: false });
    expect(out.profile.revision).toBe(1);
    expect(invokes[0]!.body, 'never a rating, never a division — placement + identity + version pins').toEqual({ runId: 'run-1', placement: 2, seasonId: RANK_SEASON, rulesVersion: RANK_RULES.rulesVersion, seed: 777 });
  });

  it('the seven opponent keys ride with the request (2026-09-22) — never a strength, never a bonus; an empty list sends no key at all', async () => {
    const server = fakeServer();
    invokeImpl = server.settle;
    const { submitRating, rankRequestFor } = await load();
    const keys = ['Mike|warden|1', 'bot:hybrid:gorr'];
    await submitRating(rankRequestFor('run-2', 1, 778, keys));
    expect(invokes[0]!.body).toEqual({ runId: 'run-2', placement: 1, seasonId: RANK_SEASON, rulesVersion: RANK_RULES.rulesVersion, seed: 778, seatKeys: keys });
    expect(Object.keys(invokes[0]!.body as object)).not.toContain('lobbyStrength');
    expect(Object.keys(invokes[0]!.body as object)).not.toContain('strengthBonus');
    await submitRating(rankRequestFor('run-3', 1, 779, []));
    expect(invokes[1]!.body).toEqual({ runId: 'run-3', placement: 1, seasonId: RANK_SEASON, rulesVersion: RANK_RULES.rulesVersion, seed: 779 });
  });

  it('a retry after a timed-out-but-committed attempt returns the ORIGINAL result exactly once (dedupe)', async () => {
    const server = fakeServer();
    invokeImpl = server.settle;
    const { submitRating, rankRequestFor } = await load();
    const first = await submitRating(rankRequestFor('run-1', 1));
    const again = await submitRating(rankRequestFor('run-1', 1));
    expect(first.status).toBe('confirmed');
    expect(again.status).toBe('confirmed');
    if (first.status !== 'confirmed' || again.status !== 'confirmed') throw new Error('unreachable');
    expect(again.deduped).toBe(true);
    expect(again.result).toEqual(first.result);
    expect(server.profile.revision, 'the second call awarded nothing').toBe(1);
  });

  it('a 409 season / rules mismatch is REJECTED (a client from another season must not settle)', async () => {
    invokeImpl = async () => ({ data: null, error: httpError(409, 'unsupported_rules') });
    const { submitRating, rankRequestFor } = await load();
    const out = await submitRating(rankRequestFor('run-1', 1));
    expect(out).toEqual({ status: 'rejected', reason: 'unsupported_rules' });
  });

  it('a transport failure / 5xx / 429 is RETRYABLE', async () => {
    const { submitRating, rankRequestFor } = await load();
    invokeImpl = async () => { throw new Error('Failed to fetch'); };
    expect((await submitRating(rankRequestFor('run-1', 1))).status).toBe('retryable');
    invokeImpl = async () => ({ data: null, error: httpError(500, 'settle_failed') });
    expect((await submitRating(rankRequestFor('run-1', 1))).status).toBe('retryable');
    invokeImpl = async () => ({ data: null, error: httpError(429, 'rate_limited') });
    expect(await submitRating(rankRequestFor('run-1', 1))).toEqual({ status: 'retryable', reason: 'rate_limited' });
  });

  it('the OLD numeric function response is REJECTED as server_outdated — never shown as a medal result', async () => {
    invokeImpl = async () => ({ data: { rating: 548, delta: 71 }, error: null });
    const { submitRating, rankRequestFor } = await load();
    expect(await submitRating(rankRequestFor('run-1', 1))).toEqual({ status: 'rejected', reason: 'server_outdated' });
  });

  it('with no session the request is retryable (it waits for identity), not rejected', async () => {
    userId = null;
    const { submitRating, rankRequestFor } = await load();
    expect(await submitRating(rankRequestFor('run-1', 1))).toEqual({ status: 'retryable', reason: 'no_session' });
  });
});

describe('the durable pending queue', () => {
  it('a finished run is persisted BEFORE it is sent, and stays until confirmed', async () => {
    const server = fakeServer();
    let online = false;
    invokeImpl = async (o) => (online ? server.settle(o) : Promise.reject(new Error('offline')));
    const { enqueuePendingRank, flushPendingRanks, pendingRanks, pendingRankFor, rankRequestFor } = await load();
    const item = enqueuePendingRank(rankRequestFor('run-1', 3, 42));
    expect(item).toMatchObject({ userId: 'u-1', runId: 'run-1', placement: 3, attempts: 0 });
    expect(pendingRankFor('run-1')).toBeTruthy();

    const seen: string[] = [];
    await flushPendingRanks((_i, o) => seen.push(o.status));
    expect(seen).toEqual(['retryable']);
    expect(pendingRanks(), 'an offline attempt keeps the request').toHaveLength(1);
    expect(pendingRanks()[0]!.attempts).toBe(1);

    online = true;
    await flushPendingRanks((_i, o) => seen.push(o.status));
    expect(seen).toEqual(['retryable', 'confirmed']);
    expect(pendingRanks(), 'confirmed → removed').toHaveLength(0);
    expect(server.settledRuns).toEqual(['run-1']);
    expect(invokes.map((i) => i.body.runId), 'the SAME run id on every attempt — never regenerated').toEqual(['run-1', 'run-1']);
  });

  it('re-enqueueing the same run (a reload mid-submit) keeps the ORIGINAL request', async () => {
    const { enqueuePendingRank, pendingRanks, rankRequestFor } = await load();
    enqueuePendingRank(rankRequestFor('run-1', 3));
    enqueuePendingRank(rankRequestFor('run-1', 1)); // a bogus second finish for the same run must not replace it
    expect(pendingRanks()).toHaveLength(1);
    expect(pendingRanks()[0]!.placement).toBe(3);
  });

  it('a rejected item leaves the queue; flushing settles in accepted (oldest-first) order', async () => {
    const server = fakeServer();
    invokeImpl = async (o) => (o.body.runId === 'bad' ? { data: null, error: httpError(400, 'bad_placement') } : server.settle(o));
    const { enqueuePendingRank, flushPendingRanks, pendingRanks, rankRequestFor } = await load();
    enqueuePendingRank(rankRequestFor('run-a', 1));
    enqueuePendingRank({ ...rankRequestFor('bad', 1), placement: 1 });
    enqueuePendingRank(rankRequestFor('run-b', 8));
    const order: string[] = [];
    await flushPendingRanks((i, o) => order.push(`${i.runId}:${o.status}`));
    expect(order).toEqual(['run-a:confirmed', 'bad:rejected', 'run-b:confirmed']);
    expect(pendingRanks()).toHaveLength(0);
    expect(server.settledRuns).toEqual(['run-a', 'run-b']);
  });

  it('ACCOUNT BINDING: another account\'s pending result is neither submitted nor dropped', async () => {
    const server = fakeServer();
    invokeImpl = server.settle;
    const { enqueuePendingRank, flushPendingRanks, pendingRanks, rankRequestFor } = await load();
    enqueuePendingRank(rankRequestFor('run-of-u1', 1));
    userId = 'u-2'; // signed out, someone else signed in on this device
    expect(pendingRanks(), 'u-2 sees none of u-1\'s items').toHaveLength(0);
    await flushPendingRanks(() => { throw new Error('nothing should settle for u-2'); });
    expect(server.settledRuns).toEqual([]);
    userId = 'u-1'; // …and when u-1 returns, the item is still there and settles
    expect(pendingRanks()).toHaveLength(1);
    const seen: string[] = [];
    await flushPendingRanks((_i, o) => seen.push(o.status));
    expect(seen).toEqual(['confirmed']);
    expect(server.settledRuns).toEqual(['run-of-u1']);
  });

  it('with no backend / no account at finish, nothing is queued (the run is unrated)', async () => {
    userId = null;
    const { enqueuePendingRank, rankRequestFor } = await load();
    expect(enqueuePendingRank(rankRequestFor('run-1', 1))).toBeNull();
  });

  it('a flush stops at the first retryable failure so settlements are not reordered', async () => {
    let calls = 0;
    invokeImpl = async () => { calls++; throw new Error('offline'); };
    const { enqueuePendingRank, flushPendingRanks, pendingRanks, rankRequestFor } = await load();
    enqueuePendingRank(rankRequestFor('run-a', 1));
    enqueuePendingRank(rankRequestFor('run-b', 1));
    await flushPendingRanks(() => {});
    expect(calls).toBe(1);
    expect(pendingRanks()).toHaveLength(2);
  });
});
