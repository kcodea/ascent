import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GUIDES, STEP 4: the seam's four new writes and three team reads over a FAKE Supabase client. Pins what is sent to
 * `guide-write`, that every refusal's code comes through, the queries (open reports with their guides, hidden guides,
 * the tags of every guide), a stable order, and that every read pages.
 */
type Res = { data: unknown; error: unknown };
let invokeImpl: (body: Record<string, unknown>) => Res | Promise<Res>;
let tableImpl: (table: string) => Res | Promise<Res>;
let hasClient = true;
const invokes: Array<Record<string, unknown>> = [];
interface Call { table: string; columns: string; eq: Array<[string, unknown]>; order: Array<[string, unknown]>; ranged: boolean }
const calls: Call[] = [];

vi.mock('../remoteBoards', () => ({
  supabaseClient: () => (hasClient ? {
    functions: { invoke: async (_fn: string, opts: { body: Record<string, unknown> }) => { invokes.push(opts.body); return invokeImpl(opts.body); } },
    from: (table: string) => ({
      select: (columns: string) => {
        const call: Call = { table, columns, eq: [], order: [], ranged: false };
        calls.push(call);
        const chain = {
          eq: (k: string, v: unknown) => { call.eq.push([k, v]); return chain; },
          order: (k: string, o: unknown) => { call.order.push([k, o]); return chain; },
          range: () => { call.ranged = true; return Promise.resolve(tableImpl(table)); },
        };
        return chain;
      },
    }),
  } : null),
}));

const { GUIDE_COLUMNS, dismissReportsRemote, fetchGuideTags, fetchHiddenGuides, fetchOpenReports, reportGuideRemote, retagSetRemote, setHiddenRemote } = await import('./guidesRemote');

const row = (id: string, patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  id, title: `T ${id}`, body: 'B', icon_card: 'grim', core: ['grim'], official: false, published: true, hidden: false, author_id: 'u-9',
  byline: 'Ann', sets: ['set2'], tribes: ['beast'], revision: 1, ...patch,
});

beforeEach(() => {
  hasClient = true;
  invokes.length = 0; calls.length = 0;
  invokeImpl = () => ({ data: {}, error: null });
  tableImpl = () => ({ data: [], error: null });
});

describe('the four writes', () => {
  it('report sends the reason and the note', async () => {
    invokeImpl = () => ({ data: { reported: true }, error: null });
    expect(await reportGuideRemote('g1', 'spam', 'a note')).toEqual({ ok: true, value: true });
    expect(invokes).toEqual([{ op: 'report', id: 'g1', reason: 'spam', note: 'a note' }]);
  });
  it('a report answer that does not say it was recorded is a server failure', async () => {
    invokeImpl = () => ({ data: {}, error: null });
    expect(await reportGuideRemote('g1', 'spam', '')).toEqual({ ok: false, code: 'server' });
  });
  it("the server's refusal comes through", async () => {
    invokeImpl = () => ({ data: null, error: { context: { status: 409, json: async () => ({ error: 'already_reported' }) } } });
    expect(await reportGuideRemote('g1', 'spam', '')).toEqual({ ok: false, code: 'already_reported' });
  });
  it('setHidden answers the guide', async () => {
    invokeImpl = () => ({ data: { guide: { id: 'g1', title: 'T', body: 'B', hidden: true, published: true, authorId: 'u-9' } }, error: null });
    const res = await setHiddenRemote('g1', true);
    expect(invokes).toEqual([{ op: 'setHidden', id: 'g1', hidden: true }]);
    expect(res.ok && res.value.hidden).toBe(true);
    expect(res.ok && res.value.authorId).toBe('u-9');
  });
  it('a setHidden answer with no guide in it that can be used is a server failure, never a guide', async () => {
    for (const data of [{}, { guide: null }, { guide: 'nope' }, { guide: { title: 'no id' } }, { guide: [] }]) {
      invokeImpl = () => ({ data, error: null });
      expect(await setHiddenRemote('g1', true), JSON.stringify(data)).toEqual({ ok: false, code: 'server' });
    }
  });
  it('a count that is not a number, or is missing, reads as 0; a number written as text is read', async () => {
    const cases: Array<[unknown, number]> = [['abc', 0], [Number.NaN, 0], [null, 0], [undefined, 0], [Number.POSITIVE_INFINITY, 0], [-1, 0], ['3', 3], [2.9, 2]];
    for (const [answer, read] of cases) {
      invokeImpl = (b) => ({ data: b.op === 'resolveReport' ? { dismissed: answer } : { tagged: answer }, error: null });
      expect(await dismissReportsRemote('g1'), String(answer)).toEqual({ ok: true, value: read });
      expect(await retagSetRemote('set3', ['g1']), String(answer)).toEqual({ ok: true, value: read });
    }
  });
  it('dismiss and carry-over answer a count that is never negative or not a number', async () => {
    invokeImpl = (b) => ({ data: b.op === 'resolveReport' ? { dismissed: 3 } : { tagged: -2 }, error: null });
    expect(await dismissReportsRemote('g1')).toEqual({ ok: true, value: 3 });
    expect(await retagSetRemote('set3', ['g1', 'g2'])).toEqual({ ok: true, value: 0 });
    expect(invokes).toEqual([{ op: 'resolveReport', id: 'g1' }, { op: 'retagSets', set: 'set3', ids: ['g1', 'g2'] }]);
  });
  it('no client is offline for every write', async () => {
    hasClient = false;
    expect(await reportGuideRemote('g1', 'spam', '')).toEqual({ ok: false, code: 'offline' });
    expect(await setHiddenRemote('g1', true)).toEqual({ ok: false, code: 'offline' });
    expect(await dismissReportsRemote('g1')).toEqual({ ok: false, code: 'offline' });
    expect(await retagSetRemote('set3', ['g1'])).toEqual({ ok: false, code: 'offline' });
  });
});

