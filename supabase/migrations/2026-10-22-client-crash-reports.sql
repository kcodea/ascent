-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- CLIENT CRASH REPORTS  (2026-10-22, R-TOUCH-CRASH-REPORT-01)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run (or `supabase db query --linked -f` this file). Independent of every
-- other file. Idempotent: safe to re-run. The same block is appended to schema.sql; keep the two identical.
-- Devlog: docs/devlog/2026-10-22-phone-crash-telemetry.md.
--
-- WHY (owner 2026-10-22: "I still can't even play it because of the crashing, but I want to make this mobile experience
-- flawless end to end"): an iPhone that dies for memory leaves no error anywhere we can see, and the owner has no Mac
-- for Safari's Web Inspector. The page's crash log (packages/ui/src/crashLog.ts) already finds a crashed session on the
-- next load; packages/ui/src/crashReport.ts now sends each one here, once.
--
-- WHAT
--  - One row per crashed session: a few columns worth filtering (last_step, ua, standalone, build) and the whole
--    breadcrumb trail + device facts in `payload`.
--  - INSERT ONLY for clients (anon and authenticated, a guest account included). No select, update or delete: rows are
--    read with the service role (the CLI / SQL Editor). `user_id` defaults to the caller and may only be the caller.
--  - Size caps so the table cannot become a blob store: payload under 64 KB, short text columns.
--  - Until this runs the client's insert fails quietly and retries on a later load (at most 3 tries per crash).

begin;

create table if not exists public.client_crash_reports (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  session_key text not null check (char_length(session_key) <= 64),
  last_step text not null check (char_length(last_step) <= 200),
  ua text not null check (char_length(ua) <= 400),
  standalone boolean not null default false,
  build text not null check (char_length(build) <= 120),
  payload jsonb not null check (pg_column_size(payload) < 65536)
);

create index if not exists client_crash_reports_created on public.client_crash_reports(created_at desc);
create index if not exists client_crash_reports_build   on public.client_crash_reports(build, created_at desc);

alter table public.client_crash_reports enable row level security;

revoke all on table public.client_crash_reports from public, anon, authenticated;
grant insert (user_id, session_key, last_step, ua, standalone, build, payload)
  on table public.client_crash_reports to anon, authenticated;

drop policy if exists "insert crash reports" on public.client_crash_reports;
create policy "insert crash reports"
  on public.client_crash_reports for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());

commit;

-- Tell the REST API about the new table.
notify pgrst, 'reload schema';
