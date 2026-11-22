-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- THE DAILY RETENTION CLEANUP (2026-11-22, chore/db-retention-cleanup; R-OPS-RETENTION-01). Owner approved building it
-- 2026-11-22. Additive, idempotent, safe to re-run. No Edge Function, no client change. Runbook: docs/ops/retention.md.
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- `ops.retention_run(p_dry_run boolean default true)` walks `ops.retention_rules` (one row per rule) and, for every
-- ENABLED rule, either counts what it would delete (dry run, the default: writes no data row anywhere, only the rule's
-- `last_checked_*` stats and one ops.events row) or deletes AT MOST `batch_limit` rows per table it touches. pg_cron runs
-- it for real once a day at 03:37 UTC (`ops-retention`), away from the 06:17 UTC health check. A backlog bigger than one
-- batch drains over the following days; nothing ever needs a long run or a long lock.
--
-- THE RULES (seeded ENABLED; `keep_days` is at least 7, `batch_limit` 1..50000):
--   perf_runs               public.perf_runs rows created more than keep_days (60) ago.
--   versus_1v1_leftovers    for a public.versus_matches row that is COMPLETE and completed more than keep_days (30) ago:
--                           its public.versus_submissions and public.versus_rounds rows. The match row is NEVER deleted.
--   versus_group_leftovers  for a public.versus_group_matches row that is COMPLETE and completed more than keep_days (30)
--                           ago: its public.versus_group_submissions, public.versus_group_fights and
--                           public.versus_group_rounds rows. versus_group_matches / versus_group_seats are NEVER deleted.
--   anon_empty_users        auth.users that are anonymous (is_anonymous, no email / phone / pending email change), whose
--                           coalesce(last_sign_in_at, created_at) is older than keep_days (30), with no auth.sessions row
--                           updated or refreshed within keep_days, and whose id appears in NO user-linked public column
--                           (and owns no storage object). Never a non-anonymous user.
--
-- WHAT READS THE VERSUS CHILD ROWS AFTER A MATCH ENDS (checked 2026-11-22, so the rules above are safe at 30 days):
--   - The live game reads nothing back from Supabase: the Cloudflare Worker (workers/versus/src) holds the match in its
--     Durable Object and only WRITES these rows (versus_cf_persist); the client (packages/ui/src/versus) gets rounds
--     over the socket, never from these tables.
--   - Duos history + the duo run recording are COPIED at the end of the game: duos_match_history (the Worker's record,
--     or duos_history_backfill once) and duo_runs / duo_run_rounds (versus_ranked_duos__record_run, run inside the
--     ranked finish write). Both outlive this cleanup and are not touched by it.
--   - settle_progression ('versus' and 'spectate') requires a committed round of the match to exist before it awards
--     XP. A claim already settled is answered from the ledger FIRST (deduped), so only a match that was never settled
--     at all within 30 days of its end loses its XP claim (`not_terminal`). The client settles at the end of the game.
--   - versus_records / Previous match stats / the room cards read versus_matches (kept), not the child rows.
--
-- THE "OWNS NOTHING" CHECK IS COMPUTED AT RUN TIME FROM THE CATALOG, so a table added later can never be missed: every
-- uuid / uuid[] column of a public base table that is either (a) a foreign key to auth.users(id), or (b) named like a
-- user reference (%user%, sender, recipient, reporter, blocker, blocked, author_id, from_user, to_user, user_a, user_b,
-- user_lo, user_hi, watched_user, bot_user, host_user, host_user_id, p1_user, p2_user; plus requester, owner, owner_id,
-- actor, players, member%, %_by). Plus storage.objects.owner / owner_id when that table exists. A false match can only
-- KEEP a user. `ops.retention__user_columns()` lists exactly what is scanned.
--
-- SAFETY: SECURITY DEFINER with a pinned search_path; callable by service_role / postgres only. One run at a time (an
-- advisory lock: a second caller gets `busy`). lock_timeout 3 s, so a delete never queues behind a lock; each rule runs
-- in its own sub-transaction, so one rule failing records its error and the others still run. The cron job sets a
-- 10-minute statement_timeout for the whole call. Users are re-checked and locked (`for update skip locked`) at delete.
--
-- DELETED SPACE IS REUSED, IT DOES NOT SHRINK THE REPORTED DATABASE SIZE: Postgres marks the rows dead, autovacuum
-- makes the space reusable for new rows; only a VACUUM FULL (an exclusive lock: a planned, by-hand step) returns it.
--
-- ROLLBACK:
--   select cron.unschedule('ops-retention');
--   drop function if exists ops.retention_run(boolean);
--   drop function if exists ops.retention__rule(text, int, int, boolean);
--   drop function if exists ops.retention__user_columns();
--   drop table if exists ops.retention_rules;

