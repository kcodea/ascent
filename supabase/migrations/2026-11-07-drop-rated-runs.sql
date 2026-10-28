-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- DROP `rated_runs`: the C3 rating ledger nothing has read or written since medals (2026-10-28, cleanup 2.6)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Apply with `npm run db:apply -- supabase/migrations/2026-11-07-drop-rated-runs.sql --yes`. Idempotent: a re-run
-- (or a database that never had the table) is a no-op. No Edge Function needs redeploying. Scope:
-- docs/design/2026-10-28-supabase-cleanup.md section 2 (RETIRE-now) and PR 2.6.
--
-- WHY (owner 2026-10-28: "scope out a massive supabase clean up so that we're running really cleanly across the
-- board"). `rated_runs (user_id, run_id)` was the C3 dedupe + rate-limit ledger of the first `submit-rating`
-- function. The medal rank (2026-09-20) replaced it with `rank_results`, settled by `settle_rank`. PROOF IT IS UNUSED
-- (read-only, production, 2026-10-28):
--  - 0 rows; 0 inserts / updates / deletes since the 2026-10-12 stats reset;
--  - no function body mentions it (`pg_proc.prosrc`), no view, trigger, policy, publication or cron job uses it, and
--    no other table references it (its only constraints are its own primary key and its FK to auth.users);
--  - its only index scans are the FK checks run when an auth user is deleted (last 2026-10-22), and the only
--    statement naming it is an ad-hoc admin audit;
--  - `git grep rated_runs` finds no reference in supabase/functions, packages, apps, workers or scripts (only
--    schema.sql's C3 history block and old docs).
-- It also held the Supabase default grants (anon/authenticated INSERT ... TRUNCATE) behind RLS with no policy: one
-- less table for the security pass to close.
--
-- GUARD: refuses to drop a table that holds rows (export them first).
-- ROLLBACK (the C3 definition from schema.sql):
--   create table if not exists public.rated_runs (
--     user_id uuid not null references auth.users(id) on delete cascade, run_id text not null,
--     created_at timestamptz not null default now(), primary key (user_id, run_id));
--   alter table public.rated_runs enable row level security;
--   create index if not exists rated_runs_user_time on public.rated_runs (user_id, created_at desc);

begin;

do $$
declare n bigint;
begin
  if to_regclass('public.rated_runs') is null then return; end if;
  execute 'select count(*) from public.rated_runs' into n;
  if n > 0 then
    raise exception 'rated_runs holds % rows: export them before dropping it (pg_dump -t public.rated_runs)', n;
  end if;
end $$;

drop table if exists public.rated_runs;

commit;
