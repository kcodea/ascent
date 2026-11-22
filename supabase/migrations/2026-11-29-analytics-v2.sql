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
--   public.analytics_health(from, to, tz)       HEALTH + BALANCE: crash + bug reports per bucket, the daily health check,
--                                               database size vs the Free plan and the biggest tables, the retention
--                                               cleanup's rules and recent runs, and hero / tribe / rune / Ancient trends.
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
--   drop function if exists analytics.players(date, date, text);   (and social / progression / health / range_of)

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

-- ── 4. HEALTH + BALANCE TRENDS ────────────────────────────────────────────────────────────────────────────────
create or replace function analytics.health(p_from date, p_to date, p_tz text)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare
  r   record;
  v_trend text;
  v_status jsonb;
  v_latest jsonb;
  v_rules jsonb;
  v_runs jsonb;
  v_out jsonb;
begin
  select * into r from analytics.range_of(p_from, p_to, p_tz);
  -- weekly trends up to ~4 months, monthly beyond (keeps every line short and the payload small)
  v_trend := case when r.last_day - r.first_day + 1 > 120 then 'month' else 'week' end;
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
  ex as (select user_id from analytics.excluded_users()),
  crashes as (select c.created_at, c.build, c.last_step from public.client_crash_reports c where c.created_at >= r.from_ts and c.created_at < r.to_ts),
  bugs as (select b.created_at, b.status, b.severity from public.bug_reports b where b.created_at >= r.from_ts and b.created_at < r.to_ts),
  -- balance: ranked lobby games only (unrated tables are not a fair read), each item's placement per trend bucket
  lob as (
    select date_trunc(v_trend, h.created_at at time zone r.tz) as b, h.placement, h.hero_id, h.entry
    from public.run_history h
    where h.created_at >= r.from_ts and h.created_at < r.to_ts and h.mode = 'lobby' and not (h.entry ? 'unrated') and h.placement is not null
      and h.user_id not in (select user_id from ex)
  ),
  bal as (
    select 'hero'::text as kind, l.hero_id as item, l.b, l.placement from lob l where l.hero_id is not null
    union all select 'tribe', nullif(l.entry->>'dominantTribe', ''), l.b, l.placement from lob l where nullif(l.entry->>'dominantTribe', '') is not null
    union all select 'rune', t.rune, l.b, l.placement from lob l
      cross join lateral jsonb_array_elements_text(case when jsonb_typeof(l.entry #> '{board,runes}') = 'array' then l.entry #> '{board,runes}' else '[]'::jsonb end) as t(rune)
    union all select 'ancient', l.entry #>> '{board,ancient,id}', l.b, l.placement from lob l where (l.entry #>> '{board,ancient,id}') is not null
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
  tops as (select * from per_i where rk <= case kind when 'rune' then 12 when 'ancient' then 8 else 10 end)
  select jsonb_build_object(
    'tz', r.tz, 'from', r.first_day, 'to', r.last_day, 'bucket', r.bucket, 'trendBucket', v_trend,
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
              order by pg_total_relation_size(c.oid) desc limit 10) t)),
    'trends', coalesce((select jsonb_object_agg(k.kind, k.items) from (
        select tp.kind, jsonb_agg(jsonb_build_object('id', tp.item, 'games', tp.n, 'avgPlacement', tp.avg, 'top4Rate', tp.top4,
            'series', (select jsonb_agg(jsonb_build_object('t', to_char(pb.b, 'YYYY-MM-DD'), 'games', pb.n, 'avgPlacement', pb.avg, 'top4Rate', pb.top4) order by pb.b)
              from per_b pb where pb.kind = tp.kind and pb.item = tp.item)) order by tp.n desc) as items
        from tops tp group by tp.kind) k), '{}'::jsonb)
  ) into v_out;
  return v_out;
end $$;

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

-- ── The four entry points (service role only) ─────────────────────────────────────────────────────────────────
create or replace function public.analytics_players(p_from date default null, p_to date default null, p_tz text default 'UTC')
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$ select analytics.players(p_from, p_to, p_tz) $$;
create or replace function public.analytics_social(p_from date default null, p_to date default null, p_tz text default 'UTC')
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$ select analytics.social(p_from, p_to, p_tz) $$;
create or replace function public.analytics_progression(p_from date default null, p_to date default null, p_tz text default 'UTC')
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$ select analytics.progression(p_from, p_to, p_tz) $$;
create or replace function public.analytics_health(p_from date default null, p_to date default null, p_tz text default 'UTC')
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$ select analytics.health(p_from, p_to, p_tz) $$;

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
