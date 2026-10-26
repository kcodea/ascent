/**
 * 2026-10-27-versus-egress.sql against the real SQL (PGlite), R-NET-REALTIME-01:
 *  - a heartbeat from a member already present changes ONLY its own member row (no room revision bump, so no Realtime
 *    wake-up for anyone), while a heartbeat from a member coming BACK (no beat for a 12 s lease) bumps the room once;
 *  - the heartbeat answers `seen` (every member's last beat) only while the room's match is paused;
 *  - versus_list_rooms prunes at most once per 30 s, and a prune bumps the revision of each room it removed members from.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../../..');
const SQL = ['2026-10-13-versus.sql', '2026-10-17-versus-open-rooms.sql', '2026-10-24-versus-group.sql', '2026-10-26-versus-lock-order.sql', '2026-10-27-versus-egress.sql']
  .map((f) => readFileSync(join(root, 'supabase/migrations', f), 'utf8')).join('\n');
const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`;
const u = (n: number): string => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

let db: PGlite;
async function as<T>(user: string, sql: string, params: unknown[] = []): Promise<T> {
  await db.exec(`select set_config('request.jwt.claim.sub', '${user}', false); set role authenticated;`);
  try { return (await db.query<{ v: T }>(sql, params)).rows[0]!.v; } finally { await db.exec('reset role'); }
}
const revision = async (room: string): Promise<number> => (await db.query<{ r: number }>('select revision as r from public.versus_rooms where id = $1', [room])).rows[0]!.r;
async function makeRoom(members: Array<[string, string, number]>, status = 'open'): Promise<string> {
  const r = await db.query<{ id: string }>(`insert into public.versus_rooms (name, host_user_id, status, set_id, content_revision, protocol) values ('R', $1, $2, 'set1', 'rev', 1) returning id`, [members[0]![0], status]);
  for (const [user, role, secsAgo] of members) {
    await db.query(`insert into public.versus_members (room_id, user_id, role, display_name, last_seen_at) values ($1, $2, $3, 'P', now() - make_interval(secs => $4))`, [r.rows[0]!.id, user, role, secsAgo]);
  }
  return r.rows[0]!.id;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(SQL);
}, 60_000);
afterAll(async () => { await db?.close(); });

describe('R-NET-REALTIME-01: heartbeats wake nobody unless someone is back', () => {
  it('a present member beats: only its own row moves, the room revision does not', async () => {
    const room = await makeRoom([[u(1), 'p1', 2], [u(2), 'spectator', 2]]);
    const before = await revision(room);
    const r = await as<Record<string, unknown>>(u(1), 'select public.versus_heartbeat($1) as v', [room]);
    expect(r.serverNow).toBeTruthy();
    expect(r.seen).toBeUndefined(); // no match, nothing paused
    expect(await revision(room)).toBe(before);
  });

  it('a member back after a lapsed lease bumps the room once (the "is back" wake-up), then no more', async () => {
    const room = await makeRoom([[u(3), 'p1', 2], [u(4), 'p2', 40]]);
    const before = await revision(room);
    await as(u(4), 'select public.versus_heartbeat($1) as v', [room]);
    expect(await revision(room)).toBe(before + 1);
    await as(u(4), 'select public.versus_heartbeat($1) as v', [room]);
    expect(await revision(room)).toBe(before + 1);
  });

  it('answers `seen` only while the room\x27s match is paused', async () => {
    const room = await makeRoom([[u(5), 'p1', 1], [u(6), 'p2', 1]], 'in_game');
    const m = await db.query<{ id: string }>(
      `insert into public.versus_matches (room_id, seed, set_id, content_revision, protocol, phase, round, p1_user, p2_user, p1_name, p2_name)
       values ($1, 7, 'set1', 'rev', 1, 'shop', 1, $2, $3, 'A', 'B') returning id`, [room, u(5), u(6)]);
    await db.query('update public.versus_rooms set current_match_id = $1 where id = $2', [m.rows[0]!.id, room]);
    const live = await as<Record<string, unknown>>(u(5), 'select public.versus_heartbeat($1) as v', [room]);
    expect(live.match).toBeTruthy();
    expect(live.seen).toBeUndefined();
    await db.query(`update public.versus_matches set paused_at = now(), paused_seat = 'p2', pause_grace_until = now() + interval '30 seconds' where id = $1`, [m.rows[0]!.id]);
    const paused = await as<Record<string, unknown>>(u(5), 'select public.versus_heartbeat($1) as v', [room]);
    expect(Object.keys(paused.seen as object).sort()).toEqual([u(5), u(6)]);
  });

  it('a spectator heartbeat answers no match and takes no seat', async () => {
    const room = await makeRoom([[u(7), 'p1', 1], [u(8), 'spectator', 1]], 'in_game');
    const r = await as<Record<string, unknown>>(u(8), 'select public.versus_heartbeat($1) as v', [room]);
    expect(r.match).toBeUndefined();
  });
});

describe('versus_list_rooms prunes at most every 30 s, off the read path', () => {
  it('prunes stale members once, bumps their room, and skips the prune on the next call within 30 s', async () => {
    await db.query(`update public.versus_housekeeping set pruned_at = 'epoch' where id = 1`);
    const room = await makeRoom([[u(20), 'p1', 5], [u(21), 'p2', 600]]); // p2 gone for 10 minutes
    const before = await revision(room);
    await as(u(20), 'select public.versus_list_rooms() as v');
    const left = await db.query('select user_id from public.versus_members where room_id = $1', [room]);
    expect(left.rows.length).toBe(1);
    expect(await revision(room)).toBe(before + 1);
    // Another stale member right after: not pruned until 30 s have passed.
    await db.query(`insert into public.versus_members (room_id, user_id, role, display_name, last_seen_at) values ($1, $2, 'spectator', 'P', now() - interval '10 minutes')`, [room, u(22)]);
    await as(u(20), 'select public.versus_list_rooms() as v');
    expect((await db.query('select 1 from public.versus_members where room_id = $1', [room])).rows.length).toBe(2);
  });
});
