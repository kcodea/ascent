import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * STEP 4's SQL, EXECUTED. PGlite runs the three earlier-to-later migrations (this step's twice: it must re-run
 * cleanly), then drives the functions as the Edge Function does and reads the tables as the REST API does. Pins: who
 * may report what and how often; that only the team hides, unhides, dismisses and carries over; what a hide does to
 * who can read the guide and to its reports; that a carry-over only ever adds a set; the limit on bookmark changes.
 */
const root = join(__dirname, '../../..');
const sql = (name: string): string => readFileSync(join(root, 'supabase/migrations', name), 'utf8');
const STEP1 = sql('2026-10-12-guides.sql');
const STEP3 = sql('2026-10-13-guides-community.sql');
const STEP4 = sql('2026-10-14-guides-moderation.sql');

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
const TEAM2 = '00000000-0000-0000-0000-00000000000e';
const MISSING = '99999999-9999-4999-8999-999999999999';
let db: PGlite;

type Row = Record<string, unknown>;
const doc = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  official: false, byline: 'Alice', sets: ['set2'], tribes: ['beast'], pairs_with: [], icon_card: 'grim', title: 'T', tagline: '',
  body: 'B', core: ['grim'], enablers: [], mentions: [], aliases: {}, forked_from: null, ...patch,
});
const one = async (text: string, args: unknown[]): Promise<Row> => (await db.query<{ r: Row }>(text, args)).rows[0]!.r;
const save = (user: string, d: Record<string, unknown>): Promise<Row> => one('select public.guide_save($1::uuid, $2::jsonb) as r', [user, JSON.stringify(d)]);
const publish = (user: string, id: unknown): Promise<Row> => one('select public.guide_set_published($1::uuid, $2::uuid, true, 1) as r', [user, id]);
const bookmark = (user: string, id: unknown, on: boolean): Promise<Row> => one('select public.guide_bookmark($1::uuid, $2::uuid, $3::boolean) as r', [user, id, on]);
const report = (user: string, id: unknown, reason = 'spam', note: string | null = ''): Promise<Row> =>
  one('select public.guide_report($1::uuid, $2::uuid, $3::text, $4::text) as r', [user, id, reason, note]);
const hide = (user: string, id: unknown, on: boolean): Promise<Row> => one('select public.guide_set_hidden($1::uuid, $2::uuid, $3::boolean) as r', [user, id, on]);
const dismiss = (user: string, id: unknown): Promise<Row> => one('select public.guide_dismiss_reports($1::uuid, $2::uuid) as r', [user, id]);
const retag = (user: string, set: string, ids: unknown[]): Promise<Row> => one('select public.guide_retag_set($1::uuid, $2::text, $3::uuid[]) as r', [user, set, ids]);
const err = async (p: Promise<unknown>): Promise<string> => p.then(() => 'no error', (e) => String((e as Error).message));
const count = async (text: string, args: unknown[] = []): Promise<number> => Number((await db.query<{ n: number }>(text, args)).rows[0]!.n);
const published = async (user: string, title: string): Promise<Row> => publish(user, (await save(user, doc({ title, byline: 'Someone' }))).id);

/** Run a statement the way the REST API does: as `role`, with `user` in the JWT claim. */
async function asRole<T = Row>(role: 'anon' | 'authenticated', user: string | null, text: string): Promise<T[] | string> {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user ?? '']);
    await db.exec(`set local role ${role}`);
    const rows = (await db.query<T>(text)).rows;
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

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(STEP1);
  await db.exec(STEP3);
  await db.exec(STEP4);
  await db.exec(STEP4); // re-runs cleanly
  for (const u of [TEAM, TEAM2, ALICE, BOB, CARL]) await db.query('insert into auth.users (id) values ($1)', [u]);
  for (const u of [TEAM, TEAM2]) await db.query('insert into public.guide_team (user_id) values ($1)', [u]);
}, 60_000);
afterAll(async () => { await db.close(); });
// Every test starts with no player guides (so no bookmarks or reports either) and empty logs.
beforeEach(async () => {
  await db.exec('delete from public.guides where not official; delete from public.guide_writes; delete from public.guide_bookmark_log;');
});

