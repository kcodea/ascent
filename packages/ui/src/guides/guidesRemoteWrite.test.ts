import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GUIDES: the write half of the seam, and its three small reads, over a FAKE Supabase client. Pins what is sent to
 * `guide-write`, how each refusal is classified (the server's code and field come through untouched; transport
 * failures become `offline` / `unavailable` / `server`), and that every read is bounded.
 */
type Res = { data: unknown; error: unknown };
let invokeImpl: (fn: string, opts: { body: Record<string, unknown> }) => Promise<Res> | Res;
let tableImpl: (table: string) => Res | Promise<Res>;
let hasClient = true;
const invokes: Array<{ fn: string; body: Record<string, unknown> }> = [];
const seen: Array<{ table: string; columns: string; eq: Array<[string, unknown]>; order: string[]; end: string }> = [];

vi.mock('../remoteBoards', () => ({
  supabaseClient: () => (hasClient ? {
    functions: { invoke: async (fn: string, opts: { body: Record<string, unknown> }) => { invokes.push({ fn, body: opts.body }); return invokeImpl(fn, opts); } },
    from: (table: string) => ({
      select: (columns: string) => {
        const call = { table, columns, eq: [] as Array<[string, unknown]>, order: [] as string[], end: '' };
        seen.push(call);
        const run = (end: string) => { call.end = end; return Promise.resolve(tableImpl(table)); };
        const chain = {
          eq: (k: string, v: unknown) => { call.eq.push([k, v]); return chain; },
          order: (k: string) => { call.order.push(k); return chain; },
          range: () => run('range'),
          maybeSingle: () => run('maybeSingle'),
        };
        return chain;
      },
    }),
  } : null),
}));

const { deleteGuideRemote, fetchGuideById, fetchMyGuides, fetchTeamFlag, importBuiltInsRemote, saveGuideRemote } = await import('./guidesRemote');

const draft = {
  official: false, byline: 'Mike', sets: ['set2'], tribes: ['beast'], pairsWith: [], iconCard: 'grim', title: 'T', tagline: '',
  body: 'B', core: ['grim'], enablers: [], mentions: [], aliases: {},
};
const row = { id: '11111111-1111-4111-8111-111111111111', title: 'T', body: 'B', icon_card: 'grim', core: ['grim'], revision: 1, byline: 'Mike' };
const httpError = (status: number, body?: Record<string, unknown>): Res => ({
  data: null, error: { name: 'FunctionsHttpError', message: 'x', context: { status, json: async () => body ?? {} } },
});

beforeEach(() => {
  hasClient = true;
  invokes.length = 0;
  seen.length = 0;
  invokeImpl = () => ({ data: { guide: row }, error: null });
  tableImpl = () => ({ data: [], error: null });
  vi.useRealTimers();
});

describe('saveGuideRemote', () => {
  it('sends { op: save, guide } to guide-write and returns the parsed guide', async () => {
    const res = await saveGuideRemote(draft);
    expect(invokes).toEqual([{ fn: 'guide-write', body: { op: 'save', guide: draft } }]);
    expect(res).toMatchObject({ ok: true, value: { id: row.id, title: 'T', iconCard: 'grim' } });
  });
  it('passes the server code and field through for every refusal', async () => {
    const cases: Array<[number, Record<string, unknown>, Record<string, unknown>]> = [
      [403, { error: 'sign_in_required' }, { code: 'sign_in_required' }],
      [403, { error: 'not_allowed' }, { code: 'not_allowed' }],
      [404, { error: 'not_found' }, { code: 'not_found' }],
      [409, { error: 'conflict' }, { code: 'conflict' }],
      [422, { error: 'too_many_guides' }, { code: 'too_many_guides' }],
      [429, { error: 'rate_limited' }, { code: 'rate_limited' }],
      [422, { error: 'blocked_text', field: 'body' }, { code: 'blocked_text', field: 'body' }],
      [422, { error: 'reserved_name', field: 'byline' }, { code: 'reserved_name', field: 'byline' }],
      [422, { error: 'bad_guide', field: 'title' }, { code: 'bad_guide', field: 'title' }],
    ];
    for (const [status, body, want] of cases) {
      invokeImpl = () => httpError(status, body);
      expect(await saveGuideRemote(draft), JSON.stringify(body)).toEqual({ ok: false, ...want });
    }
  });
  it('a 404 with no code means the function is not deployed: unavailable', async () => {
    invokeImpl = () => httpError(404);
    expect(await saveGuideRemote(draft)).toEqual({ ok: false, code: 'unavailable' });
  });
  it('a 5xx with no code is server; a thrown call, no client and no answer in 15 s are offline', async () => {
    invokeImpl = () => httpError(500);
    expect(await saveGuideRemote(draft)).toEqual({ ok: false, code: 'server' });
    invokeImpl = () => { throw new Error('network'); };
    expect(await saveGuideRemote(draft)).toEqual({ ok: false, code: 'offline' });
    hasClient = false;
    expect(await saveGuideRemote(draft)).toEqual({ ok: false, code: 'offline' });
    hasClient = true;
    vi.useFakeTimers();
    invokeImpl = () => new Promise<Res>(() => { /* never */ });
    const p = saveGuideRemote(draft);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await p).toEqual({ ok: false, code: 'offline' });
  });
  it('an answer with no usable guide in it is server, not a crash', async () => {
    invokeImpl = () => ({ data: { guide: { nothing: true } }, error: null });
    expect(await saveGuideRemote(draft)).toEqual({ ok: false, code: 'server' });
    invokeImpl = () => ({ data: null, error: null });
    expect(await saveGuideRemote(draft)).toEqual({ ok: false, code: 'server' });
  });
});

