import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GUIDES: the read seam over a FAKE Supabase client. Pins the query (official guides only, a stable order, paged per
 * R-NET-01), how each failure is classified (no backend / migration not run / could not ask), and that a malformed
 * row is dropped rather than thrown on.
 */
type Res = { data: unknown; error: { message: string; code?: string } | null };
let tableImpl: () => Res | Promise<Res>;
let hasClient = true;
const seen: { table?: string; columns?: string; eq: Array<[string, unknown]>; order: string[]; ranges: Array<[number, number]> } = { eq: [], order: [], ranges: [] };

vi.mock('../remoteBoards', () => ({
  supabaseClient: () => (hasClient ? {
    from: (table: string) => ({
      select: (columns: string) => {
        seen.table = table; seen.columns = columns;
        const chain = {
          eq: (k: string, v: unknown) => { seen.eq.push([k, v]); return chain; },
          order: (k: string) => { seen.order.push(k); return chain; },
          range: (a: number, b: number) => { seen.ranges.push([a, b]); return Promise.resolve(tableImpl()); },
        };
        return chain;
      },
    }),
  } : null),
}));

const { fetchOfficialGuides, GUIDE_COLUMNS } = await import('./guidesRemote');

const row = (id: string): Record<string, unknown> => ({ id, title: 'T', body: 'B', icon_card: 'grim', core: ['grim'], official: true, sort_order: 0, revision: 1 });

beforeEach(() => {
  hasClient = true;
  seen.eq = []; seen.order = []; seen.ranges = [];
  tableImpl = () => ({ data: [row('a'), row('b')], error: null });
  vi.useRealTimers();
});

describe('fetchOfficialGuides', () => {
  it('reads official guides in a stable order, paged, and parses them', async () => {
    const res = await fetchOfficialGuides();
    expect(seen.table).toBe('guides');
    expect(seen.columns).toBe(GUIDE_COLUMNS);
    expect(seen.eq).toEqual([['official', true]]);
    expect(seen.order).toEqual(['sort_order', 'id']);
    expect(seen.ranges[0]).toEqual([0, 999]);
    expect(res).toMatchObject({ state: 'on', guides: [{ id: 'a' }, { id: 'b' }] });
  });
  it('no backend configured is `no-backend`', async () => {
    hasClient = false;
    expect(await fetchOfficialGuides()).toEqual({ state: 'no-backend' });
  });
  it('a missing table (the migration has not run) is a definite `off`', async () => {
    for (const code of ['42P01', 'PGRST205', 'PGRST204', '42703']) {
      tableImpl = () => ({ data: null, error: { message: 'x', code } });
      expect(await fetchOfficialGuides(), code).toEqual({ state: 'off' });
    }
  });
  it('any other error, and a thrown call, are `offline`', async () => {
    tableImpl = () => ({ data: null, error: { message: 'boom', code: '500' } });
    expect(await fetchOfficialGuides()).toEqual({ state: 'offline' });
    tableImpl = () => { throw new Error('network'); };
    expect(await fetchOfficialGuides()).toEqual({ state: 'offline' });
  });
  it('a read that never answers is `offline` after 4 seconds', async () => {
    vi.useFakeTimers();
    tableImpl = () => new Promise<Res>(() => { /* never */ });
    const p = fetchOfficialGuides();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(await p).toEqual({ state: 'offline' });
  });
  it('a malformed row is dropped, the rest are kept', async () => {
    tableImpl = () => ({ data: [row('a'), { id: 'no-title' }, null, row('c')], error: null });
    expect(await fetchOfficialGuides()).toMatchObject({ state: 'on', guides: [{ id: 'a' }, { id: 'c' }] });
  });
});
