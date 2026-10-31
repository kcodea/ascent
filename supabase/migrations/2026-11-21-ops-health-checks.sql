-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- THE DAILY HEALTH CHECK: its record, its Supabase probes, and the lead's one-line status (2026-10-31,
-- feat/cf-health-check; R-OPS-HEALTH-01). Additive, idempotent, safe to re-run. No Edge Function to redeploy.
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Owner 2026-10-31: "a small daily health check that compares the Cloudflare pool copy against Supabase, confirms the
-- hub is up, and confirms the end-of-game writes are arriving."
--
-- The check runs on the friends hub's daily cron (workers/versus/src/health/, `ascent-hub`, 06:17 UTC) and on demand
-- from a dev machine (`npm run health`). Both run the same checks; this file is everything Supabase side:
--
--   - `ops.health_checks`: one row per check per run (private schema: no client role can see it).
--   - `ops.health_status`: THE LEAD'S QUERY, one row: when the cron last reported, whether it is overdue (no cron row
--     in 26 hours = the hub or its cron is down), and which checks the latest cron run failed.
--   - `ops.health_latest`: the latest run's rows (per source), for the detail.
--   - `ops.health_probe(since)`: end-of-game rows since `since` (run_history, boards, lobby_fights, run_telemetry,
--     Cloudflare versus_matches, duos_match_history), the activity signals Supabase holds (cloud saves, in-game
--     presence), the newest Cloudflare match's content revision, the writer key notes, and the game session's flush
--     ledger when that SQL is applied (2026-11-20-game-session-cf.sql; until then `session` is null and the check n/a).
--   - `ops.pool_digest(params)`: the pool as `pool_runs_sample_keys` / `pool_runs_boards` serve it, as one sha256
--     (workers/versus/src/health/healthProtocol.ts documents the exact line format the mirror reproduces).
--   - `ops.health_record(source, rows)`: appends one run's rows; keeps 90 days.
--
-- The hub reaches the three functions through key-gated wrappers (`public.ops_health_probe`, `public.ops_pool_digest`,
-- `public.ops_health_record`), called with the publishable key and the hub's own writer secret (`HUB_WRITER_SECRET`,
-- whose sha256 is already the `versus_cf_writer_keys` row noted 'ascent-hub'). Never the service role. The wrappers
-- can only read counts and hashes and append health rows. The CLI calls the `ops.*` functions directly as the
-- database admin (the Supabase CLI login), so a dev machine holds no key.
--
-- ROLLBACK:
--   drop function if exists public.ops_health_record(text, text, jsonb);
--   drop function if exists public.ops_pool_digest(text, jsonb);
--   drop function if exists public.ops_health_probe(text, timestamptz);
--   drop function if exists ops.health_record(text, jsonb);
--   drop function if exists ops.pool_digest(jsonb);
--   drop function if exists ops.health_probe(timestamptz);
--   drop function if exists ops.health__count(text, text, timestamptz, text);
--   drop function if exists ops.health__key_note(text);
--   drop view if exists ops.health_status; drop view if exists ops.health_latest;
--   drop table if exists ops.health_checks;

create extension if not exists pgcrypto with schema extensions;

create schema if not exists ops;
revoke all on schema ops from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on schema ops from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on schema ops from authenticated'; end if;
end $$;

-- ── 1. The record ──────────────────────────────────────────────────────────────────────────────────────────
create table if not exists ops.health_checks (
  id          bigserial primary key,
  run_id      uuid not null,                         -- one per run: every row of a run shares it
  ts          timestamptz not null default now(),
  source      text not null check (source in ('cron', 'cli')),
  check_name  text not null,                         -- 'hub', 'versus_worker', 'pool.whole', 'writes.lobby', ...
  status      text not null check (status in ('ok', 'fail', 'n/a')),
  ok          boolean not null generated always as (status <> 'fail') stored,  -- n/a is not a failure
  detail      jsonb not null default '{}'::jsonb
);
create index if not exists health_checks_ts on ops.health_checks (ts desc);
create index if not exists health_checks_run on ops.health_checks (run_id);
revoke all on ops.health_checks from public;

-- The latest run of each source, every check.
create or replace view ops.health_latest as
select h.source, h.ts, h.check_name, h.status, h.ok, h.detail, h.run_id
from ops.health_checks h
where h.run_id in (select distinct on (x.source) x.run_id from ops.health_checks x order by x.source, x.ts desc, x.id desc)
order by h.source, h.ok, h.check_name;

-- THE LEAD'S SESSION-START QUERY: `select * from ops.health_status;`  Healthy = overdue false and failing 0.
create or replace view ops.health_status as
select
  (select max(ts) from ops.health_checks where source = 'cron')                                          as last_cron_at,
  coalesce((select max(ts) from ops.health_checks where source = 'cron') < now() - interval '26 hours', true) as cron_overdue,
  (select count(*) from ops.health_latest where source = 'cron' and not ok)                               as cron_failing,
  (select string_agg(check_name, ', ' order by check_name) from ops.health_latest where source = 'cron' and not ok) as failing_checks,
  (select max(ts) from ops.health_checks where source = 'cli')                                           as last_cli_at;
