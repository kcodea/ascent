// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GAUNTLET ACCOUNT PROGRESS: the network seam over a FAKE Supabase client (no live backend). Pins how the
 * `gauntlet-clear` answer is classified (definite refusals leave the queue, transport failures stay), how the
 * `gauntlet_progress` read maps a missing table to "feature off", and that the crate list reads `source` without
 * breaking before the migration adds that column.
 */

type Invoke = { body: Record<string, unknown> };
type Res = { data: unknown; error: unknown };
let invokeImpl: (fn: string, opts: Invoke) => Promise<Res>;
const invokes: Array<{ fn: string; body: Record<string, unknown> }> = [];
let tableImpl: (table: string, columns: string) => Res;
const selects: Array<{ table: string; columns: string }> = [];
let userId: string | null = 'u-1';

vi.stubEnv('VITE_SUPABASE_URL', 'http://test.local');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key');
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    functions: { invoke: async (fn: string, opts: Invoke) => { invokes.push({ fn, body: opts.body }); return invokeImpl(fn, opts); } },
    from: (table: string) => ({
      select: (columns: string) => {
        selects.push({ table, columns });
        const res = (): Promise<Res> => Promise.resolve(tableImpl(table, columns));
        return { eq: () => ({ order: res, then: (f: (r: Res) => unknown, r?: (e: unknown) => unknown) => res().then(f, r) }) };
      },
    }),
  }),
}));
vi.mock('../identity', () => ({
  currentUserId: () => userId,
  currentIdentity: () => (userId ? { userId, displayName: 'Kev', anonymous: false, email: 'k@example.com' } : null),
}));

const { submitGauntletClear, fetchGauntletProgress } = await import('./gauntletRemote');
const { fetchOwnCrates } = await import('../progression/progressionRemote');

const crate = { crate_id: 'g-1', earned_level: null, state: 'sealed', reward_cosmetic_id: null, earned_at: null, opened_at: null, source: 'gauntlet:2' };
const httpError = (status: number, code?: string): Res => ({
  data: null, error: { name: 'FunctionsHttpError', message: 'x', context: { status, json: async () => (code ? { error: code } : {}) } },
});

beforeEach(() => {
  invokes.length = 0;
  selects.length = 0;
  userId = 'u-1';
  invokeImpl = async () => ({ data: { status: 'first_clear', crate }, error: null });
  tableImpl = () => ({ data: [], error: null });
});

describe('submitGauntletClear', () => {
  it('sends only the stage to `gauntlet-clear`; a first clear comes back with its crate', async () => {
    const out = await submitGauntletClear(2);
    expect(invokes).toEqual([{ fn: 'gauntlet-clear', body: { stage: 2 } }]);
    expect(out).toEqual({ status: 'confirmed', result: { status: 'first_clear', crate: expect.objectContaining({ crateId: 'g-1', earnedLevel: null, source: 'gauntlet:2' }) } });
  });
  it('a replay is confirmed with no crate', async () => {
    invokeImpl = async () => ({ data: { status: 'already_cleared', crate: null }, error: null });
    expect(await submitGauntletClear(2)).toEqual({ status: 'confirmed', result: { status: 'already_cleared', crate: null } });
  });
  it('definite refusals are rejected: 400 bad_stage, 403 sign_in_required', async () => {
    invokeImpl = async () => httpError(400, 'bad_stage');
    expect(await submitGauntletClear(2)).toEqual({ status: 'rejected', reason: 'bad_stage' });
    invokeImpl = async () => httpError(403, 'sign_in_required');
    expect(await submitGauntletClear(2)).toEqual({ status: 'rejected', reason: 'sign_in_required' });
  });
  it('transport-shaped failures are retryable: 401, 404 (not deployed), 500, a thrown fetch, no session', async () => {
    invokeImpl = async () => httpError(401, 'unauthenticated');
    expect(await submitGauntletClear(2)).toEqual({ status: 'retryable', reason: 'unauthenticated' });
    invokeImpl = async () => httpError(404);
    expect(await submitGauntletClear(2)).toEqual({ status: 'retryable', reason: 'http_404' });
    invokeImpl = async () => httpError(500, 'gauntlet_failed');
    expect(await submitGauntletClear(2)).toEqual({ status: 'retryable', reason: 'gauntlet_failed' });
    invokeImpl = async () => { throw new Error('offline'); };
    expect(await submitGauntletClear(2)).toEqual({ status: 'retryable', reason: 'network:offline' });
    userId = null;
    expect(await submitGauntletClear(2)).toEqual({ status: 'retryable', reason: 'no_session' });
  });
  it('a malformed answer is rejected as an outdated server', async () => {
    invokeImpl = async () => ({ data: { status: 'first_clear', crate: null }, error: null });
    expect(await submitGauntletClear(2)).toEqual({ status: 'rejected', reason: 'server_outdated' });
  });
});

describe('fetchGauntletProgress', () => {
  it('reads the account\'s cleared stages, sorted and unique', async () => {
    tableImpl = () => ({ data: [{ stage: 3 }, { stage: 1 }, { stage: 3 }, { stage: 'x' }], error: null });
    expect(await fetchGauntletProgress('u-1')).toEqual([1, 3]);
    expect(selects[0]).toMatchObject({ table: 'gauntlet_progress' });
  });
  it('a missing table is a definite "off"; anything else is "could not ask"', async () => {
    tableImpl = () => ({ data: null, error: { code: '42P01' } });
    expect(await fetchGauntletProgress('u-1')).toBe('off');
    tableImpl = () => ({ data: null, error: { code: 'PGRST205' } });
    expect(await fetchGauntletProgress('u-1')).toBe('off');
    tableImpl = () => ({ data: null, error: { code: '57014' } });
    expect(await fetchGauntletProgress('u-1')).toBeUndefined();
  });
});

describe('fetchOwnCrates reads `source`', () => {
  it('names a Gauntlet crate\'s source', async () => {
    tableImpl = () => ({ data: [crate], error: null });
    const list = await fetchOwnCrates();
    expect(selects[0]!.columns).toContain('source');
    expect(list).toEqual([expect.objectContaining({ crateId: 'g-1', source: 'gauntlet:2' })]);
  });
  it('before the migration adds the column (42703 / PGRST204) it retries once without it, so level crates still load', async () => {
    const level = { ...crate, crate_id: 'l-2', earned_level: 2, source: undefined };
    tableImpl = (_t, cols) => (cols.includes('source') ? { data: null, error: { code: '42703' } } : { data: [level], error: null });
    expect(await fetchOwnCrates()).toEqual([expect.objectContaining({ crateId: 'l-2', earnedLevel: 2 })]);
    expect(selects).toHaveLength(2);
    expect(selects[1]!.columns).not.toContain('source');
  });
  it('any other error is still "could not ask" (no retry)', async () => {
    tableImpl = () => ({ data: null, error: { code: '57014' } });
    expect(await fetchOwnCrates()).toBeUndefined();
    expect(selects).toHaveLength(1);
  });
});
