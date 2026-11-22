// Cost check for the analytics RPCs at a realistic volume (owner 2026-11-22: "any time frame", so no span cap without
// numbers). Seeds PGlite with ~50k finished games over a year (Career rows carrying a ~3 KB entry like the real final
// board), applies the migration, then times each RPC per range and prints the plan of a range read.
//   npx tsx apps/dash/scripts/bench-analytics.mts [games=50000]
// PGlite is single-threaded WASM, so these are an upper bound next to the hosted Postgres.
import { PGlite } from '@electric-sql/pglite';
import { STUB, STUB_V2, readMigration, readMigrationV2 } from '../src/server/analyticsDb';

const N = Number(process.argv[2] ?? 50_000);
const lobby = Math.round(N * 0.8), practice = Math.round(N * 0.12), duels = Math.round(N * 0.04), groups = Math.round(N * 0.02), tut = Math.round(N * 0.02);
const USERS = Math.max(50, Math.round(N / 15));

const db = new PGlite();
await db.exec(STUB);
await db.exec(STUB_V2);
await db.exec(readMigration());
await db.exec(readMigrationV2());
const t0 = performance.now();
await db.exec(`
  select setseed(0.42);
  insert into auth.users (id, created_at, is_anonymous)
    select md5('u' || i)::uuid, now() - random() * interval '400 days', random() < 0.9 from generate_series(1, ${USERS}) i;
  insert into public.run_history (user_id, patch, hero_id, placement, mode, entry, created_at)
    select md5('u' || (1 + (i % ${USERS})))::uuid, '0.1.0+' || (i / 500), (array['warden','indy','myra','soren','nadja','keshi','aster','bram'])[1 + i % 8],
      1 + i % 8, 'lobby',
      jsonb_build_object('seed', i, 'tribes', jsonb_build_array('kobold','dragon','beast','demon','dwarf'),
        'dominantTribe', (array['kobold','dragon','beast','demon','dwarf'])[1 + i % 5], 'activeMs', 600000 + (i % 900) * 1000,
        'board', jsonb_build_object('runes', jsonb_build_array('rune' || (i % 40), 'rune' || (i % 13)), 'ancient', jsonb_build_object('id', (array['death','fortune','genesis','time','bonds','war'])[1 + i % 6]), 'minions', (select jsonb_agg(jsonb_build_object('cardId', 'c' || k || '_' || i, 'attack', k, 'health', k, 'keywords', repeat('x', 300))) from generate_series(1, 7) k))),
      now() - random() * interval '365 days'
    from generate_series(1, ${lobby}) i;
  insert into public.rank_results (user_id, run_id, seed, division_before, created_at)
    select user_id, 'r' || (entry->>'seed'), (entry->>'seed')::bigint, (id % 18)::int, created_at from public.run_history where id % 4 <> 0;
  -- a lobby run's telemetry: ~50 distinct cards seen in the shop, ~13 bought, 2 Discovers, 6 runes offered, 2 picked
  insert into public.run_telemetry (user_id, patch, hero_id, hero_offer, source, created_at, placement, set_id, offered_cards, bought_cards,
      discover_offered_cards, discover_bought_cards, offered_runes, picked_runes)
    select user_id, patch, hero_id, array['mode:lobby', hero_id, 'indy', 'soren'], 'ladder', created_at, placement, 'set2',
      array(select 'c' || ((h.id * 7 + k * 13) % 180) from generate_series(1, 50) k),
      array(select 'c' || ((h.id * 7 + k * 13) % 180) from generate_series(1, 50, 4) k),
      array(select 'c' || ((h.id * 3 + k * 29) % 180) from generate_series(1, 6) k),
      array(select 'c' || ((h.id * 3 + k * 29) % 180) from generate_series(1, 2) k),
      array(select 'rune' || ((h.id + k * 11) % 60) from generate_series(1, 6) k),
      array(select 'rune' || ((h.id + k * 11) % 60) from generate_series(1, 2) k)
    from public.run_history h;
  insert into public.practice_games (user_id, patch, hero_id, placement, final_board, created_at)
    select md5('u' || (1 + (i % ${USERS})))::uuid, '0.1.0+' || (i / 100), 'warden', 1 + i % 8,
      jsonb_build_object('tribes', jsonb_build_array('kobold','dragon','beast','demon','dwarf')), now() - random() * interval '365 days'
    from generate_series(1, ${practice}) i;
  update public.practice_games set tp_active_ms = (400000 + id * 7 % 900000)::text;
  insert into public.versus_matches (phase, p1_user, p2_user, p1_hero, p2_hero, winner_seat, completed_at)
    select 'complete', md5('u' || (1 + (i % ${USERS})))::uuid, md5('u' || (1 + ((i * 7) % ${USERS})))::uuid, 'warden', 'indy',
      case when i % 2 = 0 then 'p1' else 'p2' end, now() - random() * interval '365 days'
    from generate_series(1, ${duels}) i;
  insert into public.versus_group_matches (id, phase, seat_count, options, completed_at)
    select md5('g' || i)::uuid, 'complete', 4, jsonb_build_object('mode', (array['group','duos','ranked_duos'])[1 + i % 3]), now() - random() * interval '365 days'
    from generate_series(1, ${groups}) i;
  insert into public.versus_group_seats (match_id, seat, user_id, hero, placement)
    select md5('g' || i)::uuid, 'p' || s, md5('u' || (1 + ((i + s * 13) % ${USERS})))::uuid, 'myra', s
    from generate_series(1, ${groups}) i, generate_series(1, 4) s;
  insert into public.progression_results (user_id, run_id, mode, placement, settled_at)
    select md5('u' || i)::uuid, 'tut', 'tutorial', 1, now() - random() * interval '365 days' from generate_series(1, least(${tut}, ${USERS})) i;
  insert into public.profiles (user_id, author, rank_season, rank_division, account_xp, account_level, equipped_title_id)
    select md5('u' || i)::uuid, 'p' || i, 3, i % 18, i * 10, 1 + i % 60, 'title' || (i % 9) from generate_series(1, ${USERS}) i;
  update public.rank_results set season = 3, applied_delta = (id_hash % 61) - 30 from (select run_id as rid, abs(hashtext(run_id)) as id_hash from public.rank_results) z where z.rid = run_id;
  insert into public.friendships (user_a, user_b, requester, status, created_at, accepted_at)
    select md5('u' || i)::uuid, md5('u' || (i + 1))::uuid, md5('u' || i)::uuid, 'accepted', t, t + interval '1 hour'
    from generate_series(1, ${USERS} - 1) i, lateral (select now() - random() * interval '365 days' as t) x;
  insert into public.duos_teams (user_lo, user_hi, created_at) select md5('u' || i)::uuid, md5('u' || (i + 2))::uuid, now() - random() * interval '365 days' from generate_series(1, ${USERS} / 5) i;
  insert into public.friend_invites (from_user, to_user, kind, status, created_at) select md5('u' || (1 + i % ${USERS}))::uuid, md5('u' || (2 + i % ${USERS}))::uuid,
    (array['versus_room', 'duos_party'])[1 + i % 2], (array['accepted', 'expired', 'declined'])[1 + i % 3], now() - random() * interval '365 days' from generate_series(1, ${N} / 10) i;
  insert into public.direct_messages (sender, recipient, body, created_at) select md5('u' || (1 + i % ${USERS}))::uuid, md5('u' || (2 + i % ${USERS}))::uuid, 'x', now() - random() * interval '1 day' from generate_series(1, 2000) i;
  insert into public.player_presence (user_id, status, mode, updated_at) select md5('u' || i)::uuid, (array['online', 'in_game', 'offline'])[1 + i % 3], 'lobby', now() - random() * interval '2 hours' from generate_series(1, ${USERS}) i;
  insert into public.achievement_catalog select 'ach' || i, 'career' from generate_series(1, 200) i;
  insert into public.achievement_completions (user_id, achievement_id, completed_at) select distinct on (u, a) md5('u' || u)::uuid, 'ach' || a, now() - random() * interval '365 days'
    from (select 1 + (i % ${USERS}) as u, 1 + ((i * 7) % 120) as a from generate_series(1, ${N} / 2) i) z;
  insert into public.cosmetic_catalog select 'cos' || i, 'hero_skin' from generate_series(1, 100) i;
  insert into public.cosmetic_loadouts (user_id, slot, cosmetic_id) select md5('u' || i)::uuid, 'skin', 'cos' || (i % 30) from generate_series(1, ${USERS}) i;
  insert into public.client_crash_reports (build, last_step, created_at) select 'b' || (i % 20), 'step' || (i % 7), now() - random() * interval '365 days' from generate_series(1, 2000) i;
  insert into public.bug_reports (status, severity, created_at) select 'open', 'low', now() - random() * interval '365 days' from generate_series(1, 300) i;
  analyze;
`);
const tr0 = performance.now();
const rolled = (await db.query<{ n: number }>('select analytics.balance_rollup_catchup() as n')).rows[0]!.n;
console.log(`balance rollup backfill (the nightly job's first run): ${rolled} rows in ${Math.round(performance.now() - tr0)} ms`);
const size = (await db.query<{ s: string }>("select pg_size_pretty(pg_total_relation_size('public.run_history')) as s")).rows[0]!.s;
console.log(`seeded ~${N} games (${lobby} lobby, ${practice} practice, ${duels} duels, ${groups} group matches, ${tut} tutorial), ${USERS} accounts; run_history ${size}; ${Math.round(performance.now() - t0)} ms`);

