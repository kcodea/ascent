import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * STEP 3's SQL, EXECUTED. PGlite runs the step 1 migration, then this step's (twice: it must re-run cleanly), then
 * drives the write functions as the Edge Function does and reads the tables as the REST API does. Pins: a repeated
 * save is applied once; who may publish, and that a hidden or changed guide is refused; who may bookmark what, the
 * 200 cap and the count; and that what was public stops being readable the moment it is unpublished.
 */
const root = join(__dirname, '../../..');
const STEP1 = readFileSync(join(root, 'supabase/migrations/2026-10-12-guides.sql'), 'utf8');
const STEP3 = readFileSync(join(root, 'supabase/migrations/2026-10-13-guides-community.sql'), 'utf8');

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
const ALICE = '00000000-0000-0000-0000-00000000000b';
const BOB = '00000000-0000-0000-0000-00000000000c';
const CARL = '00000000-0000-0000-0000-00000000000d';
/** Owns the 201 guides of the bookmark-cap test, so no real author's 20-guide cap is touched. */
const FILL = '00000000-0000-0000-0000-0000000000f0';
const SAVE1 = '22222222-2222-4222-8222-222222222221';
const SAVE2 = '22222222-2222-4222-8222-222222222222';
let db: PGlite;

type Row = Record<string, unknown>;
const doc = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  official: false, byline: 'Alice', sets: ['set2'], tribes: ['beast'], pairs_with: [], icon_card: 'grim', title: 'T', tagline: '',
  body: 'B', core: ['grim'], enablers: [], mentions: [], aliases: {}, forked_from: null, ...patch,
});
const one = async (sql: string, args: unknown[]): Promise<Row> => (await db.query<{ r: Row }>(sql, args)).rows[0]!.r;
const save = (user: string, d: Record<string, unknown>): Promise<Row> => one('select public.guide_save($1::uuid, $2::jsonb) as r', [user, JSON.stringify(d)]);
const own = (user: string, id: unknown): Promise<Row> => one('select public.guide_own_row($1::uuid, $2::uuid) as r', [user, id]);
const publish = (user: string, id: unknown, on: boolean, rev: number | null): Promise<Row> =>
  one('select public.guide_set_published($1::uuid, $2::uuid, $3::boolean, $4::int) as r', [user, id, on, rev]);
const bookmark = (user: string, id: unknown, on: boolean): Promise<Row> => one('select public.guide_bookmark($1::uuid, $2::uuid, $3::boolean) as r', [user, id, on]);
const err = async (p: Promise<unknown>): Promise<string> => p.then(() => 'no error', (e) => String((e as Error).message));
const count = async (sql: string, args: unknown[] = []): Promise<number> => Number((await db.query<{ n: number }>(sql, args)).rows[0]!.n);

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
const titlesSeenBy = async (role: 'anon' | 'authenticated', user: string | null): Promise<string[]> => {
  const rows = await asRole<{ title: string }>(role, user, 'select title from public.guides order by title');
  if (typeof rows === 'string') throw new Error(rows);
  return rows.map((r) => r.title);
};
/** A published guide of `user`. */
const published = async (user: string, title: string): Promise<Row> => {
  const g = await save(user, doc({ title, byline: 'Someone' }));
  return publish(user, g.id, true, g.revision as number);
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(STEP1);
  await db.exec(STEP3);
  await db.exec(STEP3); // re-runs cleanly
  for (const u of [TEAM, ALICE, BOB, CARL, FILL]) await db.query('insert into auth.users (id) values ($1)', [u]);
  await db.query('insert into public.guide_team (user_id) values ($1)', [TEAM]);
}, 60_000);
afterAll(async () => { await db.close(); });
// The 30-an-hour log is per account and this file saves often: start every test with it empty. The tests that pin
// the limit fill it themselves.
beforeEach(async () => { await db.exec('delete from public.guide_writes'); });

