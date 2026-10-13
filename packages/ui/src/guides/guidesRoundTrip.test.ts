import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HEROES } from '@game/sim';
import { UUID_RE, parseGuideRecord, type GuideRecord } from '@game/guides';
// TEST-ONLY DEEP IMPORTS. The Edge Function's handler and the word list are deliberately NOT exported from
// `@game/guides` (the client never runs them, and the word list must not ship in the player's bundle), so this test
// reaches into the package's source. Nothing outside a test may do this.
import { handleGuideWrite, type RpcCall } from '../../../guides/src/server';
import { isBlockedText } from '../../../guides/src/wordFilter';
import { BUNDLED_GUIDE_DATA } from './guides.bundled';
import { GUIDES, toGuide, type Guide } from './guides';
import {
  GUIDE_COLUMNS, bookmarkGuideRemote, dismissReportsRemote, reportGuideRemote, retagSetRemote, saveGuideRemote, setHiddenRemote, setPublishedRemote,
  type GuideDraftInput,
} from './guidesRemote';
import { builtInImportPayload, newSaveId } from './guideDrafts';
import { TRIBE_NAME } from './GuideParts';

/**
 * ONE REAL DOCUMENT, END TO END. The other guides tests each hold one layer still: the handler over a fake `rpc`,
 * the SQL over hand-written documents, the client reader over hand-written rows. Here nothing is faked: the payload
 * the Import button will send goes through the real handler (shape, limits, word filter), the real SQL functions
 * (PGlite runs the migration) and comes back through the client's own column list, `parseGuideRecord` and `toGuide`.
 * It fails when a key is renamed on one side only, or when the server's cleaning changes a built-in guide's text.
 */
const root = join(__dirname, '../../../..');
const MIGRATION = readFileSync(join(root, 'supabase/migrations/2026-10-12-guides.sql'), 'utf8');
/** Step 3 (publishing, bookmarks, a save that can be retried), run after step 1 as the runbook says. It replaces
 *  `guide_save`, so every test in this file drives the function that is really deployed. */
const COMMUNITY = readFileSync(join(root, 'supabase/migrations/2026-10-13-guides-community.sql'), 'utf8');
/** Step 4 (reports, hiding, carry-over), run after step 3. */
const MODERATION = readFileSync(join(root, 'supabase/migrations/2026-10-14-guides-moderation.sql'), 'utf8');

/** The same stand-ins as packages/guides/src/guides.db.test.ts: the API roles, `auth.uid()` and Supabase's default grants. */
const STUB = `
  create role anon; create role authenticated; create role service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated;
`;

const TEAM = '00000000-0000-0000-0000-00000000000a';
const PLAYER = '00000000-0000-0000-0000-00000000000b';
/** A second signed-in player, who reads and bookmarks what PLAYER publishes. */
const READER = '00000000-0000-0000-0000-00000000000c';
/** The account the client's writes are made as (the verified token, on the wire). PLAYER unless a test says otherwise. */
let caller = PLAYER;
let db: PGlite;

type Row = Record<string, unknown>;