create schema if not exists ops;
revoke all on schema ops from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on schema ops from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on schema ops from authenticated'; end if;
end $$;

-- The ops event log (same definition as 2026-11-07-durable-run-uploads.sql; created here too in case it is not applied).
create table if not exists ops.events (
  id     bigserial primary key,
  at     timestamptz not null default now(),
  source text not null,
  kind   text not null,
  key    text,
  detail jsonb
);
create index if not exists events_at on ops.events (at desc);
revoke all on ops.events from public;

-- ── 1. The rules ───────────────────────────────────────────────────────────────────────────────────────────
create table if not exists ops.retention_rules (
  rule              text primary key,
  enabled           boolean not null default true,
  keep_days         int not null check (keep_days >= 7),
  batch_limit       int not null check (batch_limit between 1 and 50000),
  note              text,
  last_checked_at   timestamptz,          -- the last run of either kind (dry or real)
  last_dry_run      boolean,
  last_candidates   bigint,               -- rows (users for anon_empty_users) that qualified at that run
  last_deleted      bigint,               -- rows deleted at that run (0 on a dry run)
  last_ms           int,
  last_error        text,                 -- null when that run succeeded
  last_deleted_at   timestamptz,          -- the last REAL run
  total_deleted     bigint not null default 0,
  updated_at        timestamptz not null default now()
);
revoke all on ops.retention_rules from public;

insert into ops.retention_rules (rule, enabled, keep_days, batch_limit, note) values
  ('perf_runs',              true, 60, 5000, 'public.perf_runs older than keep_days'),
  ('versus_1v1_leftovers',   true, 30, 5000, 'versus_submissions + versus_rounds of complete versus_matches ended > keep_days ago; matches kept'),
  ('versus_group_leftovers', true, 30, 5000, 'versus_group_submissions + _fights + _rounds of complete versus_group_matches ended > keep_days ago; matches + seats kept'),
  ('anon_empty_users',       true, 30,  500, 'idle anonymous auth.users whose id is in no user-linked public column')
on conflict (rule) do nothing;

-- ── 2. The user-linked columns, from the catalog ──────────────────────────────────────────────────────────
create or replace function ops.retention__user_columns()
returns table (schema_name text, table_name text, column_name text, is_array boolean, why text)
language sql stable security definer set search_path = pg_catalog as $$
  with cols as (
    select ns.nspname::text as s, cl.relname::text as t, a.attname::text as c, a.atttypid = 'uuid[]'::regtype as arr,
      exists (select 1 from pg_constraint k
              where k.contype = 'f' and k.conrelid = cl.oid and k.confrelid = to_regclass('auth.users')
                and array_length(k.conkey, 1) = 1 and k.conkey[1] = a.attnum) as fk,
      (a.attname like '%user%' or a.attname like 'member%' or a.attname like '%\_by'
        or a.attname in ('sender', 'recipient', 'reporter', 'blocker', 'blocked', 'author_id', 'from_user', 'to_user',
          'user_a', 'user_b', 'user_lo', 'user_hi', 'watched_user', 'bot_user', 'host_user', 'host_user_id', 'p1_user',
          'p2_user', 'requester', 'owner', 'owner_id', 'actor', 'players')) as named
    from pg_attribute a
    join pg_class cl on cl.oid = a.attrelid
    join pg_namespace ns on ns.oid = cl.relnamespace
    where ns.nspname = 'public' and cl.relkind in ('r', 'p') and not cl.relispartition
      and a.attnum > 0 and not a.attisdropped and a.atttypid in ('uuid'::regtype, 'uuid[]'::regtype)
  )
  select s, t, c, arr, case when fk then 'fk' else 'name' end from cols where fk or named
  union all
  select 'storage', 'objects', 'owner', false, 'storage'
  where to_regclass('storage.objects') is not null
    and exists (select 1 from pg_attribute where attrelid = to_regclass('storage.objects') and attname = 'owner' and not attisdropped)
  order by 1, 2, 3
$$;