describe('a repeated save is applied once', () => {
  it('the same save id creates one guide and answers it again', async () => {
    const a = await save(ALICE, doc({ title: 'Once', save_id: SAVE1 }));
    const b = await save(ALICE, doc({ title: 'Once', save_id: SAVE1 }));
    expect(b.id).toBe(a.id);
    expect(b.revision).toBe(1);
    expect(await count("select count(*) as n from public.guides where title = 'Once'")).toBe(1);
  });
  it('a retried update with the same save id is not a conflict and does not bump the revision twice', async () => {
    const g = await save(ALICE, doc({ title: 'Upd' }));
    const first = await save(ALICE, doc({ id: g.id, revision: 1, title: 'Upd 2', save_id: SAVE2 }));
    expect(first.revision).toBe(2);
    const again = await save(ALICE, doc({ id: g.id, revision: 1, title: 'Upd 2', save_id: SAVE2 }));
    expect(again.revision).toBe(2);
    expect(again.title).toBe('Upd 2');
  });
  it('a stale revision with a NEW save id is still a conflict', async () => {
    const g = await save(ALICE, doc({ title: 'Stale' }));
    await save(ALICE, doc({ id: g.id, revision: 1, title: 'Stale 2' }));
    expect(await err(save(ALICE, doc({ id: g.id, revision: 1, title: 'Stale 3', save_id: '22222222-2222-4222-8222-222222222223' })))).toContain('conflict');
  });
  it("another account sending the same save id gets its own guide, never the first account's", async () => {
    const mine = await save(BOB, doc({ title: 'Bobs', byline: 'Bob', save_id: SAVE1 }));
    expect(mine.author_id).toBe(BOB);
    expect(mine.title).toBe('Bobs');
  });
  it('a replay does not count toward the 30 saves an hour', async () => {
    await db.query('delete from public.guide_writes where user_id = $1', [CARL]);
    const sid = '22222222-2222-4222-8222-22222222222a';
    await save(CARL, doc({ title: 'Carl', byline: 'Carl', save_id: sid }));
    for (let i = 0; i < 5; i++) await save(CARL, doc({ title: 'Carl', byline: 'Carl', save_id: sid }));
    expect(await count('select count(*) as n from public.guide_writes where user_id = $1', [CARL])).toBe(1);
  });
  it('a save with no save id behaves as before', async () => {
    const a = await save(ALICE, doc({ title: 'NoId' }));
    const b = await save(ALICE, doc({ title: 'NoId' }));
    expect(b.id).not.toBe(a.id);
  });
});

describe('guide_own_row', () => {
  it("answers the author's own player guide and nobody else's", async () => {
    const g = await save(ALICE, doc({ title: 'Mine' }));
    expect((await own(ALICE, g.id)).title).toBe('Mine');
    expect(await err(own(BOB, g.id))).toContain('not_allowed');
    expect(await err(own(ALICE, '99999999-9999-4999-8999-999999999999'))).toContain('not_found');
  });
  it('refuses a Team Ascent guide, even to the team', async () => {
    const o = await save(TEAM, doc({ official: true, title: 'Official one' }));
    expect(await err(own(TEAM, o.id))).toContain('not_allowed');
  });
});