describe('the team reads', () => {
  it('open reports come with their guides, newest first, in a stable order, paged; one whose guide cannot be read is dropped', async () => {
    tableImpl = () => ({
      data: [
        { id: 'r1', guide_id: 'a', reason: 'spam', note: 'n', created_at: '2026-10-14T02:00:00Z', guide: row('a') },
        { id: 'r2', guide_id: 'b', reason: 'offensive', note: '', created_at: '2026-10-14T01:00:00Z', guide: null },
        { id: 'r3', guide_id: 'c', reason: 'made-up', note: '', created_at: '2026-10-14T00:00:00Z', guide: row('c') },
      ],
      error: null,
    });
    const res = await fetchOpenReports();
    expect(res!.map((r) => [r.id, r.guideId, r.reason, r.note, r.guide.id])).toEqual([['r1', 'a', 'spam', 'n', 'a'], ['r3', 'c', 'other', '', 'c']]);
    const c = calls[0]!;
    expect(c.table).toBe('guide_reports');
    expect(c.columns).toBe(`id, guide_id, reason, note, created_at, guide:guides(${GUIDE_COLUMNS})`);
    expect(c.eq).toEqual([['status', 'open']]);
    expect(c.order).toEqual([['created_at', { ascending: false }], ['id', { ascending: true }]]);
    expect(c.ranged).toBe(true);
  });
  it('a report whose guide comes as a list of one is read like any other', async () => {
    tableImpl = () => ({ data: [{ id: 'r1', guide_id: 'a', reason: 'spam', note: 'n', created_at: '2026-10-14T02:00:00Z', guide: [row('a')] }, { id: 'r2', guide_id: 'b', reason: 'spam', note: '', created_at: '', guide: [] }], error: null });
    const res = await fetchOpenReports();
    expect(res!.map((r) => [r.id, r.guideId, r.guide.title])).toEqual([['r1', 'a', 'T a']]);
  });
  it('hidden guides, most recently hidden first, paged', async () => {
    tableImpl = () => ({ data: [row('h1', { hidden: true }), row('h2', { hidden: true })], error: null });
    expect((await fetchHiddenGuides())!.map((g) => g.id)).toEqual(['h1', 'h2']);
    const c = calls[0]!;
    expect(c.table).toBe('guides');
    expect(c.columns).toBe(GUIDE_COLUMNS);
    expect(c.eq).toEqual([['hidden', true]]);
    expect(c.order).toEqual([['hidden_at', { ascending: false, nullsFirst: false }], ['id', { ascending: true }]]);
    expect(c.ranged).toBe(true);
  });
  it('the tags of every guide, by id, paged; a row with no id is dropped', async () => {
    tableImpl = () => ({ data: [{ id: 'a', sets: ['set2'], tribes: ['beast'], pairs_with: [], core: ['x'], enablers: ['y'], mentions: null }, { sets: [] }], error: null });
    expect(await fetchGuideTags()).toEqual([{ id: 'a', sets: ['set2'], tribes: ['beast'], pairsWith: [], core: ['x'], enablers: ['y'], mentions: [] }]);
    const c = calls[0]!;
    expect(c.table).toBe('guides');
    expect(c.columns).toBe('id, sets, tribes, pairs_with, core, enablers, mentions');
    expect(c.order).toEqual([['id', { ascending: true }]]);
    expect(c.ranged).toBe(true);
  });
  it('could not ask is undefined for each, never an empty list', async () => {
    tableImpl = () => ({ data: null, error: { message: 'boom' } });
    expect(await fetchOpenReports()).toBeUndefined();
    expect(await fetchHiddenGuides()).toBeUndefined();
    expect(await fetchGuideTags()).toBeUndefined();
    hasClient = false;
    expect(await fetchOpenReports()).toBeUndefined();
  });
});

describe('how long the team reads wait', () => {
  afterEach(() => { vi.useRealTimers(); });
  /** Ask, with a server that never answers, and say what the read has answered after each wait (in milliseconds). */
  const waits = async (read: () => Promise<unknown>, at: number[]): Promise<string[]> => {
    vi.useFakeTimers();
    tableImpl = () => new Promise<Res>(() => { /* never */ });
    let state = 'waiting';
    void read().then((v) => { state = v === undefined ? 'could not ask' : 'answered'; });
    const seen: string[] = [];
    let now = 0;
    for (const t of at) {
      await vi.advanceTimersByTimeAsync(t - now);
      now = t;
      seen.push(state);
    }
    return seen;
  };
  it('the open reports and the hidden guides wait as long as the read of every guide does, not the four seconds of a small read', async () => {
    // Each open report carries its whole guide, and a wave of reports is when the list is longest.
    for (const read of [fetchOpenReports, fetchHiddenGuides, fetchGuideTags]) {
      expect(await waits(read, [4_000, 29_999, 30_000]), read.name).toEqual(['waiting', 'waiting', 'could not ask']);
    }
  });
});
