-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- THE CRASH DIGEST: small aggregates of client_crash_reports for the hub's crash-spike alert and daily summary
-- (2026-11-22, feat/crash-spike-alerts; R-OPS-HEALTH-04). Additive, idempotent, safe to re-run.
-- APPLY AFTER 2026-11-21-ops-health-checks.sql (the `ops` schema and `ops.health__key_note`) AND
-- 2026-11-29-client-crash-reports-desktop.sql (the `platform` / `kind` / `app_version` columns).
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Owner 2026-11-22: "Discord alerts for player CRASH SPIKES (not one message per crash), through the same webhook,
-- plus an optional daily summary." The hub (workers/versus/src/health/crashAlert.ts) asks every 15 minutes for the
-- last hour against the trailing 7 days, and once a day (06:20 UTC) for yesterday against the 7 days before it.
--
--   - `ops.crash_digest_hour(at)`: per platform with reports in the hour before `at`: the count, players affected,
--     counts per kind and per app version (each with when it was first seen in the trailing 7 days, so the hub can
--     spot a NEW kind or build), the top 3 messages, and the platform's hourly baseline over the 168 hours before
--     that hour (total, mean, stddev, max; zero hours count).
--   - `ops.crash_digest_day(day)`: that UTC day per platform and kind, players affected, the top 3 messages, and the
--     7 days before it as a daily average.
--   - `public.ops_crash_digest(p_key, p_mode, p_at)`: the hub's key-gated wrapper (the hub's own writer secret, as
--     `public.ops_health_probe`; never the service role). It can only read these counts.
--
-- WHAT IT NEVER RETURNS: user ids, emails, user agents, payloads or stacks. "Players" is a count of distinct signed-in
-- users, or distinct devices (an md5 of the user agent, computed and dropped inside the query) for rows with no user.
-- A message is the row's `last_step` (already redacted on the client: errorReport.ts `redact`; a phone crash's last
-- breadcrumb), minus its leading "kind: ", clipped to 100 characters. `perf` rows are not crashes and never count.
--
-- SPEED (R-OPS-HEALTH-02: the anon role's 3 s statement_timeout cancelled the cold health probe). Both digests read
-- only the 7-8 days of rows they need through the existing `client_crash_reports_created` index (created_at desc,
-- from 2026-10-22-client-crash-reports.sql; re-asserted below in case a project lacks it), and only top-level columns,
-- never `payload` (a phone crash's payload is up to 48 KB, stored out of line: reading it cold is what would be slow).
-- PGlite bench (workers/versus/test/opsCrashDigest.db.test.ts, 2026-11-22): 21,000 rows over 7 days (~50x the live
-- volume): the hour digest 80 ms, the day digest 32 ms.
--
-- ROLLBACK:
--   drop function if exists public.ops_crash_digest(text, text, timestamptz);
--   drop function if exists ops.crash_digest_day(date);
--   drop function if exists ops.crash_digest_hour(timestamptz);
--   drop function if exists ops.crash__msg(text, text);

create index if not exists client_crash_reports_created on public.client_crash_reports(created_at desc);

-- A row's short message: last_step without the "kind: " the error rows lead with, clipped.
create or replace function ops.crash__msg(p_kind text, p_step text) returns text
language sql immutable set search_path = public as $$
  select left(case when p_step like p_kind || ': %' then substr(p_step, length(p_kind) + 3) else p_step end, 100)
$$;

-- ── The hour before p_at, against the 168 hours before that ──────────────────────────────────────────────────
create or replace function ops.crash_digest_hour(p_at timestamptz) returns jsonb
language sql stable set search_path = public as $$
  with w as (
    select coalesce(r.platform, 'unknown') as platform, r.kind, coalesce(r.app_version, '?') as app_version,
           coalesce(r.user_id::text, 'ua:' || md5(r.ua)) as who, r.created_at, r.last_step,
           r.created_at >= p_at - interval '1 hour' as cur
      from public.client_crash_reports r
     where r.created_at >= p_at - interval '169 hours' and r.created_at < p_at and r.kind <> 'perf'
  ),
  cur as (select * from w where cur),
  plat as (
    select platform, count(*)::int as n, count(distinct who)::int as users from cur group by platform
  ),
  base_h as (
    select platform, date_trunc('hour', created_at) as h, count(*)::numeric as n
      from w where not cur and platform in (select platform from plat) group by 1, 2
  ),
  base as (
    select platform, sum(n)::int as total, round(sum(n) / 168, 3) as mean,
           round(sqrt(greatest(sum(n * n) / 168 - power(sum(n) / 168, 2), 0)), 3) as sd, max(n)::int as max
      from base_h group by platform
  ),
  kinds as (
    select c.platform, c.kind, count(*)::int as n, count(distinct c.who)::int as users,
           (select min(x.created_at) from w x where x.platform = c.platform and x.kind = c.kind) as first
      from cur c group by c.platform, c.kind
  ),
  versions as (
    select c.platform, c.app_version as v, count(*)::int as n, count(distinct c.who)::int as users,
           (select min(x.created_at) from w x where x.platform = c.platform and x.app_version = c.app_version) as first
      from cur c group by c.platform, c.app_version
  ),
  msgs as (
    select platform, kind, ops.crash__msg(kind, last_step) as msg, count(*)::int as n,
           row_number() over (partition by platform order by count(*) desc, ops.crash__msg(kind, last_step)) as rk
      from cur group by platform, kind, ops.crash__msg(kind, last_step)
  )
  select jsonb_build_object(
    'mode', 'hour',
    'at', p_at,
    'platforms', coalesce((
      select jsonb_agg(jsonb_build_object(
        'platform', p.platform, 'n', p.n, 'users', p.users,
        'base', jsonb_build_object('total', coalesce(b.total, 0), 'mean', coalesce(b.mean, 0), 'sd', coalesce(b.sd, 0), 'max', coalesce(b.max, 0), 'hours', 168),
        'kinds', coalesce((select jsonb_agg(jsonb_build_object('kind', k.kind, 'n', k.n, 'users', k.users, 'first', k.first) order by k.n desc, k.kind)
                             from (select * from kinds k where k.platform = p.platform order by k.n desc, k.kind limit 10) k), '[]'::jsonb),
        'versions', coalesce((select jsonb_agg(jsonb_build_object('v', v.v, 'n', v.n, 'users', v.users, 'first', v.first) order by v.n desc, v.v)
                             from (select * from versions v where v.platform = p.platform order by v.n desc, v.v limit 5) v), '[]'::jsonb),
        'top', coalesce((select jsonb_agg(jsonb_build_object('kind', m.kind, 'msg', m.msg, 'n', m.n) order by m.rk)
                           from msgs m where m.platform = p.platform and m.rk <= 3), '[]'::jsonb)
      ) order by p.n desc, p.platform)
      from plat p left join base b on b.platform = p.platform
    ), '[]'::jsonb)
  )
$$;

-- ── One UTC day, against the 7 days before it ────────────────────────────────────────────────────────────────
create or replace function ops.crash_digest_day(p_day date) returns jsonb
language sql stable set search_path = public as $$
  with w as (
    select coalesce(r.platform, 'unknown') as platform, r.kind,
           coalesce(r.user_id::text, 'ua:' || md5(r.ua)) as who, r.last_step,
           r.created_at >= p_day::timestamp at time zone 'UTC' as cur
      from public.client_crash_reports r
     where r.created_at >= (p_day - 7)::timestamp at time zone 'UTC'
       and r.created_at < (p_day + 1)::timestamp at time zone 'UTC'
       and r.kind <> 'perf'
  ),
  cur as (select * from w where cur),
  plat as (select platform, count(*)::int as n, count(distinct who)::int as users from cur group by platform),
  prior as (select platform, count(*)::int as n from w where not cur group by platform),
  kinds as (select platform, kind, count(*)::int as n from cur group by platform, kind),
  msgs as (
    select platform, kind, ops.crash__msg(kind, last_step) as msg, count(*)::int as n
      from cur group by platform, kind, ops.crash__msg(kind, last_step)
     order by count(*) desc, platform, kind, ops.crash__msg(kind, last_step) limit 3
  )
  select jsonb_build_object(
    'mode', 'day',
    'day', p_day,
    'total', (select count(*)::int from cur),
    'users', (select count(distinct who)::int from cur),
    'avg7', round(coalesce((select sum(n) from prior), 0) / 7.0, 1),
    'platforms', coalesce((
      select jsonb_agg(jsonb_build_object(
        'platform', x.platform, 'n', coalesce(p.n, 0), 'users', coalesce(p.users, 0),
        'avg7', round(coalesce(q.n, 0) / 7.0, 1),
        'kinds', coalesce((select jsonb_agg(jsonb_build_object('kind', k.kind, 'n', k.n) order by k.n desc, k.kind)
                             from (select * from kinds k where k.platform = x.platform order by k.n desc, k.kind limit 6) k), '[]'::jsonb)
      ) order by coalesce(p.n, 0) desc, x.platform)
      from (select platform from plat union select platform from prior) x
      left join plat p on p.platform = x.platform left join prior q on q.platform = x.platform
    ), '[]'::jsonb),
    'top', coalesce((select jsonb_agg(jsonb_build_object('platform', m.platform, 'kind', m.kind, 'msg', m.msg, 'n', m.n)
                                       order by m.n desc, m.platform, m.kind, m.msg) from msgs m), '[]'::jsonb)
  )
$$;

revoke all on function ops.crash__msg(text, text) from public;
revoke all on function ops.crash_digest_hour(timestamptz) from public;
revoke all on function ops.crash_digest_day(date) from public;

-- ── The hub's key-gated wrapper ──────────────────────────────────────────────────────────────────────────────
-- p_mode 'hour': the hour before p_at (default now). p_mode 'day': the UTC day before p_at's day (default: yesterday).
create or replace function public.ops_crash_digest(p_key text, p_mode text default 'hour', p_at timestamptz default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  note text := ops.health__key_note(p_key);
  v_at timestamptz := coalesce(p_at, now());
begin
  if note is null then raise exception 'not_authorized'; end if;
  if p_mode = 'hour' then return ops.crash_digest_hour(v_at) || jsonb_build_object('key_note', note); end if;
  if p_mode = 'day' then return ops.crash_digest_day((v_at at time zone 'UTC')::date - 1) || jsonb_build_object('key_note', note); end if;
  raise exception 'bad_mode';
end $$;

revoke all on function public.ops_crash_digest(text, text, timestamptz) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'grant execute on function public.ops_crash_digest(text, text, timestamptz) to anon, authenticated';
  end if;
end $$;

notify pgrst, 'reload schema';
