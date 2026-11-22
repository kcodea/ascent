import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { NAME_BLOCK_SUB, NAME_BLOCK_WORDS, NAME_FLAG_SUB, NAME_FLAG_WORDS, nameKey, nameVerdict } from '@game/sim';
import { MODERATION_STUB, readModerationMigration } from './moderationDb';

/**
 * THE MODERATION SQL, EXECUTED (supabase/migrations/2026-11-28-moderation.sql; R-NAME-FILTER-01).
 *
 * PGlite builds the tables it touches under Supabase's default grants (every new public function is granted to anon +
 * authenticated), seeds names that were stored before the filter existed, applies the migration TWICE (idempotent),
 * then proves: the SQL filter is the TS filter (same lists, same verdicts); a slur is refused where each name is
 * written; a flagged name lands in the queue; the dashboard's actions change state and are logged; a reset name
 * cannot come back; and nothing of it is callable by anon or authenticated.
 */
const SQL = readModerationMigration();

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const C = '00000000-0000-0000-0000-00000000000c';
const D = '00000000-0000-0000-0000-00000000000d';
const OLD_SLUR = '00000000-0000-0000-0000-0000000000e1';
const OLD_FLAG = '00000000-0000-0000-0000-0000000000e2';
const TEAM = '20000000-0000-0000-0000-000000000001';
const WRITER_SECRET = 'writer-secret-for-tests';

let db: PGlite;

async function as<T>(role: 'anon' | 'authenticated' | 'service_role' | 'postgres', sql: string, params: unknown[] = [], uid?: string): Promise<T[]> {
  await db.exec('begin');
  try {
    if (role !== 'postgres') await db.exec(`set local role ${role}`);
    if (uid) await db.query(`select set_config('test.uid', $1, true)`, [uid]);
    const r = await db.query<T>(sql, params);
    await db.exec('commit');
    return r.rows;
  } catch (e) {
    await db.exec('rollback');
    throw e;
  }
}
type Json = Record<string, any>;
const svc = async (sql: string, params: unknown[] = []): Promise<Json> => (await as<{ j: Json }>('service_role', `select ${sql} as j`, params))[0]!.j;
const flags = async (): Promise<Json[]> => (await db.query<Json>('select * from moderation.name_flags order by created_at')).rows;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(MODERATION_STUB);
  await db.exec(`
    insert into public.profiles (user_id, author, discriminator, games_played) values
      ('${A}', 'Kevin', '1111', 5), ('${B}', 'Mike', '2222', 3), ('${C}', 'Ann', '3333', 1), ('${D}', 'Player', '1111', 2),
      ('${OLD_SLUR}', 'Niiigger', '4444', 1), ('${OLD_FLAG}', 'ShitLord', '5555', 1);
    insert into public.duos_teams (id, user_lo, user_hi, name) values ('${TEAM}', '${A}', '${B}', 'Wild Cards');
    insert into public.versus_cf_writer_keys values ('${createHash('sha256').update(WRITER_SECRET).digest('hex')}');
  `);
  await db.exec(SQL);
  await db.exec(SQL);
}, 60_000);
afterAll(async () => { await db.close(); });