/** The SQL each function name stands for, called the way the Edge Function's service-role client calls it. */
const CALLS: Readonly<Record<string, (a: Record<string, unknown>) => [string, unknown[]]>> = {
  guide_save: (a) => ['select public.guide_save($1::uuid, $2::jsonb) as r', [a.p_user, JSON.stringify(a.p_doc)]],
  guide_import_builtins: (a) => ['select public.guide_import_builtins($1::uuid, $2::jsonb) as r', [a.p_user, JSON.stringify(a.p_docs)]],
  guide_own_row: (a) => ['select public.guide_own_row($1::uuid, $2::uuid) as r', [a.p_user, a.p_id]],
  guide_set_published: (a) => ['select public.guide_set_published($1::uuid, $2::uuid, $3::boolean, $4::int) as r', [a.p_user, a.p_id, a.p_on, a.p_revision]],
  guide_bookmark: (a) => ['select public.guide_bookmark($1::uuid, $2::uuid, $3::boolean) as r', [a.p_user, a.p_id, a.p_on]],
  guide_report: (a) => ['select public.guide_report($1::uuid, $2::uuid, $3::text, $4::text) as r', [a.p_user, a.p_id, a.p_reason, a.p_note]],
  guide_set_hidden: (a) => ['select public.guide_set_hidden($1::uuid, $2::uuid, $3::boolean) as r', [a.p_user, a.p_id, a.p_on]],
  guide_dismiss_reports: (a) => ['select public.guide_dismiss_reports($1::uuid, $2::uuid) as r', [a.p_user, a.p_id]],
  guide_retag_set: (a) => ['select public.guide_retag_set($1::uuid, $2::text, $3::uuid[]) as r', [a.p_user, a.p_set, a.p_ids]],
};
const rpc: RpcCall = async (fn, args) => {
  const make = CALLS[fn];
  if (!make) return { data: null, error: { message: `this test has no SQL for ${fn}` } };
  try {
    const [sql, params] = make(args);
    return { data: (await db.query<{ r: unknown }>(sql, params)).rows[0]!.r, error: null };
  } catch (e) {
    return { data: null, error: { message: String((e as Error).message) } };
  }
};

/** Read the way the REST API does: as `role`, with `user` in the JWT claim, under row level security. */
async function readAs(role: 'anon' | 'authenticated', user: string | null, sql: string): Promise<Row[]> {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user ?? '']);
    await db.exec(`set local role ${role}`);
    const rows = (await db.query<Row>(sql)).rows;
    await db.exec('commit');
    return rows;
  } catch (e) {
    await db.exec('rollback');
    throw e;
  }
}

// THE CLIENT'S OWN SAVE PATH (`saveGuideRemote`), with the Edge Function stood in by the real handler over the real
// SQL. Both directions cross as JSON text, as they do on the wire, so the client reads exactly what the function sends.
vi.mock('../remoteBoards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../remoteBoards')>()),
  supabaseClient: () => ({
    functions: {
      invoke: async (_fn: string, opts: { body: unknown }) => {
        const res = await handleGuideWrite(caller, false, JSON.parse(JSON.stringify(opts.body)), rpc);
        const body = JSON.parse(JSON.stringify(res.body)) as Record<string, unknown>;
        return res.status === 200 ? { data: body, error: null } : { data: null, error: { context: { status: res.status, json: async () => body } } };
      },
    },
  }),
}));

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(MIGRATION);
  await db.exec(COMMUNITY);
  await db.exec(MODERATION);
  for (const u of [TEAM, PLAYER, READER]) await db.query('insert into auth.users (id) values ($1)', [u]);
  await db.query('insert into public.guide_team (user_id) values ($1)', [TEAM]);
}, 60_000);
afterAll(async () => { await db.close(); });

/** The fields a server row is EXPECTED to change on a built-in guide. Everything else must come back identical. */
const SERVER_OWNED: ReadonlySet<string> = new Set(['rowId', 'revision', 'order']);
/** A guide without those three, and with an absent optional field and an `undefined` one made the same thing (a
 *  built-in with no mentions has no `mentions` key; `toGuide` turns the server's empty array into `undefined`). */
const comparable = (g: Guide): Record<string, unknown> =>
  Object.fromEntries(Object.entries(g).filter(([k, v]) => !SERVER_OWNED.has(k) && v !== undefined));