describe('guide_report', () => {
  it('a player reports another player\'s published guide once, with a reason and a note', async () => {
    const g = await published(ALICE, 'Rep A');
    expect(await report(BOB, g.id, 'offensive', 'Rude title')).toEqual({ reported: true });
    const rows = (await db.query<Row>('select reporter_id, reason, note, status from public.guide_reports where guide_id = $1', [g.id])).rows;
    expect(rows).toEqual([{ reporter_id: BOB, reason: 'offensive', note: 'Rude title', status: 'open' }]);
    expect(await err(report(BOB, g.id, 'spam'))).toContain('already_reported');
    expect(await count('select count(*) as n from public.guide_reports where guide_id = $1', [g.id])).toBe(1);
  });
  it('not your own, and not a Team Ascent guide', async () => {
    const g = await published(ALICE, 'Rep B');
    expect(await err(report(ALICE, g.id))).toContain('not_allowed');
    const o = await save(TEAM, doc({ official: true, title: 'Official rep' }));
    expect(await err(report(BOB, o.id))).toContain('not_allowed');
    await db.query('delete from public.guides where id = $1', [o.id]);
  });
  it('a private, hidden or missing guide is not_found', async () => {
    const priv = await save(ALICE, doc({ title: 'Rep C' }));
    expect(await err(report(BOB, priv.id))).toContain('not_found');
    const hid = await published(ALICE, 'Rep D');
    await hide(TEAM, hid.id, true);
    expect(await err(report(BOB, hid.id))).toContain('not_found');
    expect(await err(report(BOB, '99999999-9999-4999-8999-999999999999'))).toContain('not_found');
  });
  it('a reason outside the four is refused', async () => {
    const g = await published(ALICE, 'Rep E');
    expect(await err(report(BOB, g.id, 'rude'))).toContain('bad_report');
  });
  it('ten reports a day, then report_limit; an old report does not count', async () => {
    await db.query(`insert into public.guides (author_id, byline, published, published_at, sets, icon_card, title, body, core)
                    select $1, 'Alice', true, now(), '{set2}', 'grim', 'Many ' || n, 'B', '{grim}' from generate_series(1, 12) as n`, [ALICE]);
    const ids = (await db.query<{ id: string }>("select id from public.guides where title like 'Many %' order by title")).rows.map((r) => r.id);
    for (let i = 0; i < 10; i++) await report(BOB, ids[i]);
    expect(await err(report(BOB, ids[10]))).toContain('report_limit');
    await db.query("update public.guide_reports set created_at = now() - interval '2 days' where reporter_id = $1 and guide_id = $2", [BOB, ids[0]]);
    expect(await report(BOB, ids[10])).toEqual({ reported: true });
  });
  it('the daily cap is per account: another account can still report', async () => {
    await db.query(`insert into public.guides (author_id, byline, published, published_at, sets, icon_card, title, body, core)
                    select $1, 'Alice', true, now(), '{set2}', 'grim', 'Cap ' || n, 'B', '{grim}' from generate_series(1, 11) as n`, [ALICE]);
    const ids = (await db.query<{ id: string }>("select id from public.guides where title like 'Cap %' order by title")).rows.map((r) => r.id);
    for (let i = 0; i < 10; i++) await report(BOB, ids[i]);
    expect(await err(report(BOB, ids[10]))).toContain('report_limit');
    expect(await report(CARL, ids[10])).toEqual({ reported: true });
  });
  it('a note of 300 characters is kept, 301 is refused, and no note is stored as empty', async () => {
    const a = await published(ALICE, 'Rep G');
    const b = await published(ALICE, 'Rep H');
    const c = await published(ALICE, 'Rep I');
    expect(await report(BOB, a.id, 'other', 'x'.repeat(300))).toEqual({ reported: true });
    expect(await err(report(BOB, b.id, 'other', 'x'.repeat(301)))).toContain('bad_report');
    expect(await count('select count(*) as n from public.guide_reports where guide_id = $1', [b.id])).toBe(0);
    expect(await report(BOB, c.id, 'other', null)).toEqual({ reported: true });
    const rows = (await db.query<Row>('select note from public.guide_reports where guide_id = $1', [c.id])).rows;
    expect(rows).toEqual([{ note: '' }]);
    expect(await count('select char_length(note) as n from public.guide_reports where guide_id = $1', [a.id])).toBe(300);
  });
  it('a deleted guide takes its reports with it; a deleted reporter takes theirs', async () => {
    const g = await published(ALICE, 'Rep F');
    const tmp = '00000000-0000-0000-0000-0000000000f1';
    await db.query('insert into auth.users (id) values ($1)', [tmp]);
    await report(tmp, g.id);
    await report(BOB, g.id);
    await db.query('delete from auth.users where id = $1', [tmp]);
    expect(await count('select count(*) as n from public.guide_reports where guide_id = $1', [g.id])).toBe(1);
    await db.query('delete from public.guides where id = $1', [g.id]);
    expect(await count('select count(*) as n from public.guide_reports where guide_id = $1', [g.id])).toBe(0);
  });
});

