-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- LIVE GAMES ARE CLOUDFLARE ONLY: retire the Supabase live-game path (2026-11-17, chore/cf-only-live-spectate).
-- Owner 2026-10-30: "Remove fallback for spectating. I want us to make cloudflare work as our source for live information
-- and action like spectating". Rule R-LIVE-CF-ONLY-01. Run AFTER 2026-11-13-lobby-live-status.sql and
-- 2026-11-14-retire-supabase-versus.sql. Idempotent; every overload is guarded, so a server missing one is fine.
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- WHEN TO RUN: once the first pack built from chore/cf-only-live-spectate is live AND old tabs have had time to reload
-- (about 24 hours; index.html is served no-cache). Before running, check no lobby game is still on the Supabase path:
--
--   select count(*) from public.lobby_live_games
--     where live_host is null and game_id !~ '^(versus|duos):' and last_seen_at > now() - interval '2 minutes';
--
-- It should be 0 (only an old tab whose Worker did not answer within 6 s ever wrote such a row).
--
-- What this does:
--   1. THE PLAYER'S SUPABASE WRITES are refused with `live_moved`: `lobby_live_heartbeat` (every overload),
--      `lobby_live_end`, `lobby_live_publish_frame`, and the retired Supabase Ranked Duos `lobby_live_duos_heartbeat`.
--      Only an old client calls them (as its fallback): its catch drops the error, so its game is simply not listed.
--   2. THE SUPABASE WATCH answers a listed game with `other_host`, always (every listed lobby game is on a Worker now),
--      and writes no watcher row. An old client's friend Watch already handles `other_host`: it reads the row and joins
--      the game on its Worker, so that keeps working. An unlisted game answers `no_game` as before. `lobby_live_watchers`
--      answers no rows; `lobby_live_unwatch` does nothing.
--   3. CLEANUP of transient rows only: Supabase-hosted lobby listing rows, every `lobby_live_frames` keyframe and every
--      `lobby_live_watchers` row (nothing writes either any more). The TABLES are kept: `lobby_live_games` is the Live
--      Games listing the Worker writes (`lobby_live_cf`, `versus_cf_live`) and the client reads.
--
-- What it does NOT touch: `lobby_live_cf`, `versus_cf_live`, `spectate_cf_beat` (the Worker's writers), `spectate_beat`
-- (still the XP record's client path for any Versus watch the room does not record), the listing read policy, and the
-- `lobby_live__versus_trg` triggers (they act only on `backend = 'supabase'` matches, which can no longer be created).
-- No cron job belongs to the live path (stale rows are pruned inside the writers and hidden by the read policy).

-- ── 1. The player's Supabase writes ────────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.lobby_live_heartbeat(text, text, text, jsonb, integer, text)') is not null then
    execute $f$
      create or replace function public.lobby_live_heartbeat(p_game text, p_name text, p_hero text, p_cosmetics jsonb, p_round int, p_phase text) returns int language plpgsql security definer set search_path = public as $b$
      begin
        raise exception 'live_moved';
      end;
      $b$;
    $f$;
  end if;
  if to_regprocedure('public.lobby_live_heartbeat(text, text, text, jsonb, integer, text, text)') is not null then
    execute $f$
      create or replace function public.lobby_live_heartbeat(p_game text, p_name text, p_hero text, p_cosmetics jsonb, p_round int, p_phase text, p_mode text) returns int language plpgsql security definer set search_path = public as $b$
      begin
        raise exception 'live_moved';
      end;
      $b$;
    $f$;
  end if;
  if to_regprocedure('public.lobby_live_heartbeat(text, text, text, jsonb, integer, text, text, jsonb)') is not null then
    execute $f$
      create or replace function public.lobby_live_heartbeat(p_game text, p_name text, p_hero text, p_cosmetics jsonb, p_round int, p_phase text, p_mode text, p_status jsonb) returns int language plpgsql security definer set search_path = public as $b$
      begin
        raise exception 'live_moved';
      end;
      $b$;
    $f$;
  end if;
  if to_regprocedure('public.lobby_live_end(text, integer)') is not null then
    execute $f$
      create or replace function public.lobby_live_end(p_game text, p_placement int) returns void language plpgsql security definer set search_path = public as $b$
      begin
        raise exception 'live_moved';
      end;
      $b$;
    $f$;
  end if;
  if to_regprocedure('public.lobby_live_publish_frame(text, bigint, integer, jsonb)') is not null then
    execute $f$
      create or replace function public.lobby_live_publish_frame(p_game text, p_seq bigint, p_round int, p_frame jsonb) returns void language plpgsql security definer set search_path = public as $b$
      begin
        raise exception 'live_moved';
      end;
      $b$;
    $f$;
  end if;
  if to_regprocedure('public.lobby_live_duos_heartbeat(uuid, integer, text)') is not null then
    execute $f$
      create or replace function public.lobby_live_duos_heartbeat(p_room uuid, p_round int, p_phase text) returns int language plpgsql security definer set search_path = public as $b$
      begin
        raise exception 'live_moved';
      end;
      $b$;
    $f$;
  end if;
end;
$$;

-- ── 2. The Supabase watch points at the Worker ─────────────────────────────────────────────────────────────
-- A listed game: fresh by its last write (an old row) or by `live_until` (a Worker row, written every 2 minutes).
create or replace function public.lobby_live_watch(p_game text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if not exists (select 1 from public.lobby_live_games g where g.game_id = p_game
      and (g.last_seen_at > now() - interval '60 seconds' or g.live_until > now())) then
    raise exception 'no_game';
  end if;
  raise exception 'other_host';
end;
$$;
revoke all on function public.lobby_live_watch(text) from public, anon;
grant execute on function public.lobby_live_watch(text) to authenticated;

create or replace function public.lobby_live_watch_as(p_game text, p_name text, p_profile jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if not exists (select 1 from public.lobby_live_games g where g.game_id = p_game
      and (g.last_seen_at > now() - interval '60 seconds' or g.live_until > now())) then
    raise exception 'no_game';
  end if;
  raise exception 'other_host';
end;
$$;
revoke all on function public.lobby_live_watch_as(text, text, jsonb) from public, anon;
grant execute on function public.lobby_live_watch_as(text, text, jsonb) to authenticated;

do $$
begin
  if to_regprocedure('public.lobby_live_watchers(text)') is not null then
    -- Same return type as before (a jsonb array), always empty.
    execute $f$
      create or replace function public.lobby_live_watchers(p_game text) returns jsonb
      language sql security definer set search_path = public as $b$ select '[]'::jsonb $b$;
    $f$;
  end if;
  if to_regprocedure('public.lobby_live_unwatch(text)') is not null then
    execute $f$
      create or replace function public.lobby_live_unwatch(p_game text) returns void
      language sql security definer set search_path = public as $b$ select $b$;
    $f$;
  end if;
end;
$$;

-- ── 3. Transient rows only (the tables stay) ───────────────────────────────────────────────────────────────
delete from public.lobby_live_games where live_host is null and game_id !~ '^(versus|duos):';
delete from public.lobby_live_frames;
delete from public.lobby_live_watchers;
