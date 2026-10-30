-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- VERSUS IS CLOUDFLARE ONLY: retire the Supabase Versus host (2026-11-14, chore/retire-supabase-versus).
-- Owner 2026-10-29: "why are we using supabase for versus instead of cloudflare? stop doing that". Rule R-VERSUS-CF-ONLY-01.
-- Run AFTER 2026-11-10-lobby-live-cf.sql, on the live project only (it touches pg_cron). Idempotent.
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- WHEN TO RUN: once the pack WITHOUT the Supabase fallback is live and the old builds have had time to reload (see the
-- PR / docs/versus-cf-cutover.md "Retiring the Supabase host"). Before running, check nothing is still playing here:
--
--   select count(*) from public.versus_matches       where backend = 'supabase' and phase <> 'complete';
--   select count(*) from public.versus_group_matches where backend = 'supabase' and phase <> 'complete';
--
-- Both should be 0 (or only rows untouched for more than 10 minutes, which step 3's last sweep ends as abandoned).
--
-- What this does, and what it deliberately does NOT do:
--   1. THE SWITCH stays (a table + the `versus_host_config()` read), pinned to 'cf' for every mode and unable to say
--      anything else. It is NOT dropped: an older client still reads it, and an older client treats a FAILED read as
--      "every mode on Supabase". Drop it only once no build older than chore/retire-supabase-versus is in use.
--   2. NO NEW SUPABASE ROOMS: `versus_create_room` (both overloads) refuses with `versus_moved`. Only an older client
--      whose Cloudflare create failed ever called it; it now shows that client's generic "Connection problem. Try again."
--      Every other Supabase room / match function is left as it is (a room already open finishes or idles out), and
--      every data table (versus_matches, versus_rounds, versus_group_*, duos_*, versus_ranked_duos_*, versus_events,
--      lobby_live_*) is kept: the Worker's result writer (`versus_cf_persist`) and every history / record screen use them.
--   3. THE SWEEP: `versus_sweep()` only ever ended matches hosted on Supabase (1v1 / Group / Duos filter on
--      backend = 'supabase'; Ranked Duos rows from the Worker are written once, already complete) and pruned
--      `versus_events`, which only the Supabase host wrote (the Worker logs its events to Workers Logs). It cleans no
--      Cloudflare-written row (no claims, parties or presence: those live in the Worker's own objects). So it runs one
--      last time here, the 2-minute `versus-sweep` cron job is unscheduled, and the function is kept (harmless, callable
--      by hand).
--   4. A last prune of `versus_events` older than 14 days (nothing writes new ones).

-- ── 1. The switch: every mode on the Worker, for good ──────────────────────────────────────────────────────
update public.versus_host_config set host = 'cf', updated_at = now(), note = 'Cloudflare only (R-VERSUS-CF-ONLY-01)'
  where host <> 'cf';
alter table public.versus_host_config alter column host set default 'cf';
alter table public.versus_host_config drop constraint if exists versus_host_config_host_check;
alter table public.versus_host_config drop constraint if exists versus_host_config_cf_only;
alter table public.versus_host_config add constraint versus_host_config_cf_only check (host = 'cf');

-- ── 2. No new Supabase rooms ───────────────────────────────────────────────────────────────────────────────
create or replace function public.versus_create_room(p_name text, p_display text, p_profile jsonb, p_set_id text, p_content text, p_protocol int, p_options jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'versus_moved';
end;
$$;

do $$
begin
  -- The pre-Group 6-argument overload (2026-10-13-versus.sql), if it is still on the server.
  if to_regprocedure('public.versus_create_room(text, text, jsonb, text, text, integer)') is not null then
    execute $f$
      create or replace function public.versus_create_room(p_name text, p_display text, p_profile jsonb, p_set_id text, p_content text, p_protocol int)
      returns jsonb language plpgsql security definer set search_path = public as $b$
      begin
        raise exception 'versus_moved';
      end;
      $b$;
    $f$;
  end if;
end;
$$;

-- ── 3. The sweep: one last run, then the cron job goes ─────────────────────────────────────────────────────
select public.versus_sweep();

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('versus-sweep', 'ranked-duos-sweep');
  end if;
end;
$$;

-- ── 4. The last events prune ───────────────────────────────────────────────────────────────────────────────
delete from public.versus_events where at < now() - interval '14 days';