-- ── 3. One rule ────────────────────────────────────────────────────────────────────────────────────────────
-- Returns { candidates, deleted, tables: {name: {candidates, deleted}} } or { skipped } when its tables are missing.
create or replace function ops.retention__rule(p_rule text, p_keep_days int, p_limit int, p_dry_run boolean)
returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, public set lock_timeout = '3s' as $$
declare
  cutoff timestamptz := now() - make_interval(days => p_keep_days);
  tbl record;
  n_cand bigint; n_del bigint;
  tot_cand bigint := 0; tot_del bigint := 0;
  tables jsonb := '{}'::jsonb;
  cand uuid[];
  col record;
  uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if p_rule = 'perf_runs' then
    if to_regclass('public.perf_runs') is null or not exists (select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'perf_runs' and column_name = 'created_at') then
      return jsonb_build_object('skipped', 'public.perf_runs or its created_at does not exist');
    end if;
    select count(*) into tot_cand from public.perf_runs where created_at < cutoff;
    if not p_dry_run then
      delete from public.perf_runs where id in (select p.id from public.perf_runs p where p.created_at < cutoff order by p.created_at limit p_limit);
      get diagnostics tot_del = row_count;
    end if;
    return jsonb_build_object('candidates', tot_cand, 'deleted', tot_del);

  elsif p_rule in ('versus_1v1_leftovers', 'versus_group_leftovers') then
    -- Child tables in delete order (rounds last: settle_progression checks them), each with its primary key.
    for tbl in
      select * from (values
        ('versus_1v1_leftovers',   1, 'versus_submissions',       'versus_matches',       'match_id, round, seat'),
        ('versus_1v1_leftovers',   2, 'versus_rounds',            'versus_matches',       'match_id, round'),
        ('versus_group_leftovers', 1, 'versus_group_submissions', 'versus_group_matches', 'match_id, round, seat'),
        ('versus_group_leftovers', 2, 'versus_group_fights',      'versus_group_matches', 'match_id, round, fight'),
        ('versus_group_leftovers', 3, 'versus_group_rounds',      'versus_group_matches', 'match_id, round')) v(rule, ord, child, parent, pk)
      where v.rule = p_rule order by v.ord
    loop
      if to_regclass('public.' || tbl.child) is null or to_regclass('public.' || tbl.parent) is null then
        tables := tables || jsonb_build_object(tbl.child, jsonb_build_object('skipped', 'missing'));
        continue;
      end if;
      execute format('select count(*) from public.%I c join public.%I m on m.id = c.match_id
                      where m.phase = ''complete'' and m.completed_at is not null and m.completed_at < $1', tbl.child, tbl.parent)
        into n_cand using cutoff;
      n_del := 0;
      if not p_dry_run and n_cand > 0 then
        execute format('delete from public.%1$I where (%3$s) in (
                          select %4$s from public.%1$I c join public.%2$I m on m.id = c.match_id
                          where m.phase = ''complete'' and m.completed_at is not null and m.completed_at < $1 limit $2)',
                       tbl.child, tbl.parent, tbl.pk,
                       (select string_agg('c.' || trim(x), ', ') from unnest(string_to_array(tbl.pk, ',')) x))
          using cutoff, p_limit;
        get diagnostics n_del = row_count;
      end if;
      tot_cand := tot_cand + n_cand; tot_del := tot_del + n_del;
      tables := tables || jsonb_build_object(tbl.child, jsonb_build_object('candidates', n_cand, 'deleted', n_del));
    end loop;
    return jsonb_build_object('candidates', tot_cand, 'deleted', tot_del, 'tables', tables);

  elsif p_rule = 'anon_empty_users' then
    if to_regclass('auth.users') is null then return jsonb_build_object('skipped', 'auth.users does not exist'); end if;
    -- Idle anonymous users, oldest first.
    select coalesce(array_agg(u.id order by coalesce(u.last_sign_in_at, u.created_at), u.id), '{}') into cand
    from auth.users u
    where u.is_anonymous is true
      and coalesce(u.email, '') = '' and coalesce(u.email_change, '') = '' and coalesce(u.phone, '') = ''
      and coalesce(u.last_sign_in_at, u.created_at) < cutoff
      and not exists (select 1 from auth.sessions s where s.user_id = u.id
                      and (s.updated_at >= cutoff or s.refreshed_at >= (cutoff at time zone 'utc')));
    -- Drop every one whose id is in any user-linked column (read from the catalog NOW).
    for col in select * from ops.retention__user_columns() loop
      exit when cardinality(cand) = 0;
      if col.is_array then
        execute format('select coalesce(array_agg(x order by o), ''{}'') from unnest($1) with ordinality q(x, o)
                        where not exists (select 1 from %I.%I t where t.%I @> array[x])', col.schema_name, col.table_name, col.column_name)
          into cand using cand;
      else
        execute format('select coalesce(array_agg(x order by o), ''{}'') from unnest($1) with ordinality q(x, o)
                        where not exists (select 1 from %I.%I t where t.%I = x)', col.schema_name, col.table_name, col.column_name)
          into cand using cand;
      end if;
    end loop;
    if cardinality(cand) > 0 and to_regclass('storage.objects') is not null and exists (select 1 from pg_attribute
         where attrelid = to_regclass('storage.objects') and attname = 'owner_id' and not attisdropped) then
      execute format('select coalesce(array_agg(x order by o), ''{}'') from unnest($1) with ordinality q(x, o)
                      where not exists (select 1 from storage.objects t where t.owner_id ~ %L and lower(t.owner_id)::uuid = x)', uuid_re)
        into cand using cand;
    end if;
    tot_cand := cardinality(cand);
    if not p_dry_run and tot_cand > 0 then
      -- Lock the batch (skip a row someone holds), re-check anonymous + idle on the locked row, delete.
      with batch as (
        select u.id from auth.users u
        where u.id = any(cand[1:p_limit]) and u.is_anonymous is true and coalesce(u.email, '') = ''
          and coalesce(u.last_sign_in_at, u.created_at) < cutoff
        for update skip locked
      )
      delete from auth.users u using batch b
      where u.id = b.id
        and not exists (select 1 from auth.sessions s where s.user_id = u.id
                        and (s.updated_at >= cutoff or s.refreshed_at >= (cutoff at time zone 'utc')));
      get diagnostics tot_del = row_count;
    end if;
    return jsonb_build_object('candidates', tot_cand, 'deleted', tot_del);
  end if;

  return jsonb_build_object('skipped', 'unknown rule');
end $$;

-- ── 4. The run ─────────────────────────────────────────────────────────────────────────────────────────────
create or replace function ops.retention_run(p_dry_run boolean default true)
returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, public set lock_timeout = '3s' as $$
declare
  dry boolean := coalesce(p_dry_run, true);
  r record;
  res jsonb;
  err text;
  t0 timestamptz;
  ms int;
  out_rules jsonb := '{}'::jsonb;
  total bigint := 0;
  failed int := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('ops.retention_run')) then
    return jsonb_build_object('dry_run', dry, 'skipped', 'busy');
  end if;
  for r in select * from ops.retention_rules order by case rule when 'anon_empty_users' then 1 else 0 end, rule loop
    if not r.enabled then
      out_rules := out_rules || jsonb_build_object(r.rule, jsonb_build_object('enabled', false));
      continue;
    end if;
    t0 := clock_timestamp();
    err := null;
    begin
      res := ops.retention__rule(r.rule, r.keep_days, r.batch_limit, dry);
    exception when others then
      err := left(sqlstate || ' ' || sqlerrm, 500);
      res := jsonb_build_object('error', err);
      failed := failed + 1;
    end;
    ms := (extract(epoch from clock_timestamp() - t0) * 1000)::int;
    res := res || jsonb_build_object('enabled', true, 'keep_days', r.keep_days, 'batch_limit', r.batch_limit, 'ms', ms);
    total := total + coalesce((res ->> 'deleted')::bigint, 0);
    update ops.retention_rules set
      last_checked_at = now(), last_dry_run = dry, last_ms = ms, last_error = err,
      last_candidates = (res ->> 'candidates')::bigint,
      last_deleted    = coalesce((res ->> 'deleted')::bigint, 0),
      last_deleted_at = case when dry or err is not null then last_deleted_at else now() end,
      total_deleted   = total_deleted + case when dry then 0 else coalesce((res ->> 'deleted')::bigint, 0) end
    where rule = r.rule;
    out_rules := out_rules || jsonb_build_object(r.rule, res);
  end loop;
  res := jsonb_build_object('dry_run', dry, 'at', now(), 'deleted', total, 'failed', failed, 'rules', out_rules);
  insert into ops.events (source, kind, key, detail)
  values ('retention', case when failed > 0 then 'error' when dry then 'dry_run' else 'run' end, null, res);
  delete from ops.events where source = 'retention' and at < now() - interval '90 days';
  return res;
end $$;

-- ── 5. Who may call it: service_role and postgres only ────────────────────────────────────────────────────
revoke all on function ops.retention__user_columns() from public;
revoke all on function ops.retention__rule(text, int, int, boolean) from public;
revoke all on function ops.retention_run(boolean) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function ops.retention__user_columns() from anon';
    execute 'revoke all on function ops.retention__rule(text, int, int, boolean) from anon';
    execute 'revoke all on function ops.retention_run(boolean) from anon';
    execute 'revoke all on ops.retention_rules from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function ops.retention__user_columns() from authenticated';
    execute 'revoke all on function ops.retention__rule(text, int, int, boolean) from authenticated';
    execute 'revoke all on function ops.retention_run(boolean) from authenticated';
    execute 'revoke all on ops.retention_rules from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant usage on schema ops to service_role';
    execute 'grant execute on function ops.retention_run(boolean) to service_role';
    execute 'grant select, update on ops.retention_rules to service_role';
  end if;
end $$;

-- ── 6. Daily at 03:37 UTC (the health check runs at 06:17) ─────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'ops-retention';
    perform cron.schedule('ops-retention', '37 3 * * *',
      $job$set statement_timeout = '10min'; select ops.retention_run(false)$job$);
  end if;
end;
$$;