describe('guides, end to end: handler -> SQL -> the client reader', () => {
  it('the built-in guides import through the real handler and read back identical', async () => {
    const count = BUNDLED_GUIDE_DATA.length;
    expect(count).toBeGreaterThan(0);
    // The payload, built by the same function the Import button uses.
    BUNDLED_GUIDE_DATA.forEach((d, i) => expect(GUIDES[i]!.id).toBe(d.id));
    const guides = builtInImportPayload();
    const logged: unknown[] = [];
    const res = await handleGuideWrite(TEAM, false, { op: 'importBuiltIns', guides }, rpc, (msg, detail) => { logged.push([msg, detail]); });
    expect(logged).toEqual([]);
    expect(res).toEqual({ status: 200, body: { inserted: count, skipped: 0 } });

    // Read back as a signed-out player, with exactly the client's column list and order.
    const rows = await readAs('anon', null, `select ${GUIDE_COLUMNS} from public.guides where official order by sort_order, id`);
    expect(rows).toHaveLength(count);
    const back = rows.map((r) => {
      const rec = parseGuideRecord(r);
      expect(rec, 'a row the client cannot parse').not.toBeNull();
      const guide = toGuide(rec!);
      expect(guide, `${rec!.slug}: a guide the client cannot place`).not.toBeNull();
      return guide!;
    });

    // Relative order is the built-in data order (the absolute `order` is the server's to choose).
    expect(back.map((g) => g.id)).toEqual(GUIDES.map((g) => g.id));
    for (const [i, got] of back.entries()) {
      const want = GUIDES[i]!;
      expect(comparable(got), want.id).toStrictEqual(comparable(want));
      // The three server-owned fields, each as expected.
      expect(want.rowId, want.id).toBeNull();
      expect(UUID_RE.test(got.rowId ?? ''), want.id).toBe(true);
      expect([want.revision, got.revision], want.id).toEqual([0, 1]);
      if (i > 0) expect(got.order, want.id).toBeGreaterThan(back[i - 1]!.order);
    }
  });

  it('a guide saved through the real handler reads back as written', async () => {
    // Every optional field non-empty, so a key renamed on one side only cannot hide behind an empty default.
    const draft = {
      byline: 'Mike', sets: ['set2'], tribes: ['beast'], pairsWith: ['dwarf'], iconCard: 'b2_sunmane', title: 'Sunmane, my way',
      tagline: 'Rally early, rally often.', body: 'Open on Sunny and stack the rally every turn.', core: ['b2_sunmane', 'b2_solaris'],
      enablers: ['b2_sunmane'], mentions: ['sylus'], aliases: { sunny: 'b2_sunmane' },
    };
    const logged: unknown[] = [];
    const res = await handleGuideWrite(PLAYER, false, { op: 'save', guide: draft }, rpc, (msg, detail) => { logged.push([msg, detail]); });
    expect(logged).toEqual([]);
    expect(res.status).toBe(200);
    const answered = res.body.guide as GuideRecord;

    const rows = await readAs('authenticated', PLAYER, `select ${GUIDE_COLUMNS} from public.guides where id = '${answered.id}'`);
    expect(rows).toHaveLength(1);
    const back = parseGuideRecord(rows[0]);
    expect(back).not.toBeNull();
    for (const k of ['title', 'tagline', 'body', 'byline', 'sets', 'tribes', 'pairsWith', 'iconCard', 'core', 'enablers', 'mentions', 'aliases'] as const) {
      expect(back![k], k).toStrictEqual(draft[k]);
    }
    expect(back).toMatchObject({ id: answered.id, slug: null, authorId: PLAYER, official: false, published: false, hidden: false, revision: 1, forkedFrom: null });
    // What the handler answered is the stored row (the timestamps differ only in type: this driver returns Dates).
    expect({ ...answered, createdAt: '', updatedAt: '' }).toStrictEqual({ ...back!, createdAt: '', updatedAt: '' });
    // And it is private: a signed-out player does not see it.
    expect(await readAs('anon', null, `select id from public.guides where id = '${answered.id}'`)).toHaveLength(0);
  });

  it('what the client reads out of a save answer is the stored row, field for field', async () => {
    // A copy of an imported Team Ascent guide, so the "Based on" fields are filled in too. The icon is not the first
    // Core card and there is a "pairs with": the two fields a second edit would write back wrong if they were lost.
    const source = (await readAs('anon', null, 'select id, title, byline from public.guides where official order by sort_order, id limit 1'))[0]!;
    const draft: GuideDraftInput = {
      official: false, byline: 'Mike', sets: ['set2'], tribes: ['beast'], pairsWith: ['dwarf'], iconCard: 'b2_sunmane', title: 'Sunmane, second opinion',
      tagline: 'Rally early, rally often.', body: 'Open on Sunny and stack the rally every turn.', core: ['b2_solaris', 'b2_sunmane'],
      enablers: ['b2_sunmane'], mentions: ['sylus'], aliases: { sunny: 'b2_sunmane' }, forkedFrom: String(source.id),
    };
    const res = await saveGuideRemote(draft);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const saved = (res as { ok: true; value: GuideRecord }).value;

    const rows = await readAs('authenticated', PLAYER, `select ${GUIDE_COLUMNS} from public.guides where id = '${saved.id}'`);
    expect(rows).toHaveLength(1);
    const back = parseGuideRecord(rows[0])!;
    // The stored row is what was asked for...
    expect(back).toMatchObject({
      authorId: PLAYER, iconCard: 'b2_sunmane', pairsWith: ['dwarf'], forkedFrom: String(source.id), forkedTitle: String(source.title),
      forkedByline: String(source.byline), official: false, published: false, sets: ['set2'], revision: 1,
    });
    // ...and the client read every field of it out of the answer (the timestamps differ only in type: this driver
    // returns Dates for a direct read, the answer carries text).
    expect({ ...saved, createdAt: '', updatedAt: '' }).toStrictEqual({ ...back, createdAt: '', updatedAt: '' });
    for (const [got, col] of [[saved.createdAt, 'created_at'], [saved.updatedAt, 'updated_at']] as const) {
      expect(got, col).not.toBe('');
      expect(new Date(got).getTime(), col).toBe(new Date(rows[0]![col] as string | Date).getTime());
    }
  });
});

