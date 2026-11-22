import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { STUB, STUB_V2, readMigration, readMigrationV2 } from './analyticsDb';

/**
 * THE ROUND-TWO ANALYTICS RPCs, EXECUTED (supabase/migrations/2026-11-29-analytics-v2.sql): players (retention +
 * engagement), social (live now + social), progression (ladder + levels + achievements + cosmetics), health (crashes,
 * bugs, ops checks, database size, retention runs, balance trends). Both migrations applied twice (idempotent).
 * Proves the grants are locked to service_role and the numbers come out right on a small known seed.
 */
const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const C = '00000000-0000-0000-0000-00000000000c';
const BOT = '00000000-0000-0000-0000-0000000000ff';
const CLAUDE = '00000000-0000-0000-0000-0000000000ee';

const SEED = `
  insert into auth.users (id, created_at, is_anonymous) values ('${A}', now() - interval '40 days', false), ('${B}', now(), true),
    ('${C}', now(), false), ('${BOT}', now(), true), ('${CLAUDE}', now(), true);
  insert into public.profiles (user_id, author, rank_season, rank_division, account_xp, account_level, equipped_title_id) values
    ('${A}', 'Kevin', 3, 7, 500, 5, 't1'), ('${B}', 'Guest', 3, 2, 100, 2, 't1'), ('${C}', 'Cee', 2, 10, 0, 1, null),
    ('${CLAUDE}', 'Claudebot3', 3, 16, 900, 9, 't9');
  insert into public.versus_test_bots values ('${BOT}');

  -- A: first game 10 days ago, back 9 days ago, again today. B: first game 3 days ago (practice), never back. C: first today.
  insert into public.run_history (user_id, patch, hero_id, placement, mode, entry, created_at) values
    ('${A}', 'p', 'warden', 2, 'lobby', '{"seed": 1, "activeMs": 600000, "dominantTribe": "kobold", "board": {"runes": ["r1", "r2"], "ancient": {"id": "death"}}}', now() - interval '10 days'),
    ('${A}', 'p', 'warden', 5, 'lobby', '{"seed": 2, "dominantTribe": "kobold", "board": {"runes": ["r1"]}}', now() - interval '9 days'),
    ('${A}', 'p', 'indy', 1, 'lobby', '{"seed": 3, "unrated": "all-generated", "board": {"runes": ["r9"]}}', now()),
    ('${CLAUDE}', 'p', 'warden', 8, 'lobby', '{"seed": 9, "activeMs": 999999999}', now());
  insert into public.practice_games (user_id, patch, hero_id, placement, tp_active_ms, created_at) values
    ('${B}', 'p', 'coran', 3, '1200000', now() - interval '3 days'), ('${C}', 'p', 'coran', 4, null, now());
  insert into public.rank_results (user_id, run_id, seed, division_before, season, applied_delta, promoted, demoted, created_at) values
    ('${A}', 'r1', 1, 6, 3, 40, true, false, now() - interval '10 days'), ('${A}', 'r2', 2, 7, 3, -10, false, false, now() - interval '9 days'),
    ('${B}', 'r3', 5, 2, 3, 20, false, false, now() - interval '3 days'), ('${CLAUDE}', 'r9', 9, 16, 3, 99, true, false, now());

  insert into public.player_presence values ('${A}', 'in_game', 'lobby', now()), ('${B}', 'online', null, now()),
    ('${C}', 'offline', null, now()), ('${BOT}', 'in_game', 'versus', now());
  insert into public.player_presence (user_id, status, updated_at) select md5('stale')::uuid, 'online', now() - interval '10 minutes';
  insert into public.spectate_presence values ('${C}', 'run', now()), ('${B}', 'run', now() - interval '20 minutes');
  insert into public.versus_matches (phase, p1_user, p2_user, p1_hero, p2_hero, winner_seat, completed_at) values
    ('complete', '${A}', '${B}', 'warden', 'fi', 'p1', now()), ('complete', '${A}', '${BOT}', 'warden', 'fi', 'p1', now());
  insert into public.versus_group_matches (phase, seat_count, options, dev_forced, completed_at) values
    ('complete', 4, '{"mode": "duos"}', false, now()), ('complete', 4, '{"mode": "group"}', true, now());
  insert into public.duos_teams (user_lo, user_hi, created_at) values ('${A}', '${B}', now() - interval '1 day');
  insert into public.friendships (user_a, user_b, requester, status, created_at, accepted_at) values
    ('${A}', '${B}', '${A}', 'accepted', now() - interval '2 days', now()), ('${A}', '${C}', '${A}', 'pending', now(), null);
  insert into public.friend_invites (from_user, to_user, kind, status) values ('${A}', '${B}', 'versus_room', 'accepted'), ('${A}', '${C}', 'duos_party', 'pending');
  insert into public.direct_messages (sender, recipient, body) values ('${A}', '${B}', 'secret one'), ('${B}', '${A}', 'secret two'), ('${BOT}', '${A}', 'bot');

  insert into public.achievement_catalog values ('a1', 'career'), ('a2', 'career'), ('a3', 'ranked');
  insert into public.achievement_completions values ('${A}', 'a1', now()), ('${B}', 'a1', now() - interval '3 days'), ('${A}', 'a2', now() - interval '60 days');
  insert into public.cosmetic_catalog values ('skin1', 'hero_skin'), ('frame1', 'portrait_frame');
  insert into public.cosmetic_loadouts values ('${A}', 'skin', 'warden', 'skin1'), ('${B}', 'skin', 'warden', 'skin1'), ('${BOT}', 'skin', 'warden', 'skin1'),
    ('${A}', 'frame', '', 'frame1');

  insert into public.client_crash_reports (build, last_step) values ('b1', 'boot'), ('b1', 'shop');
  insert into public.bug_reports (status, severity) values ('open', 'high');
  insert into ops.health_checks (run_id, source, check_name, status, detail) values ('x', 'cron', 'pool', 'ok', '{}'), ('x', 'cron', 'writes', 'fail', '{"why": "none"}');
  insert into ops.retention_rules (rule, keep_days, batch_limit, last_deleted, total_deleted) values ('perf_runs', 60, 5000, 3, 9);
  insert into ops.events (source, kind, detail) values ('retention', 'run', '{"deleted": 3, "failed": 0}'), ('health', 'x', '{}');
`;