describe('the SQL filter mirrors packages/sim/src/nameFilter.ts', () => {
  const sqlList = (name: string): string[] => {
    const m = new RegExp(`${name} constant text\\[\\] := array\\[([\\s\\S]*?)\\];`).exec(SQL);
    if (!m) throw new Error(`no ${name} in the migration`);
    return [...m[1]!.matchAll(/'([^']*)'/g)].map((x) => x[1]!);
  };
  it('carries the same four lists', () => {
    expect(sqlList('c_block_sub')).toEqual([...NAME_BLOCK_SUB]);
    expect(sqlList('c_block_words')).toEqual([...NAME_BLOCK_WORDS]);
    expect(sqlList('c_flag_sub')).toEqual([...NAME_FLAG_SUB]);
    expect(sqlList('c_flag_words')).toEqual([...NAME_FLAG_WORDS]);
  });

  it('gives the same verdict and the same key for every case', async () => {
    const cases = [
      'N1gg3r', 'n i g g e r', 'Niiiigger', 'xXFagXx', 'Fag1', 'FagLord', 'spics', 'Retarded', 'F4gg0t', 'tr@nny',
      'FuckFace', 'Sh!t', 'Scunthorpe', 'Grammar Nazi', 'Team Ascent', 'Admin', 'Ádmin', 'Moderat0r', 'sexy', 'Moby Dick',
      'Player', 'IronFox87', 'KevinTheGreat', 'Niger', 'Spicy', 'Raccoon', 'Assassin', 'Hancock', 'Peacock', 'Dickens',
      'Therapist', 'Cassandra', 'Mike', 'Classy', 'Shrek4', 'Grape', 'Draper', 'Cocktail Hour', '', '   ', '1234',
      'Señor Shiiiit', 'ÉLITE kys', 'bigBOSSman', 'XXXTentacion', 'wank3r', 'c0c0nut', 'Mod Squad', 'StaffyDog',
      ...NAME_BLOCK_SUB, ...NAME_BLOCK_WORDS, ...NAME_FLAG_SUB, ...NAME_FLAG_WORDS,
    ];
    const rows = (await db.query<{ n: string; v: Json; k: string }>(
      'select n, moderation.name_verdict(n) as v, moderation.name_key(n) as k from unnest($1::text[]) as n', [cases])).rows;
    for (const r of rows) {
      expect(r.v, r.n).toEqual(nameVerdict(r.n));
      expect(r.k, r.n).toBe(nameKey(r.n));
    }
  });
});

describe('grants', () => {
  const DASH = [
    "public.moderation_queue('open', 'open', 10)",
    "public.moderation_search('kev')",
    `public.moderation_review_report('kevin@example.com', '${A}', null)`,
    `public.moderation_clear_flag('kevin@example.com', '${A}', null)`,
    `public.moderation_reset_name('kevin@example.com', 'account', '${A}', null)`,
  ];
  for (const role of ['anon', 'authenticated'] as const) {
    it(`${role} can call none of the dashboard's functions, nor read the private schema`, async () => {
      for (const f of DASH) await expect(as(role, `select ${f}`)).rejects.toThrow(/permission denied/);
      await expect(as(role, "select moderation.name_verdict('x')")).rejects.toThrow(/permission denied/);
      await expect(as(role, 'select * from moderation.name_flags')).rejects.toThrow(/permission denied/);
      await expect(as(role, 'select * from moderation.log')).rejects.toThrow(/permission denied/);
    });
  }
  it('the entry points are SECURITY DEFINER with a pinned search_path, executable by the service role (and the owner) only', async () => {
    const names = ['moderation_queue', 'moderation_search', 'moderation_review_report', 'moderation_clear_flag', 'moderation_reset_name'];
    const rows = (await db.query<{ proname: string; prosecdef: boolean; proconfig: string[] | null }>(
      'select proname, prosecdef, proconfig from pg_proc where proname = any($1)', [names])).rows;
    expect(rows).toHaveLength(names.length);
    for (const r of rows) {
      expect(r.prosecdef, r.proname).toBe(true);
      expect(r.proconfig?.some((c) => c.startsWith('search_path=')), r.proname).toBe(true);
    }
    const grantees = (await db.query<{ grantee: string }>(
      "select distinct grantee from information_schema.routine_privileges where routine_name = any($1) and privilege_type = 'EXECUTE'", [names])).rows;
    expect(new Set(grantees.map((g) => g.grantee))).toEqual(new Set(['service_role', 'postgres']));
  });
  it('the Worker flag needs the writer secret', async () => {
    await expect(as('anon', "select public.moderation_cf_flag('wrong', 'room-1', 'Shit Room', null)")).rejects.toThrow(/bad_key/);
    await expect(as('anon', "select public.moderation_cf_flag(null, 'room-1', 'Shit Room', null)")).rejects.toThrow(/bad_key/);
  });
});

describe('names already stored', () => {
  it('the scan flags them once (a stored slur as severity block), even after a second run', async () => {
    const f = await flags();
    expect(f.filter((x) => x.target_id === OLD_SLUR)).toMatchObject([{ kind: 'account', severity: 'block', term: 'nigger', status: 'open', name: 'Niiigger' }]);
    expect(f.filter((x) => x.target_id === OLD_FLAG)).toMatchObject([{ kind: 'account', severity: 'flag', term: 'shit', status: 'open' }]);
    expect(f.some((x) => x.target_id === A || x.target_id === TEAM)).toBe(false);
  });
});