revoke all on ops.health_latest, ops.health_status from public;

-- ── 2. Helpers ─────────────────────────────────────────────────────────────────────────────────────────────
-- The note of the writer key row matching p_key, or null.
create or replace function ops.health__key_note(p_key text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(k.note, '') from public.versus_cf_writer_keys k
  where p_key is not null and k.key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex')
  limit 1
$$;

-- `{ n, latest }` for rows of public.<tbl> whose <col> >= since (and <where>, a fixed literal from this file).
-- null when the table or the column does not exist on this project (a check is then n/a, never an error).
create or replace function ops.health__count(p_table text, p_col text, p_since timestamptz, p_where text default null)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  n bigint; latest timestamptz;
begin
  if to_regclass('public.' || p_table) is null or not exists (select 1 from information_schema.columns
       where table_schema = 'public' and table_name = p_table and column_name = p_col) then
    return null;
  end if;
  execute format('select count(*) filter (where %1$I >= $1), max(%1$I) from public.%2$I %3$s', p_col, p_table,
                 case when p_where is null then '' else 'where ' || p_where end)
    into n, latest using p_since;
  return jsonb_build_object('n', n, 'latest', latest);
end $$;

-- ── 3. The write probe ─────────────────────────────────────────────────────────────────────────────────────
create or replace function ops.health_probe(p_since timestamptz) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  since timestamptz := least(greatest(coalesce(p_since, now() - interval '24 hours'), now() - interval '7 days'), now());
  c jsonb := '{}'::jsonb;
  l jsonb := '{}'::jsonb;
  r jsonb;
  t record;
  rev text;
  sess jsonb := null;
  applied bigint; rejected bigint := 0;
begin
  for t in select * from (values
      ('run_history', 'run_history', 'created_at', null::text),
      ('boards', 'boards', 'created_at', null),
      ('lobby_fights', 'lobby_fights', 'created_at', null),
      ('run_telemetry', 'run_telemetry', 'created_at', null),
      ('versus_cf', 'versus_matches', 'updated_at', 'backend = ''cloudflare'''),
      ('duos_history', 'duos_match_history', 'completed_at', null),
      ('saved_runs', 'saved_runs', 'updated_at', null),
      ('in_game', 'player_presence', 'updated_at', 'status = ''in_game''')) v(k, tbl, col, w)
  loop
    r := ops.health__count(t.tbl, t.col, since, t.w);
    c := c || jsonb_build_object(t.k, r -> 'n');
    l := l || jsonb_build_object(t.k, r -> 'latest');
  end loop;

  if to_regclass('public.versus_matches') is not null then
    execute 'select content_revision from public.versus_matches where backend = ''cloudflare'' and created_at > now() - interval ''7 days''
             order by created_at desc limit 1' into rev;
  end if;

  -- The game session's flush ledger (2026-11-20-game-session-cf.sql): writes applied, and writes the flush rejected
  -- (logged to ops.events as source 'session', kind 'write_rejected').
  if to_regclass('public.session_cf_writes') is not null then
    execute 'select count(*) from public.session_cf_writes where at >= $1 and status = ''applied''' into applied using since;
    if to_regclass('ops.events') is not null then
      execute 'select count(*) from ops.events where at >= $1 and source = ''session'' and kind = ''write_rejected''' into rejected using since;
    end if;
    sess := jsonb_build_object('applied', applied, 'rejected', rejected);
  end if;

  return jsonb_build_object(
    'since', since,
    'writer_keys', (select coalesce(jsonb_agg(coalesce(k.note, '') order by k.created_at), '[]'::jsonb) from public.versus_cf_writer_keys k),
    'counts', c, 'latest', l, 'latest_cf_revision', rev, 'session', sess);
end $$;

-- ── 4. The pool digest ─────────────────────────────────────────────────────────────────────────────────────
-- p_params null: every eligible run in id order (the mirror's whole index). Otherwise pool_runs_sample_keys' own
-- parameters, which must carry p_seed (a deterministic draw both sides can repeat). Each drawn run's boards come from
-- pool_runs_boards itself, 300 ids a call (its cap). Line per run, in draw order:
--     <run_id>|<run_key>|<rev>|<sha256 hex of boards::text>
-- digest = sha256 hex of the lines joined by E'\n'; rows = [{run_id, rev, h: first 16 hex of the boards hash}].
create or replace function ops.pool_digest(p_params jsonb) returns jsonb
language plpgsql volatile set search_path = public set work_mem = '16MB' as $$
declare
  ids bigint[];
  m jsonb := '{}'::jsonb;
  e jsonb;
  lines text[] := '{}';
  out_rows jsonb := '[]'::jsonb;
  i int;
  n int;
begin
  if p_params is null or jsonb_typeof(p_params) = 'null' then
    select coalesce(array_agg(r.id order by r.id), '{}') into ids from public.pool_runs r where r.eligible;
  else
    if jsonb_typeof(p_params) <> 'object' or coalesce(p_params ->> 'p_seed', '') = '' then raise exception 'bad_params'; end if;
    select coalesce(array_agg(k.run_id order by k.ord), '{}') into ids
    from public.pool_runs_sample_keys(
      least(greatest(coalesce((p_params ->> 'p_limit')::int, 150), 0), 300), p_params ->> 'p_set', p_params ->> 'p_patch_prefix', null::uuid,
      p_params ->> 'p_seed', (p_params ->> 'p_strength_min')::numeric, (p_params ->> 'p_strength_max')::numeric,
      p_params ->> 'p_pool', (p_params ->> 'p_early_weight')::numeric, (p_params ->> 'p_strength_cap')::numeric
    ) with ordinality as k(run_id, run_key, author, user_id, wave_count, strength, strength_early, strength_late, rev, ord);
  end if;
  n := coalesce(array_length(ids, 1), 0);

  i := 1;
  while i <= n loop
    select m || coalesce(jsonb_object_agg(b.run_id::text, jsonb_build_array(b.run_key, b.rev,
             encode(extensions.digest(b.boards::text, 'sha256'), 'hex'))), '{}'::jsonb)
      into m from public.pool_runs_boards(ids[i:least(i + 299, n)]) b;
    i := i + 300;
  end loop;

  for i in 1..n loop
    e := m -> (ids[i]::text);
    continue when e is null;  -- the run left the pool between the draw and the boards read
    lines := lines || format('%s|%s|%s|%s', ids[i], e ->> 0, e ->> 1, e ->> 2);
    out_rows := out_rows || jsonb_build_object('run_id', ids[i], 'rev', e ->> 1, 'h', left(e ->> 2, 16));
  end loop;

  return jsonb_build_object('count', coalesce(array_length(lines, 1), 0),
    'digest', encode(extensions.digest(array_to_string(lines, E'\n'), 'sha256'), 'hex'), 'rows', out_rows);
end $$;

-- ── 5. The record ──────────────────────────────────────────────────────────────────────────────────────────
-- p_rows: [{ check, status, detail }] (healthCore.ts `HealthResult`). At most 50 rows, each detail at most 16 KB.
create or replace function ops.health_record(p_source text, p_rows jsonb) returns jsonb
language plpgsql volatile set search_path = public as $$
declare
  run uuid := gen_random_uuid();
  n int;
begin
  if p_source not in ('cron', 'cli') then raise exception 'bad_source'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 50 then
    raise exception 'bad_rows';
  end if;
  insert into ops.health_checks (run_id, source, check_name, status, detail)
  select run, p_source, left(coalesce(x ->> 'check', '?'), 64),
         case when x ->> 'status' in ('ok', 'fail', 'n/a') then x ->> 'status' else 'fail' end,
         case when jsonb_typeof(x -> 'detail') = 'object' and octet_length((x -> 'detail')::text) <= 16384 then x -> 'detail'
              else jsonb_build_object('truncated', true) end
  from jsonb_array_elements(p_rows) x;
  get diagnostics n = row_count;
  delete from ops.health_checks where ts < now() - interval '90 days';
  return jsonb_build_object('run_id', run, 'rows', n);
end $$;

revoke all on function ops.health__key_note(text) from public;
revoke all on function ops.health__count(text, text, timestamptz, text) from public;
revoke all on function ops.health_probe(timestamptz) from public;
revoke all on function ops.pool_digest(jsonb) from public;
revoke all on function ops.health_record(text, jsonb) from public;

-- ── 6. The hub's key-gated wrappers ────────────────────────────────────────────────────────────────────────
create or replace function public.ops_health_probe(p_key text, p_since timestamptz default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare note text := ops.health__key_note(p_key);
begin
  if note is null then raise exception 'not_authorized'; end if;
  return ops.health_probe(p_since) || jsonb_build_object('key_note', note);
end $$;

create or replace function public.ops_pool_digest(p_key text, p_params jsonb default null) returns jsonb
language plpgsql volatile security definer set search_path = public set work_mem = '16MB' as $$
begin
  if ops.health__key_note(p_key) is null then raise exception 'not_authorized'; end if;
  return ops.pool_digest(p_params);
end $$;

create or replace function public.ops_health_record(p_key text, p_source text, p_rows jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
begin
  if ops.health__key_note(p_key) is null then raise exception 'not_authorized'; end if;
  return ops.health_record(p_source, p_rows);
end $$;

revoke all on function public.ops_health_probe(text, timestamptz) from public;
revoke all on function public.ops_pool_digest(text, jsonb) from public;
revoke all on function public.ops_health_record(text, text, jsonb) from public;
grant execute on function public.ops_health_probe(text, timestamptz) to anon, authenticated;
grant execute on function public.ops_pool_digest(text, jsonb) to anon, authenticated;
grant execute on function public.ops_health_record(text, text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
