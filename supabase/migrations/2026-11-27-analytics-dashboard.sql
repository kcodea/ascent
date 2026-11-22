-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- THE DEV ANALYTICS DASHBOARD's read side (2026-11-22, feat/dev-analytics-dashboard). Additive, idempotent, safe to
-- re-run. No Edge Function. Nothing in the game calls these.
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Owner 2026-11-22: a private analytics page for Kevin and Mike (apps/dash, Cloudflare Pages behind Cloudflare
-- Access). Its Pages Function verifies the Access login, then calls the two RPCs below with the service role key.
--
--   - `public.analytics_overview(from, to, tz)`: the headline numbers and the time series for ANY range (from null =
--     all time, to null = today), in the viewer's time zone: games finished (by mode), accounts that finished at least
--     one game, new auth accounts (email vs guest), accounts whose FIRST ever finished game fell in it, and the same
--     length period before it. Bucketed by hour (one day), day (up to 92 days), week (up to two years) or month.
--   - `public.analytics_breakdown(from, to, patch, tz)`: the detail for any date range (from null = all time) and an
--     optional exact build (`patch` = the client's `0.1.0+<sha>` stamp): per mode, per hero (with ranked medal
--     bands), per tribe (in the run's tribes / the final board's top tribe), hero offer pick rate, and the builds seen.
--
-- Both return ONE small aggregated jsonb (never raw rows). They are SECURITY DEFINER with a pinned search_path and
-- EXECUTE is granted to `service_role` ONLY (Supabase's defaults grant every new public function to anon and
-- authenticated, so both are revoked explicitly). The implementation lives in the private `analytics` schema, which
-- no client role can use. PostgREST only exposes `public`, which is why the two entry points live there.
--
-- WHAT "A FINISHED GAME" IS (one row per account per finished game, `analytics.player_games`):
--   run_history          mode 'lobby'        -> 'ranked', or 'unrated_lobby' when the entry carries `unrated`
--                        any other mode      -> 'other' (legacy course / rift runs)
--   practice_games                           -> 'practice'
--   versus_matches       phase 'complete'    -> 'versus_duel' (two rows: p1 and p2; placement 1 = winner)
--   versus_group_matches phase 'complete'    -> options.mode 'duos' -> 'versus_duos', 'ranked_duos' -> 'ranked_duos',
--                        (+ versus_group_seats) else 'versus_group'; dev-forced test matches are skipped
--   progression_results  mode 'tutorial'     -> 'tutorial'
-- Gauntlet games leave no per-game row (only `gauntlet_progress`, a first clear per stage), so they are not counted.
-- Accounts in `versus_test_bots` and the agent test identities (profiles named Claudebot*) are excluded.
--
-- INDEXES: the date-range scans need a time index on each source. `practice_games (created_at)` and
-- `run_telemetry (created_at)` exist; this file adds four. At 2026-10-28 sizes (run_history 323 rows, versus_matches 88,
-- versus_group_matches 119, progression_results 468) each is well under 100 kB; they grow at ~40 bytes a row.
--
-- NO SPAN CAP (owner 2026-11-22: "any time frame"): every source is read by a time-index range scan and the outputs are
-- aggregates (a chart is at most ~120 buckets), so a long range costs rows scanned, not payload. Measured with
-- apps/dash/scripts/bench-analytics.mts; numbers and the decision in apps/dash/README.md.
--
-- ROLLBACK:
--   drop function if exists public.analytics_breakdown(date, date, text, text);
--   drop function if exists public.analytics_overview(date, date, text);
--   drop schema if exists analytics cascade;
--   drop index if exists public.run_history_created_at;
--   drop index if exists public.progression_results_settled_at;
--   drop index if exists public.versus_matches_completed_at;
--   drop index if exists public.versus_group_matches_completed_at;

-- An earlier draft of this file (never applied) had a days-based overview; drop it if it is there.
drop function if exists public.analytics_overview(int, text);

create schema if not exists analytics;
revoke all on schema analytics from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on schema analytics from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on schema analytics from authenticated'; end if;
end $$;

-- ── 1. Indexes for the date-range scans ────────────────────────────────────────────────────────────────────
create index if not exists run_history_created_at on public.run_history (created_at);
create index if not exists progression_results_settled_at on public.progression_results (settled_at);
create index if not exists versus_matches_completed_at on public.versus_matches (completed_at) where phase = 'complete';
create index if not exists versus_group_matches_completed_at on public.versus_group_matches (completed_at) where phase = 'complete';

