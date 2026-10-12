import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import { GUIDE_COLUMNS } from './guidesRemote';
import { builtInImportPayload } from './guideDrafts';
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
let db: PGlite;

type Row = Record<string, unknown>;

/** The SQL each function name stands for, called the way the Edge Function's service-role client calls it. */
const CALLS: Readonly<Record<string, (a: Record<string, unknown>) => [string, unknown[]]>> = {
  guide_save: (a) => ['select public.guide_save($1::uuid, $2::jsonb) as r', [a.p_user, JSON.stringify(a.p_doc)]],
  guide_import_builtins: (a) => ['select public.guide_import_builtins($1::uuid, $2::jsonb) as r', [a.p_user, JSON.stringify(a.p_docs)]],
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

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(MIGRATION);
  for (const u of [TEAM, PLAYER]) await db.query('insert into auth.users (id) values ($1)', [u]);
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
  it('the eleven built-in guides import through the real handler and read back identical', async () => {
    expect(BUNDLED_GUIDE_DATA).toHaveLength(11);
    // The payload, built by the same function the Import button uses.
    BUNDLED_GUIDE_DATA.forEach((d, i) => expect(GUIDES[i]!.id).toBe(d.id));
    const guides = builtInImportPayload();
    const logged: unknown[] = [];
    const res = await handleGuideWrite(TEAM, false, { op: 'importBuiltIns', guides }, rpc, (msg, detail) => { logged.push([msg, detail]); });
    expect(logged).toEqual([]);
    expect(res).toEqual({ status: 200, body: { inserted: 11, skipped: 0 } });

    // Read back as a signed-out player, with exactly the client's column list and order.
    const rows = await readAs('anon', null, `select ${GUIDE_COLUMNS} from public.guides where official order by sort_order, id`);
    expect(rows).toHaveLength(11);
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