describe('deleteGuideRemote and importBuiltInsRemote', () => {
  it('delete sends the row id', async () => {
    invokeImpl = () => ({ data: { deleted: row.id }, error: null });
    expect(await deleteGuideRemote(row.id)).toEqual({ ok: true, value: true });
    expect(invokes).toEqual([{ fn: 'guide-write', body: { op: 'delete', id: row.id } }]);
  });
  it('import sends the guides and returns the counts as numbers', async () => {
    invokeImpl = () => ({ data: { inserted: 11, skipped: 0 }, error: null });
    expect(await importBuiltInsRemote([draft])).toEqual({ ok: true, value: { inserted: 11, skipped: 0 } });
    expect(invokes).toEqual([{ fn: 'guide-write', body: { op: 'importBuiltIns', guides: [draft] } }]);
  });
  it('a refusal comes through for both', async () => {
    invokeImpl = () => httpError(403, { error: 'not_allowed' });
    expect(await deleteGuideRemote(row.id)).toEqual({ ok: false, code: 'not_allowed' });
    expect(await importBuiltInsRemote([draft])).toEqual({ ok: false, code: 'not_allowed' });
  });
});

describe('the three small reads', () => {
  it('fetchTeamFlag reads only the caller\'s own row; a row means team, none means not', async () => {
    tableImpl = () => ({ data: { user_id: 'u-1' }, error: null });
    expect(await fetchTeamFlag('u-1')).toBe(true);
    expect(seen[0]).toMatchObject({ table: 'guide_team', eq: [['user_id', 'u-1']], end: 'maybeSingle' });
    tableImpl = () => ({ data: null, error: null });
    expect(await fetchTeamFlag('u-1')).toBe(false);
  });
  it('fetchTeamFlag is undefined (unknown) on an error or with no client, never false', async () => {
    tableImpl = () => ({ data: null, error: { message: 'x' } });
    expect(await fetchTeamFlag('u-1')).toBeUndefined();
    hasClient = false;
    expect(await fetchTeamFlag('u-1')).toBeUndefined();
  });
  it('fetchMyGuides reads the caller\'s non-official guides, in a stable order, paged', async () => {
    tableImpl = () => ({ data: [row, { id: 'no-title' }], error: null });
    const res = await fetchMyGuides('u-1');
    expect(seen[0]).toMatchObject({ table: 'guides', eq: [['author_id', 'u-1'], ['official', false]], order: ['created_at', 'id'], end: 'range' });
    expect(res).toHaveLength(1);
    expect(res![0]).toMatchObject({ id: row.id });
  });
  it('fetchMyGuides is undefined on an error', async () => {
    tableImpl = () => ({ data: null, error: { message: 'x', code: '500' } });
    expect(await fetchMyGuides('u-1')).toBeUndefined();
  });
  it('fetchGuideById answers the guide, null when it is gone, undefined when it could not ask', async () => {
    tableImpl = () => ({ data: row, error: null });
    expect(await fetchGuideById(row.id)).toMatchObject({ id: row.id });
    expect(seen[0]).toMatchObject({ table: 'guides', eq: [['id', row.id]], end: 'maybeSingle' });
    tableImpl = () => ({ data: null, error: null });
    expect(await fetchGuideById(row.id)).toBeNull();
    tableImpl = () => ({ data: null, error: { message: 'x' } });
    expect(await fetchGuideById(row.id)).toBeUndefined();
  });
});