describe('the guard where a name is written', () => {
  it('refuses a slur for an account name (update and insert), as the player, and writes nothing', async () => {
    await expect(as('authenticated', `update public.profiles set author = 'xXFagXx' where user_id = '${C}'`)).rejects.toThrow(/name_blocked/);
    await expect(as('authenticated', "insert into public.profiles (user_id, author) values ('00000000-0000-0000-0000-0000000000f1', 'N1gg3r')")).rejects.toThrow(/name_blocked/);
    expect((await db.query<{ author: string }>(`select author from public.profiles where user_id = '${C}'`)).rows[0]!.author).toBe('Ann');
  });

  it('flags a broader-list account name, replaces it while open, and closes it on a clean rename', async () => {
    await as('authenticated', `update public.profiles set author = 'Admin Ann' where user_id = '${C}'`);
    let mine = (await flags()).filter((x) => x.target_id === C);
    expect(mine).toMatchObject([{ kind: 'account', name: 'Admin Ann', term: 'admin', status: 'open', owner_user: C }]);
    await as('authenticated', `update public.profiles set author = 'Ann the Bitch' where user_id = '${C}'`);
    mine = (await flags()).filter((x) => x.target_id === C);
    expect(mine).toMatchObject([{ name: 'Ann the Bitch', term: 'bitch', status: 'open' }]); // one open flag per target
    await as('authenticated', `update public.profiles set author = 'Ann' where user_id = '${C}'`);
    mine = (await flags()).filter((x) => x.target_id === C);
    expect(mine).toMatchObject([{ status: 'closed', reviewed_by: 'system' }]);
  });

  it('an unchanged name (the profile sync re-sending it) is not checked again', async () => {
    const before = (await flags()).length;
    await as('authenticated', `update public.profiles set author = 'ShitLord', games_played = 2 where user_id = '${OLD_FLAG}'`);
    expect((await flags()).length).toBe(before);
  });

  it('refuses a slur and flags the rest for a Duos team name', async () => {
    await expect(as('postgres', `update public.duos_teams set name = 'Spic Squad' where id = '${TEAM}'`)).rejects.toThrow(/name_blocked/);
    await as('postgres', `update public.duos_teams set name = 'Nazi Gold' where id = '${TEAM}'`);
    expect((await flags()).filter((x) => x.target_id === TEAM)).toMatchObject([{ kind: 'team', name: 'Nazi Gold', term: 'nazi', owner_user: A, status: 'open' }]);
  });

  it('the room Worker flags a room name with its secret (the SQL re-reads the name; a clean one is not stored)', async () => {
    expect(await svcAnon(`public.moderation_cf_flag('${WRITER_SECRET}', 'room-1', 'Clean Room', '${B}')`)).toEqual({ flagged: false });
    expect(await svcAnon(`public.moderation_cf_flag('${WRITER_SECRET}', 'room-1', 'Wank Room', '${B}')`)).toEqual({ flagged: true });
    expect((await flags()).filter((x) => x.kind === 'room')).toMatchObject([{ target_id: 'room-1', name: 'Wank Room', term: 'wank', owner_user: B }]);
  });
});
const svcAnon = async (sql: string): Promise<Json> => (await as<{ j: Json }>('anon', `select ${sql} as j`))[0]!.j;

