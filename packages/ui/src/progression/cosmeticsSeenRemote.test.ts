// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * THE COLLECTION'S SEEN LIST: the network seam over a FAKE Supabase client (owner 2026-10-11: "i want to save the
 * 'seen' on the account level"). Pins what the read asks for, and above all how its answer is CLASSIFIED: only a
 * definite "no such column / table" means the server is from before the migration (the list is then the device's);
 * any other failure is "could not ask". Getting that wrong would let a device take its own baseline over the
 * account's list. Also pins the write: the `mark_cosmetics_seen` function with the ids, true only when it landed.
 */
type Res = { data: unknown; error: unknown };
let tableImpl: () => Res;
let rpcImpl: () => Res;
const reads: Array<{ table: string; columns: string; filters: string[] }> = [];
const rpcs: Array<{ fn: string; args: unknown }> = [];

vi.stubEnv('VITE_SUPABASE_URL', 'http://test.local');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key');
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: (fn: string, args: unknown) => { rpcs.push({ fn, args }); return Promise.resolve(rpcImpl()); },
    from: (table: string) => ({
      select: (columns: string) => {
        const read = { table, columns, filters: [] as string[] };
        reads.push(read);
        const chain = {
          eq: (col: string, v: unknown) => { read.filters.push(`${col}=${String(v)}`); return chain; },
          not: (col: string, op: string, v: unknown) => { read.filters.push(`not ${col} ${op} ${String(v)}`); return chain; },
          order: () => chain,
          range: () => Promise.resolve(tableImpl()),
        };
        return chain;
      },
    }),
  }),
}));
vi.mock('../identity', () => ({ currentUserId: () => 'u-1' }));

const { fetchSeenCosmeticIds, markCosmeticsSeenRemote } = await import('./progressionRemote');

beforeEach(() => { reads.length = 0; rpcs.length = 0; tableImpl = () => ({ data: [], error: null }); rpcImpl = () => ({ data: 0, error: null }); });

describe('fetchSeenCosmeticIds', () => {
  it('reads the ids of THIS account\'s rows that carry a seen time', async () => {
    tableImpl = () => ({ data: [{ cosmetic_id: 'alpha_tester' }, { cosmetic_id: 'skin_albus_1' }, { cosmetic_id: 7 }], error: null });
    expect(await fetchSeenCosmeticIds('u-1')).toEqual(['alpha_tester', 'skin_albus_1']);
    expect(reads).toEqual([{ table: 'player_cosmetics', columns: 'cosmetic_id', filters: ['user_id=u-1', 'not seen_at is null'] }]);
  });

  it('nothing seen yet is an empty list, not a refusal', async () => {
    expect(await fetchSeenCosmeticIds('u-1')).toEqual([]);
  });

  it.each(['42703', 'PGRST204', '42P01', 'PGRST205'])('a server from before the migration (%s) is "unsupported"', async (code) => {
    tableImpl = () => ({ data: null, error: { message: 'column player_cosmetics.seen_at does not exist', code } });
    expect(await fetchSeenCosmeticIds('u-1')).toBe('unsupported');
  });

  it.each(['PGRST301', '57014', '', undefined])('any other failure (%s) is "could not ask", never "unsupported"', async (code) => {
    tableImpl = () => ({ data: null, error: { message: 'boom', ...(code === undefined ? {} : { code }) } });
    expect(await fetchSeenCosmeticIds('u-1')).toBeUndefined();
  });

  it('a throw is "could not ask"', async () => {
    tableImpl = () => { throw new Error('offline'); };
    expect(await fetchSeenCosmeticIds('u-1')).toBeUndefined();
  });
});

describe('markCosmeticsSeenRemote', () => {
  it('calls mark_cosmetics_seen with the ids; true when it landed', async () => {
    expect(await markCosmeticsSeenRemote(['a', 'b'])).toBe(true);
    expect(rpcs).toEqual([{ fn: 'mark_cosmetics_seen', args: { p_ids: ['a', 'b'] } }]);
  });

  it('false when the server refused, when it threw, and (without a call) for an empty list', async () => {
    rpcImpl = () => ({ data: null, error: { message: 'function does not exist', code: 'PGRST202' } });
    expect(await markCosmeticsSeenRemote(['a'])).toBe(false);
    rpcImpl = () => { throw new Error('offline'); };
    expect(await markCosmeticsSeenRemote(['a'])).toBe(false);
    rpcs.length = 0;
    expect(await markCosmeticsSeenRemote([])).toBe(false);
    expect(rpcs).toEqual([]);
  });
});
