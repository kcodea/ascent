/**
 * A SHOP ARMOR RAISE REACHES THE SERVER'S POOL AT ONCE (R-VERSUS-LIVE-ARMOR-01). Owner (Versus Group / Duos with friends,
 * 2026-10-27): "i casted mend to get armor but it didn't show to the other players."
 *
 * PGlite runs every Versus migration in order through the ready signal, then `2026-11-03-versus-live-armor.sql` (twice:
 * idempotent). A side sent for the current round (candidate, lock, re-lock) that reports more Armor than the seat's (Duos:
 * team's) stored pool raises it by the resolver's own bound (`versusVitalsBefore`: never past the highest Armor floor,
 * never above a pool already at it, never Health), bumping the match revision so every client re-reads it. A stale
 * (auto) side, a pool not stored yet, or a report that does not raise anything changes nothing (and bumps nothing).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { combatSide } from '@game/core';
import type { PreparedCombatSide } from '../state';
import { versusArmorFloorMax, versusVitalsBefore } from './vitals';

const root = join(__dirname, '../../../..');
const FILES = [
  '2026-10-13-versus.sql', '2026-10-14-versus-shop-start.sql', '2026-10-14-versus-scout.sql', '2026-10-14-versus-ready-pause.sql',
  '2026-10-15-versus-hero-reroll.sql', '2026-10-16-versus-clock-grace.sql', '2026-10-17-versus-open-rooms.sql',
  '2026-10-24-versus-group.sql', '2026-10-24-versus-group-knockout-stands.sql',
  '2026-10-25-versus-duos.sql', '2026-10-25-versus-duos-edges.sql', '2026-10-25-versus-duos-random-order.sql',
  '2026-10-25-versus-duos-pass-back.sql', '2026-10-26-versus-lock-order.sql', '2026-10-27-versus-egress.sql', '2026-10-28-versus-health.sql',
  '2026-10-29-ranked-duos.sql', '2026-10-30-ranked-duos-client.sql', '2026-10-31-ranked-duos-live-fixes.sql',
  '2026-11-01-versus-ready-signal.sql',
];
const BASE = FILES.map((f) => readFileSync(join(root, 'supabase/migrations', f), 'utf8')).join('\n');
const LIVE = readFileSync(join(root, 'supabase/migrations/2026-11-03-versus-live-armor.sql'), 'utf8');
const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`;
const U = (n: number): string => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const [A, B, C, D, E, F, G, H, I, J] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(U) as string[] as [string, string, string, string, string, string, string, string, string, string];
const NAMES: Record<string, string> = Object.fromEntries([A, B, C, D, E, F, G, H, I, J].map((u, i) => [u, `P${i + 1}`]));
const CONTENT = 'rev1';

let db: PGlite;
let clock = Date.parse('2026-10-27T12:00:00Z');
async function as<T = any>(user: string | null, sql: string, params: unknown[] = []): Promise<T> {
  await db.exec(`set versus.test_now = '${new Date(clock).toISOString()}'`);
  await db.exec(user ? `select set_config('request.jwt.claim.sub', '${user}', false); set role authenticated;` : `select set_config('request.jwt.claim.sub', '', false); set role service_role;`);
  try {
    const r = await db.query<Record<string, unknown>>(sql, params);
    const row = r.rows[0];
    return (row ? Object.values(row)[0] : undefined) as T;
  } finally {
    await db.exec('reset role');
  }
}
const one = async (sql: string, params: unknown[] = []): Promise<any> => (await db.query<any>(sql, params)).rows[0];
/** A side reporting the run's pools, as `faceOmen { deferFight }` stamps a Versus side. */
const side = (resolve: number, armor: number): PreparedCombatSide => ({ board: [], state: combatSide(), config: {}, vitals: { resolve, armor } });

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(BASE);
  // The 2026-11-02 reliability migration sits between (apply order): the Armor triggers compose with it.
  await db.exec(readFileSync(join(root, 'supabase/migrations/2026-11-02-versus-server-reliability.sql'), 'utf8'));
  await db.exec(LIVE);
  await db.exec(LIVE); // idempotent
}, 120_000);
afterAll(async () => { await db?.close(); });

