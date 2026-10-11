import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE GUIDES SQL, EXECUTED. PGlite runs the migration (twice: it must re-run cleanly), then drives the three write
 * functions as the Edge Function does (service role) and reads the table as the REST API does (the `anon` /
 * `authenticated` role with the caller's id in the JWT claim). Pins spec section 1's permission table at the row
 * level: who reads what, who may write what, the 20-guide cap, the 30-per-hour rate limit and edit conflicts.
 */
const root = join(__dirname, '../../..');
const MIGRATION = readFileSync(join(root, 'supabase/migrations/2026-10-12-guides.sql'), 'utf8');

const STUB = `
  create role anon; create role authenticated; create role service_role;
  -- Supabase grants the API roles every privilege on every new table and function by default; the migration's own
  -- revokes (and row level security) are what must hold the line, so model those defaults here.
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
const ALICE = '00000000-0000-0000-0000-00000000000b';
const BOB = '00000000-0000-0000-0000-00000000000c';
const SPAM = '00000000-0000-0000-0000-00000000000d';
const TEAM2 = '00000000-0000-0000-0000-00000000000e';
let db: PGlite;

const doc = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  official: false, byline: 'Alice', sets: ['set2'], tribes: ['beast'], pairs_with: [], icon_card: 'grim', title: 'T', tagline: '',
  body: 'B', core: ['grim'], enablers: [], mentions: [], aliases: {}, forked_from: null, ...patch,
});

type Row = Record<string, unknown>;
/** Call a write function as the service role (the connection's own superuser stands in for it). */
const save = async (user: string, d: Record<string, unknown>): Promise<Row> =>
  (await db.query<{ r: Row }>('select public.guide_save($1::uuid, $2::jsonb) as r', [user, JSON.stringify(d)])).rows[0]!.r;
const err = async (p: Promise<unknown>): Promise<string> => p.then(() => 'no error', (e) => String((e as Error).message));

/** Run a statement the way the REST API does: as `role`, with `user` in the JWT claim. */
async function asRole<T = Row>(role: 'anon' | 'authenticated', user: string | null, sql: string): Promise<T[] | string> {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user ?? '']);
    await db.exec(`set local role ${role}`);
    const rows = (await db.query<T>(sql)).rows;
    await db.exec('commit');
    return rows;
  } catch (e) {
    await db.exec('rollback');
    return String((e as Error).message);
  }
}
/** Run a statement as the real `service_role`, the way the Edge Function does. */
async function asServiceRole<T = Row>(sql: string): Promise<T[]> {
  await db.exec('begin');
  try {
    await db.exec('set local role service_role');
    const rows = (await db.query<T>(sql)).rows;
    await db.exec('commit');
    return rows;
  } catch (e) {
    await db.exec('rollback');
    throw e;
  }
}
const titlesSeenBy = async (role: 'anon' | 'authenticated', user: string | null): Promise<string[]> => {
  const rows = await asRole<{ title: string }>(role, user, 'select title from public.guides order by title');
  if (typeof rows === 'string') throw new Error(rows);
  return rows.map((r) => r.title);
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(MIGRATION);
  await db.exec(MIGRATION); // re-runs cleanly
  for (const u of [TEAM, ALICE, BOB, SPAM, TEAM2]) await db.query('insert into auth.users (id) values ($1)', [u]);
  for (const t of [TEAM, TEAM2]) await db.query('insert into public.guide_team (user_id) values ($1)', [t]);
}, 60_000);
afterAll(async () => { await db.close(); });

describe('guide_save', () => {
  it('a player creates a PRIVATE guide: not official, not published, revision 1, their by line', async () => {
    const r = await save(ALICE, doc({ title: 'Alice private' }));
    expect(r).toMatchObject({ author_id: ALICE, byline: 'Alice', official: false, published: false, hidden: false, revision: 1, title: 'Alice private' });
  });

  it('a non-team account can never create an official guide', async () => {
    expect(await err(save(ALICE, doc({ official: true })))).toMatch(/not_allowed/);
  });

  it('a team member creates an official guide: by line forced to Team Ascent, public, appended in order', async () => {
    const a = await save(TEAM, doc({ official: true, byline: 'ignored', title: 'Official A' }));
    const b = await save(TEAM, doc({ official: true, title: 'Official B' }));
    expect(a).toMatchObject({ official: true, published: true, byline: 'Team Ascent', author_id: null, updated_by: TEAM });
    expect(Number(b.sort_order)).toBe(Number(a.sort_order) + 1);
  });

  it('an update needs the revision it loaded, bumps it, and a stale one is a conflict', async () => {
    const r = await save(ALICE, doc({ title: 'Rev' }));
    const r2 = await save(ALICE, doc({ id: r.id, revision: 1, title: 'Rev 2' }));
    expect(r2).toMatchObject({ title: 'Rev 2', revision: 2 });
    expect(await err(save(ALICE, doc({ id: r.id, revision: 1, title: 'stale' })))).toMatch(/conflict/);
  });

  it('only the author may update a player guide; only the team may update an official one', async () => {
    const mine = await save(ALICE, doc({ title: 'Mine' }));
    expect(await err(save(BOB, doc({ id: mine.id, revision: 1 })))).toMatch(/not_allowed/);
    expect(await err(save(TEAM, doc({ id: mine.id, revision: 1 })))).toMatch(/not_allowed/); // the team hides or deletes; it does not rewrite a player's guide
    const off = await save(TEAM, doc({ official: true, title: 'Official C' }));
    expect(await err(save(ALICE, doc({ id: off.id, revision: 1, official: true })))).toMatch(/not_allowed/);
    expect(await err(save(ALICE, doc({ id: off.id, revision: 1 })))).toMatch(/not_allowed/);
    expect(await save(TEAM, doc({ id: off.id, revision: 1, official: true, title: 'Official C2' }))).toMatchObject({ title: 'Official C2', byline: 'Team Ascent' });
  });

  it('a save never flips a guide between official and player', async () => {
    const off = await save(TEAM, doc({ official: true, title: 'Flip' }));
    expect(await err(save(TEAM, doc({ id: off.id, revision: 1, official: false })))).toMatch(/not_allowed/);
  });

  it('an unknown id is not_found', async () => {
    expect(await err(save(ALICE, doc({ id: '99999999-9999-4999-8999-999999999999', revision: 1 })))).toMatch(/not_found/);
  });

  it('a duplicate snapshots the source title and by line, and only from a guide the caller can read', async () => {
    const off = await save(TEAM, doc({ official: true, title: 'Source' }));
    const copy = await save(BOB, doc({ byline: 'Bob', forked_from: off.id }));
    expect(copy).toMatchObject({ forked_from: off.id, forked_title: 'Source', forked_byline: 'Team Ascent' });
    const secret = await save(ALICE, doc({ title: 'Alice secret' }));
    const sneaky = await save(BOB, doc({ byline: 'Bob', forked_from: secret.id }));
    expect(sneaky).toMatchObject({ forked_from: null, forked_title: null, forked_byline: null });
  });

  it('a player may own at most 20 guides; official guides do not count', async () => {
    for (let i = 0; i < 20; i++) await save(SPAM, doc({ byline: 'Spam', title: `S${i}` }));
    expect(await err(save(SPAM, doc({ byline: 'Spam', title: 'S20' })))).toMatch(/too_many_guides/);
    // Official guides do not count toward the cap: a team account at 20 player guides can still publish an official one.
    for (let i = 0; i < 20; i++) await save(TEAM2, doc({ byline: 'Team', title: `T${i}` }));
    expect(await err(save(TEAM2, doc({ byline: 'Team', title: 'T20' })))).toMatch(/too_many_guides/);
    expect(await save(TEAM2, doc({ official: true, title: 'Official from Team2' }))).toMatchObject({ official: true, author_id: null });
  });

  it('30 saves an hour, then rate_limited', async () => {
    const RATE = '00000000-0000-0000-0000-000000000011';
    await db.query('insert into auth.users (id) values ($1)', [RATE]);
    const first = await save(RATE, doc({ byline: 'Rate', title: 'R' }));
    let rev = Number(first.revision);
    for (let i = 0; i < 29; i++) rev = Number((await save(RATE, doc({ id: first.id, revision: rev, byline: 'Rate' }))).revision);
    expect(await err(save(RATE, doc({ id: first.id, revision: rev, byline: 'Rate' })))).toMatch(/rate_limited/);
  });

  it('the rate log forgets saves older than a day', async () => {
    const OLD = '00000000-0000-0000-0000-000000000012';
    await db.query('insert into auth.users (id) values ($1)', [OLD]);
    await db.query("insert into public.guide_writes (user_id, at) values ($1, now() - interval '2 days'), ($1, now() - interval '3 hours')", [OLD]);
    await save(OLD, doc({ byline: 'Old', title: 'O' }));
    const left = (await db.query<{ n: number }>("select count(*)::int as n from public.guide_writes where user_id = $1 and at < now() - interval '1 day'", [OLD])).rows[0]!.n;
    expect(left).toBe(0);
  });

  it('every write function refuses a missing caller as unauthenticated', async () => {
    expect(await err(db.query("select public.guide_save(null::uuid, '{}'::jsonb)"))).toMatch(/unauthenticated/);
    expect(await err(db.query('select public.guide_delete(null::uuid, $1::uuid)', [ALICE]))).toMatch(/unauthenticated/);
    expect(await err(db.query("select public.guide_import_builtins(null::uuid, '[]'::jsonb)"))).toMatch(/unauthenticated/);
  });
});

describe('official guides own no account', () => {
  it('the table refuses an official guide with an author, an unpublished one or a different by line', async () => {
    const off = await save(TEAM, doc({ official: true, title: 'Shape' }));
    expect(off.author_id).toBeNull();
    expect(await err(db.query('update public.guides set published = false where id = $1', [off.id]))).toMatch(/guides_official_shape/);
    expect(await err(db.query('update public.guides set author_id = $2 where id = $1', [off.id, ALICE]))).toMatch(/guides_official_shape/);
    expect(await err(db.query("update public.guides set byline = 'Alice' where id = $1", [off.id]))).toMatch(/guides_official_shape/);
  });

  it('deleting a player account deletes their guides', async () => {
    const GONE = '00000000-0000-0000-0000-000000000013';
    await db.query('insert into auth.users (id) values ($1)', [GONE]);
    const a = await save(GONE, doc({ byline: 'Gone', title: 'Gone A' }));
    const b = await save(GONE, doc({ byline: 'Gone', title: 'Gone B' }));
    await db.query('update public.guides set published = true where id = $1', [b.id]);
    await db.query('delete from auth.users where id = $1', [GONE]);
    const left = (await db.query<{ n: number }>('select count(*)::int as n from public.guides where id = any($1::uuid[])', [[a.id, b.id]])).rows[0]!.n;
    expect(left).toBe(0);
  });

  it("deleting a team member's account keeps the official guide and drops their team row", async () => {
    const LEFT = '00000000-0000-0000-0000-000000000014';
    await db.query('insert into auth.users (id) values ($1)', [LEFT]);
    await db.query('insert into public.guide_team (user_id) values ($1)', [LEFT]);
    const off = await save(LEFT, doc({ official: true, title: 'Survivor' }));
    await db.query('delete from auth.users where id = $1', [LEFT]);
    const guide = (await db.query<Row>('select title, official, author_id from public.guides where id = $1', [off.id])).rows;
    expect(guide).toHaveLength(1);
    expect(guide[0]).toMatchObject({ title: 'Survivor', official: true, author_id: null });
    const team = (await db.query<{ n: number }>('select count(*)::int as n from public.guide_team where user_id = $1', [LEFT])).rows[0]!.n;
    expect(team).toBe(0);
  });
});

describe('who can read a guide', () => {
  let hiddenId: unknown;
  beforeAll(async () => {
    const pub = await save(ALICE, doc({ title: 'Alice public' }));
    const hid = await save(ALICE, doc({ title: 'Alice hidden' }));
    hiddenId = hid.id;
    // Publishing and hiding get their own functions in later steps; set the flags directly here.
    await db.query('update public.guides set published = true where id = any($1::uuid[])', [[pub.id, hid.id]]);
    await db.query('update public.guides set hidden = true where id = $1', [hid.id]);
  });

  it('everyone reads official and published guides; a private or hidden one only its author and the team', async () => {
    const bob = await titlesSeenBy('authenticated', BOB);
    expect(bob).toContain('Official A');
    expect(bob).toContain('Alice public');
    expect(bob).not.toContain('Alice private');
    expect(bob).not.toContain('Alice hidden');
    const alice = await titlesSeenBy('authenticated', ALICE);
    expect(alice).toEqual(expect.arrayContaining(['Alice private', 'Alice hidden', 'Alice public']));
    const team = await titlesSeenBy('authenticated', TEAM);
    expect(team).toEqual(expect.arrayContaining(['Alice private', 'Alice hidden']));
    const anon = await titlesSeenBy('anon', null);
    expect(anon).toContain('Official A');
    expect(anon).toContain('Alice public');
    expect(anon).not.toContain('Alice private');
    expect(anon).not.toContain('Alice hidden');
  });

  it('no client can write the table or call a write function', async () => {
    const before = (await db.query<{ n: number }>('select count(*)::int as n from public.guides')).rows[0]!.n;
    for (const role of ['authenticated', 'anon'] as const) {
      const uid = role === 'anon' ? null : BOB;
      expect(await asRole(role, uid, "update public.guides set title = 'hacked'")).toMatch(/permission denied/);
      expect(await asRole(role, uid, 'delete from public.guides')).toMatch(/permission denied/);
      expect(await asRole(role, uid, `insert into public.guides (author_id, byline, icon_card, title, body, core) values ('${BOB}', 'Bob', 'grim', 'Sneak', 'B', '{grim}')`)).toMatch(/permission denied/);
      expect(await asRole(role, uid, 'truncate public.guides cascade')).toMatch(/permission denied/);
      expect(await asRole(role, uid, 'select count(*) from public.guide_writes')).toMatch(/permission denied/);
    }
    const all = (await db.query<{ title: string }>('select title from public.guides')).rows.map((r) => r.title);
    expect(all).toHaveLength(before);
    expect(all).not.toContain('hacked');
    expect(all).not.toContain('Sneak');
    expect(all).toContain('Official A');
    for (const role of ['authenticated', 'anon'] as const) {
      const uid = role === 'anon' ? null : BOB;
      expect(await asRole(role, uid, `select public.guide_save('${BOB}'::uuid, '{}'::jsonb)`)).toMatch(/permission denied/);
      expect(await asRole(role, uid, `select public.guide_delete('${BOB}'::uuid, '${String(hiddenId)}'::uuid)`)).toMatch(/permission denied/);
      expect(await asRole(role, uid, `select public.guide_import_builtins('${BOB}'::uuid, '[]'::jsonb)`)).toMatch(/permission denied/);
      expect(await asRole(role, uid, "select public.guide_text_array('[]'::jsonb)")).toMatch(/permission denied/);
    }
  });

  it('the service role can call the write functions (the grant works)', async () => {
    const rows = await asServiceRole<{ r: Row }>(`select public.guide_save('${ALICE}'::uuid, '${JSON.stringify(doc({ title: 'Via service role' }))}'::jsonb) as r`);
    expect(rows[0]!.r).toMatchObject({ author_id: ALICE, title: 'Via service role', revision: 1 });
  });

  it('a player learns only their own team membership', async () => {
    expect(await asRole('authenticated', TEAM, 'select user_id from public.guide_team')).toHaveLength(1);
    expect(await asRole('authenticated', BOB, 'select user_id from public.guide_team')).toHaveLength(0);
  });
});

describe('guide_delete', () => {
  const del = (user: string, id: unknown): Promise<unknown> => db.query('select public.guide_delete($1::uuid, $2::uuid)', [user, id]);
  it('the author deletes their own; another player cannot; the team can delete anyone\'s', async () => {
    const a = await save(ALICE, doc({ title: 'Del A' }));
    const b = await save(ALICE, doc({ title: 'Del B' }));
    expect(await err(del(BOB, a.id))).toMatch(/not_allowed/);
    expect(await err(del(ALICE, a.id))).toBe('no error');
    expect(await err(del(TEAM, b.id))).toBe('no error');
    expect(await err(del(ALICE, a.id))).toMatch(/not_found/);
  });
  it('only the team deletes an official guide', async () => {
    const off = await save(TEAM, doc({ official: true, title: 'Del Official' }));
    expect(await err(del(ALICE, off.id))).toMatch(/not_allowed/);
    expect(await err(del(TEAM, off.id))).toBe('no error');
  });
});

describe('guide_import_builtins', () => {
  const imp = async (user: string, docs: unknown[]): Promise<Row> =>
    (await db.query<{ r: Row }>('select public.guide_import_builtins($1::uuid, $2::jsonb) as r', [user, JSON.stringify(docs)])).rows[0]!.r;
  const docs = [doc({ slug: 'set2-one', title: 'One' }), doc({ slug: 'set2-two', title: 'Two' })];

  it('team only', async () => {
    expect(await err(imp(ALICE, docs))).toMatch(/not_allowed/);
  });
  it('inserts each built-in once as an official guide, in the order given, after the official guides already there', async () => {
    const maxBefore = Number((await db.query<Row>('select max(sort_order) as m from public.guides where official')).rows[0]!.m);
    expect(maxBefore).toBeGreaterThanOrEqual(1); // earlier tests made official guides
    expect(await imp(TEAM, docs)).toEqual({ inserted: 2, skipped: 0 });
    const rows = (await db.query<Row>("select slug, official, published, byline, author_id, sort_order from public.guides where slug like 'set2-%' order by sort_order")).rows;
    expect(rows.map((r) => r.slug)).toEqual(['set2-one', 'set2-two']);
    expect(rows[0]).toMatchObject({ official: true, published: true, byline: 'Team Ascent', author_id: null });
    expect(rows.every((r) => Number(r.sort_order) > maxBefore)).toBe(true);
    expect(Number(rows[1]!.sort_order)).toBe(Number(rows[0]!.sort_order) + 1);
  });
  it('pressing it twice changes nothing, and never overwrites a guide the team has edited since', async () => {
    await db.query("update public.guides set title = 'One, edited' where slug = 'set2-one'");
    expect(await imp(TEAM, docs)).toEqual({ inserted: 0, skipped: 2 });
    expect((await db.query<Row>("select title from public.guides where slug = 'set2-one'")).rows[0]!.title).toBe('One, edited');
  });
});