describe('guide_set_hidden', () => {
  it('the team hides a guide: only its author and the team still read it, and its open reports are actioned', async () => {
    const g = await published(ALICE, 'Hid A');
    const other = await published(ALICE, 'Hid A other');
    await report(BOB, g.id);
    await report(CARL, g.id, 'offensive');
    await report(BOB, other.id);
    const h = await hide(TEAM, g.id, true);
    expect(h.hidden).toBe(true);
    expect(h.hidden_by).toBe(TEAM);
    expect(h.hidden_at).not.toBeNull();
    expect(h.published).toBe(true);
    expect(await titlesSeenBy('authenticated', BOB)).not.toContain('Hid A');
    expect(await titlesSeenBy('anon', null)).not.toContain('Hid A');
    expect(await titlesSeenBy('authenticated', ALICE)).toContain('Hid A');
    expect(await titlesSeenBy('authenticated', TEAM)).toContain('Hid A');
    const st = (await db.query<Row>('select status, resolved_by from public.guide_reports where guide_id = $1 order by reason', [g.id])).rows;
    expect(st).toEqual([{ status: 'actioned', resolved_by: TEAM }, { status: 'actioned', resolved_by: TEAM }]);
    // Another guide's report is not this guide's business.
    expect(await count("select count(*) as n from public.guide_reports where guide_id = $1 and status = 'open'", [other.id])).toBe(1);
  });
  it('unhiding makes it public again and clears who hid it; reports stay actioned', async () => {
    const g = await published(ALICE, 'Hid B');
    await report(BOB, g.id);
    await hide(TEAM, g.id, true);
    const u = await hide(TEAM, g.id, false);
    expect(u.hidden).toBe(false);
    expect(u.hidden_by).toBeNull();
    expect(u.hidden_at).toBeNull();
    expect(await titlesSeenBy('authenticated', BOB)).toContain('Hid B');
    expect(await count("select count(*) as n from public.guide_reports where guide_id = $1 and status = 'actioned'", [g.id])).toBe(1);
    // One report per guide per account, ever: the earlier reporter cannot report it again.
    expect(await err(report(BOB, g.id))).toContain('already_reported');
  });
  it('only the team; never a Team Ascent guide; a missing guide is not_found', async () => {
    const g = await published(ALICE, 'Hid C');
    expect(await err(hide(BOB, g.id, true))).toContain('not_allowed');
    expect(await err(hide(ALICE, g.id, true))).toContain('not_allowed');
    expect((await db.query<Row>('select hidden from public.guides where id = $1', [g.id])).rows[0]!.hidden).toBe(false);
    const o = await save(TEAM, doc({ official: true, title: 'Official hid' }));
    expect(await err(hide(TEAM, o.id, true))).toContain('not_allowed');
    await db.query('delete from public.guides where id = $1', [o.id]);
    expect(await err(hide(TEAM, MISSING, true))).toContain('not_found');
    // The team check comes first: a stranger learns nothing about which ids exist.
    expect(await err(hide(BOB, MISSING, true))).toContain('not_allowed');
  });
  it('hiding a hidden guide keeps who hid it first and when, still actions open reports, and answers the guide', async () => {
    const g = await published(ALICE, 'Hid E');
    const first = await hide(TEAM, g.id, true);
    await db.query("insert into public.guide_reports (guide_id, reporter_id, reason) values ($1, $2, 'spam')", [g.id, BOB]);
    const again = await hide(TEAM2, g.id, true);
    expect(again.hidden).toBe(true);
    expect(again.id).toBe(g.id);
    expect(again.hidden_by).toBe(TEAM);
    expect(again.hidden_at).toEqual(first.hidden_at);
    const st = (await db.query<Row>('select status, resolved_by from public.guide_reports where guide_id = $1', [g.id])).rows;
    expect(st).toEqual([{ status: 'actioned', resolved_by: TEAM2 }]);
    // After an unhide, the next hide is a fresh one by whoever does it.
    await hide(TEAM, g.id, false);
    expect((await hide(TEAM2, g.id, true)).hidden_by).toBe(TEAM2);
  });
  it('a missing direction never means unhide', async () => {
    const g = await published(ALICE, 'Hid F');
    await hide(TEAM, g.id, true);
    expect(await err(one('select public.guide_set_hidden($1::uuid, $2::uuid, null) as r', [TEAM, g.id]))).toContain('not_allowed');
    expect(await err(one('select public.guide_set_hidden($1::uuid, $2::uuid, null) as r', [BOB, g.id]))).toContain('not_allowed');
    expect((await db.query<Row>('select hidden from public.guides where id = $1', [g.id])).rows[0]!.hidden).toBe(true);
  });
  it('a hide does not re-mark a report that was already dismissed', async () => {
    const g = await published(ALICE, 'Hid G');
    await report(BOB, g.id);
    await dismiss(TEAM, g.id);
    await report(CARL, g.id);
    await hide(TEAM2, g.id, true);
    const st = (await db.query<Row>('select reporter_id, status, resolved_by from public.guide_reports where guide_id = $1 order by reporter_id', [g.id])).rows;
    expect(st).toEqual([{ reporter_id: BOB, status: 'dismissed', resolved_by: TEAM }, { reporter_id: CARL, status: 'actioned', resolved_by: TEAM2 }]);
  });
  it('a hidden guide keeps its bookmarks and their count, and cannot be published by its author', async () => {
    const g = await published(ALICE, 'Hid D');
    await bookmark(BOB, g.id, true);
    await hide(TEAM, g.id, true);
    expect(await count('select bookmark_count as n from public.guides where id = $1', [g.id])).toBe(1);
    await one('select public.guide_set_published($1::uuid, $2::uuid, false, null) as r', [ALICE, g.id]);
    expect(await err(publish(ALICE, g.id))).toContain('guide_hidden');
  });
});