async function room(users: string[], options: string | null): Promise<string> {
  const r = options
    ? await as<any>(users[0]!, `select public.versus_create_room('Live', $1, '{}', 'set3', $2, 1, $3::jsonb)`, [NAMES[users[0]!], CONTENT, options])
    : await as<any>(users[0]!, `select public.versus_create_room('Live', $1, '{}', 'set3', $2, 1)`, [NAMES[users[0]!], CONTENT]);
  for (const u of users.slice(1)) await as(u, `select public.versus_join_room($1, 'player', $2, '{}', $3, 1)`, [r.id, NAMES[u], CONTENT]);
  await as(users[0]!, `select public.versus_start_game($1)`, [r.id]);
  let g: any;
  for (const u of users) g = await as(u, `select public.versus_press_gate($1)`, [r.id]);
  return g.current_match_id;
}

describe('a reported Armor raise lands on the stored pool at once (R-VERSUS-LIVE-ARMOR-01)', () => {
  it('the SQL floor is the content floor (Mend: 5)', async () => {
    expect((await one('select public.versus__armor_floor_max() v')).v).toBe(versusArmorFloorMax());
  });

  it('GROUP: a candidate reporting Mend raises the seat by the resolver bound and bumps the revision; nothing else moves', async () => {
    const users = [A, B, C];
    const m = await room(users, JSON.stringify({ v: 1, mode: 'group', modifiers: [] }));
    for (const u of users) await as(u, `select public.versus_group_register_offer($1, array['warden','indy','keshi'])`, [m]);
    for (const u of users) await as(u, `select public.versus_group_pick_hero($1, 0)`, [m]);
    for (const u of users) await as(u, `select public.versus_group_intro_done($1)`, [m]);
    expect((await one('select phase from public.versus_group_matches where id = $1', [m])).phase).toBe('shop');
    const submit = (u: string, seq: number, s: PreparedCombatSide, final = false) =>
      as(u, `select public.versus_group_submit($1, 1, $2, $3::jsonb, $4, null, null)`, [m, seq, JSON.stringify(s), final]);
    const seat = async (s: string) => one('select health, armor from public.versus_group_seats where match_id = $1 and seat = $2', [m, s]);
    const rev = async () => Number((await one('select revision from public.versus_group_matches where id = $1', [m])).revision);

    // No stored pool yet (before round 1 commits): left alone, the resolver still honours the report at the close.
    await submit(A, 1, side(30, 5));
    expect(await seat('p1')).toEqual({ health: null, armor: null });

    // Stored pools as after a committed round: p1 at 20/0, p2 at 18/3, p3 at 25/12.
    await db.query(`update public.versus_group_seats set health = case seat when 'p1' then 20 when 'p2' then 18 else 25 end,
      armor = case seat when 'p1' then 0 when 'p2' then 3 else 12 end where match_id = $1`, [m]);
    let r0 = await rev();
    await submit(A, 2, side(20, 5)); // Mend: 0 -> 5
    expect(await seat('p1')).toEqual({ health: 20, armor: 5 });
    expect(await rev()).toBe(r0 + 1);
    expect(versusVitalsBefore({ health: 20, armor: 0 }, [{ health: 20, armor: 5 }])).toEqual({ health: 20, armor: 5 }); // the resolver agrees

    r0 = await rev();
    await submit(A, 3, side(20, 5)); // the same report again: nothing moves, nothing bumps
    expect(await rev()).toBe(r0);

    await submit(B, 1, side(99, 40)); // a report past the floor: bounded at 5, Health never raised
    expect(await seat('p2')).toEqual({ health: 18, armor: 5 });

    r0 = await rev();
    await submit(C, 1, side(25, 14), true); // a pool already past the floor never rises from a report (the lock still lands)
    expect(await seat('p3')).toEqual({ health: 25, armor: 12 });
    expect(await rev()).toBe(r0 + 1); // the lock's own bump only
  });

  it('DUOS: a teammate\'s Mend raises the TEAM pool and both its seats', async () => {
    const users = [D, E, F, G];
    const m = await room(users, JSON.stringify({ v: 1, mode: 'duos', modifiers: [] }));
    for (const u of users) await as(u, `select public.versus_group_register_offer($1, array['warden','indy','keshi'])`, [m]);
    for (const u of users) await as(u, `select public.versus_group_pick_hero($1, 0)`, [m]);
    for (const u of users) await as(u, `select public.versus_group_intro_done($1)`, [m]);
    expect((await one('select phase from public.versus_group_matches where id = $1', [m])).phase).toBe('shop');
    await db.query(`update public.versus_group_teams set health = 22, armor = 1 where match_id = $1`, [m]);
    await db.query(`update public.versus_group_seats set health = 22, armor = 1 where match_id = $1`, [m]);
    await as(E, `select public.versus_group_submit($1, 1, 1, $2::jsonb, false, null, null)`, [m, JSON.stringify(side(22, 5))]);
    const team = await one(`select health, armor from public.versus_group_teams where match_id = $1 and team = 'a'`, [m]);
    expect(team).toEqual({ health: 22, armor: 5 });
    const seats = (await db.query<any>('select seat, health, armor from public.versus_group_seats where match_id = $1 order by seat', [m])).rows;
    expect(seats.map((s) => [s.seat, s.health, s.armor])).toEqual([['p1', 22, 5], ['p2', 22, 5], ['p3', 22, 1], ['p4', 22, 1]]);
  });

  it('1v1: the seat\'s match columns rise; an auto (stale) side and another round never do', async () => {
    const m = await room([H, I], null);
    const priv = async (s: string) => one('select * from public.versus_seat_private where match_id = $1 and seat = $2', [m, s]);
    for (const [u, s] of [[H, 'p1'], [I, 'p2']] as const) {
      expect(await priv(s)).toBeTruthy();
      await as(u, `select public.versus_register_offer($1, array['warden','indy','keshi'])`, [m]);
      await as(u, 'select public.versus_pick_hero($1, 0)', [m]);
    }
    clock += 60_000;
    for (const u of [H, I]) await as(u, 'select public.versus_reconcile($1)', [m]).catch(() => undefined);
    for (const u of [H, I]) await as(u, 'select public.versus_intro_done($1)', [m]).catch(() => undefined);
    const row = await one('select phase, round from public.versus_matches where id = $1', [m]);
    expect(row.phase).toBe('shop');
    await db.query('update public.versus_matches set p1_health = 15, p1_armor = 2, p2_health = 30, p2_armor = 0 where id = $1', [m]);
    const r0 = Number((await one('select revision from public.versus_matches where id = $1', [m])).revision);
    await as(H, 'select public.versus_submit($1, $2, 1, $3::jsonb, false, null)', [m, row.round, JSON.stringify(side(15, 5))]);
    let now = await one('select p1_health, p1_armor, p2_health, p2_armor, revision from public.versus_matches where id = $1', [m]);
    expect([now.p1_health, now.p1_armor, now.p2_armor]).toEqual([15, 5, 0]);
    expect(Number(now.revision)).toBe(r0 + 1);
    // An auto-played old board's stale report (source auto) and a side for another round: nothing moves.
    await db.query(`insert into public.versus_submissions (match_id, round, seat, user_id, candidate_seq, prepared_side, final, source)
      values ($1, $2, 'p2', $3, 0, $4::jsonb, true, 'auto')`, [m, row.round, I, JSON.stringify(side(30, 5))]);
    await db.query(`insert into public.versus_submissions (match_id, round, seat, user_id, candidate_seq, prepared_side, final, source)
      values ($1, $2, 'p2', $3, 0, $4::jsonb, false, 'candidate')`, [m, row.round + 1, I, JSON.stringify(side(30, 5))]);
    now = await one('select p2_armor from public.versus_matches where id = $1', [m]);
    expect(now.p2_armor).toBe(0);
  });
});
