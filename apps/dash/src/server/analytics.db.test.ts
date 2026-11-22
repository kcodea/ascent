import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { STUB, readMigration } from './analyticsDb';

/**
 * THE ANALYTICS RPCs, EXECUTED (supabase/migrations/2026-11-27-analytics-dashboard.sql).
 *
 * PGlite builds the tables the functions read, with only the columns they touch, under Supabase's defaults (every new
 * public function is granted to anon + authenticated). It seeds a small known set of finished games, applies the
 * migration TWICE (idempotent), then proves: anon and authenticated cannot execute either entry point or anything in
 * the private schema; the service role can; and the numbers come out right for the seed.
 */
const SQL = readMigration();



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
const overview = async (from: string | null, to: string | null = 'current_date', tz = 'UTC'): Promise<Json> =>
  (await as<{ j: Json }>('service_role', `select public.analytics_overview(${from ?? 'null'}, ${to ?? 'null'}, '${tz}') as j`))[0]!.j;
const breakdown = async (patch: string | null = null, from = 'current_date - 6'): Promise<Json> =>
  (await as<{ j: Json }>('service_role', `select public.analytics_breakdown(${from}, current_date, $1, 'UTC') as j`, [patch]))[0]!.j;

describe('analytics RPC grants', () => {
  for (const role of ['anon', 'authenticated'] as const) {
    it(`${role} cannot execute the entry points or the private schema`, async () => {
      await expect(as(role, "select public.analytics_overview(null, null, 'UTC')")).rejects.toThrow(/permission denied/);
      await expect(as(role, "select public.analytics_breakdown(null, null, null, 'UTC')")).rejects.toThrow(/permission denied/);
      await expect(as(role, "select analytics.overview(null, null, 'UTC')")).rejects.toThrow(/permission denied/);
      await expect(as(role, 'select * from analytics.player_games(now() - interval \'1 day\', now())')).rejects.toThrow(/permission denied/);
    });
  }
  it('the entry points are SECURITY DEFINER with a pinned search_path', async () => {
    const rows = (await db.query<{ proname: string; prosecdef: boolean; proconfig: string[] | null }>(
      "select proname, prosecdef, proconfig from pg_proc where proname in ('analytics_overview', 'analytics_breakdown')")).rows;
    expect(rows).toHaveLength(2); // one overload each (the never-applied days-based draft is dropped)
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
  it('30 days: by day, with totals and the per-day counts', async () => {
    const o = await overview('current_date - 29');
    expect(o.tz).toBe('UTC');
    expect(o.bucket).toBe('day');
    expect(o.series).toHaveLength(30);
    const today = o.series[29];
    // games today: 3 of A's lobbies + 2 practice + 1 duel + 1 duos = 7 (the Claudebot lobby, the dev-forced match and the
    // unfinished duel are not games)
    expect(today.games).toBe(7);
    expect(today.byMode).toEqual({ ranked: 2, unrated_lobby: 1, practice: 2, versus_duel: 1, versus_duos: 1 });
    expect(today.accounts).toBe(3); // A, B, C (never the bot or the Claudebot)
    expect(today.newEmail).toBe(1); // C
    expect(today.newGuest).toBe(3); // B, BOT, CLAUDE (auth rows are counted as created)
    expect(today.firstGame).toBe(1); // C (B first played yesterday, A 35 days ago)
    expect(o.series[28]).toMatchObject({ games: 1, accounts: 1, firstGame: 1 });
    expect(o.totals).toEqual({ games: 8, accounts: 3, newEmail: 1, newGuest: 3, firstGame: 2 });
    expect(o.previous).toEqual({ games: 1, accounts: 1 }); // the 30 days before: A's game 35 days ago
  });

  it('today: by hour, up to the current hour, with every game in the current hour', async () => {
    const o = await overview('current_date');
    expect(o.bucket).toBe('hour');
    const hour = Number((await db.query<{ h: number }>("select extract(hour from now() at time zone 'UTC')::int as h")).rows[0]!.h);
    expect(o.series).toHaveLength(hour + 1);
    expect(o.series[hour]).toMatchObject({ games: 7, accounts: 3 });
    expect(o.totals.games).toBe(7);
    expect(o.previous).toEqual({ games: 1, accounts: 1 }); // yesterday
  });

  it('all time: starts at the first finished game, no previous period', async () => {
    const o = await overview(null, null);
    expect(o.from).toBe((await db.query<{ d: string }>("select (current_date - 35)::text as d")).rows[0]!.d);
    expect(o.bucket).toBe('day');
    expect(o.series).toHaveLength(36);
    expect(o.totals.games).toBe(9);
    expect(o.previous).toBeNull();
  });

  it('buckets long ranges by week and by month', async () => {
    expect((await overview('current_date - 200')).bucket).toBe('week');
    const year3 = await overview('current_date - 1100');
    expect(year3.bucket).toBe('month');
    expect(year3.series.length).toBeLessThanOrEqual(38);
    expect(year3.totals.games).toBe(9);
  });

  it('falls back to UTC for an unknown time zone, and a reversed range becomes one day', async () => {
    const o = await overview('current_date', 'current_date - 5', 'Mars/Olympus');
    expect(o.tz).toBe('UTC');
    expect(o.from).toBe(o.to);
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

  it('all time (from null) has no span cap and reaches the oldest game', async () => {
    const b = await breakdown(null, 'null');
    const ranked = b.modes.find((m: Json) => m.mode === 'ranked');
    expect(ranked.games).toBe(4); // A's game 35 days ago is in it now
    expect(b.patches.map((p: Json) => p.patch)).toContain('0.1.0+old');
  });

  it('returns a small payload', async () => {
    expect(JSON.stringify(await breakdown()).length).toBeLessThan(20_000);
    expect(JSON.stringify(await overview(null, null)).length).toBeLessThan(20_000);
  });
});
