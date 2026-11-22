-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- CLIENT CRASH REPORTS ON DESKTOP + WEB  (2026-11-22, R-CRASH-REPORT-DESKTOP-01)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run (or `supabase db query --linked -f` this file) AFTER
-- 2026-10-22-client-crash-reports.sql. Idempotent: safe to re-run. Not appended to schema.sql (same reason as the
-- table's own file). Devlog: docs/devlog/2026-11-22-desktop-crash-reports.md.
--
-- WHY (owner 2026-11-22, ahead of the Steam invite-only playtest on the desktop app): crash and error reports from the
-- desktop exe and desktop browsers, not only phones. The client (packages/ui/src/errorReport.ts) now also sends uncaught
-- errors, unhandled rejections, ErrorBoundary catches, crashed sessions and the desktop shell's crash files
-- (renderer gone / OOM / killed, GPU process gone, hangs, main-process exceptions) to this same table.
--
-- WHAT
--  1. Three GENERATED columns, read from the payload the client already sends, so filtering needs no jsonb digging and
--     the client never has to know whether this file has run (a client that ships first keeps working, and so does an
--     older client after it):
--       platform     'desktop' | 'web' | 'phone' (payload.platform; older phone rows: payload.device.lite)
--       kind         'error' | 'rejection' | 'render' | 'crash-session' | 'renderer-gone' | 'child-gone' |
--                    'renderer-hang' | 'main-exception' | 'main-rejection' | 'perf' (older rows: 'crash-session')
--       app_version  payload.app.version (the web build's version; the exe's own is payload.detail.exeVersion)
--  2. A RATE LIMIT (a before-insert trigger): at most 100 rows a day per signed-in user, and at most 300 an hour across
--     all rows with no user (the publishable-key REST fallback). The client caps itself far lower (5 errors a session,
--     20 reports a day per device); this only stops a runaway or hostile client from filling the table.
--  3. Grants and RLS are UNCHANGED: clients may only insert (column grant), `user_id` may only be the caller or null,
--     no client reads; the payload stays under 64 KB. Generated columns cannot be written by anyone.
--
-- READ THEM (service role: the CLI / SQL Editor):
--   select created_at, platform, kind, app_version, last_step, payload->'error'->>'message' as message
--     from public.client_crash_reports where kind <> 'perf' order by created_at desc limit 50;
--
-- Rollback:
--   drop trigger if exists client_crash_reports_rate_limit on public.client_crash_reports;
--   drop function if exists public.client_crash_reports_rate_limit();
--   alter table public.client_crash_reports drop column if exists platform, drop column if exists kind,
--     drop column if exists app_version;

begin;

alter table public.client_crash_reports
  add column if not exists platform text generated always as (
    case
      when payload->>'platform' in ('desktop', 'web', 'phone') then payload->>'platform'
      when payload->'device'->>'lite' = 'true' then 'phone'
      else null
    end
  ) stored,
  add column if not exists kind text generated always as (left(coalesce(payload->>'kind', 'crash-session'), 32)) stored,
  add column if not exists app_version text generated always as (left(payload->'app'->>'version', 40)) stored;

create index if not exists client_crash_reports_kind on public.client_crash_reports(platform, kind, created_at desc);
create index if not exists client_crash_reports_user_day on public.client_crash_reports(user_id, created_at desc) where user_id is not null;
create index if not exists client_crash_reports_anon_hour on public.client_crash_reports(created_at desc) where user_id is null;

create or replace function public.client_crash_reports_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n integer;
begin
  if new.user_id is not null then
    select count(*) into n from public.client_crash_reports
      where user_id = new.user_id and created_at > now() - interval '1 day';
    if n >= 100 then
      raise exception 'crash report limit reached' using errcode = 'P0001';
    end if;
  else
    select count(*) into n from public.client_crash_reports
      where user_id is null and created_at > now() - interval '1 hour';
    if n >= 300 then
      raise exception 'crash report limit reached' using errcode = 'P0001';
    end if;
  end if;
  return new;
end
$$;

revoke all on function public.client_crash_reports_rate_limit() from public, anon, authenticated;

drop trigger if exists client_crash_reports_rate_limit on public.client_crash_reports;
create trigger client_crash_reports_rate_limit
  before insert on public.client_crash_reports
  for each row execute function public.client_crash_reports_rate_limit();

commit;

-- Tell the REST API about the new columns.
notify pgrst, 'reload schema';
