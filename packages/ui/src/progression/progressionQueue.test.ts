// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ACCOUNT PROGRESSION: the durable queue + the submission seam, over a FAKE Supabase client (no live backend).
 * Pins: account binding (userId + runId + mode), oldest-first, a duplicate server answer is a success,
 * transport failures stay queued with exponential backoff, definite refusals leave, a ranked item waits for its
 * rank settlement, and the request never carries an XP number.
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
  currentIdentity: () => (userId ? { userId, displayName: 'Kev', anonymous: true, email: null } : null),
}));

const { backoffMs, clearPendingProgressions, enqueuePendingProgression, flushPendingProgressions, pendingProgressions } = await import('./progressionQueue');
const { progressionRequestFor } = await import('./progressionRemote');
import type { ProgressionRunFactsV1 } from '@game/progression';

const facts = (over: Partial<ProgressionRunFactsV1> = {}): ProgressionRunFactsV1 => ({
  version: 1, runId: 'run-1', mode: 'ranked', setId: 'set2', patch: 'p', heroId: 'indy', placement: 2, waveReached: 12,
  terminal: true, comebackAfterFourLosses: true, combats: { wins: 6, losses: 5, draws: 0 }, ...over,
});
const settled = (runId: string, mode = 'ranked') => ({
  data: {
    status: 'confirmed', deduped: false,
    result: { runId, mode, rulesVersion: 1, placement: 2, comeback: true, xp: { base: 100, topFour: 40, firstPlace: 0, comeback: 25, total: 165 },
      before: { lifetimeXp: 0, level: 1 }, after: { lifetimeXp: 165, level: 1 }, unlockedTitles: [], cratesAwarded: 0, crateIds: [], revisionAfter: 1, settledAt: null },
    profile: { accountXp: 165, accountLevel: 1, revision: 1, equippedTitleId: null, titles: [] },
  },
  error: null,
});
const httpError = (status: number, code: string) => ({ data: null, error: { name: 'FunctionsHttpError', message: 'x', context: { status, json: async () => ({ error: code }) } } });

const noRankPending = { rankPending: () => false };

beforeEach(() => {
  clearPendingProgressions();
  invokes.length = 0;
  userId = 'u-1';
  invokeImpl = async (o) => settled(String(o.body.runId), String(o.body.mode));
});

describe('the request', () => {
  it('carries facts, the comeback flag and the rules pin, never an XP number or a level', () => {
    const req = progressionRequestFor(facts());
    expect(req).toMatchObject({ mode: 'ranked', runId: 'run-1', rulesVersion: 1, comeback: true });
    expect(JSON.stringify(req)).not.toMatch(/"xp"|"level"|"total"/);
  });
  it('achievements (2026-09-28): V2 facts go up as V1 unless the server evaluates achievements (an older server refuses V2)', () => {
    const v2 = { ...facts(), version: 2 as const, metrics: { rubyPlays: 4 } };
    const plain = progressionRequestFor(v2);
    expect(plain.facts).toMatchObject({ version: 1, runId: 'run-1' });
    expect(plain.facts).not.toHaveProperty('metrics');
    expect(progressionRequestFor(v2, undefined, true).facts).toEqual(v2);
  });
  it('practice carries its source row id; tutorial carries the course pin', () => {
    expect(progressionRequestFor(facts({ mode: 'practice', runId: 'practice:9' }), 9)).toMatchObject({ mode: 'practice', sourceId: 9, runId: 'practice:9' });
    expect(progressionRequestFor(facts({ mode: 'tutorial', runId: 'learn-ascent:v1', placement: null }))).toMatchObject({ courseId: 'learn-ascent', courseVersion: 1 });
  });
});

describe('enqueue', () => {
  it('binds to the live account; a repeat returns the ORIGINAL item; no session queues nothing', () => {
    const a = enqueuePendingProgression(progressionRequestFor(facts()), 1000);
    expect(a).toMatchObject({ userId: 'u-1', runId: 'run-1', mode: 'ranked', attempts: 0 });
    const again = enqueuePendingProgression(progressionRequestFor(facts({ comebackAfterFourLosses: false })));
    expect(again?.comeback).toBe(true);
    expect(pendingProgressions()).toHaveLength(1);
    userId = null;
    expect(enqueuePendingProgression(progressionRequestFor(facts({ runId: 'run-2' })))).toBeNull();
  });
  it('the same run id in two MODES is two items (the key is userId + runId + mode)', () => {
    enqueuePendingProgression(progressionRequestFor(facts()));
    enqueuePendingProgression(progressionRequestFor(facts({ mode: 'practice', runId: 'run-1' })), undefined);
    expect(pendingProgressions()).toHaveLength(2);
  });
});

