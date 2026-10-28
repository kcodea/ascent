/**
 * RANKED DUOS, THE PARTY IS ITS OWN PLACE, EXECUTED (R-RANKED-DUOS-SPLIT-01): PGlite runs every Versus migration, the
 * friends and Live Games migrations, the Ranked Duos server and party, then `2026-11-02-ranked-duos-party-split.sql`
 * (twice: idempotent), against a stubbed `auth.uid()`:
 *
 * - `versus_list_rooms()` (today's client call, no argument) lists Versus rooms only; `versus_list_rooms('duos')` the
 *   parties only;
 * - `versus_set_options` never turns a Versus room into a party, nor a party into a Versus room (`bad_mode`);
 * - leaving the party before its game starts (open, or sealed with one gate pressed) creates no match and settles no
 *   rating: there is nothing to place (owner 2026-10-27: "you shouldn't lose mmr for leaving that lobby").
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../../..');
const mig = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const FILES = [
  '2026-10-13-versus.sql', '2026-10-14-versus-shop-start.sql', '2026-10-14-versus-scout.sql', '2026-10-14-versus-ready-pause.sql',
  '2026-10-15-versus-hero-reroll.sql', '2026-10-16-versus-clock-grace.sql', '2026-10-17-versus-open-rooms.sql',
  '2026-10-24-versus-group.sql', '2026-10-24-versus-group-knockout-stands.sql',
  '2026-10-25-versus-duos.sql', '2026-10-25-versus-duos-edges.sql', '2026-10-25-versus-duos-random-order.sql',
  '2026-10-25-versus-duos-pass-back.sql', '2026-10-26-versus-lock-order.sql', '2026-10-27-versus-egress.sql', '2026-10-28-versus-health.sql',
  '2026-10-15-lobby-live.sql', '2026-10-26-lobby-live-hero-select.sql', '2026-10-28-friends.sql',
  '2026-10-29-ranked-duos.sql', '2026-10-30-ranked-duos-client.sql', '2026-10-31-ranked-duos-live-fixes.sql',
  '2026-11-01-ranked-duos-party.sql',
];
const BASE = FILES.map(mig).join('\n');
const SPLIT = mig('2026-11-02-ranked-duos-party-split.sql');
const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  create table auth.users (id uuid primary key, is_anonymous boolean not null default false);
  create table public.profiles (user_id uuid primary key, author text, discriminator text, avatar text, favorite_hero text);
  grant select on public.profiles to anon, authenticated;
  create table public.cosmetic_loadouts (user_id uuid, slot text, target_id text not null default '', cosmetic_id text, primary key (user_id, slot, target_id));
  grant select on public.cosmetic_loadouts to anon, authenticated;
`;
const U = (n: number): string => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const [A, B, C] = [1, 2, 3].map(U) as [string, string, string];
const NAMES: Record<string, string> = { [A]: 'Kevin', [B]: 'Lemon', [C]: 'Ionlime' };
const CONTENT = 'rev1';
const OPT_RANKED = JSON.stringify({ v: 1, mode: 'ranked_duos', modifiers: [] });
const OPT_DUEL = JSON.stringify({ v: 1, mode: 'duel', modifiers: [] });

let db: PGlite;
const clock = Date.now();
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
async function fails(user: string | null, sql: string, params: unknown[] = []): Promise<string> {
  try { await as(user, sql, params); } catch (e) { return (e as Error).message; }
  return 'did not fail';
}
const q = async <T = any>(sql: string, params: unknown[] = []): Promise<T[]> => (await db.query<T>(sql, params)).rows;
const room = async (host: string, opts: string): Promise<string> =>
  (await as<any>(host, `select public.versus_create_room('Room', $1, '{}', 'set3', $2, 1, $3::jsonb)`, [NAMES[host], CONTENT, opts])).id;
const join_ = (u: string, id: string) => as<any>(u, `select public.versus_join_room($1, 'player', $2, '{}', $3, 1)`, [id, NAMES[u], CONTENT]);
const leave = (u: string, id: string) => as(u, 'select public.versus_leave_room($1)', [id]);
const ids = async (u: string, sql: string): Promise<string[]> => ((await as<any[]>(u, sql)) ?? []).map((r) => r.id);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  for (const [i, id] of [A, B, C].entries()) {
    await db.query('insert into auth.users (id) values ($1)', [id]);
    await db.query('insert into public.profiles (user_id, author, discriminator, favorite_hero) values ($1, $2, $3, $4)', [id, NAMES[id], String(1111 * (i + 1)), 'warden']);
  }
  await db.exec(BASE);
  await db.exec(SPLIT);
  await db.exec(SPLIT); // idempotent
}, 120_000);
afterAll(async () => { await db?.close(); });

describe('Ranked Duos parties and Versus rooms are listed apart (R-RANKED-DUOS-SPLIT-01)', () => {
  it('the no-argument list (today\'s client) is Versus only; the duos area lists only parties', async () => {
    const vs = await room(A, OPT_DUEL);
    const party = await room(B, OPT_RANKED);
    expect(await ids(C, 'select public.versus_list_rooms()')).toEqual([vs]);
    expect(await ids(C, `select public.versus_list_rooms('versus')`)).toEqual([vs]);
    expect(await ids(C, `select public.versus_list_rooms('duos')`)).toEqual([party]);
    await leave(A, vs);
    await leave(B, party);
  });

  it('a Versus room never becomes a party, and a party never becomes a Versus room', async () => {
    const vs = await room(A, OPT_DUEL);
    expect(await fails(A, 'select public.versus_set_options($1, $2::jsonb)', [vs, OPT_RANKED])).toMatch(/bad_mode/);
    // Within Versus the options still change.
    const g = await as<any>(A, 'select public.versus_set_options($1, $2::jsonb)', [vs, JSON.stringify({ v: 1, mode: 'group', modifiers: [] })]);
    expect(g.options.mode).toBe('group');
    const party = await room(B, OPT_RANKED);
    expect(await fails(B, 'select public.versus_set_options($1, $2::jsonb)', [party, OPT_DUEL])).toMatch(/bad_mode/);
    await leave(A, vs);
    await leave(B, party);
  });
});

describe('leaving the party before its game costs nothing (R-RANKED-DUOS-SPLIT-01)', () => {
  const matches = async (id: string): Promise<number> => (await q<{ n: number }>('select count(*)::int as n from public.versus_group_matches where room_id = $1', [id]))[0]!.n;
  const results = async (): Promise<number> => (await q<{ n: number }>('select count(*)::int as n from public.duos_rank_results'))[0]!.n;

  it('open: the teammate leaves, then the host; no match, no rating', async () => {
    const party = await room(A, OPT_RANKED);
    await join_(B, party);
    await leave(B, party);
    await leave(A, party);
    expect(await matches(party)).toBe(0);
    expect(await results()).toBe(0);
  });

  it('sealed (Start pressed, one gate pressed): leaving reopens the room; no match, no rating', async () => {
    const party = await room(A, OPT_RANKED);
    await join_(B, party);
    const sealed = await as<any>(A, 'select public.versus_start_game($1)', [party]);
    expect(sealed.status).toBe('sealed');
    await as(A, 'select public.versus_press_gate($1)', [party]);
    await leave(B, party);
    const [r] = await q<{ status: string }>('select status from public.versus_rooms where id = $1', [party]);
    expect(r!.status).toBe('open');
    expect(await matches(party)).toBe(0);
    expect(await results()).toBe(0);
    await leave(A, party);
  });
});
