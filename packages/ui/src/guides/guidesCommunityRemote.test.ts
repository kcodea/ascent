import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GUIDE_LIMITS } from '@game/guides';

/**
 * GUIDES, STEP 3: the seam's two new writes and two new reads over a FAKE Supabase client. Pins what is sent to
 * `guide-write`; the Community query (public player guides of one set, the tribe rule, the sort, one page plus one
 * row, a stable order); that search text cannot break out of its filter; and that a bookmark whose guide can no
 * longer be read is dropped, never drawn.
 */
type Res = { data: unknown; error: unknown };
let invokeImpl: (body: Record<string, unknown>) => Res | Promise<Res>;
let tableImpl: (table: string) => Res | Promise<Res>;
let hasClient = true;
const invokes: Array<Record<string, unknown>> = [];
interface Call { table: string; columns: string; eq: Array<[string, unknown]>; contains: Array<[string, unknown]>; or: string[]; order: Array<[string, unknown]>; range: [number, number] | null }
const calls: Call[] = [];

vi.mock('../remoteBoards', () => ({
  supabaseClient: () => (hasClient ? {
    functions: { invoke: async (_fn: string, opts: { body: Record<string, unknown> }) => { invokes.push(opts.body); return invokeImpl(opts.body); } },
    from: (table: string) => ({
      select: (columns: string) => {
        const call: Call = { table, columns, eq: [], contains: [], or: [], order: [], range: null };
        calls.push(call);
        const chain = {
          eq: (k: string, v: unknown) => { call.eq.push([k, v]); return chain; },
          contains: (k: string, v: unknown) => { call.contains.push([k, v]); return chain; },
          or: (f: string) => { call.or.push(f); return chain; },
          order: (k: string, o: unknown) => { call.order.push([k, o]); return chain; },
          range: (a: number, b: number) => { call.range = [a, b]; return Promise.resolve(tableImpl(table)); },
        };
        return chain;
      },
    }),
  } : null),
}));

const { GUIDE_COLUMNS, bookmarkGuideRemote, communitySearch, fetchBookmarkedGuides, fetchCommunityPage, setPublishedRemote } = await import('./guidesRemote');

const row = (id: string, patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  id, title: `T ${id}`, body: 'B', icon_card: 'grim', core: ['grim'], official: false, published: true, hidden: false, author_id: 'u-9',
  byline: 'Ann', sets: ['set2'], tribes: ['beast'], revision: 1, bookmark_count: 0, published_at: '2026-10-13T00:00:00Z', ...patch,
});
const q = (patch: Partial<Parameters<typeof fetchCommunityPage>[0]> = {}): Parameters<typeof fetchCommunityPage>[0] =>
  ({ setId: 'set2', tribes: ['beast', 'dragon'], neutral: true, search: '', sort: 'bookmarked', offset: 0, ...patch });

beforeEach(() => {
  hasClient = true;
  invokes.length = 0; calls.length = 0;
  invokeImpl = () => ({ data: {}, error: null });
  tableImpl = () => ({ data: [], error: null });
});

describe('setPublishedRemote', () => {
  it('sends the op and reads the guide out of the answer in either key style', async () => {
    invokeImpl = () => ({ data: { guide: { id: 'g1', title: 'T', body: 'B', published: true, publishedAt: '2026-10-13T00:00:00Z', authorId: 'u-1' } }, error: null });
    const res = await setPublishedRemote('g1', true);
    expect(invokes).toEqual([{ op: 'setPublished', id: 'g1', published: true }]);
    expect(res.ok && res.value.published).toBe(true);
    expect(res.ok && res.value.publishedAt).toBe('2026-10-13T00:00:00Z');
    expect(res.ok && res.value.authorId).toBe('u-1');
  });
  it("passes the server's refusal and field through", async () => {
    invokeImpl = () => ({ data: null, error: { context: { status: 422, json: async () => ({ error: 'reserved_name', field: 'title' }) } } });
    expect(await setPublishedRemote('g1', true)).toEqual({ ok: false, code: 'reserved_name', field: 'title' });
  });
  it('an answer with no usable guide is a server failure, not a success', async () => {
    invokeImpl = () => ({ data: { guide: { nope: 1 } }, error: null });
    expect(await setPublishedRemote('g1', true)).toEqual({ ok: false, code: 'server' });
  });
});

describe('bookmarkGuideRemote', () => {
  it('bookmark and unbookmark are two ops, and the count comes back', async () => {
    invokeImpl = (b) => ({ data: { bookmarked: b.op === 'bookmark', count: 4 }, error: null });
    expect(await bookmarkGuideRemote('g1', true)).toEqual({ ok: true, value: { bookmarked: true, count: 4 } });
    expect(await bookmarkGuideRemote('g1', false)).toEqual({ ok: true, value: { bookmarked: false, count: 4 } });
    expect(invokes).toEqual([{ op: 'bookmark', id: 'g1' }, { op: 'unbookmark', id: 'g1' }]);
  });
  it('an answer that does not say whether it is bookmarked is a server failure', async () => {
    invokeImpl = () => ({ data: { count: 1 }, error: null });
    expect(await bookmarkGuideRemote('g1', true)).toEqual({ ok: false, code: 'server' });
  });
  it('no client is offline', async () => {
    hasClient = false;
    expect(await bookmarkGuideRemote('g1', true)).toEqual({ ok: false, code: 'offline' });
  });
});