describe('guide_dismiss_reports', () => {
  it('the team dismisses every open report of a guide; the guide stays public', async () => {
    const g = await published(ALICE, 'Dis A');
    const other = await published(ALICE, 'Dis A other');
    await report(BOB, g.id);
    await report(CARL, g.id);
    await report(BOB, other.id);
    expect(await dismiss(TEAM, g.id)).toEqual({ dismissed: 2 });
    expect(await count("select count(*) as n from public.guide_reports where guide_id = $1 and status = 'dismissed' and resolved_by = $2 and resolved_at is not null", [g.id, TEAM])).toBe(2);
    expect(await count("select count(*) as n from public.guide_reports where guide_id = $1 and status = 'open'", [other.id])).toBe(1); // another guide's report is untouched
    expect(await dismiss(TEAM, g.id)).toEqual({ dismissed: 0 });
    expect(await count("select count(*) as n from public.guide_reports where guide_id = $1 and status = 'dismissed'", [g.id])).toBe(2);
    expect(await titlesSeenBy('authenticated', BOB)).toContain('Dis A');
  });
  it('a dismissed report still stops the same account reporting that guide again', async () => {
    const g = await published(ALICE, 'Dis B');
    await report(BOB, g.id);
    await dismiss(TEAM, g.id);
    expect(await err(report(BOB, g.id))).toContain('already_reported');
  });
  it('only the team', async () => {
    const g = await published(ALICE, 'Dis C');
    await report(BOB, g.id);
    expect(await err(dismiss(BOB, g.id))).toContain('not_allowed');
    expect(await count("select count(*) as n from public.guide_reports where guide_id = $1 and status = 'open'", [g.id])).toBe(1);
  });
});