-- ── 2. Helpers ─────────────────────────────────────────────────────────────────────────────────────────────
-- A time zone name the server knows, else UTC (the caller's value never reaches anything but this lookup).
create or replace function analytics.safe_tz(p_tz text)
returns text language sql stable set search_path = pg_catalog, pg_temp as $$
  select coalesce((select name from pg_timezone_names where name = p_tz limit 1), 'UTC')
$$;

-- Accounts that are not players: the Versus test bots and the agent test identities.
create or replace function analytics.excluded_users()
returns table (user_id uuid) language sql stable set search_path = public, pg_temp as $$
  select b.bot_user from public.versus_test_bots b
  union
  select p.user_id from public.profiles p where p.user_id is not null and p.author ilike 'claudebot%'
$$;

-- Medal of a division index (0 = Bronze I .. 17 = Ascendant III; packages/sim/src/rank.ts).
create or replace function analytics.medal_of(p_division int)
returns text language sql immutable set search_path = pg_catalog, pg_temp as $$
  select case when p_division is null or p_division < 0 then null
    else (array['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Ascendant'])[least(p_division / 3, 5) + 1] end
$$;

-- ── 3. Every finished game in [p_from, p_to), one row per account per game ───────────────────────────────────
-- `game_key` identifies the GAME (a 1v1 is one game with two rows). `seats` is how many finish places the mode has,
-- so "top half" is placement <= seats / 2 (top 4 of a lobby, the winner of a 1v1). `patch` is null for Versus and the
-- tutorial (those rows carry no build stamp).
create or replace function analytics.player_games(p_from timestamptz, p_to timestamptz)
returns table (mode text, game_key text, user_id uuid, at timestamptz, hero_id text, placement int, seats int, patch text)
language sql stable set search_path = public, pg_temp as $$
  select x.* from (
    select case when h.mode = 'lobby' then case when h.entry ? 'unrated' then 'unrated_lobby' else 'ranked' end else 'other' end,
           'rh:' || h.id, h.user_id, h.created_at, h.hero_id, h.placement, 8, h.patch
      from public.run_history h
      where h.created_at >= p_from and h.created_at < p_to
    union all
    select 'practice', 'pg:' || p.id, p.user_id, p.created_at, p.hero_id, p.placement, 8, p.patch
      from public.practice_games p
      where p.created_at >= p_from and p.created_at < p_to
    union all
    select 'versus_duel', 'vm:' || m.id, s.uid, m.completed_at, s.hero,
           case when m.winner_seat is null then null when m.winner_seat = s.seat then 1 else 2 end, 2, null
      from public.versus_matches m
      cross join lateral (values ('p1', m.p1_user, m.p1_hero), ('p2', m.p2_user, m.p2_hero)) as s(seat, uid, hero)
      where m.phase = 'complete' and m.completed_at >= p_from and m.completed_at < p_to
    union all
    select case coalesce(g.options->>'mode', '') when 'duos' then 'versus_duos' when 'ranked_duos' then 'ranked_duos' else 'versus_group' end,
           'vg:' || g.id, s.user_id, g.completed_at, s.hero, s.placement,
           case when coalesce(g.options->>'mode', '') in ('duos', 'ranked_duos') then 4 else g.seat_count end, null
      from public.versus_group_matches g
      join public.versus_group_seats s on s.match_id = g.id
      where g.phase = 'complete' and not coalesce(g.dev_forced, false) and g.completed_at >= p_from and g.completed_at < p_to
    union all
    select 'tutorial', 'tut:' || r.user_id || ':' || r.run_id, r.user_id, r.settled_at, null, r.placement, 8, null
      from public.progression_results r
      where r.mode = 'tutorial' and r.settled_at >= p_from and r.settled_at < p_to
  ) as x (mode, game_key, user_id, at, hero_id, placement, seats, patch)
  where x.user_id is null or not exists (select 1 from analytics.excluded_users() e where e.user_id = x.user_id)
$$;

-- Each account's first ever finished game (any mode). Scalar columns only, so no jsonb is read.
create or replace function analytics.first_game_at()
returns table (user_id uuid, first_at timestamptz)
language sql stable set search_path = public, pg_temp as $$
  select f.uid, min(f.at) from (
    select h.user_id, h.created_at from public.run_history h
    union all select p.user_id, p.created_at from public.practice_games p where p.user_id is not null
    union all select m.p1_user, m.completed_at from public.versus_matches m where m.phase = 'complete'
    union all select m.p2_user, m.completed_at from public.versus_matches m where m.phase = 'complete'
    union all select s.user_id, g.completed_at from public.versus_group_matches g join public.versus_group_seats s on s.match_id = g.id
      where g.phase = 'complete' and not coalesce(g.dev_forced, false)
    union all select r.user_id, r.settled_at from public.progression_results r where r.mode = 'tutorial'
  ) as f (uid, at)
  where f.uid is not null and f.at is not null
    and not exists (select 1 from analytics.excluded_users() e where e.user_id = f.uid)
  group by f.uid
$$;

-- ── 4. The headline numbers + the time series, for ANY range ────────────────────────────────────────────────
-- The first day anything finished, in the viewer's time zone (an "All time" range starts here). Each `min` is one probe
-- of a time index.
create or replace function analytics.first_day(p_tz text)
returns date language sql stable set search_path = public, pg_temp as $$
  select (least(
    (select min(h.created_at) from public.run_history h),
    (select min(p.created_at) from public.practice_games p),
    (select min(m.completed_at) from public.versus_matches m where m.phase = 'complete'),
    (select min(g.completed_at) from public.versus_group_matches g where g.phase = 'complete'),
    (select min(r.settled_at) from public.progression_results r where r.mode = 'tutorial')
  ) at time zone analytics.safe_tz(p_tz))::date
$$;

-- The bucket a range is charted in: one day by HOUR, up to 92 days by day, up to two years by week, longer by month.
create or replace function analytics.bucket_for(p_days int)
returns text language sql immutable set search_path = pg_catalog, pg_temp as $$
  select case when p_days <= 1 then 'hour' when p_days <= 92 then 'day' when p_days <= 731 then 'week' else 'month' end
$$;

-- p_from null = all time (from the first finished game); p_to null = today. Both in the viewer's time zone, inclusive.
-- No span cap: every source is read by a time-index range scan, and the output is at most ~120 buckets (see the
-- measurements in apps/dash/README.md).
create or replace function analytics.overview(p_from date, p_to date, p_tz text)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_tz     text := analytics.safe_tz(p_tz);
  v_today  date := (now() at time zone v_tz)::date;
  v_last   date := least(coalesce(p_to, v_today), v_today);
  v_first  date := coalesce(p_from, analytics.first_day(v_tz), v_last);
  v_span   int;
  v_bucket text;
  v_from   timestamptz;
  v_to     timestamptz;
  v_pfrom  timestamptz;
  v_pto    timestamptz;
  v_s0     timestamp;
  v_s1     timestamp;
  v_out    jsonb;
begin
  if v_first > v_last then v_first := v_last; end if;
  v_span   := v_last - v_first + 1;
  v_bucket := analytics.bucket_for(v_span);
  v_from   := v_first::timestamp at time zone v_tz;
  v_to     := (v_last + 1)::timestamp at time zone v_tz;
  v_pfrom  := (v_first - v_span)::timestamp at time zone v_tz;
  -- A range that reaches today is compared with the period before UP TO THE SAME POINT (today so far vs yesterday so far).
  v_pto    := case when v_last = v_today then now() - make_interval(days => v_span) else v_from end;
  v_s0     := date_trunc(v_bucket, v_first::timestamp);
  -- Today by hour stops at the current hour; every other range runs to its last bucket.
  v_s1     := case when v_bucket = 'hour' and v_last = v_today then date_trunc('hour', now() at time zone v_tz)
                   else date_trunc(v_bucket, v_last::timestamp + interval '1 day' - interval '1 second') end;

  with g as (
    select x.*, date_trunc(v_bucket, x.at at time zone v_tz) as b from analytics.player_games(v_from, v_to) x
  ),
  buckets as (select s as b from generate_series(v_s0, v_s1, ('1 ' || v_bucket)::interval) s),
  per_b as (select g.b, count(distinct g.game_key) as games, count(distinct g.user_id) as accounts from g group by g.b),
  per_mode as (
    select m.b, jsonb_object_agg(m.mode, m.games) as by_mode
    from (select g.b, g.mode, count(distinct g.game_key) as games from g group by g.b, g.mode) m group by m.b
  ),
  joined as (
    select date_trunc(v_bucket, u.created_at at time zone v_tz) as b,
           count(*) filter (where not coalesce(u.is_anonymous, false)) as email,
           count(*) filter (where coalesce(u.is_anonymous, false)) as guest
    from auth.users u where u.created_at >= v_from and u.created_at < v_to group by 1
  ),
  firsts as (
    select date_trunc(v_bucket, f.first_at at time zone v_tz) as b, count(*) as n
    from analytics.first_game_at() f where f.first_at >= v_from and f.first_at < v_to group by 1
  ),
  prev as (
    select count(distinct x.game_key) as games, count(distinct x.user_id) as accounts
    from analytics.player_games(v_pfrom, v_pto) x where p_from is not null
  )
  select jsonb_build_object(
    'tz', v_tz,
    'today', v_today,
    'from', v_first,
    'to', v_last,
    'bucket', v_bucket,
    'series', coalesce((select jsonb_agg(jsonb_build_object(
        't', to_char(s.b, 'YYYY-MM-DD"T"HH24:MI'),
        'games', coalesce(pb.games, 0),
        'accounts', coalesce(pb.accounts, 0),
        'newEmail', coalesce(j.email, 0),
        'newGuest', coalesce(j.guest, 0),
        'firstGame', coalesce(f.n, 0),
        'byMode', coalesce(pm.by_mode, '{}'::jsonb)
      ) order by s.b)
      from buckets s
      left join per_b pb on pb.b = s.b
      left join per_mode pm on pm.b = s.b
      left join joined j on j.b = s.b
      left join firsts f on f.b = s.b), '[]'::jsonb),
    'totals', jsonb_build_object(
      'games', (select count(distinct g.game_key) from g),
      'accounts', (select count(distinct g.user_id) from g),
      'newEmail', (select coalesce(sum(j.email), 0) from joined j),
      'newGuest', (select coalesce(sum(j.guest), 0) from joined j),
      'firstGame', (select coalesce(sum(f.n), 0) from firsts f)),
    'previous', case when p_from is null then null
      else (select jsonb_build_object('games', p.games, 'accounts', p.accounts) from prev p) end
  ) into v_out;
  return v_out;
end $$;


-- ── 5. The detail for a range ──────────────────────────────────────────────────────────────────────────────
create or replace function analytics.breakdown(p_from date, p_to date, p_patch text, p_tz text)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_tz    text := analytics.safe_tz(p_tz);
  v_today date := (now() at time zone v_tz)::date;
  v_last  date := least(coalesce(p_to, v_today), v_today);
  v_first date := coalesce(p_from, analytics.first_day(v_tz), v_last); -- null = all time
  v_patch text := nullif(btrim(coalesce(p_patch, '')), '');
  v_from  timestamptz;
  v_to    timestamptz;
  v_out   jsonb;
begin
  if v_first > v_last then v_first := v_last; end if;
  v_from := v_first::timestamp at time zone v_tz;
  v_to   := (v_last + 1)::timestamp at time zone v_tz;

  with every_game as (select * from analytics.player_games(v_from, v_to)),
  g as (select * from every_game e where v_patch is null or e.patch = v_patch),
  mode_totals as (select g.mode, count(*) as picks from g where g.hero_id is not null group by g.mode),
  lob as (
    select h.id, h.hero_id, h.placement,
           case when h.entry ? 'unrated' then 'unrated_lobby' else 'ranked' end as mode,
           case when jsonb_typeof(h.entry->'tribes') = 'array' then h.entry->'tribes' else '[]'::jsonb end as tribes,
           nullif(h.entry->>'dominantTribe', '') as dom,
           analytics.medal_of(coalesce(
             (select rr.division_before from public.rank_results rr
               where rr.user_id = h.user_id and (h.entry->>'seed') ~ '^-?[0-9]{1,18}$' and rr.seed = (h.entry->>'seed')::bigint
               order by rr.created_at desc limit 1),
             case when (h.entry #>> '{rank,before,divisionIndex}') ~ '^[0-9]{1,2}$' then (h.entry #>> '{rank,before,divisionIndex}')::int end
           )) as medal
    from public.run_history h
    where h.created_at >= v_from and h.created_at < v_to and h.mode = 'lobby'
      and (v_patch is null or h.patch = v_patch)
      and not exists (select 1 from analytics.excluded_users() e where e.user_id = h.user_id)
  ),
  practice_tribes as (
    select p.placement, t.tribe
    from public.practice_games p
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(p.final_board->'tribes') = 'array' then p.final_board->'tribes' else '[]'::jsonb end) as t(tribe)
    where p.created_at >= v_from and p.created_at < v_to and (v_patch is null or p.patch = v_patch)
      and (p.user_id is null or not exists (select 1 from analytics.excluded_users() e where e.user_id = p.user_id))
  ),
  in_run as (
    select l.mode, t.tribe, l.placement from lob l cross join lateral jsonb_array_elements_text(l.tribes) as t(tribe)
    union all select 'practice', pt.tribe, pt.placement from practice_tribes pt
  ),
  tribe_totals as (
    select l.mode, count(*) as games from lob l group by l.mode
    union all
    select 'practice', count(*) from public.practice_games p
      where p.created_at >= v_from and p.created_at < v_to and (v_patch is null or p.patch = v_patch)
        and jsonb_typeof(p.final_board->'tribes') = 'array'
        and (p.user_id is null or not exists (select 1 from analytics.excluded_users() e where e.user_id = p.user_id))
  ),
  offers as (
    select o.hero as hero_id, count(*) as offered, count(*) filter (where t.hero_id = o.hero) as picked
    from public.run_telemetry t
    cross join lateral unnest(t.hero_offer) as o(hero)
    where t.created_at >= v_from and t.created_at < v_to
      and (t.source = 'ladder' or 'mode:lobby' = any (t.hero_offer))
      and o.hero not like 'mode:%'
      and (v_patch is null or t.patch = v_patch)
      and (t.user_id is null or not exists (select 1 from analytics.excluded_users() e where e.user_id = t.user_id))
    group by o.hero
  ),
  hero_rows as (
    select g.mode, 'all'::text as band, g.hero_id, count(*) as games,
           avg(g.placement)::numeric(6, 2) as avg_place,
           avg(case when g.placement <= g.seats / 2 then 1.0 else 0.0 end) filter (where g.placement is not null) as top_half,
           avg(case when g.placement = 1 then 1.0 else 0.0 end) filter (where g.placement is not null) as first,
           max(mt.picks) as picks
    from g join mode_totals mt on mt.mode = g.mode
    where g.hero_id is not null
    group by g.mode, g.hero_id
    union all
    select 'ranked', l.medal, l.hero_id, count(*),
           avg(l.placement)::numeric(6, 2),
           avg(case when l.placement <= 4 then 1.0 else 0.0 end) filter (where l.placement is not null),
           avg(case when l.placement = 1 then 1.0 else 0.0 end) filter (where l.placement is not null),
           max(bt.picks)
    from lob l
    join (select l2.medal, count(*) as picks from lob l2 where l2.mode = 'ranked' and l2.medal is not null and l2.hero_id is not null group by l2.medal) bt
      on bt.medal = l.medal
    where l.mode = 'ranked' and l.medal is not null and l.hero_id is not null
    group by l.medal, l.hero_id
  )
  select jsonb_build_object(
    'from', v_first, 'to', v_last, 'tz', v_tz, 'patch', v_patch,
    'patches', coalesce((select jsonb_agg(jsonb_build_object('patch', p.patch, 'games', p.games, 'firstSeen', p.first_seen, 'lastSeen', p.last_seen)
        order by p.first_seen desc)
      from (select e.patch, count(distinct e.game_key) as games, min(e.at) as first_seen, max(e.at) as last_seen
            from every_game e where e.patch is not null group by e.patch order by min(e.at) desc limit 60) p), '[]'::jsonb),
    'modes', coalesce((select jsonb_agg(jsonb_build_object('mode', m.mode, 'games', m.games, 'accounts', m.accounts, 'seats', m.seats,
        'avgPlacement', m.avg_place) order by m.games desc)
      from (select g.mode, count(distinct g.game_key) as games, count(distinct g.user_id) as accounts, max(g.seats) as seats,
                   avg(g.placement)::numeric(6, 2) as avg_place
            from g group by g.mode) m), '[]'::jsonb),
    'heroes', coalesce((select jsonb_agg(jsonb_build_object('mode', h.mode, 'band', h.band, 'heroId', h.hero_id, 'games', h.games,
        'pickRate', round(h.games::numeric / nullif(h.picks, 0), 4), 'avgPlacement', h.avg_place,
        'topHalfRate', round(h.top_half, 4), 'firstRate', round(h.first, 4)) order by h.mode, h.band, h.games desc)
      from hero_rows h), '[]'::jsonb),
    'heroOffers', coalesce((select jsonb_agg(jsonb_build_object('heroId', o.hero_id, 'offered', o.offered, 'picked', o.picked,
        'offerPickRate', round(o.picked::numeric / nullif(o.offered, 0), 4)) order by o.offered desc) from offers o), '[]'::jsonb),
    'medals', coalesce((select jsonb_agg(jsonb_build_object('medal', b.medal, 'games', b.games, 'avgPlacement', b.avg_place)
        order by array_position(array['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Ascendant'], b.medal))
      from (select l.medal, count(*) as games, avg(l.placement)::numeric(6, 2) as avg_place
            from lob l where l.mode = 'ranked' and l.medal is not null group by l.medal) b), '[]'::jsonb),
    'tribesInRun', coalesce((select jsonb_agg(jsonb_build_object('mode', r.mode, 'tribe', r.tribe, 'games', r.games,
        'rate', round(r.games::numeric / nullif(tt.games, 0), 4), 'avgPlacement', r.avg_place,
        'top4Rate', round(r.top4, 4), 'firstRate', round(r.first, 4)) order by r.mode, r.games desc)
      from (select i.mode, i.tribe, count(*) as games, avg(i.placement)::numeric(6, 2) as avg_place,
                   avg(case when i.placement <= 4 then 1.0 else 0.0 end) filter (where i.placement is not null) as top4,
                   avg(case when i.placement = 1 then 1.0 else 0.0 end) filter (where i.placement is not null) as first
            from in_run i group by i.mode, i.tribe) r
      join tribe_totals tt on tt.mode = r.mode), '[]'::jsonb),
    'tribesFinal', coalesce((select jsonb_agg(jsonb_build_object('mode', r.mode, 'tribe', r.tribe, 'games', r.games,
        'rate', round(r.games::numeric / nullif(tt.games, 0), 4), 'avgPlacement', r.avg_place,
        'top4Rate', round(r.top4, 4), 'firstRate', round(r.first, 4)) order by r.mode, r.games desc)
      from (select l.mode, l.dom as tribe, count(*) as games, avg(l.placement)::numeric(6, 2) as avg_place,
                   avg(case when l.placement <= 4 then 1.0 else 0.0 end) filter (where l.placement is not null) as top4,
                   avg(case when l.placement = 1 then 1.0 else 0.0 end) filter (where l.placement is not null) as first
            from lob l where l.dom is not null group by l.mode, l.dom) r
      join tribe_totals tt on tt.mode = r.mode), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $$;

-- Nothing in the private schema is callable by anyone but its owner (the wrappers below run as the owner).
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'analytics' loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function %s from authenticated', f); end if;
  end loop;
end $$;

-- ── 6. The two entry points (service role only) ────────────────────────────────────────────────────────────
create or replace function public.analytics_overview(p_from date default null, p_to date default null, p_tz text default 'UTC')
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select analytics.overview(p_from, p_to, p_tz)
$$;

create or replace function public.analytics_breakdown(p_from date default null, p_to date default null, p_patch text default null, p_tz text default 'UTC')
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select analytics.breakdown(p_from, p_to, p_patch, p_tz)
$$;

revoke all on function public.analytics_overview(date, date, text) from public;
revoke all on function public.analytics_breakdown(date, date, text, text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.analytics_overview(date, date, text) from anon';
    execute 'revoke all on function public.analytics_breakdown(date, date, text, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.analytics_overview(date, date, text) from authenticated';
    execute 'revoke all on function public.analytics_breakdown(date, date, text, text) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.analytics_overview(date, date, text) to service_role';
    execute 'grant execute on function public.analytics_breakdown(date, date, text, text) to service_role';
  end if;
end $$;