describe('fetchBookmarkedGuides', () => {
  it("reads this account's bookmarks with their guides, newest first, in a stable order, paged", async () => {
    tableImpl = () => ({ data: [{ created_at: 'x', guide: row('a') }, { created_at: 'y', guide: row('b') }], error: null });
    const res = await fetchBookmarkedGuides('u-1');
    expect(res!.map((g) => g.id)).toEqual(['a', 'b']);
    const c = calls[0]!;
    expect(c.table).toBe('guide_bookmarks');
    expect(c.columns).toBe(`created_at, guide:guides(${GUIDE_COLUMNS})`);
    expect(c.eq).toEqual([['user_id', 'u-1']]);
    expect(c.order.map((o) => o[0])).toEqual(['created_at', 'guide_id']);
    expect(c.range).not.toBeNull();
  });
  it('drops a bookmark whose guide can no longer be read, went private, was hidden, is official or is their own', async () => {
    tableImpl = () => ({
      data: [
        { guide: null }, { guide: row('priv', { published: false }) }, { guide: row('hid', { hidden: true }) },
        { guide: row('off', { official: true }) }, { guide: row('own', { author_id: 'u-1' }) }, { guide: [row('arr')] }, { guide: row('ok') },
      ],
      error: null,
    });
    expect((await fetchBookmarkedGuides('u-1'))!.map((g) => g.id)).toEqual(['arr', 'ok']);
  });
  it('could not ask is undefined, never an empty list', async () => {
    tableImpl = () => ({ data: null, error: { message: 'boom' } });
    expect(await fetchBookmarkedGuides('u-1')).toBeUndefined();
    hasClient = false;
    expect(await fetchBookmarkedGuides('u-1')).toBeUndefined();
    hasClient = true;
    expect(await fetchBookmarkedGuides('')).toBeUndefined();
  });
});

describe('fetchCommunityPage', () => {
  it('asks for public player guides of this set, for these tribes or none, most bookmarked first, one page plus one row', async () => {
    const page = GUIDE_LIMITS.communityPage;
    tableImpl = () => ({ data: Array.from({ length: page + 1 }, (_, i) => row(`g${i}`)), error: null });
    const res = await fetchCommunityPage(q());
    expect(res!.guides.length).toBe(page);
    expect(res!.more).toBe(true);
    const c = calls[0]!;
    expect(c.table).toBe('guides');
    expect(c.columns).toBe(GUIDE_COLUMNS);
    expect(c.eq).toEqual([['official', false], ['published', true], ['hidden', false]]);
    expect(c.contains).toEqual([['sets', ['set2']]]);
    expect(c.or).toEqual(['tribes.ov.{beast,dragon},tribes.eq.{}']);
    expect(c.order.map((o) => o[0])).toEqual(['bookmark_count', 'published_at', 'id']);
    expect(c.range).toEqual([0, page]);
  });
  it('Newest orders by first-published time only; the next page starts where the last one ended', async () => {
    await fetchCommunityPage(q({ sort: 'newest', offset: 20 }));
    expect(calls[0]!.order.map((o) => o[0])).toEqual(['published_at', 'id']);
    expect(calls[0]!.range).toEqual([20, 20 + GUIDE_LIMITS.communityPage]);
  });
  it('a short page says there is no more', async () => {
    tableImpl = () => ({ data: [row('a'), row('b')], error: null });
    expect(await fetchCommunityPage(q())).toMatchObject({ more: false });
  });
  it('tribes only, or Neutral only; no tribe and no Neutral asks nothing and answers empty', async () => {
    await fetchCommunityPage(q({ neutral: false }));
    expect(calls[0]!.or).toEqual(['tribes.ov.{beast,dragon}']);
    calls.length = 0;
    await fetchCommunityPage(q({ tribes: [], neutral: true }));
    expect(calls[0]!.or).toEqual(['tribes.eq.{}']);
    calls.length = 0;
    expect(await fetchCommunityPage(q({ tribes: [], neutral: false }))).toEqual({ guides: [], more: false });
    expect(calls).toEqual([]);
  });
  it('a tribe or set id that is not a plain id never reaches the query', async () => {
    await fetchCommunityPage(q({ tribes: ['beast', 'x},official.eq.true,tribes.ov.{y'] }));
    expect(calls[0]!.or).toEqual(['tribes.ov.{beast},tribes.eq.{}']);
    calls.length = 0;
    expect(await fetchCommunityPage(q({ setId: 'set2},x' }))).toEqual({ guides: [], more: false });
    expect(calls).toEqual([]);
  });
  it('search looks in the title, tagline and by line, quoted, as its own filter', async () => {
    await fetchCommunityPage(q({ search: '  Imp  flood ' }));
    expect(calls[0]!.or).toEqual([
      'tribes.ov.{beast,dragon},tribes.eq.{}',
      'title.ilike."%Imp flood%",tagline.ilike."%Imp flood%",byline.ilike."%Imp flood%"',
    ]);
  });
  it('search text cannot close its quote, add a filter or match everything', async () => {
    await fetchCommunityPage(q({ search: 'a",official.eq.true,title.ilike."%' }));
    const f = calls[0]!.or[1]!;
    expect(f.split('"').length).toBe(7); // three quoted values and nothing else
    expect(f).not.toContain('official.eq.true"');
    expect(communitySearch('100%_*\\ "x"')).toBe('100 x');
    expect(communitySearch('%%%')).toBe('');
    await fetchCommunityPage(q({ search: '%%%' }));
    expect(calls[1]!.or.length).toBe(1); // nothing left to search for: no second filter
  });
  it('search text is cut to the limit, counted in characters', () => {
    expect([...communitySearch('x'.repeat(200))].length).toBe(GUIDE_LIMITS.searchQuery);
  });
  it('could not ask is undefined', async () => {
    tableImpl = () => ({ data: null, error: { message: 'boom' } });
    expect(await fetchCommunityPage(q())).toBeUndefined();
    hasClient = false;
    expect(await fetchCommunityPage(q())).toBeUndefined();
  });
});