describe('guide_retag_set', () => {
  it('the team adds a set to the named guides, once, and never removes one', async () => {
    const a = await save(ALICE, doc({ title: 'Tag A', sets: ['set2'] }));
    const b = await save(ALICE, doc({ title: 'Tag B', sets: ['set2', 'set3'] }));
    const c = await save(ALICE, doc({ title: 'Tag C', sets: ['set1'] }));
    expect(await retag(TEAM, 'set3', [a.id, b.id])).toEqual({ tagged: 1 });
    const sets = async (id: unknown): Promise<unknown> => (await db.query<Row>('select sets from public.guides where id = $1', [id])).rows[0]!.sets;
    expect(await sets(a.id)).toEqual(['set2', 'set3']);
    expect(await sets(b.id)).toEqual(['set2', 'set3']);
    expect(await sets(c.id)).toEqual(['set1']);
    expect(await retag(TEAM, 'set3', [a.id, b.id])).toEqual({ tagged: 0 }); // running it again changes nothing
  });
  it('it does not bump the revision or touch the text, so an author editing is not disturbed', async () => {
    const a = await save(ALICE, doc({ title: 'Tag D' }));
    await retag(TEAM, 'set3', [a.id]);
    const row = (await db.query<Row>('select revision, title from public.guides where id = $1', [a.id])).rows[0]!;
    expect(row).toEqual({ revision: 1, title: 'Tag D' });
  });
  it('only the team; a set id that is not a set id is refused; so is an empty or oversized list', async () => {
    const a = await save(ALICE, doc({ title: 'Tag E' }));
    expect(await err(retag(ALICE, 'set3', [a.id]))).toContain('not_allowed');
    expect(await err(retag(TEAM, "set3'); drop table guides; --", [a.id]))).toContain('bad_set');
    expect(await err(retag(TEAM, 'setx', [a.id]))).toContain('bad_set');
    expect(await err(retag(TEAM, 'xset3', [a.id]))).toContain('bad_set'); // the start of the pattern is anchored too
    expect(await err(retag(TEAM, 'set3x', [a.id]))).toContain('bad_set');
    expect(await err(retag(TEAM, 'set3', []))).toContain('bad_ids');
    const many = Array.from({ length: 201 }, () => a.id);
    expect(await err(retag(TEAM, 'set3', many))).toContain('bad_ids');
    expect(await count('select count(*) as n from public.guides')).toBeGreaterThan(0);
  });
  it('an id that names no guide is skipped, not an error', async () => {
    const a = await save(ALICE, doc({ title: 'Tag F' }));
    expect(await retag(TEAM, 'set3', [a.id, MISSING])).toEqual({ tagged: 1 });
  });
  it('a guide whose sets hold a NULL element is still tagged, once', async () => {
    const a = await save(ALICE, doc({ title: 'Tag G' }));
    await db.query("update public.guides set sets = array['set2', null]::text[] where id = $1", [a.id]);
    expect(await retag(TEAM, 'set3', [a.id])).toEqual({ tagged: 1 });
    expect((await db.query<Row>('select sets from public.guides where id = $1', [a.id])).rows[0]!.sets).toEqual(['set2', null, 'set3']);
    expect(await retag(TEAM, 'set3', [a.id])).toEqual({ tagged: 0 });
  });
});