describe('guide_set_published', () => {
  it('the author publishes: public, with a first-published time that later changes never move', async () => {
    const g = await save(ALICE, doc({ title: 'Pub A' }));
    expect(await titlesSeenBy('authenticated', BOB)).not.toContain('Pub A');
    const p = await publish(ALICE, g.id, true, 1);
    expect(p.published).toBe(true);
    expect(p.published_at).not.toBeNull();
    expect(p.revision).toBe(1);
    expect(await titlesSeenBy('authenticated', BOB)).toContain('Pub A');
    expect(await titlesSeenBy('anon', null)).toContain('Pub A');
    const u = await publish(ALICE, g.id, false, null);
    expect(u.published).toBe(false);
    expect(u.published_at).toBe(p.published_at);
    expect(await titlesSeenBy('authenticated', BOB)).not.toContain('Pub A');
    const again = await publish(ALICE, g.id, true, 1);
    expect(again.published_at).toBe(p.published_at);
  });
  it('only the author; never a Team Ascent guide', async () => {
    const g = await save(ALICE, doc({ title: 'Pub B' }));
    expect(await err(publish(BOB, g.id, true, 1))).toContain('not_allowed');
    expect(await err(publish(TEAM, g.id, true, 1))).toContain('not_allowed');
    const o = await save(TEAM, doc({ official: true, title: 'Official two' }));
    expect(await err(publish(TEAM, o.id, false, null))).toContain('not_allowed');
    expect(await err(publish(ALICE, '99999999-9999-4999-8999-999999999999', true, 1))).toContain('not_found');
  });
  it('a guide that changed since its text was checked is a conflict, and stays private', async () => {
    const g = await save(ALICE, doc({ title: 'Pub C' }));
    await save(ALICE, doc({ id: g.id, revision: 1, title: 'Pub C2' }));
    expect(await err(publish(ALICE, g.id, true, 1))).toContain('conflict');
    expect(await titlesSeenBy('authenticated', BOB)).not.toContain('Pub C2');
    expect((await publish(ALICE, g.id, true, 2)).published).toBe(true);
  });
  it('a hidden guide cannot be published, but can be unpublished', async () => {
    const g = await save(ALICE, doc({ title: 'Pub D' }));
    await db.query('update public.guides set hidden = true where id = $1', [g.id]);
    expect(await err(publish(ALICE, g.id, true, 1))).toContain('guide_hidden');
    await db.query('update public.guides set hidden = true, published = true where id = $1', [g.id]);
    expect((await publish(ALICE, g.id, false, null)).published).toBe(false);
  });
  it('asking for the state it is already in changes nothing and is not counted', async () => {
    await db.query('delete from public.guide_writes where user_id = $1', [BOB]);
    const g = await save(BOB, doc({ title: 'Pub E', byline: 'Bob' }));
    await publish(BOB, g.id, true, 1);
    const before = await count('select count(*) as n from public.guide_writes where user_id = $1', [BOB]);
    const same = await publish(BOB, g.id, true, 1);
    expect(same.published).toBe(true);
    expect(await count('select count(*) as n from public.guide_writes where user_id = $1', [BOB])).toBe(before);
  });
  it('publishing counts toward the 30 an hour; unpublishing is never refused for it', async () => {
    await db.query('delete from public.guide_writes where user_id = $1', [CARL]);
    const g = await save(CARL, doc({ title: 'Pub F', byline: 'Carl' }));
    await db.query("insert into public.guide_writes (user_id) select $1 from generate_series(1, 29)", [CARL]);
    expect(await err(publish(CARL, g.id, true, 1))).toContain('rate_limited');
    await db.query('delete from public.guide_writes where user_id = $1', [CARL]);
    await publish(CARL, g.id, true, 1);
    await db.query("insert into public.guide_writes (user_id) select $1 from generate_series(1, 40)", [CARL]);
    expect((await publish(CARL, g.id, false, null)).published).toBe(false);
  });
});