describe('dm_report keeps the context the review needs', () => {
  it('copies up to 3 messages before and 2 after the reported one, labelled by side', async () => {
    const base = Date.parse('2026-11-22T10:00:00Z');
    const at = (m: number) => new Date(base + m * 60_000).toISOString();
    const msgs: Array<[string, string, string, number]> = [
      [B, A, 'm0 too old for the context', 0], [A, B, 'm1', 1], [B, A, 'm2', 2], [A, B, 'm3', 3],
      [B, A, 'REPORTED you are trash', 4], [A, B, 'm5', 5], [B, A, 'm6', 6], [A, B, 'm7 after the window', 7],
      [B, C, 'another conversation', 4],
    ];
    for (const [s, r, body, m] of msgs) {
      await db.query('insert into public.direct_messages (sender, recipient, body, created_at) values ($1, $2, $3, $4)', [s, r, body, at(m)]);
    }
    const id = (await db.query<{ id: string }>("select id from public.direct_messages where body like 'REPORTED%'")).rows[0]!.id;
    await as('authenticated', `select public.dm_report('${id}', 'abuse')`, [], A);
    await as('authenticated', `select public.dm_report('${id}', 'abuse')`, [], A); // once per message
    const rep = (await db.query<Json>('select * from public.dm_reports')).rows;
    expect(rep).toHaveLength(1);
    expect(rep[0]!.context.map((c: Json) => [c.by, c.body])).toEqual([
      ['reporter', 'm1'], ['reported', 'm2'], ['reporter', 'm3'], ['reported', 'REPORTED you are trash'], ['reporter', 'm5'], ['reported', 'm6'],
    ]);
    // The original is pruned (1 day); the report keeps its copy and its context.
    await db.exec('delete from public.direct_messages');
    const q = await svc("public.moderation_queue('open', 'open', 50)");
    expect(q.counts.reports).toBe(1);
    const r = q.reports[0];
    expect(r).toMatchObject({ reason: 'abuse', status: 'open', body: 'REPORTED you are trash', senderReports: 1, senderOpen: 1 });
    expect(r.reporter).toMatchObject({ id: A, name: 'Kevin', tag: '1111' });
    expect(r.sender).toMatchObject({ id: B, name: 'Mike', tag: '2222' });
    expect(r.context).toHaveLength(6);
  });
});

