import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE ANALYTICS RPCs, EXECUTED (supabase/migrations/2026-11-27-analytics-dashboard.sql).
 *
 * PGlite builds the tables the functions read, with only the columns they touch, under Supabase's defaults (every new
 * public function is granted to anon + authenticated). It seeds a small known set of finished games, applies the
 * migration TWICE (idempotent), then proves: anon and authenticated cannot execute either entry point or anything in
 * the private schema; the service role can; and the numbers come out right for the seed.
 */
const root = join(__dirname, '../../../..');
const SQL = readFileSync(join(root, 'supabase/migrations/2026-11-27-analytics-dashboard.sql'), 'utf8');

const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

  create table auth.users (id uuid primary key, created_at timestamptz not null default now(), is_anonymous boolean not null default false);
  create table public.profiles (user_id uuid primary key, author text);
  create table public.versus_test_bots (bot_user uuid primary key);
  create table public.run_history (id bigint generated always as identity primary key, user_id uuid not null, patch text, hero_id text,
    placement int, mode text, entry jsonb not null, created_at timestamptz not null default now());
  create table public.practice_games (id bigint generated always as identity primary key, user_id uuid, patch text, hero_id text not null,
    placement int, final_board jsonb, created_at timestamptz default now());
  create table public.versus_matches (id uuid primary key default gen_random_uuid(), phase text not null, p1_user uuid not null, p2_user uuid not null,
    p1_hero text, p2_hero text, winner_seat text, completed_at timestamptz);
  create table public.versus_group_matches (id uuid primary key default gen_random_uuid(), phase text not null, seat_count int not null,
    options jsonb not null default '{}', dev_forced boolean not null default false, completed_at timestamptz);
  create table public.versus_group_seats (match_id uuid not null, seat text not null, user_id uuid not null, hero text, placement int,
    primary key (match_id, seat));
  create table public.progression_results (user_id uuid not null, run_id text not null, mode text not null, placement int,
    settled_at timestamptz not null default now(), primary key (user_id, run_id, mode));
  create table public.rank_results (user_id uuid not null, run_id text not null, seed bigint, division_before int not null,
    created_at timestamptz not null default now(), primary key (user_id, run_id));
  create table public.run_telemetry (id bigint generated always as identity primary key, user_id uuid, patch text, hero_id text not null,
    hero_offer text[], source text, created_at timestamptz not null default now());