describe('step 3, end to end: the client -> the handler -> SQL -> the client reader', () => {
  /** Make the client's next writes as `who`, and put PLAYER back whatever happens. */
  const as = async <T>(who: string, act: () => Promise<T>): Promise<T> => {
    caller = who;
    try { return await act(); } finally { caller = PLAYER; }
  };
  const stored = async (id: string): Promise<Row> => (await db.query<Row>('select published, published_at, title, revision, bookmark_count from public.guides where id = $1', [id])).rows[0]!;

  it('a retried save, publish, a bookmark by a second account, unpublish, publish again, and a publish refused for its stored text', async () => {
    // 1. A save carrying a save id, sent twice (the first answer "was lost"): one row, the same guide both times.
    const saveId = newSaveId();
    expect(UUID_RE.test(saveId)).toBe(true);
    const draft: GuideDraftInput = {
      official: false, saveId, byline: 'Mike', sets: ['set2'], tribes: ['beast'], pairsWith: [], iconCard: 'b2_sunmane', title: 'Sunmane, the long road',
      tagline: 'One guide, never two.', body: 'Open on Sunny and stack the rally every turn.', core: ['b2_sunmane', 'b2_solaris'],
      enablers: [], mentions: [], aliases: {},
    };
    const first = await saveGuideRemote(draft);
    expect(first.ok, JSON.stringify(first)).toBe(true);
    const again = await saveGuideRemote(draft);
    expect(again.ok, JSON.stringify(again)).toBe(true);
    const saved = (first as { ok: true; value: GuideRecord }).value;
    const replayed = (again as { ok: true; value: GuideRecord }).value;
    expect(replayed.id).toBe(saved.id);
    expect([saved.revision, replayed.revision]).toEqual([1, 1]);
    expect(replayed).toStrictEqual(saved);
    expect((await db.query('select id from public.guides where last_save_id = $1', [saveId])).rows).toHaveLength(1);
    expect((await db.query('select id from public.guides where author_id = $1 and title = $2', [PLAYER, draft.title])).rows).toHaveLength(1);
    const id = saved.id;

    // 2. Publish: what the client reads out of the answer is public, dated, and names its author.
    const pub = await setPublishedRemote(id, true);
    expect(pub.ok, JSON.stringify(pub)).toBe(true);
    const publishedGuide = toGuide((pub as { ok: true; value: GuideRecord }).value);
    expect(publishedGuide).not.toBeNull();
    expect(publishedGuide!.published).toBe(true);
    expect(publishedGuide!.publishedAt).not.toBeNull();
    expect(publishedGuide!.authorId).toBe(PLAYER);
    expect(publishedGuide!.rowId).toBe(id);
    const firstPublishedAt = publishedGuide!.publishedAt!;
    expect(Number.isNaN(new Date(firstPublishedAt).getTime())).toBe(false);
    expect((await stored(id)).published).toBe(true);

    // 3. A second account bookmarks it; its author cannot.
    expect(await as(READER, () => bookmarkGuideRemote(id, true))).toEqual({ ok: true, value: { bookmarked: true, count: 1 } });
    expect(await bookmarkGuideRemote(id, true)).toEqual({ ok: false, code: 'not_allowed' });
    expect((await stored(id)).bookmark_count).toBe(1);

    // 4. Unpublish: private again, the first-published date kept. The reader can no longer add a bookmark to it.
    const unpub = await setPublishedRemote(id, false);
    expect(unpub.ok, JSON.stringify(unpub)).toBe(true);
    const privateGuide = toGuide((unpub as { ok: true; value: GuideRecord }).value)!;
    expect(privateGuide.published).toBe(false);
    expect(privateGuide.publishedAt).toBe(firstPublishedAt);
    expect(await as(READER, () => bookmarkGuideRemote(id, true))).toEqual({ ok: false, code: 'not_found' });
    // Publish again: still the date it was FIRST published.
    const repub = await setPublishedRemote(id, true);
    expect(repub.ok, JSON.stringify(repub)).toBe(true);
    const republished = toGuide((repub as { ok: true; value: GuideRecord }).value)!;
    expect(republished.published).toBe(true);
    expect(republished.publishedAt).toBe(firstPublishedAt);

    // 5. The stored title now breaks a rule (a direct update stands in for a word list that changed after the save).
    //    Unpublishing checks no text; publishing checks the stored text today, and says which part.
    await db.query('update public.guides set title = $2 where id = $1', [id, 'Team Ascent picks']);
    const down = await setPublishedRemote(id, false);
    expect(down.ok, JSON.stringify(down)).toBe(true);
    expect(await setPublishedRemote(id, true)).toEqual({ ok: false, code: 'reserved_name', field: 'title' });
    expect(await stored(id)).toMatchObject({ published: false, title: 'Team Ascent picks' });
  });
});

