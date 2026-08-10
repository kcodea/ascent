import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * ACCOUNTS C2 — the offline upload queue + the "unrated" tag.
 *
 * C1 signs in anonymously at boot, so `currentUserId()` is normally set by the time a run ends — but not if
 * Supabase was unreachable, or a run finished before the handshake. Those uploads used to no-op and the run was
 * LOST. Now they queue to localStorage and replay when a session lands, tagged UNRATED (a run finished with no
 * live session must not move the ladder).
 *
 * These drive a fake Supabase client + a switchable identity, so they pin the BEHAVIOUR: no session → queue,
 * not insert; a landed session → replay; and a replayed run is unrated (its ladder rating is skipped).
 */

interface Call { table: string; op: 'insert' | 'update' | 'rpc'; payload: unknown }
const calls: Call[] = [];
let userId: string | null = null;

vi.stubEnv('VITE_SUPABASE_URL', 'http://test.local');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key');

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: async (fn: string, args: unknown) => { calls.push({ table: fn, op: 'rpc', payload: args }); return { data: null, error: null }; },
    from: (table: string) => ({
      insert: async (payload: unknown) => { calls.push({ table, op: 'insert', payload }); return { data: null, error: null }; },
      update: (payload: unknown) => { calls.push({ table, op: 'update', payload }); return { eq: () => ({ select: async () => ({ data: [{ user_id: 'u-1' }], error: null }) }) }; },
    }),
  }),
}));

// Switchable identity — `userId` null models "no live session" (offline / pre-handshake).
vi.mock('./identity', () => ({
  currentUserId: () => userId,
  currentIdentity: () => (userId ? { userId, displayName: 'Kev', anonymous: false, email: 'kev@x.com' } : null),
  setIdentity: () => {},
}));

// The bare-node test env has no localStorage; the queue lives there, so shim an in-memory one.
const mem = new Map<string, string>();
beforeEach(() => {
  calls.length = 0;
  userId = null;
  mem.clear();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, v); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => mem.clear(),
    key: () => null,
    length: 0,
  } as Storage;
  vi.resetModules();
});
afterEach(() => vi.restoreAllMocks());

const mod = () => import('./remoteBoards');
const board = { id: 'b1', patch: 'test+sha', wave: 3, heroId: 'gorr', minions: [{}] } as never;

describe('offline → queue, not lost', () => {
  it('uploadBoards with no session queues instead of inserting', async () => {
    const { uploadBoards } = await mod();
    await uploadBoards([board]);
    expect(calls.filter((c) => c.op === 'insert'), 'no session → nothing hits the DB').toHaveLength(0);
    const q = JSON.parse(mem.get('ascent.uploadqueue') ?? '[]') as Array<{ kind: string }>;
    expect(q.map((i) => i.kind)).toEqual(['boards']);
  });

  it('a profile finished offline queues too', async () => {
    const { uploadPlayerProfile } = await mod();
    await uploadPlayerProfile({ author: 'Kev', rating: 500, gamesPlayed: 2, patch: 'test' });
    expect(calls).toHaveLength(0);
    const q = JSON.parse(mem.get('ascent.uploadqueue') ?? '[]') as Array<{ kind: string }>;
    expect(q.map((i) => i.kind)).toEqual(['profile']);
  });
});

describe('session lands → flush, tagged unrated', () => {
  it('replays a queued board and marks it unrated, then clears the queue', async () => {
    const { uploadBoards, flushUploadQueue } = await mod();
    await uploadBoards([board]);            // queued (no session)
    userId = 'u-1';                          // a session establishes
    await flushUploadQueue();
    const insert = calls.find((c) => c.op === 'insert' && c.table === 'boards');
    expect(insert, 'the queued board must now upload').toBeTruthy();
    expect((insert!.payload as Array<{ unrated: boolean }>)[0]!.unrated, 'an offline run is unrated').toBe(true);
    expect(mem.get('ascent.uploadqueue'), 'the queue is emptied after a flush').toBe('[]');
  });

  it('a queued profile does NOT move the ladder — the rating RPC is skipped', async () => {
    const { uploadPlayerProfile, flushUploadQueue } = await mod();
    await uploadPlayerProfile({ author: 'Kev', rating: 500, gamesPlayed: 2, patch: 'test' }); // queued
    userId = 'u-1';
    await flushUploadQueue();
    expect(calls.some((c) => c.op === 'update' && c.table === 'profiles'), 'the profile row still upserts').toBe(true);
    expect(calls.some((c) => c.op === 'rpc' && c.table === 'submit_own_rating'), 'but an offline run is UNRATED — no rating submission').toBe(false);
  });

  it('flush is a no-op with no session (nothing to flush TO)', async () => {
    const { uploadBoards, flushUploadQueue } = await mod();
    await uploadBoards([board]); // queued
    await flushUploadQueue();    // still no session
    expect(calls).toHaveLength(0);
    const q = JSON.parse(mem.get('ascent.uploadqueue') ?? '[]') as unknown[];
    expect(q, 'the queue is preserved until a session exists').toHaveLength(1);
  });
});
