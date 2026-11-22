-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- THE HEALTH PROBE, PRE-COMPUTED (fix 2026-11-22, R-OPS-HEALTH-02). APPLY AFTER 2026-11-21-ops-health-checks.sql.
-- ADDITIVE and idempotent (safe to re-run).
--
-- WHY: the hub's daily check (06:17 UTC, workers/versus hub.wrangler.toml) calls `public.ops_health_probe` through
-- PostgREST with the ANON key, and the `anon` role carries `statement_timeout = 3s`. On a cold database (nothing in
-- cache at that hour) the probe's eight window counts take ~3.2 s, so the call was cancelled (57014) and four checks
-- (writer_key, writes.lobby, writes.versus, writes.duos) read "fail" on 2026-11-21 and 2026-11-22 although every
-- write path was healthy. Warm, the same probe takes ~30 ms.
--
-- FIX: pg_cron computes the probe at 06:10 UTC as the database owner (no 3 s ceiling) into a one-row cache; the
-- key-gated wrapper answers from that cache when it is fresh (computed in the last 30 minutes) and its window matches
-- what the hub asked for (within 2 hours), and computes live otherwise (the CLI / an off-schedule run). The answer
-- carries `cached_at` when it came from the cache. Nothing else about the probe changes: same function, same fields.
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════

create table if not exists ops.health_probe_cache (
  id smallint primary key default 1 check (id = 1),
  since timestamptz not null,
  computed_at timestamptz not null default now(),
  result jsonb not null
);
revoke all on ops.health_probe_cache from public;

create or replace function ops.health_probe_refresh() returns jsonb
language plpgsql volatile set search_path = public as $$
declare
  since timestamptz := now() - interval '24 hours';
  r jsonb := ops.health_probe(since);
begin
  insert into ops.health_probe_cache (id, since, computed_at, result) values (1, since, now(), r)
  on conflict (id) do update set since = excluded.since, computed_at = excluded.computed_at, result = excluded.result;
  return r;
end $$;
revoke all on function ops.health_probe_refresh() from public;

create or replace function public.ops_health_probe(p_key text, p_since timestamptz default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  note text := ops.health__key_note(p_key);
  want timestamptz := coalesce(p_since, now() - interval '24 hours');
  c ops.health_probe_cache;
begin
  if note is null then raise exception 'not_authorized'; end if;
  select * into c from ops.health_probe_cache where id = 1;
  if found and c.computed_at > now() - interval '30 minutes' and abs(extract(epoch from (c.since - want))) <= 7200 then
    return c.result || jsonb_build_object('key_note', note, 'cached_at', c.computed_at);
  end if;
  return ops.health_probe(p_since) || jsonb_build_object('key_note', note);
end $$;
revoke all on function public.ops_health_probe(text, timestamptz) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'grant execute on function public.ops_health_probe(text, timestamptz) to anon, authenticated';
  end if;
end $$;

-- 06:10 UTC, seven minutes before the hub's 06:17 check. The owner role has no statement ceiling; give it two minutes.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'ops-health-probe-warm';
    perform cron.schedule('ops-health-probe-warm', '10 6 * * *',
      $job$set statement_timeout = '2min'; select ops.health_probe_refresh()$job$);
  end if;
end $$;