describe('step 4, end to end: report, hide, unhide and carry over, as three accounts', () => {
  const as = async <T>(who: string, act: () => Promise<T>): Promise<T> => {
    caller = who;
    try { return await act(); } finally { caller = PLAYER; }
  };
  const ok = <T>(res: { ok: boolean }, label: string): T => {
    expect(res.ok, `${label}: ${JSON.stringify(res)}`).toBe(true);
    return (res as unknown as { value: T }).value;
  };
  const stored = async (id: string): Promise<Row> =>
    (await db.query<Row>('select published, hidden, hidden_by, sets, revision, bookmark_count from public.guides where id = $1', [id])).rows[0]!;
  const reports = async (id: string): Promise<Row[]> =>
    (await db.query<Row>('select reporter_id, reason, note, status, resolved_by from public.guide_reports where guide_id = $1 order by created_at, id', [id])).rows;

  it('a reader reports, only the team hides, unhides and carries over, and every answer is read the way the server meant it', async () => {
    // 1. PLAYER saves and publishes a guide. READER reports it; a second report is refused; the author cannot report their own.
    const draft: GuideDraftInput = {
      official: false, saveId: newSaveId(), byline: 'Mike', sets: ['set2'], tribes: ['beast'], pairsWith: [], iconCard: 'b2_sunmane', title: 'Sunmane, reported',
      tagline: 'A guide to report.', body: 'Open on Sunny and stack the rally every turn.', core: ['b2_sunmane', 'b2_solaris'], enablers: [], mentions: [], aliases: {},
    };
    const saved = ok<GuideRecord>(await saveGuideRemote(draft), 'save');
    const id = saved.id;
    ok<GuideRecord>(await setPublishedRemote(id, true), 'publish');

    expect(await as(READER, () => reportGuideRemote(id, 'spam', 'looks like an advert'))).toEqual({ ok: true, value: true });
    expect(await as(READER, () => reportGuideRemote(id, 'offensive', ''))).toEqual({ ok: false, code: 'already_reported' });
    expect(await reportGuideRemote(id, 'spam', '')).toEqual({ ok: false, code: 'not_allowed' });
    expect(await reports(id)).toMatchObject([{ reporter_id: READER, reason: 'spam', note: 'looks like an advert', status: 'open' }]);

    // 2. READER is not on the team: none of the three team actions is allowed, and the guide is still public.
    expect(await as(READER, () => setHiddenRemote(id, true))).toEqual({ ok: false, code: 'not_allowed' });
    expect(await as(READER, () => dismissReportsRemote(id))).toEqual({ ok: false, code: 'not_allowed' });
    expect(await as(READER, () => retagSetRemote('set3', [id]))).toEqual({ ok: false, code: 'not_allowed' });
    expect(await stored(id)).toMatchObject({ published: true, hidden: false, sets: ['set2'], revision: 1 });
    expect((await reports(id))[0]!.status).toBe('open');

    // 3. TEAM hides it. What the client reads out of the answer is hidden and still published; its author cannot publish it
    //    again; the open report is now actioned, by the team account.
    const hiddenRec = ok<GuideRecord>(await as(TEAM, () => setHiddenRemote(id, true)), 'hide');
    const hiddenGuide = toGuide(hiddenRec);
    expect(hiddenGuide).not.toBeNull();
    expect(hiddenGuide!.hidden).toBe(true);
    expect(hiddenGuide!.published).toBe(true);
    expect(hiddenGuide!.rowId).toBe(id);
    expect(hiddenGuide!.authorId).toBe(PLAYER);
    expect(await reports(id)).toMatchObject([{ status: 'actioned', resolved_by: TEAM }]);
    expect(await stored(id)).toMatchObject({ hidden: true, hidden_by: TEAM, published: true });
    // A reader can no longer read it; the team still can.
    expect(await readAs('authenticated', READER, `select id from public.guides where id = '${id}'`)).toHaveLength(0);
    expect(await readAs('authenticated', TEAM, `select id from public.guides where id = '${id}'`)).toHaveLength(1);
    // Hiding leaves it published, so asking to publish it again is "already so": the answer is the hidden guide, not a
    // refusal. The refusal is for a hidden guide the author took back to private and now tries to put public again.
    expect(toGuide(ok<GuideRecord>(await setPublishedRemote(id, true), 'publish while hidden'))).toMatchObject({ hidden: true, published: true });
    ok<GuideRecord>(await setPublishedRemote(id, false), 'unpublish while hidden');
    expect(await setPublishedRemote(id, true)).toEqual({ ok: false, code: 'guide_hidden' });
    expect(await stored(id)).toMatchObject({ hidden: true, published: false });

    // 4. TEAM unhides it (it is still private); its author publishes it again. READER bookmarks it. TEAM carries it to
    //    set3: once changed, the second time nothing to change.
    const shown = ok<GuideRecord>(await as(TEAM, () => setHiddenRemote(id, false)), 'unhide');
    expect(toGuide(shown)).toMatchObject({ hidden: false, published: false });
    expect(toGuide(ok<GuideRecord>(await setPublishedRemote(id, true), 'publish after unhide'))).toMatchObject({ hidden: false, published: true });
    expect(await as(READER, () => bookmarkGuideRemote(id, true))).toEqual({ ok: true, value: { bookmarked: true, count: 1 } });
    expect(await as(TEAM, () => retagSetRemote('set3', [id]))).toEqual({ ok: true, value: 1 });
    expect(await as(TEAM, () => retagSetRemote('set3', [id]))).toEqual({ ok: true, value: 0 });
    const after = await stored(id);
    expect(after.sets).toEqual(['set2', 'set3']);
    expect(after.revision).toBe(1);
    expect(after.bookmark_count).toBe(1);
  });
});

describe('the word filter and the game\'s own names', () => {
  it('every hero name and tribe name in the game passes the word filter', () => {
    expect(HEROES.length).toBeGreaterThan(0);
    for (const h of HEROES) expect(isBlockedText(h.name), h.name).toBe(false);
    const tribes = Object.values(TRIBE_NAME);
    expect(tribes.length).toBeGreaterThan(0);
    for (const name of tribes) expect(isBlockedText(name), name).toBe(false);
  });
});
