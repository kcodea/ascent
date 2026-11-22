-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- THE DEV DASHBOARD, ROUND TWO (2026-11-22, feat/dash-v2): four more read-only views of usage. Additive, idempotent,
-- safe to re-run. APPLY AFTER 2026-11-27-analytics-dashboard.sql (it reuses that file's `analytics` schema and helpers:
-- player_games, first_game_at, first_day, bucket_for, safe_tz, excluded_users, medal_of). No Edge Function.
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Owner 2026-11-22: "what else can we add to get more visibility into overall usage" (all four groups):
--
--   public.analytics_players(from, to, tz)      RETENTION + ENGAGEMENT: day-1/7/30 return of new players (cohort = the
--                                               first finished game), weekly cohorts, DAU/WAU/MAU + stickiness, games per
--                                               player, hours played, and when games finish (weekday x hour).
--   public.analytics_social(from, to, tz)       LIVE NOW + SOCIAL: online / in a game / watching now (player_presence,
--                                               spectate_presence), Versus matches by mode, Duos teams, friend requests
--                                               and accepts, game invites, DMs (counts only, never a body).
--   public.analytics_progression(from, to, tz)  PROGRESSION + LADDER: players per division now, points movement, account
--                                               levels, achievements per bucket + most / least common, most equipped.
--   public.analytics_health(from, to, tz)       HEALTH: crash + bug reports per bucket, the daily health check, database
--                                               size vs the Free plan and the biggest tables, the retention cleanup's runs.
--   public.analytics_balance(from, to, tz)      BALANCE: hero / tribe / rune / Ancient trends (ranked lobby games). Its own
--                                               call (owner 2026-11-22: "separate health and balance"), so Health never
--                                               pays for this scan of every Career entry in the range.
--
-- Same contract as the first file: one small aggregated jsonb each, SECURITY DEFINER with a pinned search_path,
-- EXECUTE for service_role ONLY. Test bots and the Claudebot test accounts are excluded wherever a row names a player.
-- No direct message body, no email and no free text from a player is ever read.
--
-- WHAT "NOW" MEANS: player_presence is the friends hub's mirror (a row per account, re-stamped every ~2.5 minutes while
-- connected, set offline on close), so "online now" = status not offline and updated in the last 5 minutes.
-- spectate_presence is re-stamped by the spectate beat, so "watching now" = stamped in the last 3 minutes. The Live Games
-- directory itself lives in the Cloudflare Worker and is not readable from SQL.
--
-- INDEXES (all tiny today): friendships (created_at), friendships (accepted_at), bug_reports (created_at),
-- rank_results (created_at), achievement_completions (completed_at), duos_teams (created_at). ~40 bytes a row each.
--
-- ROLLBACK:
--   drop function if exists public.analytics_players(date, date, text);
--   drop function if exists public.analytics_social(date, date, text);
--   drop function if exists public.analytics_progression(date, date, text);
--   drop function if exists public.analytics_health(date, date, text);
--   drop function if exists public.analytics_balance(date, date, text, text, text);
--   drop function if exists analytics.players(date, date, text);   (and social / progression / health / balance / range_of / buckets)
--   select cron.unschedule('analytics-balance-rollup');
--   drop function if exists analytics.balance_backfill_step(int); drop function if exists analytics.balance_rollup_catchup(int);
--   drop function if exists analytics.balance_rollup_day(date); drop function if exists analytics.balance_obs(timestamptz, timestamptz);
--   drop table if exists analytics.balance_daily; drop table if exists analytics.balance_rollup_state;

create index if not exists friendships_created_at on public.friendships (created_at);
create index if not exists friendships_accepted_at on public.friendships (accepted_at) where accepted_at is not null;
create index if not exists bug_reports_created_at on public.bug_reports (created_at);
create index if not exists rank_results_created_at on public.rank_results (created_at);
create index if not exists achievement_completions_completed_at on public.achievement_completions (completed_at);
create index if not exists duos_teams_created_at on public.duos_teams (created_at);

-- The resolved range for (from, to, tz): the same rules as analytics.overview (from null = all time, to null = today).
create or replace function analytics.range_of(p_from date, p_to date, p_tz text,
  out tz text, out today date, out first_day date, out last_day date, out from_ts timestamptz, out to_ts timestamptz, out bucket text)
language plpgsql stable set search_path = public, pg_temp as $$
begin
  tz := analytics.safe_tz(p_tz);
  today := (now() at time zone tz)::date;
  last_day := least(coalesce(p_to, today), today);
  first_day := coalesce(p_from, analytics.first_day(tz), last_day);
  if first_day > last_day then first_day := last_day; end if;
  from_ts := first_day::timestamp at time zone tz;
  to_ts := (last_day + 1)::timestamp at time zone tz;
  bucket := analytics.bucket_for(last_day - first_day + 1);
end $$;

-- The bucket starts of a range (a one-day range today stops at the current hour).
create or replace function analytics.buckets(p_first date, p_last date, p_today date, p_tz text, p_bucket text)
returns table (b timestamp) language sql stable set search_path = pg_catalog, pg_temp as $$
  select generate_series(
    date_trunc(p_bucket, p_first::timestamp),
    case when p_bucket = 'hour' and p_last = p_today then date_trunc('hour', now() at time zone p_tz)
         else date_trunc(p_bucket, p_last::timestamp + interval '1 day' - interval '1 second') end,
    ('1 ' || p_bucket)::interval)
$$;

-- ── 1. RETENTION + ENGAGEMENT ─────────────────────────────────────────────────────────────────────────────────
create or replace function analytics.players(p_from date, p_to date, p_tz text)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare
  r   record;
  v_out jsonb;
