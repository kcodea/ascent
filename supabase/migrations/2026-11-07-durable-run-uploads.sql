-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- DURABLE RUN UPLOADS: idempotency keys for boards / run_history / run_telemetry, and a write-failure log the client
-- reports to  (2026-10-28, R-NET-OUTBOX-01; Supabase cleanup PRs 2.4 + 2.5)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Apply with `npm run db:apply -- supabase/migrations/2026-11-07-durable-run-uploads.sql --yes`. Idempotent: safe to
-- re-run. Additive only. No Edge Function needs redeploying. ORDER: either way round with the client. A client from
-- before this change keeps inserting exactly as before (a duplicate it re-sends is now refused by the unique index,
-- which that client already ignores). The new client sends `on_conflict=user_id,upload_key`; until this file is
-- applied it gets "no unique constraint" / "unknown column" and falls back, for the session, to the plain insert.
-- Scope: docs/design/2026-10-28-supabase-cleanup.md section 4. Runbook: docs/devlog/2026-10-28-durable-run-uploads.md.
--
-- WHY (owner 2026-10-28: "scope out a massive supabase clean up so that we're running really cleanly across the
-- board"): the run-end writes were fire-and-forget with no key, so a retry could double a row and a failure lost it.
-- The client now keeps each write in a durable outbox until the server takes it; these keys make every retry safe:
--  - `boards.upload_key`        = the board's client id (`snapshot->>'id'`), GENERATED, so every client (old ones too)
--                                 is covered; checked on production 2026-10-28: every board has one, no account
--                                 holds the same id twice.
--  - `run_history.upload_key`   = `entry->>'seed' || '|' || entry->>'at'` (the run's seed + finish time), GENERATED;
--                                 checked: every row has both, no duplicate.
--  - `run_telemetry.upload_key` = sent by the client (the same seed|finish time); null on older rows.
-- Each is UNIQUE together with `user_id` (NULLs never collide, so legacy rows without a key are untouched). PostgREST
-- can target a plain unique index on columns (not an expression), which is why the keys are columns.
--
-- And the failure log: `ops.events` (created by 2026-11-07-pool-refresh-off-upload.sql too; same definition, so the
-- two files apply in either order) + `report_write_failure`, which the outbox calls when the server REJECTS a write
-- for good, when a write has failed 5 times and is still retrying, or when the outbox overflows. Rate-limited per
-- account; service role reads it. The daily digest query is in the runbook.
--
-- ROLLBACK: drop the three unique indexes and columns (`alter table ... drop column upload_key`), `drop function
-- public.report_write_failure(text, text, text, jsonb)`. ops.events may stay (the pool job writes it too).
--
-- The generated columns rewrite `boards` (10 MB) and `run_history` (2.4 MB) once, under a brief exclusive lock.

begin;

-- ── 1. Idempotency keys ────────────────────────────────────────────────────────────────────────────────────
alter table public.boards add column if not exists upload_key text generated always as (snapshot ->> 'id') stored;
create unique index if not exists boards_user_upload_key on public.boards (user_id, upload_key);

alter table public.run_history add column if not exists upload_key text
  generated always as ((entry ->> 'seed') || '|' || (entry ->> 'at')) stored;
create unique index if not exists run_history_user_upload_key on public.run_history (user_id, upload_key);

alter table public.run_telemetry add column if not exists upload_key text;
create unique index if not exists run_telemetry_user_upload_key on public.run_telemetry (user_id, upload_key);

-- ── 2. The failure log ─────────────────────────────────────────────────────────────────────────────────────
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
create index if not exists events_client_user on ops.events ((detail ->> 'user'), at desc) where source = 'client';

-- A client reports a write it could not land. SECURITY DEFINER (the log is closed to clients); a session is required;
-- at most 50 reports per account per day (beyond that, silently ignored: the log must not become an egress or
-- storage lever); every text is cut short.
create or replace function public.report_write_failure(p_kind text, p_key text, p_error text, p_detail jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return; end if;
  if (select count(*) from ops.events e
      where e.source = 'client' and e.detail ->> 'user' = uid::text and e.at > now() - interval '1 day') >= 50 then
    return;
  end if;
  insert into ops.events (source, kind, key, detail)
  values ('client', 'write_failure', left(p_key, 200),
          jsonb_build_object('user', uid, 'write', left(p_kind, 40), 'error', left(p_error, 500))
          || case when p_detail is not null and jsonb_typeof(p_detail) = 'object' and length(p_detail::text) <= 2000
                  then jsonb_build_object('detail', p_detail) else '{}'::jsonb end);
end $$;
revoke all on function public.report_write_failure(text, text, text, jsonb) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.report_write_failure(text, text, text, jsonb) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.report_write_failure(text, text, text, jsonb) to authenticated';
  end if;
end $$;

commit;