describe('flush', () => {
  it('oldest first; confirmed items leave the queue and report', async () => {
    enqueuePendingProgression(progressionRequestFor(facts({ runId: 'a' })));
    enqueuePendingProgression(progressionRequestFor(facts({ runId: 'b' })));
    const seen: string[] = [];
    await flushPendingProgressions((item, o) => seen.push(`${item.runId}:${o.status}`), noRankPending);
    expect(seen).toEqual(['a:confirmed', 'b:confirmed']);
    expect(invokes.map((i) => i.body.runId)).toEqual(['a', 'b']);
    expect(pendingProgressions()).toHaveLength(0);
  });

  it('a DUPLICATE answer is a success carrying the original result', async () => {
    invokeImpl = async (o) => ({ ...settled(String(o.body.runId)), data: { ...settled(String(o.body.runId)).data, deduped: true } });
    enqueuePendingProgression(progressionRequestFor(facts()));
    const outcomes: unknown[] = [];
    await flushPendingProgressions((_i, o) => outcomes.push(o), noRankPending);
    expect(outcomes[0]).toMatchObject({ status: 'confirmed', deduped: true, result: { xp: { total: 165 } } });
    expect(pendingProgressions()).toHaveLength(0);
  });

  it('transport failures stay queued, back off exponentially, and stop the flush', async () => {
    let t = 10_000;
    invokeImpl = async () => httpError(503, 'settle_failed');
    enqueuePendingProgression(progressionRequestFor(facts({ runId: 'a' })));
    enqueuePendingProgression(progressionRequestFor(facts({ runId: 'b' })));
    await flushPendingProgressions(() => {}, { ...noRankPending, now: () => t });
    expect(invokes).toHaveLength(1); // stopped at the first retryable failure
    const [a] = pendingProgressions();
    expect(a).toMatchObject({ runId: 'a', attempts: 1, lastError: 'settle_failed', nextAttemptAt: 10_000 + backoffMs(1) });
    // Not due yet: an unforced flush leaves it alone …
    t += 1000;
    await flushPendingProgressions(() => {}, { ...noRankPending, now: () => t });
    expect(invokes).toHaveLength(1);
    // … a forced one (boot / online / identity) retries now, and the backoff doubles.
    await flushPendingProgressions(() => {}, { ...noRankPending, now: () => t, force: true });
    expect(invokes).toHaveLength(2);
    expect(pendingProgressions()[0]).toMatchObject({ attempts: 2, nextAttemptAt: t + backoffMs(2) });
    clearPendingProgressions();
  });

  it('backoff: 5 s, 10 s, 20 s … capped at 10 minutes', () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([5_000, 10_000, 20_000, 40_000]);
    expect(backoffMs(30)).toBe(600_000);
  });

  it('a function that is not deployed yet (404) and a rate limit (429) are retryable, never dropped', async () => {
    for (const status of [404, 429, 401]) {
      clearPendingProgressions();
      invokes.length = 0;
      invokeImpl = async () => httpError(status, status === 429 ? 'rate_limited' : '');
      enqueuePendingProgression(progressionRequestFor(facts()));
      const outcomes: Array<{ status: string }> = [];
      await flushPendingProgressions((_i, o) => outcomes.push(o), { ...noRankPending, force: true });
      expect(outcomes[0]?.status, `${status}`).toBe('retryable');
      expect(pendingProgressions(), `${status}`).toHaveLength(1);
    }
    clearPendingProgressions();
  });

  it('definite refusals (400 / 409) leave the queue as rejected', async () => {
    invokeImpl = async () => httpError(409, 'before_epoch');
    enqueuePendingProgression(progressionRequestFor(facts()));
    const outcomes: unknown[] = [];
    await flushPendingProgressions((_i, o) => outcomes.push(o), noRankPending);
    expect(outcomes[0]).toEqual({ status: 'rejected', reason: 'before_epoch' });
    expect(pendingProgressions()).toHaveLength(0);
  });

  it('an old server answer with no parseable result is rejected, never mistaken for XP', async () => {
    invokeImpl = async () => ({ data: { ok: true }, error: null });
    enqueuePendingProgression(progressionRequestFor(facts()));
    const outcomes: unknown[] = [];
    await flushPendingProgressions((_i, o) => outcomes.push(o), noRankPending);
    expect(outcomes[0]).toEqual({ status: 'rejected', reason: 'server_outdated' });
  });

  it('a ranked item WAITS while its rank settlement is still pending; others go ahead', async () => {
    enqueuePendingProgression(progressionRequestFor(facts({ runId: 'ranked-1' })));
    enqueuePendingProgression(progressionRequestFor(facts({ mode: 'practice', runId: 'practice:4' }), 4));
    let rankPending = true;
    await flushPendingProgressions(() => {}, { rankPending: () => rankPending });
    expect(invokes.map((i) => i.body.runId)).toEqual(['practice:4']);
    expect(pendingProgressions().map((i) => i.runId)).toEqual(['ranked-1']);
    rankPending = false;
    await flushPendingProgressions(() => {}, { rankPending: () => rankPending });
    expect(invokes.map((i) => i.body.runId)).toEqual(['practice:4', 'ranked-1']);
    expect(pendingProgressions()).toHaveLength(0);
  });

  it("account binding: another account's items are neither submitted nor dropped", async () => {
    enqueuePendingProgression(progressionRequestFor(facts({ runId: 'mine' })));
    userId = 'u-2';
    await flushPendingProgressions(() => {}, noRankPending);
    expect(invokes).toHaveLength(0);
    userId = 'u-1';
    expect(pendingProgressions().map((i) => i.runId)).toEqual(['mine']);
  });
});