begin
  select * into r from analytics.range_of(p_from, p_to, p_tz);
  with
  firsts as (select f.user_id, (f.first_at at time zone r.tz)::date as d0 from analytics.first_game_at() f),
  cohort as (select * from firsts where d0 between r.first_day and r.last_day),
  -- every day a cohort member finished a game, up to 30 days after the range
  later as (
    select distinct x.user_id, (x.at at time zone r.tz)::date as d
    from analytics.player_games(r.from_ts, r.to_ts + interval '31 days') x
    where x.user_id in (select c.user_id from cohort c)
  ),
  ret as (
    select c.user_id, c.d0,
      c.d0 + 1 < r.today as e1, c.d0 + 7 < r.today as e7, c.d0 + 30 < r.today as e30,
      coalesce(bool_or(l.d = c.d0 + 1), false) as r1,
      coalesce(bool_or(l.d <= c.d0 + 7), false) as r7,
      coalesce(bool_or(l.d <= c.d0 + 30), false) as r30
    from cohort c left join later l on l.user_id = c.user_id and l.d between c.d0 + 1 and c.d0 + 30
    group by c.user_id, c.d0
  ),
  g as (select x.*, (x.at at time zone r.tz) as lt from analytics.player_games(r.from_ts, r.to_ts) x),
  per_player as (select g.user_id, count(distinct g.game_key) as n from g where g.user_id is not null group by g.user_id),
  -- DAU / WAU / MAU as of the range's last day
  month as (
    select distinct x.user_id, (x.at at time zone r.tz)::date as d
    from analytics.player_games((r.last_day - 29)::timestamp at time zone r.tz, r.to_ts) x where x.user_id is not null
  ),
  dau_days as (select gs::date as d, (select count(distinct m.user_id) from month m where m.d = gs::date) as n
    from generate_series(r.last_day - 29, r.last_day, interval '1 day') gs),
  -- active play time: the Career entry's activeMs (lobby) and practice's tp_active_ms; nothing else records it
  played as (
    select (h.entry->>'activeMs')::numeric as ms from public.run_history h
      where h.created_at >= r.from_ts and h.created_at < r.to_ts and jsonb_typeof(h.entry->'activeMs') = 'number'
        and not exists (select 1 from analytics.excluded_users() e where e.user_id = h.user_id)
    union all
    select p.tp_active_ms::numeric from public.practice_games p
      where p.created_at >= r.from_ts and p.created_at < r.to_ts and p.tp_active_ms ~ '^[0-9]{1,10}(\.[0-9]+)?$'
        and (p.user_id is null or not exists (select 1 from analytics.excluded_users() e where e.user_id = p.user_id))
  ),
  timed_total as (
    select (select count(*) from public.run_history h where h.created_at >= r.from_ts and h.created_at < r.to_ts
              and not exists (select 1 from analytics.excluded_users() e where e.user_id = h.user_id))
         + (select count(*) from public.practice_games p where p.created_at >= r.from_ts and p.created_at < r.to_ts
              and (p.user_id is null or not exists (select 1 from analytics.excluded_users() e where e.user_id = p.user_id))) as n
  )
  select jsonb_build_object(
    'tz', r.tz, 'from', r.first_day, 'to', r.last_day,
    'retention', jsonb_build_object(
      'cohort', (select count(*) from ret),
      'd1', jsonb_build_object('eligible', (select count(*) from ret where e1), 'returned', (select count(*) from ret where e1 and r1)),
      'd7', jsonb_build_object('eligible', (select count(*) from ret where e7), 'returned', (select count(*) from ret where e7 and r7)),
      'd30', jsonb_build_object('eligible', (select count(*) from ret where e30), 'returned', (select count(*) from ret where e30 and r30))),
    'cohorts', coalesce((select jsonb_agg(jsonb_build_object('week', w.wk, 'players', w.players,
        'd1', w.d1, 'd1Eligible', w.e1, 'd7', w.d7, 'd7Eligible', w.e7, 'd30', w.d30, 'd30Eligible', w.e30) order by w.wk desc)
      from (select date_trunc('week', ret.d0::timestamp)::date as wk, count(*) as players,
              count(*) filter (where e1 and r1) as d1, count(*) filter (where e1) as e1,
              count(*) filter (where e7 and r7) as d7, count(*) filter (where e7) as e7,
              count(*) filter (where e30 and r30) as d30, count(*) filter (where e30) as e30
            from ret group by 1 order by 1 desc limit 26) w), '[]'::jsonb),
    'active', jsonb_build_object(
      'dau', (select n from dau_days where d = r.last_day),
      'wau', (select count(distinct m.user_id) from month m where m.d > r.last_day - 7),
      'mau', (select count(distinct m.user_id) from month m),
      'dauAvg30', (select round(avg(n), 2) from dau_days),
      'stickiness', (select round(avg(n) / nullif((select count(distinct m.user_id) from month m), 0), 4) from dau_days)),
    'gamesPerPlayer', jsonb_build_object(
      'players', (select count(*) from per_player),
      'mean', (select round(avg(n), 2) from per_player),
      'median', (select percentile_cont(0.5) within group (order by n) from per_player),
      'buckets', (select jsonb_agg(jsonb_build_object('label', b.label, 'players', (select count(*) from per_player pp where pp.n between b.lo and b.hi))
          order by b.lo)
        from (values ('1', 1, 1), ('2-3', 2, 3), ('4-7', 4, 7), ('8-15', 8, 15), ('16-31', 16, 31), ('32+', 32, 2147483647)) as b(label, lo, hi))),
    'playTime', jsonb_build_object(
      'hours', (select round(coalesce(sum(ms), 0) / 3600000.0, 1) from played),
      'timedGames', (select count(*) from played),
      'games', (select n from timed_total),
      'avgMinutes', (select round(avg(ms) / 60000.0, 1) from played)),
    'heatmap', coalesce((select jsonb_agg(jsonb_build_object('dow', h.dow, 'hour', h.hr, 'games', h.n) order by h.dow, h.hr)
      from (select extract(isodow from g.lt)::int as dow, extract(hour from g.lt)::int as hr, count(distinct g.game_key) as n
            from g group by 1, 2) h), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $$;

-- ── 2. LIVE NOW + SOCIAL ──────────────────────────────────────────────────────────────────────────────────────
create or replace function analytics.social(p_from date, p_to date, p_tz text)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare
  r   record;
  v_out jsonb;
begin
  select * into r from analytics.range_of(p_from, p_to, p_tz);
  with
  ex as (select user_id from analytics.excluded_users()),
  ev as (
    select 'versus_duel'::text as kind, m.completed_at as at from public.versus_matches m
      where m.phase = 'complete' and m.completed_at >= r.from_ts and m.completed_at < r.to_ts
        and m.p1_user not in (select user_id from ex) and m.p2_user not in (select user_id from ex)
    union all
    select case coalesce(g.options->>'mode', '') when 'duos' then 'versus_duos' when 'ranked_duos' then 'ranked_duos' else 'versus_group' end,
           g.completed_at from public.versus_group_matches g
      where g.phase = 'complete' and not coalesce(g.dev_forced, false) and g.completed_at >= r.from_ts and g.completed_at < r.to_ts
    union all
    select 'duos_team', t.created_at from public.duos_teams t
      where t.created_at >= r.from_ts and t.created_at < r.to_ts and t.user_lo not in (select user_id from ex) and t.user_hi not in (select user_id from ex)
    union all
    select 'friend_request', f.created_at from public.friendships f
      where f.created_at >= r.from_ts and f.created_at < r.to_ts and f.user_a not in (select user_id from ex) and f.user_b not in (select user_id from ex)
    union all
    select 'friend_accept', f.accepted_at from public.friendships f
      where f.accepted_at >= r.from_ts and f.accepted_at < r.to_ts and f.user_a not in (select user_id from ex) and f.user_b not in (select user_id from ex)
    union all
    select case i.kind when 'duos_party' then 'invite_duos' else 'invite_versus' end, i.created_at from public.friend_invites i
      where i.created_at >= r.from_ts and i.created_at < r.to_ts and i.from_user not in (select user_id from ex)
    union all
    -- direct messages: COUNTED ONLY (never a body). Kept one day by dm_prune, so only the last ~24 h can show.
    select 'dm', d.created_at from public.direct_messages d
      where d.created_at >= r.from_ts and d.created_at < r.to_ts and d.sender not in (select user_id from ex)
  ),
  per as (select date_trunc(r.bucket, ev.at at time zone r.tz) as b, ev.kind, count(*) as n from ev group by 1, 2),
  presence as (
    select p.status, p.mode from public.player_presence p
    where p.status <> 'offline' and p.updated_at > now() - interval '5 minutes' and p.user_id not in (select user_id from ex)
  )
  select jsonb_build_object(
    'tz', r.tz, 'from', r.first_day, 'to', r.last_day, 'bucket', r.bucket,
    'now', jsonb_build_object(
      'online', (select count(*) from presence),
      'inGame', (select count(*) from presence where status = 'in_game'),
      'byMode', coalesce((select jsonb_object_agg(m.mode, m.n) from (select coalesce(nullif(mode, ''), 'other') as mode, count(*) as n
          from presence where status = 'in_game' group by 1) m), '{}'::jsonb),
      'watching', (select count(*) from public.spectate_presence s where s.at > now() - interval '3 minutes' and s.user_id not in (select user_id from ex)),
      'at', now()),
    'series', coalesce((select jsonb_agg(jsonb_build_object('t', to_char(s.b, 'YYYY-MM-DD"T"HH24:MI'),
        'counts', coalesce((select jsonb_object_agg(p.kind, p.n) from per p where p.b = s.b), '{}'::jsonb)) order by s.b)
      from analytics.buckets(r.first_day, r.last_day, r.today, r.tz, r.bucket) s), '[]'::jsonb),
    'totals', coalesce((select jsonb_object_agg(t.kind, t.n) from (select kind, count(*) as n from ev group by kind) t), '{}'::jsonb),
    'invites', jsonb_build_object(
      'sent', (select count(*) from public.friend_invites i where i.created_at >= r.from_ts and i.created_at < r.to_ts),
      'accepted', (select count(*) from public.friend_invites i where i.created_at >= r.from_ts and i.created_at < r.to_ts and i.status = 'accepted')),
    'friendships', jsonb_build_object('accepted', (select count(*) from public.friendships where status = 'accepted'),
      'pending', (select count(*) from public.friendships where status = 'pending')),
    'dmOldest', (select min(created_at) from public.direct_messages)
  ) into v_out;
  return v_out;
end $$;

-- ── 3. PROGRESSION + LADDER ───────────────────────────────────────────────────────────────────────────────────
create or replace function analytics.progression(p_from date, p_to date, p_tz text)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare
  r   record;
  v_season int;
  v_out jsonb;
begin
  select * into r from analytics.range_of(p_from, p_to, p_tz);
  select max(season) into v_season from public.rank_results;
  with
  ex as (select user_id from analytics.excluded_users()),
  ranked_now as (
    select p.rank_division as division from public.profiles p
    where v_season is not null and p.rank_season = v_season and p.user_id not in (select user_id from ex)
      and exists (select 1 from public.rank_results rr where rr.user_id = p.user_id and rr.season = v_season)
  ),
  moves as (
    select rr.* from public.rank_results rr
    where rr.created_at >= r.from_ts and rr.created_at < r.to_ts and rr.user_id not in (select user_id from ex)
  ),
  levels as (select p.account_level as lvl from public.profiles p where coalesce(p.account_xp, 0) > 0 and p.user_id not in (select user_id from ex)),
  comps as (
    select c.achievement_id, c.user_id, c.completed_at from public.achievement_completions c where c.user_id not in (select user_id from ex)
  ),
  players_with_xp as (select count(*) as n from levels)
  select jsonb_build_object(
    'tz', r.tz, 'from', r.first_day, 'to', r.last_day, 'bucket', r.bucket, 'season', v_season,
    'divisions', coalesce((select jsonb_agg(jsonb_build_object('division', d.division, 'medal', analytics.medal_of(d.division), 'players', d.n) order by d.division)
      from (select division, count(*) as n from ranked_now group by division) d), '[]'::jsonb),
    'movement', jsonb_build_object(
      'games', (select count(*) from moves),
      'players', (select count(distinct user_id) from moves),
      'netPoints', (select coalesce(sum(applied_delta), 0) from moves),
      'avgDelta', (select round(avg(applied_delta), 2) from moves),
      'promotions', (select count(*) from moves where promoted),
      'demotions', (select count(*) from moves where demoted),
      'byMedal', coalesce((select jsonb_agg(jsonb_build_object('medal', m.medal, 'games', m.n, 'avgDelta', m.avg) order by m.k)
        from (select min(division_before) as k, analytics.medal_of(division_before) as medal, count(*) as n, round(avg(applied_delta), 2) as avg
              from moves group by 2) m), '[]'::jsonb),
      'series', coalesce((select jsonb_agg(jsonb_build_object('t', to_char(s.b, 'YYYY-MM-DD"T"HH24:MI'),
          'games', coalesce(x.n, 0), 'net', coalesce(x.net, 0), 'promotions', coalesce(x.pro, 0), 'demotions', coalesce(x.dem, 0)) order by s.b)
        from analytics.buckets(r.first_day, r.last_day, r.today, r.tz, r.bucket) s
        left join (select date_trunc(r.bucket, m.created_at at time zone r.tz) as b, count(*) as n, sum(m.applied_delta) as net,
                     count(*) filter (where m.promoted) as pro, count(*) filter (where m.demoted) as dem from moves m group by 1) x on x.b = s.b), '[]'::jsonb)),
    'levels', jsonb_build_object(
      'players', (select n from players_with_xp),
      'max', (select max(lvl) from levels),
      'median', (select percentile_cont(0.5) within group (order by lvl) from levels),
      'buckets', (select jsonb_agg(jsonb_build_object('label', b.label, 'players', (select count(*) from levels l where l.lvl between b.lo and b.hi)) order by b.lo)
        from (values ('1', 1, 1), ('2-4', 2, 4), ('5-9', 5, 9), ('10-19', 10, 19), ('20-49', 20, 49), ('50+', 50, 2147483647)) as b(label, lo, hi))),
    'achievements', jsonb_build_object(
      'inRange', (select count(*) from comps c where c.completed_at >= r.from_ts and c.completed_at < r.to_ts),
      'series', coalesce((select jsonb_agg(jsonb_build_object('t', to_char(s.b, 'YYYY-MM-DD"T"HH24:MI'), 'n', coalesce(x.n, 0)) order by s.b)
        from analytics.buckets(r.first_day, r.last_day, r.today, r.tz, r.bucket) s
        left join (select date_trunc(r.bucket, c.completed_at at time zone r.tz) as b, count(*) as n from comps c
                   where c.completed_at >= r.from_ts and c.completed_at < r.to_ts group by 1) x on x.b = s.b), '[]'::jsonb),
      'players', (select count(distinct user_id) from comps),
      'most', coalesce((select jsonb_agg(jsonb_build_object('id', a.achievement_id, 'players', a.n) order by a.n desc, a.achievement_id)
        from (select achievement_id, count(distinct user_id) as n from comps group by 1 order by 2 desc, 1 limit 8) a), '[]'::jsonb),
      'least', coalesce((select jsonb_agg(jsonb_build_object('id', a.achievement_id, 'players', a.n) order by a.n, a.achievement_id)
        from (select k.achievement_id, coalesce(cc.n, 0) as n from public.achievement_catalog k
              left join (select achievement_id, count(distinct user_id) as n from comps group by 1) cc on cc.achievement_id = k.achievement_id
              order by 2, 1 limit 8) a), '[]'::jsonb)),
    'equipped', coalesce((select jsonb_agg(jsonb_build_object('id', e.cosmetic_id, 'category', e.category, 'players', e.n) order by e.n desc, e.cosmetic_id)
      from (select l.cosmetic_id, max(k.category) as category, count(distinct l.user_id) as n
            from public.cosmetic_loadouts l left join public.cosmetic_catalog k on k.cosmetic_id = l.cosmetic_id
            where l.user_id not in (select user_id from ex) group by 1 order by 3 desc, 1 limit 12) e), '[]'::jsonb),
    'titles', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'players', t.n) order by t.n desc, t.id)
      from (select equipped_title_id as id, count(*) as n from public.profiles
            where equipped_title_id is not null and user_id not in (select user_id from ex) group by 1 order by 2 desc, 1 limit 8) t), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $$;