describe('a limit on bookmark changes', () => {
  it('120 changes an hour, then rate_limited; a call that changes nothing is not counted', async () => {
    const g = await published(ALICE, 'Lim A');
    await bookmark(BOB, g.id, true);
    await bookmark(BOB, g.id, true); // already bookmarked: nothing changes
    await bookmark(BOB, g.id, false);
    await bookmark(BOB, g.id, false); // already removed
    expect(await count('select count(*) as n from public.guide_bookmark_log where user_id = $1', [BOB])).toBe(2);
    await db.query('insert into public.guide_bookmark_log (user_id) select $1 from generate_series(1, 118)', [BOB]);
    expect(await err(bookmark(BOB, g.id, true))).toContain('rate_limited');
    expect(await err(bookmark(BOB, g.id, false))).toContain('rate_limited');
    // The limit is per account: nobody else is held up by it.
    expect((await bookmark(CARL, g.id, true)).bookmarked).toBe(true);
    await db.query("update public.guide_bookmark_log set at = now() - interval '2 hours' where user_id = $1", [BOB]);
    expect((await bookmark(BOB, g.id, true)).bookmarked).toBe(true);
  });
  it('the 120th change in an hour is accepted and the 121st is refused', async () => {
    const g = await published(ALICE, 'Lim C');
    await db.query('insert into public.guide_bookmark_log (user_id) select $1 from generate_series(1, 119)', [BOB]);
    expect((await bookmark(BOB, g.id, true)).bookmarked).toBe(true);
    expect(await err(bookmark(BOB, g.id, false))).toContain('rate_limited');
  });
  it('a missing direction is refused and removes nothing', async () => {
    const g = await published(ALICE, 'Lim D');
    await bookmark(BOB, g.id, true);
    expect(await err(one('select public.guide_bookmark($1::uuid, $2::uuid, null) as r', [BOB, g.id]))).toContain('not_allowed');
    expect(await count('select count(*) as n from public.guide_bookmarks where user_id = $1', [BOB])).toBe(1);
  });
  it('the step 3 rules still hold: not your own, the count follows', async () => {
    const g = await published(ALICE, 'Lim B');
    expect(await err(bookmark(ALICE, g.id, true))).toContain('not_allowed');
    expect(await bookmark(BOB, g.id, true)).toEqual({ bookmarked: true, count: 1 });
    expect(await bookmark(BOB, g.id, false)).toEqual({ bookmarked: false, count: 0 });
  });
  it('a guide you could not read is not_found, a Team Ascent guide is not_allowed', async () => {
    const priv = await save(ALICE, doc({ title: 'Lim Private' }));
    const hid = await published(ALICE, 'Lim Hidden');
    await hide(TEAM, hid.id, true);
    const o = await save(TEAM, doc({ official: true, title: 'Official bm' }));
    expect(await err(bookmark(BOB, priv.id, true))).toContain('not_found');
    expect(await err(bookmark(BOB, hid.id, true))).toContain('not_found');
    expect(await err(bookmark(BOB, MISSING, true))).toContain('not_found');
    expect(await err(bookmark(BOB, o.id, true))).toContain('not_allowed');
    expect(await err(bookmark(TEAM, o.id, true))).toContain('not_allowed');
    expect(await err(bookmark(ALICE, hid.id, true))).toContain('not_allowed'); // the author still sees it, and may not bookmark it
    expect(await count('select count(*) as n from public.guide_bookmarks')).toBe(0);
    expect(await count('select count(*) as n from public.guide_bookmark_log')).toBe(0); // refusals are not counted
    await db.query('delete from public.guides where id = $1', [o.id]);
  });
  it('200 bookmarks at most', async () => {
    await db.query(`insert into public.guides (author_id, byline, published, published_at, sets, icon_card, title, body, core)
                    select $1, 'Alice', true, now(), '{set2}', 'grim', 'Bm ' || n, 'B', '{grim}' from generate_series(1, 201) as n`, [ALICE]);
    const ids = (await db.query<{ id: string }>("select id from public.guides where title like 'Bm %' order by title")).rows.map((r) => r.id);
    await db.query('insert into public.guide_bookmarks (user_id, guide_id) select $1, unnest($2::uuid[])', [BOB, ids.slice(0, 200)]);
    expect(await err(bookmark(BOB, ids[200]!, true))).toContain('too_many_bookmarks');
    expect(await bookmark(BOB, ids[0]!, true)).toMatchObject({ bookmarked: true }); // already one of the 200: nothing to add
    expect(await bookmark(BOB, ids[0]!, false)).toMatchObject({ bookmarked: false });
    expect((await bookmark(BOB, ids[200]!, true)).bookmarked).toBe(true); // a place is free again
  });
  it('removing a bookmark of a hidden guide answers a count of 0, while the real count goes down by one', async () => {
    const g = await published(ALICE, 'Lim E');
    await bookmark(BOB, g.id, true);
    await bookmark(CARL, g.id, true);
    await hide(TEAM, g.id, true);
    expect(await bookmark(BOB, g.id, false)).toEqual({ bookmarked: false, count: 0 });
    expect(await count('select bookmark_count as n from public.guides where id = $1', [g.id])).toBe(1);
  });
});

