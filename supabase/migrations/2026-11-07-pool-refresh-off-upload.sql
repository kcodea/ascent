-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- POOL WORK OFF THE UPLOAD: a cheap board insert, a once-a-minute pool refresh, cached histograms, no temp spill
-- (2026-10-28, R-LOBBY-POOL-JOB-01; Supabase cleanup PRs 2.1-2.3)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Apply with `npm run db:apply -- supabase/migrations/2026-11-07-pool-refresh-off-upload.sql --yes` (or paste it into
-- the SQL Editor and then `npm run db:apply -- <this file> --record-only --yes`). Idempotent: safe to re-run. Needs
-- pg_cron (already enabled in production). No Edge Function needs redeploying, no client change.
-- Scope + numbers: docs/design/2026-10-28-supabase-cleanup.md sections 3.1a, 3.2, 4.2.4. Runbook:
-- docs/devlog/2026-10-28-pool-refresh-off-upload.md.
--
-- WHY (owner 2026-10-28: "scope out a massive supabase clean up so that we're running really cleanly across the
-- board"; measured 2026-10-12..28):
--  - A board upload (`insert into boards`) averaged 1.35 s, max 7.7 s against the 8 s statement timeout, because its
--    statement triggers rebuilt the run's `pool_runs` row AND ran `pool_strength_refresh` inside the request. A new
--    run has `strength_at` null, which the "stale after 10 minutes" check reads as -infinity, so EVERY new run's upload
--    did a FULL refresh: 84,191 `pool_runs` updates from 2,399 inserts, a deadlock candidate between two uploads, and
--    an upload that times out is lost (and invisible: failed statements never reach pg_stat_statements).
--  - Both triggers caught every error and only `raise warning`, so a failed pool refresh was invisible.
--  - `pool_runs_sample` spilled its 150-run answer (~3.6 MB) to a temp file on every call (work_mem 2 MB): 13.9 GB of
--    temp writes in 16 days. Measured on production with EXPLAIN ANALYZE (read-only): 930 ms with 1,246 temp blocks
--    at 2 MB, 131 ms and no temp file at 16 MB, same 150 rows.
--  - `board_strength_histogram` grouped every scored board on each of its 7,055 calls (133 ms mean); its answer only
--    changes when boards arrive.
--
-- WHAT:
--  1. `pool_runs_sample` runs with `work_mem = 16MB` (a function-level SET: the answer is unchanged). NOTE: a later
--     `create or replace function public.pool_runs_sample` must repeat `set work_mem = '16MB'` or it drops it
--     (db:drift + boardStrength tests pin it).
--  2. The `boards` triggers only ENQUEUE the touched run keys into `pool_dirty` (one tiny upsert per statement, errors
--     are NOT swallowed). `pool_refresh_dirty()`, run by pg_cron every minute, does exactly what the triggers did, in
--     the same order: `pool_runs_upsert_from` per run key (first-queued first, so new runs get their ids in upload
--     order), then, if any queued statement carried a scored board, `pool_strength_refresh` with the same rule (FULL
--     when any run's stamp is older than 10 minutes or missing, else the scored keys). Pool freshness lag: <= 1 minute.
--     A failure rolls the batch back (the keys stay queued for the next minute, `attempts` + `last_error` count it) and
--     is written to `ops.events`, never only warned.
--  3. `board_strength_hist` / `run_strength_hist` hold the two histograms, rebuilt by the same job; the two RPCs read
--     them (same signature, same rows, same order) instead of grouping on every call.
--  4. `ops.events`: the ops failure log (service role only; Supabase cleanup section 4.3).
--  5. `cron-history-purge` (daily): keeps 7 days of `cron.job_run_details`, which a per-minute job would otherwise grow
--     by ~1,440 rows a day forever.
--
-- SERVED BOARDS ARE UNCHANGED: `pool_runs_sample`'s body is untouched; `pool_runs` rows (ids, eligibility, shape,
-- strengths) after each job run equal what the old triggers left after the same uploads. Proved in
-- packages/sim/src/lobby/poolRefreshJob.db.test.ts (old chain vs old chain + this file, same uploads, same samples).
--
-- ROLLBACK (re-creates the in-upload triggers; the old trigger functions are left in place, unused):
--   select cron.unschedule('pool-refresh');
--   drop trigger if exists pool_dirty_boards_insert on public.boards;
--   drop trigger if exists pool_dirty_boards_update on public.boards;
--   drop trigger if exists pool_dirty_boards_delete on public.boards;
--   create trigger pool_runs_boards_insert after insert on public.boards referencing new table as new_rows for each statement execute function public.pool_runs_after_boards_insert();
--   create trigger pool_runs_boards_delete after delete on public.boards referencing old table as old_rows for each statement execute function public.pool_runs_after_boards_delete();
--   create trigger pool_runs_boards_update after update on public.boards referencing old table as old_rows new table as new_rows for each statement execute function public.pool_runs_after_boards_update();
--   create trigger pool_strength_boards_insert after insert on public.boards referencing new table as new_rows for each statement execute function public.pool_strength_after_boards();
--   create trigger pool_strength_boards_update after update on public.boards referencing new table as new_rows for each statement execute function public.pool_strength_after_boards();
--   select public.pool_refresh_dirty();  -- drain anything still queued
--   (and re-run the two histogram functions from 2026-09-30-board-strength.sql section 4 to read `boards` again)
--
-- Locks: the board-strength migration deadlocked against live pool reads, so this takes both pool tables first.

begin;
lock table public.pool_runs in access exclusive mode;
lock table public.boards in access exclusive mode;

-- ── 1. pool_runs_sample: no temp spill ─────────────────────────────────────────────────────────────────────
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'pool_runs_sample' loop
    execute format('alter function %s set work_mem = %L', f, '16MB');
  end loop;
end $$;

-- ── 2. The ops failure log ─────────────────────────────────────────────────────────────────────────────────
create schema if not exists ops;
revoke all on schema ops from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on schema ops from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on schema ops from authenticated'; end if;
end $$;
create table if not exists ops.events (
  id     bigserial primary key,
  at     timestamptz not null default now(),
  source text not null,   -- who wrote it: 'pool_refresh_dirty', 'client', ...
  kind   text not null,   -- 'error', 'write_failure', ...
  key    text,            -- what it was about (a run key, an upload id), when there is one
  detail jsonb
);
create index if not exists events_at on ops.events (at desc);
revoke all on ops.events from public;

-- ── 3. The queue ───────────────────────────────────────────────────────────────────────────────────────────
-- One row per run key with work pending. `id` = first-queued order (the order new runs get their pool_runs ids in).
-- The job CLAIMS rows by deleting them first, so a key queued again while the job runs (its upload waits on the
-- claimed row, then inserts a fresh one) is processed by the next run, never lost.
create table if not exists public.pool_dirty (
  id         bigserial,
  author     text not null,
  hero_id    text not null,
  seed       bigint not null,
  scored     boolean not null default false,  -- a queued statement carried a board with a strength score
  queued_at  timestamptz not null default now(),
  attempts   int not null default 0,          -- failed job runs while this key was queued
  last_error text,
  primary key (author, hero_id, seed)
);
alter table public.pool_dirty enable row level security;  -- no policy: clients can neither read nor write it
revoke all on public.pool_dirty from public, anon, authenticated;

-- Enqueue the run keys a `boards` statement touched (statement-level: one upsert per upload, not per row).
-- Mirrors the old triggers' key sets: pool rows for every new AND old row; a strength refresh only for new rows that
-- carry a score. SECURITY DEFINER: the uploading player may insert `boards` but never write `pool_dirty`. Errors are
-- raised, not swallowed: this is a plain upsert into a tiny table, and a failure must be seen.
create or replace function public.pool_dirty_after_boards() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    insert into public.pool_dirty as d (author, hero_id, seed, scored)
    select coalesce(n.author, 'anon'), n.hero_id, n.seed, bool_or(n.strength_raw is not null)
    from new_rows n where n.seed is not null and n.hero_id is not null
    group by 1, 2, 3
    on conflict (author, hero_id, seed) do update set scored = d.scored or excluded.scored;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    insert into public.pool_dirty as d (author, hero_id, seed, scored)
    select distinct coalesce(o.author, 'anon'), o.hero_id, o.seed, false
    from old_rows o where o.seed is not null and o.hero_id is not null
    on conflict (author, hero_id, seed) do nothing;
  end if;
  return null;
end $$;

-- ── 4. The histograms, materialized ────────────────────────────────────────────────────────────────────────
create table if not exists public.board_strength_hist (
  strength_ref  text not null,
  strength_wave smallint not null,
  strength_raw  numeric not null,
  n             bigint not null,
  primary key (strength_ref, strength_wave, strength_raw)
);
create table if not exists public.run_strength_hist (
  set_id       text not null,
  strength_avg numeric not null,
  n            bigint not null,
  primary key (set_id, strength_avg)
);
alter table public.board_strength_hist enable row level security;
alter table public.run_strength_hist enable row level security;
revoke all on public.board_strength_hist from public, anon, authenticated;
revoke all on public.run_strength_hist from public, anon, authenticated;

-- Rebuild both from their sources: exactly the GROUP BYs the RPCs used to run per call.
create or replace function public.pool_strength_hist_refresh() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.board_strength_hist;
  insert into public.board_strength_hist (strength_ref, strength_wave, strength_raw, n)
  select b.strength_ref, b.strength_wave, b.strength_raw, count(*)
  from public.boards b
  where b.strength_ref is not null and b.strength_raw is not null and b.strength_wave is not null
  group by 1, 2, 3;
  delete from public.run_strength_hist;
  insert into public.run_strength_hist (set_id, strength_avg, n)
  select r.set_id, r.strength_avg, count(*) from public.pool_runs r
  where r.set_id is not null and r.strength_avg is not null
  group by 1, 2;
end $$;

-- Same signatures, same rows, same order as the 2026-09-30 GROUP BY versions; now a lookup. SECURITY DEFINER because
-- the cache tables are closed to clients (the RPC is the only way in, as before).
create or replace function public.board_strength_histogram(p_ref text) returns table (wave int, raw numeric, n bigint)
language sql stable security definer set search_path = public as $$
  select h.strength_wave::int, h.strength_raw, h.n
  from public.board_strength_hist h
  where h.strength_ref = p_ref
  order by 1, 2
$$;
create or replace function public.run_strength_histogram(p_set text) returns table (avg numeric, n bigint)
language sql stable security definer set search_path = public as $$
  select h.strength_avg, h.n from public.run_strength_hist h
  where h.set_id = p_set
  order by 1
$$;

-- ── 5. The job ─────────────────────────────────────────────────────────────────────────────────────────────
-- Drain the queue: what the old in-upload triggers did, in the same order, once a minute. Returns the number of run
-- keys processed (0 = nothing queued or another run holds the lock; -1 = failed and logged, keys still queued).
create or replace function public.pool_refresh_dirty() returns int
language plpgsql security definer set search_path = public as $$
declare
  ka text[]; kh text[]; ks bigint[]; sa text[]; sh text[]; ss bigint[]; stale boolean; n int;
begin
  if not pg_try_advisory_xact_lock(hashtext('public.pool_refresh_dirty')) then return 0; end if;
  begin
    -- 0. Claim the queue by deleting it (rolled back with everything else on a failure). An upload that re-queues a
    --    claimed key waits for this transaction, then queues a fresh row for the next run: nothing is lost.
    with claimed as (delete from public.pool_dirty returning id, author, hero_id, seed, scored)
    select array_agg(author order by id), array_agg(hero_id order by id), array_agg(seed order by id),
           array_agg(author order by id) filter (where scored), array_agg(hero_id order by id) filter (where scored),
           array_agg(seed order by id) filter (where scored)
      into ka, kh, ks, sa, sh, ss
    from claimed;
    n := coalesce(array_length(ka, 1), 0);
    if n = 0 then return 0; end if;
    -- 1. pool_runs rows, first-queued first (a new run's id order = its upload order, as with the old trigger).
    for i in 1 .. n loop
      perform public.pool_runs_upsert_from(array[ka[i]], array[kh[i]], array[ks[i]]);
    end loop;
    -- 2. Strength, with the old trigger's rule: only when a queued statement carried a score; FULL when any run is
    --    unstamped or stamped more than 10 minutes ago (a new run is unstamped), else just the scored keys.
    if sa is not null then
      select coalesce(min(coalesce(strength_at, '-infinity'::timestamptz)) < now() - interval '10 minutes', false) into stale
      from public.pool_runs;
      if stale then perform public.pool_strength_refresh(null, null, null);
      else perform public.pool_strength_refresh(sa, sh, ss); end if;
    end if;
    -- 3. The histograms the client ranks its own game against.
    perform public.pool_strength_hist_refresh();
  exception when others then
    -- The block rolled back: every claimed key is queued again. Count it and log it where the daily digest reads.
    update public.pool_dirty set attempts = attempts + 1, last_error = sqlerrm;
    insert into ops.events (source, kind, key, detail)
    values ('pool_refresh_dirty', 'error', null,
            jsonb_build_object('error', sqlerrm, 'sqlstate', sqlstate, 'queued', (select count(*) from public.pool_dirty)));
    return -1;
  end;
  return n;
end $$;

revoke all on function public.pool_dirty_after_boards() from public, anon, authenticated;
revoke all on function public.pool_strength_hist_refresh() from public, anon, authenticated;
revoke all on function public.pool_refresh_dirty() from public, anon, authenticated;
grant execute on function public.board_strength_histogram(text) to anon, authenticated;
grant execute on function public.run_strength_histogram(text) to anon, authenticated;

-- ── 6. Swap the triggers ───────────────────────────────────────────────────────────────────────────────────
drop trigger if exists pool_runs_boards_insert on public.boards;
drop trigger if exists pool_runs_boards_delete on public.boards;
drop trigger if exists pool_runs_boards_update on public.boards;
drop trigger if exists pool_strength_boards_insert on public.boards;
drop trigger if exists pool_strength_boards_update on public.boards;
drop trigger if exists pool_dirty_boards_insert on public.boards;
drop trigger if exists pool_dirty_boards_update on public.boards;
drop trigger if exists pool_dirty_boards_delete on public.boards;
create trigger pool_dirty_boards_insert after insert on public.boards
  referencing new table as new_rows for each statement execute function public.pool_dirty_after_boards();
create trigger pool_dirty_boards_update after update on public.boards
  referencing old table as old_rows new table as new_rows for each statement execute function public.pool_dirty_after_boards();
create trigger pool_dirty_boards_delete after delete on public.boards
  referencing old table as old_rows for each statement execute function public.pool_dirty_after_boards();

-- The caches start full (the job keeps them current from here on).
select public.pool_strength_hist_refresh();

commit;

-- ── 7. Schedule (outside the transaction; skipped where pg_cron is absent, e.g. the PGlite tests) ────────────
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('pool-refresh', 'cron-history-purge');
    perform cron.schedule('pool-refresh', '* * * * *', 'select public.pool_refresh_dirty()');
    perform cron.schedule('cron-history-purge', '17 4 * * *',
      $q$delete from cron.job_run_details where end_time < now() - interval '7 days'$q$);
  else
    raise notice 'pg_cron is not installed: schedule public.pool_refresh_dirty() every minute by hand';
  end if;
end $$;