describe('the dashboard', () => {
  const ACTOR = 'Kevin@Example.com';

  it('the queue lists the open flags newest first with the owner and the current name', async () => {
    const q = await svc("public.moderation_queue('open', 'open', 50)");
    expect(q.counts.names).toBe(q.names.length);
    const team = q.names.find((n: Json) => n.kind === 'team');
    expect(team).toMatchObject({ name: 'Nazi Gold', canReset: true, owner: { id: A, name: 'Kevin' }, current: { exists: true, name: 'Nazi Gold' } });
    expect(team.current.members.map((m: Json) => m.name)).toEqual(['Kevin', 'Mike']);
    expect(q.names.find((n: Json) => n.kind === 'room')).toMatchObject({ canReset: false });
    const times = q.names.map((n: Json) => n.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it('search finds an account by part of a name, by its exact handle, and a team by name', async () => {
    const s1 = await svc("public.moderation_search('shit')");
    expect(s1.accounts).toMatchObject([{ id: OLD_FLAG, name: 'ShitLord', openFlag: true, verdict: { verdict: 'flag' } }]);
    const s2 = await svc("public.moderation_search('kevin#1111')");
    expect(s2.accounts.map((a: Json) => a.id)).toEqual([A]);
    const s3 = await svc("public.moderation_search('nazi')");
    expect(s3.teams).toMatchObject([{ id: TEAM, name: 'Nazi Gold', openFlag: true }]);
    expect((await svc("public.moderation_search('%')")).accounts).toEqual([]); // LIKE wildcards are literal
  });

  it('mark reviewed: status, who, when, the note, and a log row', async () => {
    const id = (await db.query<{ id: string }>('select id from public.dm_reports')).rows[0]!.id;
    const out = await svc('public.moderation_review_report($1, $2, $3)', [ACTOR, id, '  Warned in chat  ']);
    expect(out.report).toMatchObject({ status: 'reviewed', reviewedBy: 'kevin@example.com', note: 'Warned in chat' });
    const q = await svc("public.moderation_queue('open', 'open', 50)");
    expect(q.counts.reports).toBe(0);
    expect((await svc("public.moderation_queue('reviewed', 'open', 50)")).reports).toHaveLength(1);
    expect(q.log[0]).toMatchObject({ actor: 'kevin@example.com', action: 'review_report', before: { status: 'open' }, after: { status: 'reviewed', note: 'Warned in chat' } });
  });

  it('looks fine: the flag is cleared and logged, and a second clear is refused', async () => {
    const f = (await flags()).find((x) => x.kind === 'room')!;
    await svc('public.moderation_clear_flag($1, $2, null)', [ACTOR, f.id]);
    expect((await flags()).find((x) => x.id === f.id)).toMatchObject({ status: 'cleared', reviewed_by: 'kevin@example.com' });
    await expect(svc('public.moderation_clear_flag($1, $2, null)', [ACTOR, f.id])).rejects.toThrow(/not_open/);
    const log = (await svc("public.moderation_queue('open', 'open', 50)")).log;
    expect(log[0]).toMatchObject({ action: 'clear_flag', kind: 'room', targetId: 'room-1', before: { status: 'open', name: 'Wank Room' }, after: { status: 'cleared' } });
  });

  it('reset an account: "Player", the tag kept unique, the flag closed, logged; the old name cannot come back', async () => {
    // D already holds Player#1111, so A (Kevin#1111) needs a new tag. Give A a flagged name first.
    await as('authenticated', `update public.profiles set author = 'Kevin Wank' where user_id = '${A}'`);
    const out = await svc('public.moderation_reset_name($1, $2, $3, $4)', [ACTOR, 'account', A, 'Rude name']);
    expect(out.before).toEqual({ name: 'Kevin Wank', tag: '1111' });
    expect(out.after.name).toBe('Player');
    expect(out.after.tag).toMatch(/^\d{4}$/);
    expect(out.after.tag).not.toBe('1111');
    const p = (await db.query<Json>(`select author, discriminator from public.profiles where user_id = '${A}'`)).rows[0]!;
    expect(p).toEqual({ author: 'Player', discriminator: out.after.tag });
    expect((await flags()).filter((x) => x.target_id === A)).toMatchObject([{ status: 'reset', reviewed_by: 'kevin@example.com', note: 'Rude name' }]);
    expect((await svc("public.moderation_queue('open', 'open', 50)")).log[0]).toMatchObject({ action: 'reset_name', kind: 'account', targetId: A, before: { name: 'Kevin Wank' }, after: { name: 'Player' } });
    await expect(as('authenticated', `update public.profiles set author = 'kevin  w4nk' where user_id = '${A}'`)).rejects.toThrow(/name_blocked/);
    await as('authenticated', `update public.profiles set author = 'Kevin' where user_id = '${A}'`); // another name is fine
  });

  it('reset an account whose tag is free keeps the tag', async () => {
    const out = await svc('public.moderation_reset_name($1, $2, $3, null)', [ACTOR, 'account', OLD_FLAG]);
    expect(out.after).toEqual({ name: 'Player', tag: '5555' });
  });

  it('reset a team: the name is cleared (the default "A & B" shows again), the flag closed, logged', async () => {
    const out = await svc('public.moderation_reset_name($1, $2, $3, null)', [ACTOR, 'team', TEAM]);
    expect(out).toMatchObject({ before: { name: 'Nazi Gold' }, after: { name: null } });
    expect((await db.query<Json>(`select name from public.duos_teams where id = '${TEAM}'`)).rows[0]!.name).toBeNull();
    expect((await flags()).filter((x) => x.target_id === TEAM)).toMatchObject([{ status: 'reset' }]);
    await expect(as('postgres', `update public.duos_teams set name = 'NAZI GOLD' where id = '${TEAM}'`)).rejects.toThrow(/name_blocked/);
  });

  it('refuses a bad action: rooms cannot be reset, bad ids, unknown targets, no actor', async () => {
    await expect(svc('public.moderation_reset_name($1, $2, $3, null)', [ACTOR, 'room', A])).rejects.toThrow(/bad_kind/);
    await expect(svc('public.moderation_reset_name($1, $2, $3, null)', [ACTOR, 'account', 'not-a-uuid'])).rejects.toThrow(/bad_target/);
    await expect(svc('public.moderation_reset_name($1, $2, $3, null)', [ACTOR, 'account', '00000000-0000-0000-0000-000000000999'])).rejects.toThrow(/not_found/);
    await expect(svc('public.moderation_review_report($1, $2, null)', ['  ', A])).rejects.toThrow(/bad_actor/);
  });

  it('the queue payload stays small', async () => {
    expect(JSON.stringify(await svc("public.moderation_queue('all', 'all', 200)")).length).toBeLessThan(50_000);
  });
});