let db: PGlite;
async function as<T>(role: 'anon' | 'authenticated' | 'service_role', sql: string): Promise<T[]> {
  await db.exec('begin');
  try {
    await db.exec(`set local role ${role}`);
    const r = await db.query<T>(sql);
    await db.exec('commit');
    return r.rows;
  } catch (e) {
    await db.exec('rollback');
    throw e;
  }
}
type Json = Record<string, any>;
const call = async (fn: string, from = 'current_date - 29'): Promise<Json> =>
  (await as<{ j: Json }>('service_role', `select public.${fn}(${from}, null, 'UTC') as j`))[0]!.j;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(STUB_V2);
  await db.exec(SEED);
  for (let i = 0; i < 2; i++) { await db.exec(readMigration()); await db.exec(readMigrationV2()); }
}, 60_000);
afterAll(async () => { await db.close(); });

const FNS = ['analytics_players', 'analytics_social', 'analytics_progression', 'analytics_health'];

describe('round-two grants', () => {
  for (const role of ['anon', 'authenticated'] as const) {
    it(`${role} cannot execute any of the four or the private functions behind them`, async () => {
      for (const fn of FNS) await expect(as(role, `select public.${fn}(null, null, 'UTC')`)).rejects.toThrow(/permission denied/);
      await expect(as(role, "select analytics.players(null, null, 'UTC')")).rejects.toThrow(/permission denied/);
    });
  }
  it('only service_role (and the owner) hold EXECUTE, and each is SECURITY DEFINER with a pinned search_path', async () => {
    const grants = (await db.query<{ grantee: string }>(`select distinct grantee from information_schema.routine_privileges
      where routine_name = any ($1) and privilege_type = 'EXECUTE'`, [FNS])).rows;
    expect(new Set(grants.map((g) => g.grantee))).toEqual(new Set(['service_role', 'postgres']));
    const procs = (await db.query<{ prosecdef: boolean; proconfig: string[] | null }>('select prosecdef, proconfig from pg_proc where proname = any ($1)', [FNS])).rows;
    expect(procs).toHaveLength(4);
    for (const p of procs) { expect(p.prosecdef).toBe(true); expect(p.proconfig?.some((c) => c.startsWith('search_path='))).toBe(true); }
  });
});