-- ── 4. HEALTH (crashes, bugs, the daily check, database size, the retention cleanup) ─────────────────────────────
-- Its own call so opening Health never pays for the balance scan below (owner 2026-11-22: "separate health and balance").
create or replace function analytics.health(p_from date, p_to date, p_tz text)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare
  r   record;
  v_status jsonb;
  v_latest jsonb;
  v_rules jsonb;
  v_runs jsonb;
  v_out jsonb;
begin
  select * into r from analytics.range_of(p_from, p_to, p_tz);
  -- The ops pieces are read only if they exist (each lives in its own migration).
  if to_regclass('ops.health_status') is not null then
    execute 'select to_jsonb(s) from ops.health_status s limit 1' into v_status;
  end if;
  if to_regclass('ops.health_latest') is not null then
    execute $q$select coalesce(jsonb_agg(jsonb_build_object('check', l.check_name, 'status', l.status, 'source', l.source, 'ts', l.ts,
      'detail', left(coalesce(l.detail::text, ''), 240)) order by l.source, l.check_name), '[]'::jsonb) from ops.health_latest l$q$ into v_latest;
  end if;
  if to_regclass('ops.retention_rules') is not null then
    execute $q$select coalesce(jsonb_agg(jsonb_build_object('rule', x.rule, 'enabled', x.enabled, 'keepDays', x.keep_days,
      'lastCheckedAt', x.last_checked_at, 'lastDryRun', x.last_dry_run, 'lastCandidates', x.last_candidates, 'lastDeleted', x.last_deleted,
      'lastError', x.last_error, 'totalDeleted', x.total_deleted) order by x.rule), '[]'::jsonb) from ops.retention_rules x$q$ into v_rules;
  end if;
  if to_regclass('ops.events') is not null then
    execute $q$select coalesce(jsonb_agg(jsonb_build_object('at', e.at, 'kind', e.kind, 'deleted', e.detail->'deleted', 'failed', e.detail->'failed') order by e.at desc), '[]'::jsonb)
      from (select * from ops.events where source = 'retention' order by at desc limit 7) e$q$ into v_runs;
  end if;

  with
  crashes as (select c.created_at, c.build, c.last_step from public.client_crash_reports c where c.created_at >= r.from_ts and c.created_at < r.to_ts),
  bugs as (select b.created_at, b.status, b.severity from public.bug_reports b where b.created_at >= r.from_ts and b.created_at < r.to_ts)
  select jsonb_build_object(
    'tz', r.tz, 'from', r.first_day, 'to', r.last_day, 'bucket', r.bucket,
    'crashes', jsonb_build_object(
      'total', (select count(*) from crashes),
      'series', coalesce((select jsonb_agg(jsonb_build_object('t', to_char(s.b, 'YYYY-MM-DD"T"HH24:MI'), 'crashes', coalesce(c.n, 0), 'bugs', coalesce(bb.n, 0)) order by s.b)
        from analytics.buckets(r.first_day, r.last_day, r.today, r.tz, r.bucket) s
        left join (select date_trunc(r.bucket, created_at at time zone r.tz) as b, count(*) as n from crashes group by 1) c on c.b = s.b
        left join (select date_trunc(r.bucket, created_at at time zone r.tz) as b, count(*) as n from bugs group by 1) bb on bb.b = s.b), '[]'::jsonb),
      'byBuild', coalesce((select jsonb_agg(jsonb_build_object('build', x.build, 'n', x.n) order by x.n desc) from
        (select coalesce(build, 'unknown') as build, count(*) as n from crashes group by 1 order by 2 desc limit 5) x), '[]'::jsonb),
      'byStep', coalesce((select jsonb_agg(jsonb_build_object('step', x.step, 'n', x.n) order by x.n desc) from
        (select left(coalesce(last_step, 'unknown'), 60) as step, count(*) as n from crashes group by 1 order by 2 desc limit 5) x), '[]'::jsonb)),
    'bugs', jsonb_build_object(
      'total', (select count(*) from bugs),
      'byStatus', coalesce((select jsonb_object_agg(coalesce(status, 'unknown'), n) from (select status, count(*) as n from bugs group by 1) x), '{}'::jsonb),
      'bySeverity', coalesce((select jsonb_object_agg(coalesce(severity, 'unknown'), n) from (select severity, count(*) as n from bugs group by 1) x), '{}'::jsonb)),
    'ops', jsonb_build_object('status', v_status, 'latest', coalesce(v_latest, '[]'::jsonb), 'retentionRules', v_rules, 'retentionRuns', v_runs),
    'database', jsonb_build_object(
      'bytes', pg_database_size(current_database()),
      'limitBytes', 524288000,
      'tables', (select jsonb_agg(jsonb_build_object('table', t.name, 'bytes', t.bytes) order by t.bytes desc)
        from (select n.nspname || '.' || c.relname as name, pg_total_relation_size(c.oid) as bytes
              from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where c.relkind in ('r', 'm') and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
              order by pg_total_relation_size(c.oid) desc limit 10) t))
  ) into v_out;
  return v_out;
