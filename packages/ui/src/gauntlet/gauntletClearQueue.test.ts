// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GAUNTLET CLEAR QUEUE: a signed-in clear is written to its own durable queue first, then sent. Pins: dedupe on
 * userId + stage, account binding (never cross-submitted, never submitted without a live account), oldest first,
 * transport failures back off exponentially and stop the flush, definite refusals leave the queue.
 */

type Invoke = { body: Record<string, unknown> };
let invokeImpl: (opts: Invoke) => Promise<{ data: unknown; error: unknown }>;
const invokes: Invoke[] = [];
let userId: string | null = 'u-1';
let anonymous = false;

vi.stubEnv('VITE_SUPABASE_URL', 'http://test.local');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key');
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    functions: { invoke: async (_fn: string, opts: Invoke) => { invokes.push(opts); return invokeImpl(opts); } },
    from: () => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }) }),
  }),
}));
vi.mock('../identity', () => ({
  currentUserId: () => userId,
  currentIdentity: () => (userId ? { userId, displayName: 'Kev', anonymous, email: null } : null),
}));

const { GAUNTLET_CLEAR_QUEUE_KEY, clearGauntletClearQueue, enqueueGauntletClear, flushGauntletClears, pendingGauntletClears } = await import('./gauntletClearQueue');
const { backoffMs } = await import('../progression/progressionQueue');

const already = { data: { status: 'already_cleared', crate: null }, error: null };
const httpError = (status: number, code: string) => ({ data: null, error: { name: 'FunctionsHttpError', message: 'x', context: { status, json: async () => ({ error: code }) } } });

beforeEach(() => {
  clearGauntletClearQueue();
  localStorage.clear();
  invokes.length = 0;
  userId = 'u-1';
  anonymous = false;
  invokeImpl = async () => already;
});

describe('enqueue', () => {
  it('binds to the live account and dedupes on userId + stage (a repeat keeps the ORIGINAL item)', () => {
    const a = enqueueGauntletClear(2, 1000);
    expect(a).toMatchObject({ userId: 'u-1', stage: 2, attempts: 0, at: new Date(1000).toISOString() });
    expect(enqueueGauntletClear(2, 5000)?.at).toBe(new Date(1000).toISOString());
    expect(pendingGauntletClears()).toHaveLength(1);
    userId = 'u-2';
    enqueueGauntletClear(2);
    expect(pendingGauntletClears()).toHaveLength(1); // u-2's own item
    expect(JSON.parse(localStorage.getItem(GAUNTLET_CLEAR_QUEUE_KEY)!)).toHaveLength(2);
  });
  it('no session, or a guest (anonymous) session, queues nothing', () => {
    userId = null;
    expect(enqueueGauntletClear(1)).toBeNull();
    userId = 'u-1'; anonymous = true;
    expect(enqueueGauntletClear(1)).toBeNull();
    expect(localStorage.getItem(GAUNTLET_CLEAR_QUEUE_KEY)).toBeNull();
  });
});

describe('flush', () => {
  it('oldest first, one at a time; confirmed items leave and report', async () => {
    enqueueGauntletClear(1);
    enqueueGauntletClear(2);
    const seen: string[] = [];
    await flushGauntletClears((item, o) => seen.push(`${item.stage}:${o.status}`));
    expect(invokes.map((i) => i.body.stage)).toEqual([1, 2]);
    expect(seen).toEqual(['1:confirmed', '2:confirmed']);
    expect(pendingGauntletClears()).toHaveLength(0);
  });

  it('only the CURRENT account\'s items are sent; another account\'s park untouched', async () => {
    enqueueGauntletClear(1);
    userId = 'u-2';
    await flushGauntletClears(() => {});
    expect(invokes).toHaveLength(0);
    userId = 'u-1';
    expect(pendingGauntletClears()).toHaveLength(1);
  });

  it('transport failures stay queued, back off exponentially, and stop the flush', async () => {
    let t = 10_000;
    invokeImpl = async () => httpError(503, 'gauntlet_failed');
    enqueueGauntletClear(1);
    enqueueGauntletClear(2);
    await flushGauntletClears(() => {}, { now: () => t });
    expect(invokes).toHaveLength(1);
    const [a] = pendingGauntletClears();
    expect(a).toMatchObject({ stage: 1, attempts: 1, lastError: 'gauntlet_failed', nextAttemptAt: t + backoffMs(1) });
    // Not due yet: an unforced flush leaves it alone.
    await flushGauntletClears(() => {}, { now: () => t });
    expect(invokes).toHaveLength(1);
    // Forced (network return): tried again, backoff doubles.
    await flushGauntletClears(() => {}, { now: () => t, force: true });
    expect(pendingGauntletClears()[0]).toMatchObject({ attempts: 2, nextAttemptAt: t + backoffMs(2) });
    // Due: tried without force, and a success clears both.
    t += backoffMs(2);
    invokeImpl = async () => already;
    await flushGauntletClears(() => {}, { now: () => t });
    expect(pendingGauntletClears()).toHaveLength(0);
  });

  it('a definite refusal leaves the queue (it would be refused again)', async () => {
    invokeImpl = async () => httpError(403, 'sign_in_required');
    enqueueGauntletClear(3);
    const seen: unknown[] = [];
    await flushGauntletClears((_i, o) => seen.push(o));
    expect(seen).toEqual([{ status: 'rejected', reason: 'sign_in_required' }]);
    expect(pendingGauntletClears()).toHaveLength(0);
  });
});