`;

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const C = '00000000-0000-0000-0000-00000000000c';
const BOT = '00000000-0000-0000-0000-0000000000ff';
const CLAUDE = '00000000-0000-0000-0000-0000000000ee';

// Everything is relative to now() in UTC, so "today" and "yesterday" are stable whatever day the test runs.
const SEED = `
  insert into auth.users (id, created_at, is_anonymous) values
    ('${A}', now() - interval '40 days', false), ('${B}', now(), true), ('${C}', now(), false),
    ('${BOT}', now(), true), ('${CLAUDE}', now(), true);
  insert into public.profiles values ('${A}', 'Kevin'), ('${B}', 'Guest'), ('${CLAUDE}', 'Claudebot3');
  insert into public.versus_test_bots values ('${BOT}');

  -- A: an old game 35 days ago (first game, outside the 30-day window), two ranked lobbies today (one Gold, one with
  -- the medal only on the entry), one unrated lobby today. B: a ranked lobby yesterday on another build.
  insert into public.run_history (user_id, patch, hero_id, placement, mode, entry, created_at) values
    ('${A}', '0.1.0+old', 'warden', 5, 'lobby', '{"seed": 1, "tribes": ["beast","mech"], "dominantTribe": "beast"}', now() - interval '35 days'),
    ('${A}', '0.1.0+new', 'warden', 1, 'lobby', '{"seed": 11, "tribes": ["beast","mech","undead"], "dominantTribe": "beast"}', now()),
    ('${A}', '0.1.0+new', 'magician', 6, 'lobby', '{"seed": 12, "tribes": ["mech","undead"], "dominantTribe": "mech", "rank": {"before": {"divisionIndex": 4}}}', now()),
    ('${A}', '0.1.0+new', 'warden', 3, 'lobby', '{"seed": 13, "tribes": ["beast"], "unrated": "all-generated"}', now()),
    ('${B}', '0.1.0+mid', 'magician', 2, 'lobby', '{"seed": 21, "tribes": ["dragon"], "dominantTribe": "dragon"}', now() - interval '1 day'),
    ('${CLAUDE}', '0.1.0+new', 'warden', 1, 'lobby', '{"seed": 99}', now());
  insert into public.rank_results (user_id, run_id, seed, division_before) values ('${A}', 'r11', 11, 7);

  -- B: a practice game today (B's first game was yesterday). C: first ever game today, a practice game.
  insert into public.practice_games (user_id, patch, hero_id, placement, final_board, created_at) values
    ('${B}', '0.1.0+new', 'coran', 4, '{"tribes": ["beast","kobold"]}', now()),
    ('${C}', '0.1.0+new', 'coran', 8, '{"tribes": ["kobold"]}', now());

  -- A 1v1 between A and B today (A wins), one unfinished; a Versus Duos and a dev-forced test match today.
  insert into public.versus_matches (phase, p1_user, p2_user, p1_hero, p2_hero, winner_seat, completed_at) values
    ('complete', '${A}', '${B}', 'warden', 'fi', 'p1', now()),
    ('shop', '${A}', '${B}', 'warden', 'fi', null, null);
  insert into public.versus_group_matches (id, phase, seat_count, options, dev_forced, completed_at) values
    ('10000000-0000-0000-0000-000000000001', 'complete', 4, '{"mode": "duos"}', false, now()),
    ('10000000-0000-0000-0000-000000000002', 'complete', 4, '{"mode": "group"}', true, now());
  insert into public.versus_group_seats values
    ('10000000-0000-0000-0000-000000000001', 'p1', '${A}', 'fi', 1), ('10000000-0000-0000-0000-000000000001', 'p2', '${BOT}', 'fi', 3),
    ('10000000-0000-0000-0000-000000000002', 'p1', '${C}', 'fi', 1);

  insert into public.run_telemetry (user_id, patch, hero_id, hero_offer, source, created_at) values
    ('${A}', '0.1.0+new', 'warden', array['mode:lobby','warden','magician','fi'], 'ladder', now()),
    ('${A}', '0.1.0+new', 'magician', array['mode:lobby','warden','magician','coran'], 'ladder', now()),
    ('${A}', '0.1.0+new', 'coran', array['coran','fi','warden'], 'practice', now());
`;

let db: PGlite;

async function as<T>(role: 'anon' | 'authenticated' | 'service_role', sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec('begin');
  try {
    await db.exec(`set local role ${role}`);
    const r = await db.query<T>(sql, params);
    await db.exec('commit');
    return r.rows;
  } catch (e) {
    await db.exec('rollback');
    throw e;
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(SEED);
  await db.exec(SQL);
  await db.exec(SQL);
}, 60_000);
afterAll(async () => { await db.close(); });

type Json = Record<string, any>;
const overview = async (): Promise<Json> =>
  (await as<{ j: Json }>('service_role', "select public.analytics_overview(30, 'UTC') as j"))[0]!.j;
const breakdown = async (patch: string | null = null): Promise<Json> =>
  (await as<{ j: Json }>('service_role', "select public.analytics_breakdown(current_date - 6, current_date, $1, 'UTC') as j", [patch]))[0]!.j;

describe('analytics RPC grants', () => {
  for (const role of ['anon', 'authenticated'] as const) {
    it(`${role} cannot execute the entry points or the private schema`, async () => {
      await expect(as(role, "select public.analytics_overview(30, 'UTC')")).rejects.toThrow(/permission denied/);
      await expect(as(role, "select public.analytics_breakdown(null, null, null, 'UTC')")).rejects.toThrow(/permission denied/);
      await expect(as(role, "select analytics.overview(30, 'UTC')")).rejects.toThrow(/permission denied/);
      await expect(as(role, 'select * from analytics.player_games(now() - interval \'1 day\', now())')).rejects.toThrow(/permission denied/);
    });
  }
  it('the entry points are SECURITY DEFINER with a pinned search_path', async () => {
    const rows = (await db.query<{ proname: string; prosecdef: boolean; proconfig: string[] | null }>(
      "select proname, prosecdef, proconfig from pg_proc where proname in ('analytics_overview', 'analytics_breakdown')")).rows;
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.prosecdef).toBe(true);
      expect(r.proconfig?.some((c) => c.startsWith('search_path='))).toBe(true);
    }
  });
  it('no other role holds EXECUTE on them', async () => {
    const rows = (await db.query<{ grantee: string }>(
      "select grantee from information_schema.routine_privileges where routine_name in ('analytics_overview', 'analytics_breakdown') and privilege_type = 'EXECUTE'")).rows;
    expect(new Set(rows.map((r) => r.grantee))).toEqual(new Set(['service_role', 'postgres']));
  });
});

describe('analytics_overview', () => {
  it('counts today: games, accounts, new accounts and first games', async () => {
    const o = await overview();
    expect(o.tz).toBe('UTC');
    expect(o.daily).toHaveLength(30);
    const today = o.daily[29];
    // games today: 3 of A's lobbies + 2 practice + 1 duel + 1 duos = 7 (the Claudebot lobby, the dev-forced match and the
    // unfinished duel are not games)
    expect(today.games).toBe(7);
    expect(today.byMode).toEqual({ ranked: 2, unrated_lobby: 1, practice: 2, versus_duel: 1, versus_duos: 1 });
    expect(today.accounts).toBe(3); // A, B, C (never the bot or the Claudebot)
    expect(today.newEmail).toBe(1); // C
    expect(today.newGuest).toBe(3); // B, BOT, CLAUDE (auth rows are counted as created)
    expect(today.firstGame).toBe(1); // C (B first played yesterday, A 35 days ago)
    const yesterday = o.daily[28];
    expect(yesterday).toMatchObject({ games: 1, accounts: 1, firstGame: 1 });
    expect(o.windows.d1).toEqual({ games: 7, accounts: 3 });
    expect(o.windows.d7).toEqual({ games: 8, accounts: 3 });
    expect(o.windows.d30).toEqual({ games: 8, accounts: 3 });
  });
  it('falls back to UTC for an unknown time zone and clamps the window', async () => {
    const o = (await as<{ j: Json }>('service_role', "select public.analytics_overview(500, 'Mars/Olympus') as j"))[0]!.j;
    expect(o.tz).toBe('UTC');
    expect(o.days).toBe(92);
  });
});

describe('analytics_breakdown', () => {
  it('heroes per mode, with pick share, placement and the ranked medal bands', async () => {
    const b = await breakdown();
    const hero = (mode: string, band: string, id: string) => b.heroes.find((h: Json) => h.mode === mode && h.band === band && h.heroId === id);
    // ranked, last 7 days: A warden 1st, A magician 6th, B magician 2nd
    expect(hero('ranked', 'all', 'warden')).toMatchObject({ games: 1, avgPlacement: 1, topHalfRate: 1, firstRate: 1 });
    expect(hero('ranked', 'all', 'magician')).toMatchObject({ games: 2, avgPlacement: 4, topHalfRate: 0.5, firstRate: 0 });
    expect(Number(hero('ranked', 'all', 'magician').pickRate)).toBeCloseTo(2 / 3, 3);
    // medal: seed 11 from rank_results (division 7 = Gold), seed 12 from the entry (division 4 = Silver)
    expect(hero('ranked', 'Gold', 'warden')).toMatchObject({ games: 1 });
    expect(hero('ranked', 'Silver', 'magician')).toMatchObject({ games: 1 });
    expect(b.medals).toEqual([{ medal: 'Silver', games: 1, avgPlacement: 6 }, { medal: 'Gold', games: 1, avgPlacement: 1 }]);
    // the 1v1: warden won, fi lost
    expect(hero('versus_duel', 'all', 'warden')).toMatchObject({ games: 1, topHalfRate: 1 });
    expect(hero('versus_duel', 'all', 'fi')).toMatchObject({ games: 1, topHalfRate: 0, avgPlacement: 2 });
    // duos: only A's seat (the bot is excluded)
    expect(hero('versus_duos', 'all', 'fi')).toMatchObject({ games: 1, avgPlacement: 1 });
  });

  it('hero offers from lobby telemetry only', async () => {
    const b = await breakdown();
    const offer = (id: string) => b.heroOffers.find((o: Json) => o.heroId === id);
    expect(offer('warden')).toMatchObject({ offered: 2, picked: 1 });
    expect(offer('magician')).toMatchObject({ offered: 2, picked: 1 });
    expect(offer('fi')).toMatchObject({ offered: 1, picked: 0 });
    expect(offer('mode:lobby')).toBeUndefined();
    expect(offer('coran')).toMatchObject({ offered: 1, picked: 0 }); // the practice row is not a lobby offer
  });

  it('tribes in the run and on the final board', async () => {
    const b = await breakdown();
    const inRun = (mode: string, t: string) => b.tribesInRun.find((r: Json) => r.mode === mode && r.tribe === t);
    expect(inRun('ranked', 'mech')).toMatchObject({ games: 2, avgPlacement: 3.5 });
    expect(Number(inRun('ranked', 'mech').rate)).toBeCloseTo(2 / 3, 3);
    expect(inRun('practice', 'kobold')).toMatchObject({ games: 2, rate: 1 });
    const fin = b.tribesFinal.find((r: Json) => r.mode === 'ranked' && r.tribe === 'beast');
    expect(fin).toMatchObject({ games: 1, firstRate: 1 });
  });

  it('a build filter narrows to that build and hides the unstamped Versus rows', async () => {
    const b = await breakdown('0.1.0+mid');
    expect(b.patch).toBe('0.1.0+mid');
    expect(b.modes).toEqual([{ mode: 'ranked', games: 1, accounts: 1, seats: 8, avgPlacement: 2 }]);
    expect(b.patches.map((p: Json) => p.patch).sort()).toEqual(['0.1.0+mid', '0.1.0+new']);
  });

  it('returns a small payload', async () => {
    expect(JSON.stringify(await breakdown()).length).toBeLessThan(20_000);
    expect(JSON.stringify(await overview()).length).toBeLessThan(20_000);
  });
});