end $$;

-- ── 5. BALANCE: the dev balance view (heroes, tribes, Ancients, minions, spells, runes) ───────────────────────────
-- Owner 2026-11-22: "separate health and balance", then "add minion, spell, and rune balance data ... this will become our
-- new dev balance view". Its own call, so Health never pays for these scans.
--
-- METHOD (the in-game Balance Report's, owner ruling 2026-09-22; packages/sim/src/reportCohorts.ts, playerReport.ts):
-- a "runs that had X vs everyone else" placement gap is a SURVIVAL statistic (a winner lives longer and touches more cards),
-- so the comparison here is at EQUAL ACCESS:
--   cards  taken (bought from the shop or a Discover) vs OFFERED AND PASSED in the same run's shop / Discovers;
--   runes  picked vs offered at the forge and skipped (equal forge access).
-- Both are RAW associations at equal access: not stratified by round band or shop tier (the per-offer wave and gold sit in
-- `derived`, ~100 kB a run, too heavy to read per request), and never causal. Per item it returns the counts, the unique
-- players (player_key) and the mean + sample variance of placement on each side, so the page shows a Welch interval and
-- the report's evidence gates instead of a bare number. Final-board presence (Career entry) is labelled survival-biased.
--
-- COST: reading every run's card arrays live was ~70 s for "All time" at 50k runs (bench), so cards + runes come from a
-- DAILY ROLLUP: `analytics.balance_daily`, one row per (UTC day, mode, set, card or rune, taken or passed) with additive
-- sums and up to 10 of that day's distinct player keys (enough for the report's 3 / 5-player gates; the page shows 10+).
-- Size: one row per item per side per day it was seen (a few hundred a day at today's traffic; ~100 bytes each plus the
-- player keys). Card / rune day edges are UTC days (the rest of the dashboard uses the viewer's time zone).
--
-- FILLED ONE UTC DAY AT A TIME, NEVER IN ONE STATEMENT (fix 2026-11-22: the first apply's one-shot all-history backfill
-- spilled its sort to disk and hit "No space left on device" on the Free plan, rolling the whole file back). This file
-- writes NO rollup rows. `analytics.balance_rollup_catchup(n)` rolls up at most n finished days (oldest first, one
-- day's runs per aggregate, kept in memory by its own work_mem) and records how far it got in
-- `analytics.balance_rollup_state`; the nightly pg_cron job (`analytics-balance-rollup`, 03:47 UTC) runs it with n = 14,
-- so history fills over a few nights. To fill it sooner, the lead runs `select analytics.balance_backfill_step(14);`
-- repeatedly (each call is its own transaction; it returns how many days remain). Today (UTC) is always read live; days
-- not rolled up yet are left out and the page says "rolled up from X through Y".

create table if not exists analytics.balance_daily (
  day        date    not null,
  mode       text    not null check (mode in ('ranked', 'unrated')),
  set_id     text    not null,
  kind       text    not null check (kind in ('card', 'rune')),
  item       text    not null,
  taken      boolean not null,
  n          int     not null,
  sum_place  bigint  not null,
  sumsq      bigint  not null,
  top4       int     not null,
  players    text[]  not null, -- up to 10 distinct player keys that day (the unique-player count is exact up to 10, then '10+')
  primary key (day, mode, set_id, kind, item, taken)
);
-- How far the rollup has got: every UTC day up to and including `through` is rolled up (one row, id = true).
create table if not exists analytics.balance_rollup_state (
  id       boolean primary key default true check (id),
  through  date,
  updated_at timestamptz not null default now()
);
revoke all on analytics.balance_daily, analytics.balance_rollup_state from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on analytics.balance_daily, analytics.balance_rollup_state from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on analytics.balance_daily, analytics.balance_rollup_state from authenticated'; end if;
end $$;

-- One observation per lobby run per card / rune it was offered or took: taken, or offered and passed. The per-run
-- de-duplication happens inside each run (a few dozen ids), so there is no wide global sort.
create or replace function analytics.balance_obs(p_from timestamptz, p_to timestamptz)
returns table (day date, mode text, set_id text, kind text, item text, taken boolean, pk text, placement int)
language sql stable set search_path = public, pg_temp as $$
  with tr as (
    select (t.created_at at time zone 'UTC')::date as day, case when coalesce(t.unrated, false) then 'unrated' else 'ranked' end as mode,
      coalesce(t.set_id, 'set1') as set_id, coalesce(t.player_key, t.user_id::text, t.author, '') as pk, t.placement,
      coalesce(t.offered_cards, '{}') || coalesce(t.discover_offered_cards, '{}') as off_c, coalesce(t.bought_cards, '{}') || coalesce(t.discover_bought_cards, '{}') as took_c,
      coalesce(t.offered_runes, '{}') as off_r, coalesce(t.picked_runes, '{}') as took_r
    from public.run_telemetry t
    where t.created_at >= p_from and t.created_at < p_to and t.placement between 1 and 8
      and (t.source = 'ladder' or 'mode:lobby' = any (t.hero_offer))
      and (t.user_id is null or not exists (select 1 from analytics.excluded_users() e where e.user_id = t.user_id))
  )
  select tr.day, tr.mode, tr.set_id, 'card'::text, x.item, x.taken, tr.pk, tr.placement
    from tr cross join lateral (select u.item, bool_or(u.took) as taken
      from (select unnest(tr.off_c) as item, false as took union all select unnest(tr.took_c), true) u group by u.item) x
  union all
  select tr.day, tr.mode, tr.set_id, 'rune', x.item, x.taken, tr.pk, tr.placement
    from tr cross join lateral (select u.item, bool_or(u.took) as taken
      from (select unnest(tr.off_r) as item, false as took union all select unnest(tr.took_r), true) u group by u.item) x
$$;

-- Roll up ONE UTC day (replacing what is there). Returns the rows written. One day's runs only, so the aggregate stays in
-- memory (bench: ~140 runs / ~16k observations a day at 50k runs a year, no temp files at 16 MB).
drop function if exists analytics.balance_rollup(date, date);
create or replace function analytics.balance_rollup_day(p_day date)
returns int language plpgsql volatile set search_path = public, pg_temp set work_mem = '16MB' as $$
declare v int;
begin
  delete from analytics.balance_daily where day = p_day;
  insert into analytics.balance_daily (day, mode, set_id, kind, item, taken, n, sum_place, sumsq, top4, players)
  select o.day, o.mode, o.set_id, o.kind, o.item, o.taken, count(*), sum(o.placement), sum(o.placement * o.placement),
    count(*) filter (where o.placement <= 4), (array_agg(distinct o.pk))[1:10]
  from analytics.balance_obs(p_day::timestamp at time zone 'UTC', (p_day + 1)::timestamp at time zone 'UTC') o
  group by 1, 2, 3, 4, 5, 6;
  get diagnostics v = row_count;
  return v;
end $$;

-- Roll up at most p_max_days finished UTC days after the last one done (oldest first; never today), one day at a time.
-- Returns what it did and how many finished days are still to do.
drop function if exists analytics.balance_rollup_catchup();
create or replace function analytics.balance_rollup_catchup(p_max_days int default 14)
returns jsonb language plpgsql volatile set search_path = public, pg_temp as $$
declare
  v_yesterday date := (now() at time zone 'UTC')::date - 1;
  v_through date;
  v_first date;
  v_last date;
  v_rows int := 0;
  d date;
begin
  select through into v_through from analytics.balance_rollup_state where id;
  v_first := coalesce(v_through + 1, (select (min(created_at) at time zone 'UTC')::date from public.run_telemetry), v_yesterday + 1);
  v_last := least(v_yesterday, v_first + greatest(coalesce(p_max_days, 14), 0) - 1);
  if v_first <= v_last then
    d := v_first;
    while d <= v_last loop
      v_rows := v_rows + analytics.balance_rollup_day(d);
      d := d + 1;
    end loop;
    insert into analytics.balance_rollup_state (id, through, updated_at) values (true, v_last, now())
      on conflict (id) do update set through = excluded.through, updated_at = excluded.updated_at;
  end if;
  return jsonb_build_object('from', case when v_first <= v_last then v_first end, 'through', coalesce(greatest(v_last, v_through), v_through),
    'days', greatest(v_last - v_first + 1, 0), 'rows', v_rows, 'remaining', greatest(v_yesterday - greatest(v_last, coalesce(v_through, v_first - 1)), 0));
end $$;

-- The lead's manual step (the same thing, by name): `select analytics.balance_backfill_step(14);` until remaining = 0.
create or replace function analytics.balance_backfill_step(p_days int default 14)
returns jsonb language sql volatile set search_path = public, pg_temp as $$ select analytics.balance_rollup_catchup(p_days) $$;

drop function if exists public.analytics_balance(date, date, text);
drop function if exists analytics.balance(date, date, text);
create or replace function analytics.balance(p_from date, p_to date, p_tz text, p_mode text, p_set text)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare
  r   record;
  v_trend text;
  v_mode text := case when p_mode in ('ranked', 'unrated', 'all') then p_mode else 'ranked' end;
  v_set text := case when p_set ~ '^set[0-9]{1,3}$' then p_set else null end;
  v_today_utc date := (now() at time zone 'UTC')::date;
  v_through date := (select through from analytics.balance_rollup_state where id);
  v_d0 date;
  v_d1 date;
  v_out jsonb;
begin
  select * into r from analytics.range_of(p_from, p_to, p_tz);
  v_trend := case when r.last_day - r.first_day + 1 > 120 then 'month' else 'week' end;
  v_d0 := (r.from_ts at time zone 'UTC')::date;
  v_d1 := ((r.to_ts - interval '1 microsecond') at time zone 'UTC')::date;
  with
  ex as (select user_id from analytics.excluded_users()),
  -- Career rows (heroes, tribes, Ancients): small scalars only, so the materialized rows stay small (a whole entry, or a
  -- final board, per row is what spilled to disk on long ranges)
  lob as (
    select h.id, date_trunc(v_trend, h.created_at at time zone r.tz) as b, h.placement, h.hero_id,
      nullif(h.entry->>'dominantTribe', '') as dom, h.entry #>> '{board,ancient,id}' as anc
    from public.run_history h
    where h.created_at >= r.from_ts and h.created_at < r.to_ts and h.mode = 'lobby' and h.placement is not null
      and (v_mode = 'all' or (v_mode = 'ranked') = not (h.entry ? 'unrated'))
      and (v_set is null or coalesce(h.entry #>> '{board,setId}', v_set) = v_set) -- a row without a set stamp is kept
      and h.user_id not in (select user_id from ex)
  ),
  bal as (
    select 'hero'::text as kind, l.hero_id as item, l.b, l.placement from lob l where l.hero_id is not null
    union all select 'tribe', l.dom, l.b, l.placement from lob l where l.dom is not null
    union all select 'ancient', l.anc, l.b, l.placement from lob l where l.anc is not null
  ),
  per_b as (
    select kind, item, b, count(*) as n, round(avg(placement), 2) as avg, round(avg(case when placement <= 4 then 1.0 else 0.0 end), 4) as top4
    from bal group by kind, item, b
  ),
  per_i as (
    select kind, item, count(*) as n, round(avg(placement), 2) as avg, round(avg(case when placement <= 4 then 1.0 else 0.0 end), 4) as top4,
      row_number() over (partition by kind order by count(*) desc, item) as rk
    from bal group by kind, item
  ),
  tops as (select * from per_i where rk <= case kind when 'ancient' then 8 else 12 end),
  -- final boards: one row per run per card on it (survival-biased by construction). The board is read straight from the
  -- row and de-duplicated inside each run, so nothing wide is sorted or hashed across runs.
  fin as (
    select x.item, l.placement, x.golden
    from lob l join public.run_history h on h.id = l.id
    cross join lateral (
      select m->>'cardId' as item, bool_or(coalesce((m->>'golden')::boolean, false)) as golden
      from jsonb_array_elements(case when jsonb_typeof(h.entry #> '{board,minions}') = 'array' then h.entry #> '{board,minions}' else '[]'::jsonb end) as m
      where m->>'cardId' is not null group by 1) x
  ),
  fin_i as (select item, count(*) as n, round(avg(placement), 2) as avg, count(*) filter (where golden) as golden from fin group by item),
  -- cards + runes: rolled-up whole UTC days, plus today read live. Only small numeric columns travel through the sorts and
  -- hashes (the player keys are read once, below, and only where they are needed), so long ranges stay in memory.
  rolled as (
    select d.day, d.kind, d.item, d.taken, d.n, d.sum_place, d.sumsq, d.top4, cardinality(d.players) as np
    from analytics.balance_daily d
    where d.day between v_d0 and least(v_d1, v_today_utc - 1, v_through)
      and (v_mode = 'all' or d.mode = v_mode) and (v_set is null or d.set_id = v_set)
  ),
  live_obs as materialized (
    select o.day, o.kind, o.item, o.taken, o.pk, o.placement
    from analytics.balance_obs(greatest(r.from_ts, v_today_utc::timestamp at time zone 'UTC'), r.to_ts) o -- today only (bounded)
    where (v_mode = 'all' or o.mode = v_mode) and (v_set is null or o.set_id = v_set)
  ),
  live as (
    select o.day, o.kind, o.item, o.taken, count(*)::int as n, sum(o.placement)::bigint as sum_place, sum(o.placement * o.placement)::bigint as sumsq,
      (count(*) filter (where o.placement <= 4))::int as top4, count(distinct o.pk)::int as np
    from live_obs o group by 1, 2, 3, 4
  ),
  days as (select * from rolled union all select * from live),
  -- per item and side: the sums, and the most distinct players any one day held (10 = the rollup's cap, so already '10+')
  side as (
    select kind, item, taken, sum(n) as n, sum(sum_place) as s, sum(sumsq) as q, sum(top4) as t4, max(np) as max_day_players
    from days group by kind, item, taken
  ),
  agg as (
    select kind, item,
      sum(n) filter (where taken) as t_n, sum(s) filter (where taken) as t_s, sum(q) filter (where taken) as t_q, sum(t4) filter (where taken) as t_4,
      sum(n) filter (where not taken) as p_n, sum(s) filter (where not taken) as p_s, sum(q) filter (where not taken) as p_q
    from side group by kind, item
  ),
  -- unique players: only the sides that never reached 10 in a day need the union of their keys (a popular card is '10+'
  -- outright), so the key unnest stays small however long the range
  few as (select kind, item, taken from side where max_day_players < 10),
  pl_small as (
    select k.kind, k.item, k.taken, count(distinct k.p) as players from (
      select d.kind, d.item, d.taken, unnest(d.players) as p
        from analytics.balance_daily d join few f on f.kind = d.kind and f.item = d.item and f.taken = d.taken
        where d.day between v_d0 and least(v_d1, v_today_utc - 1, v_through)
          and (v_mode = 'all' or d.mode = v_mode) and (v_set is null or d.set_id = v_set)
      union all
      select o.kind, o.item, o.taken, o.pk from live_obs o join few f on f.kind = o.kind and f.item = o.item and f.taken = o.taken
    ) k group by 1, 2, 3
  ),
  pl as (
    select x.kind, x.item,
      max(case when x.taken then case when x.max_day_players >= 10 then 10 else coalesce(ps.players, 0) end end) as t_players,
      max(case when not x.taken then case when x.max_day_players >= 10 then 10 else coalesce(ps.players, 0) end end) as p_players
    from side x left join pl_small ps on ps.kind = x.kind and ps.item = x.item and ps.taken = x.taken
    group by 1, 2
  ),
  ser as (
    select kind, item, date_trunc(v_trend, day::timestamp) as b, sum(n) as n, sum(sum_place)::numeric / sum(n) as avg
    from days where taken group by 1, 2, 3
  ),
  ser_j as (
    select kind, item, jsonb_agg(jsonb_build_array(to_char(b, 'YYYY-MM-DD'), n, round(avg, 2)) order by b) as s from ser group by 1, 2
  ),
  stats as (
    select a.kind, a.item, coalesce(a.t_n, 0) as t_n, coalesce(a.p_n, 0) as p_n,
      a.t_s::numeric / nullif(a.t_n, 0) as t_avg, (a.t_q - a.t_s::numeric * a.t_s / nullif(a.t_n, 0)) / nullif(a.t_n - 1, 0) as t_var,
      a.t_4::numeric / nullif(a.t_n, 0) as t_top4,
      a.p_s::numeric / nullif(a.p_n, 0) as p_avg, (a.p_q - a.p_s::numeric * a.p_s / nullif(a.p_n, 0)) / nullif(a.p_n - 1, 0) as p_var,
      coalesce(pl.t_players, 0) as t_players, coalesce(pl.p_players, 0) as p_players
    from agg a left join pl on pl.kind = a.kind and pl.item = a.item
  ),
  -- the field: every lobby run in the filter (telemetry), from the same observations' run-level view
  field as (
    select count(*) as n, avg(t.placement) as avg, var_samp(t.placement) as var, avg(case when t.placement <= 4 then 1.0 else 0.0 end) as top4
    from public.run_telemetry t
    where t.created_at >= r.from_ts and t.created_at < r.to_ts and t.placement between 1 and 8
      and (t.source = 'ladder' or 'mode:lobby' = any (t.hero_offer))
      and (v_mode = 'all' or (v_mode = 'ranked') = not coalesce(t.unrated, false))
      and (v_set is null or coalesce(t.set_id, 'set1') = v_set)
      and (t.user_id is null or t.user_id not in (select user_id from ex))
  )
  select jsonb_build_object(
    'tz', r.tz, 'from', r.first_day, 'to', r.last_day, 'trendBucket', v_trend, 'mode', v_mode, 'set', v_set,
    'games', (select count(*) from lob),
    'runs', (select n from field),
    'rolledThrough', v_through,
    'rolledFrom', (select min(day) from analytics.balance_daily),
    'field', (select jsonb_build_object('n', f.n, 'avg', round(f.avg, 3), 'var', round(f.var, 3), 'top4', round(f.top4, 4)) from field f),
    'trends', coalesce((select jsonb_object_agg(k.kind, k.items) from (
        select tp.kind, jsonb_agg(jsonb_build_object('id', tp.item, 'games', tp.n, 'avgPlacement', tp.avg, 'top4Rate', tp.top4,
            'series', (select jsonb_agg(jsonb_build_object('t', to_char(pb.b, 'YYYY-MM-DD'), 'games', pb.n, 'avgPlacement', pb.avg, 'top4Rate', pb.top4) order by pb.b)
              from per_b pb where pb.kind = tp.kind and pb.item = tp.item)) order by tp.n desc) as items
        from tops tp group by tp.kind) k), '{}'::jsonb),
    -- compact rows: [id, seen, taken, takenPlayers, takenAvg, takenVar, takenTop4, passed, passedPlayers, passedAvg, passedVar,
    --                finalN, finalAvg, finalGolden, series [[bucket start, n, avg]] for items taken in 10+ runs]
    'items', coalesce((select jsonb_object_agg(z.kind, z.rows) from (
        select s.kind, jsonb_agg(jsonb_build_array(s.item, s.t_n + s.p_n, s.t_n, s.t_players, round(s.t_avg, 3), round(s.t_var, 3), round(s.t_top4, 4),
            s.p_n, s.p_players, round(s.p_avg, 3), round(s.p_var, 3),
            coalesce(fi.n, 0), fi.avg, coalesce(fi.golden, 0),
            case when s.t_n >= 10 then sj.s end) order by s.t_n desc, s.item) as rows
        from stats s left join fin_i fi on s.kind = 'card' and fi.item = s.item left join ser_j sj on sj.kind = s.kind and sj.item = s.item
        group by s.kind) z), '{}'::jsonb)
  ) into v_out;
  return v_out;
end $$;

-- NO BACKFILL HERE (it is what ran the Free plan out of disk). The nightly job rolls up at most 14 days a run, oldest
-- first; the lead can run `select analytics.balance_backfill_step(14);` to fill history sooner.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'analytics-balance-rollup';
    perform cron.schedule('analytics-balance-rollup', '47 3 * * *',
      $job$set statement_timeout = '5min'; select analytics.balance_rollup_catchup(14)$job$);
  end if;
end $$;

-- MEMORY, NOT DISK, for the long-range reads (fix 2026-11-22). The Free plan's session work_mem is 2 MB, so an "All time"
-- read sorted / hashed through temp files (bench at ~50k games: 6-40 MB of temp per read; 295 MB for the old balance
-- read). Each read sets its own work_mem (16 MB; hash nodes get 2x by hash_mem_multiplier) so its sorts stay in memory.
-- These are dev-only reads for two people behind a 60 s cache, so the extra memory is never multiplied by traffic.
alter function analytics.overview(date, date, text) set work_mem = '16MB';
alter function analytics.breakdown(date, date, text, text) set work_mem = '16MB';
alter function analytics.players(date, date, text) set work_mem = '16MB';
alter function analytics.social(date, date, text) set work_mem = '16MB';
alter function analytics.progression(date, date, text) set work_mem = '16MB';
alter function analytics.balance(date, date, text, text, text) set work_mem = '32MB'; -- the widest read (Career + rollup)

-- Nothing in the private schema is callable by anyone but its owner.
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'analytics' loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function %s from authenticated', f); end if;
  end loop;
end $$;

-- ── The five entry points (service role only) ─────────────────────────────────────────────────────────────────
create or replace function public.analytics_players(p_from date default null, p_to date default null, p_tz text default 'UTC')
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$ select analytics.players(p_from, p_to, p_tz) $$;
create or replace function public.analytics_social(p_from date default null, p_to date default null, p_tz text default 'UTC')
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$ select analytics.social(p_from, p_to, p_tz) $$;
create or replace function public.analytics_progression(p_from date default null, p_to date default null, p_tz text default 'UTC')
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$ select analytics.progression(p_from, p_to, p_tz) $$;
create or replace function public.analytics_health(p_from date default null, p_to date default null, p_tz text default 'UTC')
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$ select analytics.health(p_from, p_to, p_tz) $$;
create or replace function public.analytics_balance(p_from date default null, p_to date default null, p_tz text default 'UTC',
  p_mode text default 'ranked', p_set text default null)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$ select analytics.balance(p_from, p_to, p_tz, p_mode, p_set) $$;

do $$
declare fn text;
begin
  foreach fn in array array['analytics_players', 'analytics_social', 'analytics_progression', 'analytics_health'] loop
    execute format('revoke all on function public.%I(date, date, text) from public', fn);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function public.%I(date, date, text) from anon', fn); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function public.%I(date, date, text) from authenticated', fn); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function public.%I(date, date, text) to service_role', fn); end if;
  end loop;
end $$;

revoke all on function public.analytics_balance(date, date, text, text, text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on function public.analytics_balance(date, date, text, text, text) from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on function public.analytics_balance(date, date, text, text, text) from authenticated'; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant execute on function public.analytics_balance(date, date, text, text, text) to service_role'; end if;
end $$;