async function time(label: string, sql: string): Promise<void> {
  const runs: number[] = [];
  let bytes = 0;
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    const r = await db.query<{ j: unknown }>(sql);
    runs.push(performance.now() - t);
    bytes = JSON.stringify(r.rows[0]?.j ?? null).length;
  }
  runs.sort((a, b) => a - b);
  console.log(`${label.padEnd(28)} median ${runs[1]!.toFixed(0).padStart(6)} ms   payload ${(bytes / 1024).toFixed(1)} kB`);
}

for (const [label, from] of [['today', 'current_date'], ['7 days', 'current_date - 6'], ['30 days', 'current_date - 29'], ['90 days', 'current_date - 89'], ['365 days', 'current_date - 364'], ['all time', 'null']] as const) {
  await time(`overview  ${label}`, `select public.analytics_overview(${from}, null, 'UTC') as j`);
}
for (const [label, from] of [['today', 'current_date'], ['7 days', 'current_date - 6'], ['30 days', 'current_date - 29'], ['365 days', 'current_date - 364'], ['all time', 'null']] as const) {
  await time(`breakdown ${label}`, `select public.analytics_breakdown(${from}, null, null, 'UTC') as j`);
}
for (const fn of ['players', 'social', 'progression', 'health', 'balance']) {
  for (const [label, from] of [['7 days', 'current_date - 6'], ['30 days', 'current_date - 29'], ['all time', 'null']] as const) {
    await time(`${fn.padEnd(11)} ${label}`, `select public.analytics_${fn}(${from}, null, 'UTC') as j`);
  }
}
if (process.env.BENCH_PROFILE) {
  // the pieces of an all-time balance read, one at a time
  const pieces: Array<[string, string]> = [
    ['rollup sums', "select kind, item, sum(n), sum(sum_place) from analytics.balance_daily group by 1, 2"],
    ['rollup unique players', 'select kind, item, taken, count(distinct p) from analytics.balance_daily cross join unnest(players) p group by 1, 2, 3'],
    ['career final boards', "select m->>'cardId', count(*) from public.run_history h cross join lateral jsonb_array_elements(h.entry #> '{board,minions}') m group by 1"],
    ['career heroes/tribes', "select hero_id, entry->>'dominantTribe', count(*) from public.run_history group by 1, 2"],
  ];
  for (const [label, sql] of pieces) await time(`  piece: ${label}`, `select count(*) as j from (${sql}) z`);
}
const plan = await db.query<{ 'QUERY PLAN': string }>("explain select count(*) from public.run_history where created_at >= now() - interval '7 days' and created_at < now()");
console.log('\nplan of a 7-day run_history read:\n' + plan.rows.map((r) => `  ${r['QUERY PLAN']}`).join('\n'));
await db.close();