describe('guide_bookmark', () => {
  it("a player bookmarks another player's published guide once; the count follows", async () => {
    const g = await published(ALICE, 'Bm A');
    expect(await bookmark(BOB, g.id, true)).toEqual({ bookmarked: true, count: 1 });
    expect(await bookmark(BOB, g.id, true)).toEqual({ bookmarked: true, count: 1 });
    expect(await bookmark(CARL, g.id, true)).toEqual({ bookmarked: true, count: 2 });
    expect(await bookmark(BOB, g.id, false)).toEqual({ bookmarked: false, count: 1 });
    expect(await bookmark(BOB, g.id, false)).toEqual({ bookmarked: false, count: 1 });
    expect(await count('select bookmark_count as n from public.guides where id = $1', [g.id])).toBe(1);
  });
  it('not your own, and not a Team Ascent guide', async () => {
    const g = await published(ALICE, 'Bm B');
    expect(await err(bookmark(ALICE, g.id, true))).toContain('not_allowed');
    const o = await save(TEAM, doc({ official: true, title: 'Official three' }));
    expect(await err(bookmark(BOB, o.id, true))).toContain('not_allowed');
  });
  it('a private, hidden or missing guide is not_found (it does not say which)', async () => {
    const priv = await save(ALICE, doc({ title: 'Bm C' }));
    expect(await err(bookmark(BOB, priv.id, true))).toContain('not_found');
    const hid = await published(ALICE, 'Bm D');
    await db.query('update public.guides set hidden = true where id = $1', [hid.id]);
    expect(await err(bookmark(BOB, hid.id, true))).toContain('not_found');
    expect(await err(bookmark(BOB, '99999999-9999-4999-8999-999999999999', true))).toContain('not_found');
  });
  it('200 bookmarks, then too_many_bookmarks; removing one makes room', async () => {
    await db.query('delete from public.guide_bookmarks where user_id = $1', [CARL]);
    await db.query(`insert into public.guides (author_id, byline, published, published_at, sets, icon_card, title, body, core)
                    select $1, 'Filler', true, now(), '{set2}', 'grim', 'Fill ' || n, 'B', '{grim}' from generate_series(1, 201) as n`, [FILL]);
    await db.query(`insert into public.guide_bookmarks (user_id, guide_id)
                    select $1, id from public.guides where title like 'Fill %' order by title limit 200`, [CARL]);
    const last = (await db.query<{ id: string }>("select id from public.guides where title like 'Fill %' and id not in (select guide_id from public.guide_bookmarks where user_id = $1) limit 1", [CARL])).rows[0]!.id;
    expect(await err(bookmark(CARL, last, true))).toContain('too_many_bookmarks');
    const some = (await db.query<{ guide_id: string }>('select guide_id from public.guide_bookmarks where user_id = $1 limit 1', [CARL])).rows[0]!.guide_id;
    await bookmark(CARL, some, false);
    expect((await bookmark(CARL, last, true)).bookmarked).toBe(true);
  });
  it('the count survives the ways a bookmark can go: the guide deleted, the account deleted', async () => {
    const g = await published(ALICE, 'Bm E');
    const tmp = '00000000-0000-0000-0000-0000000000f1';
    await db.query('insert into auth.users (id) values ($1)', [tmp]);
    await bookmark(tmp, g.id, true);
    await bookmark(BOB, g.id, true);
    await db.query('delete from auth.users where id = $1', [tmp]);
    expect(await count('select bookmark_count as n from public.guides where id = $1', [g.id])).toBe(1);
    await db.query('delete from public.guides where id = $1', [g.id]);
    expect(await count('select count(*) as n from public.guide_bookmarks where guide_id = $1', [g.id])).toBe(0);
  });
  it('a player reads only their own bookmarks, and a bookmark of a guide that went private reads as no guide', async () => {
    const g = await published(ALICE, 'Bm F');
    await bookmark(BOB, g.id, true);
    const mine = await asRole<{ guide_id: string }>('authenticated', BOB, 'select guide_id from public.guide_bookmarks');
    expect(Array.isArray(mine) && mine.some((r) => r.guide_id === g.id)).toBe(true);
    const theirs = await asRole<{ guide_id: string }>('authenticated', CARL, `select guide_id from public.guide_bookmarks where guide_id = '${String(g.id)}'`);
    expect(theirs).toEqual([]);
    await publish(ALICE, g.id, false, null);
    const joined = await asRole<{ title: string | null }>('authenticated', BOB,
      `select g.title from public.guide_bookmarks b left join public.guides g on g.id = b.guide_id where b.guide_id = '${String(g.id)}'`);
    expect(joined).toEqual([{ title: null }]);
  });
});

describe('the locks', () => {
  it('no client role can call the new functions or write a bookmark', async () => {
    const g = await published(ALICE, 'Lock A');
    for (const role of ['anon', 'authenticated'] as const) {
      expect(await asRole(role, BOB, `select public.guide_set_published('${BOB}'::uuid, '${String(g.id)}'::uuid, true, 1)`)).toMatch(/permission denied/);
      expect(await asRole(role, BOB, `select public.guide_bookmark('${BOB}'::uuid, '${String(g.id)}'::uuid, true)`)).toMatch(/permission denied/);
      expect(await asRole(role, BOB, `select public.guide_own_row('${ALICE}'::uuid, '${String(g.id)}'::uuid)`)).toMatch(/permission denied/);
      expect(await asRole(role, BOB, `insert into public.guide_bookmarks (user_id, guide_id) values ('${BOB}', '${String(g.id)}')`)).toMatch(/permission denied|row-level security/);
    }
  });
  it('every new function refuses a missing caller', async () => {
    const g = await published(ALICE, 'Lock B');
    expect(await err(one('select public.guide_own_row(null, $1::uuid) as r', [g.id]))).toContain('unauthenticated');
    expect(await err(one('select public.guide_set_published(null, $1::uuid, true, 1) as r', [g.id]))).toContain('unauthenticated');
    expect(await err(one('select public.guide_bookmark(null, $1::uuid, true) as r', [g.id]))).toContain('unauthenticated');
  });
});