describe('the locks', () => {
  it('no client role can call the new functions, read the bookmark log, or read reports unless on the team', async () => {
    const g = await published(ALICE, 'Lock A');
    await report(BOB, g.id, 'spam', 'secret note');
    for (const role of ['anon', 'authenticated'] as const) {
      expect(await asRole(role, BOB, `select public.guide_report('${BOB}'::uuid, '${String(g.id)}'::uuid, 'spam', '')`)).toMatch(/permission denied/);
      expect(await asRole(role, BOB, `select public.guide_set_hidden('${BOB}'::uuid, '${String(g.id)}'::uuid, true)`)).toMatch(/permission denied/);
      expect(await asRole(role, BOB, `select public.guide_dismiss_reports('${BOB}'::uuid, '${String(g.id)}'::uuid)`)).toMatch(/permission denied/);
      expect(await asRole(role, BOB, `select public.guide_retag_set('${BOB}'::uuid, 'set3', array['${String(g.id)}']::uuid[])`)).toMatch(/permission denied/);
      expect(await asRole(role, BOB, 'select * from public.guide_bookmark_log')).toMatch(/permission denied/);
      expect(await asRole(role, BOB, 'select note from public.guide_reports')).toEqual([]);
    }
    expect(await asRole('authenticated', ALICE, 'select note from public.guide_reports')).toEqual([]); // not even about her own guide
    expect(await asRole('authenticated', TEAM, 'select note from public.guide_reports')).toEqual([{ note: 'secret note' }]);
  });
  it('every new function refuses a missing caller', async () => {
    const g = await published(ALICE, 'Lock B');
    expect(await err(one('select public.guide_report(null, $1::uuid, $2, $3) as r', [g.id, 'spam', '']))).toContain('unauthenticated');
    expect(await err(one('select public.guide_set_hidden(null, $1::uuid, true) as r', [g.id]))).toContain('unauthenticated');
    expect(await err(one('select public.guide_dismiss_reports(null, $1::uuid) as r', [g.id]))).toContain('unauthenticated');
    expect(await err(one('select public.guide_retag_set(null, $1, $2::uuid[]) as r', ['set3', [g.id]]))).toContain('unauthenticated');
  });
});