describe('analytics_players', () => {
  it('retention: cohort by first finished game, only counted once the window has passed', async () => {
    const p = await call('analytics_players');
    expect(p.retention.cohort).toBe(3); // A, B, C (never the Claudebot)
    expect(p.retention.d1).toEqual({ eligible: 2, returned: 1 }); // A came back the next day; B did not; C's day 1 is not over
    expect(p.retention.d7).toEqual({ eligible: 1, returned: 1 });
    expect(p.retention.d30).toEqual({ eligible: 0, returned: 0 });
    expect(p.cohorts.reduce((a: number, c: Json) => a + c.players, 0)).toBe(3);
  });
  it('DAU / WAU / MAU, games per player, hours played and the heatmap', async () => {
    const p = await call('analytics_players');
    expect(p.active).toMatchObject({ dau: 3, wau: 3, mau: 3 }); // B played the 1v1 against A today
    expect(Number(p.active.stickiness)).toBeGreaterThan(0);
    expect(p.gamesPerPlayer.players).toBe(3);
    // A: 3 lobby + the 1v1 + Duos = 5; B: practice + the 1v1 = 2; C: 1
    expect(p.gamesPerPlayer.buckets.find((b: Json) => b.label === '1').players).toBe(1);
    expect(p.gamesPerPlayer.buckets.find((b: Json) => b.label === '4-7').players).toBe(1);
    expect(p.gamesPerPlayer.buckets.find((b: Json) => b.label === '2-3').players).toBe(1);
    // 600 000 ms (A's Career entry) + 1 200 000 ms (B's practice) = 0.5 h; the Claudebot's huge value is excluded
    expect(p.playTime).toMatchObject({ hours: 0.5, timedGames: 2, games: 5 });
    expect(p.heatmap.reduce((a: number, h: Json) => a + h.games, 0)).toBe(7); // 3 lobby + 2 practice + duel + duos
  });
});

describe('analytics_social', () => {
  it('now: online in the last 5 minutes, in a game by mode, watching in the last 3; never the bot', async () => {
    const s = await call('analytics_social');
    expect(s.now).toMatchObject({ online: 2, inGame: 1, byMode: { lobby: 1 }, watching: 1 });
  });
  it('per-bucket social counts, DMs counted but never read', async () => {
    const s = await call('analytics_social');
    expect(s.totals).toMatchObject({ versus_duel: 1, versus_duos: 1, duos_team: 1, friend_request: 2, friend_accept: 1, invite_versus: 1, invite_duos: 1, dm: 2 });
    expect(s.totals.versus_group).toBeUndefined(); // the dev-forced match
    expect(s.invites).toEqual({ sent: 2, accepted: 1 });
    expect(s.friendships).toEqual({ accepted: 1, pending: 1 });
    expect(JSON.stringify(s)).not.toContain('secret');
  });
});

describe('analytics_progression', () => {
  it('divisions this season, points movement, levels, achievements and cosmetics', async () => {
    const p = await call('analytics_progression');
    expect(p.season).toBe(3);
    expect(p.divisions).toEqual([{ division: 2, medal: 'Bronze', players: 1 }, { division: 7, medal: 'Gold', players: 1 }]);
    expect(p.movement).toMatchObject({ games: 3, players: 2, netPoints: 50, promotions: 1, demotions: 0 });
    expect(p.levels).toMatchObject({ players: 2, max: 5 });
    expect(p.achievements.inRange).toBe(2);
    expect(p.achievements.most[0]).toEqual({ id: 'a1', players: 2 });
    expect(p.achievements.least[0]).toEqual({ id: 'a3', players: 0 });
    expect(p.equipped[0]).toEqual({ id: 'skin1', category: 'hero_skin', players: 2 });
    expect(p.titles).toEqual([{ id: 't1', players: 2 }]);
  });
});

describe('analytics_health', () => {
  it('crashes, bugs, ops checks, retention, database size', async () => {
    const h = await call('analytics_health');
    expect(h.crashes.total).toBe(2);
    expect(h.crashes.byBuild).toEqual([{ build: 'b1', n: 2 }]);
    expect(h.bugs).toMatchObject({ total: 1, byStatus: { open: 1 }, bySeverity: { high: 1 } });
    expect(h.ops.latest.map((l: Json) => `${l.check}:${l.status}`).sort()).toEqual(['pool:ok', 'writes:fail']);
    expect(h.ops.retentionRules[0]).toMatchObject({ rule: 'perf_runs', lastDeleted: 3, totalDeleted: 9 });
    expect(h.ops.retentionRuns).toHaveLength(1);
    expect(h.database.bytes).toBeGreaterThan(0);
    expect(h.database.limitBytes).toBe(524288000);
    expect(h.database.tables.length).toBeGreaterThan(0);
  });
  it('balance trends from ranked lobby games only: hero, tribe, rune, Ancient', async () => {
    const h = await call('analytics_health');
    expect(h.trendBucket).toBe('week');
    const warden = h.trends.hero.find((x: Json) => x.id === 'warden');
    expect(warden).toMatchObject({ games: 2, avgPlacement: 3.5, top4Rate: 0.5 });
    expect(h.trends.hero.find((x: Json) => x.id === 'indy')).toBeUndefined(); // that game was unrated
    expect(h.trends.tribe[0]).toMatchObject({ id: 'kobold', games: 2 });
    expect(h.trends.rune.find((x: Json) => x.id === 'r1')).toMatchObject({ games: 2 });
    expect(h.trends.ancient).toEqual([expect.objectContaining({ id: 'death', games: 1, avgPlacement: 2 })]);
  });
});
