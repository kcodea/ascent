-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- LIVE GAMES ON CLOUDFLARE: lobby + Practice spectating on the Worker, and spectator XP for every Cloudflare watch
-- (2026-11-10, feat/cf-live-spectate). Run AFTER 2026-11-08-versus-cf-live-games-invites.sql (needs `live_until`,
-- `mode` and the 7-argument `lobby_live_heartbeat`), 2026-11-05-versus-host-config.sql (the switch),
-- 2026-11-04-versus-cf-writer.sql (`versus_cf_writer_keys`) and 2026-10-24-versus-spectator-xp.sql (the watch record).
-- Idempotent. No secret in here: both Cloudflare pieces reuse the Worker's writer key hashes.
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- OWNER (2026-10-29): "build the cloudflare spectating for lobby and practice too so it's all uniform". R-LIVE-CF-01,
-- R-LIVE-CF-XP-01; runbook docs/versus-cf-cutover.md ("lobby_live").
--
-- 1. THE SWITCH gains `lobby_live` (default 'supabase'): where a NEW live lobby / Practice game publishes its spectator
--    stream. A game keeps its host for life (its Live Games row says where: `live_host`), so a flip never moves a game
--    already being watched. Flip: `update public.versus_host_config set host = 'cf' where mode = 'lobby_live';`
-- 2. `lobby_live_games.live_host`: null = the Supabase path (heartbeat, broadcast channel, `lobby_live_frames`);
--    'cf:<content revision>' = the game's Durable Object on the Worker that carries that engine. Written only by
--    `lobby_live_cf`; `lobby_live_heartbeat` clears it (a client that fell back to Supabase owns its row again).
-- 3. `lobby_live_cf(p_key, p_game, p_row)`: the Worker's ONE write path for a lobby game's row (key-gated, never the
--    service role), event-driven like the Cloudflare Versus rows: written when the listing changes plus a 2-minute
--    keep-alive, visible 4 minutes past the last write (`live_until`), removed at the end (row null). It can never take
--    over another account's row, nor touch a Supabase-hosted one on removal. No frame ever reaches Postgres.
-- 4. `lobby_live_watch` / `lobby_live_watch_as` refuse a Cloudflare-hosted game (`other_host`): an older client would
--    otherwise sit on a Supabase channel the game never publishes to.
-- 5. `spectate_cf_beat(p_key, p_beats)`: the watch record for a Cloudflare watch (a Versus room's stands or a live
--    game's), written by the object the spectator is connected to. Each beat runs `spectate_beat`'s own accrual rule
--    (time accrues only between beats at most 45 s apart on the ONE game that spectator beat last), so
--    `settle_progression`'s XP rules and caps apply unchanged. Closes the runbook's "no spectator XP on a Cloudflare
--    match" gap: the object, not `versus_members` / `lobby_live_watchers`, is the witness.

create extension if not exists pgcrypto with schema extensions;

-- ── 1. The switch ──────────────────────────────────────────────────────────────────────────────────────────
alter table public.versus_host_config drop constraint if exists versus_host_config_mode_check;
alter table public.versus_host_config add constraint versus_host_config_mode_check
  check (mode in ('duel', 'group', 'duos', 'ranked_duos', 'lobby_live'));
insert into public.versus_host_config (mode, host) values ('lobby_live', 'supabase') on conflict (mode) do nothing;

-- ── 2. Where a live game is hosted ─────────────────────────────────────────────────────────────────────────
alter table public.lobby_live_games add column if not exists live_host text;
alter table public.lobby_live_games drop constraint if exists lobby_live_games_live_host_check;
alter table public.lobby_live_games add constraint lobby_live_games_live_host_check
  check (live_host is null or live_host ~ '^cf:[0-9A-Za-z._-]{1,64}$');

-- ── 3. The Worker's row writer ─────────────────────────────────────────────────────────────────────────────
create or replace function public.lobby_live_cf(p_key text, p_game text, p_row jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_phase text;
  v_mode text;
  v_host text;
  prof public.profiles;
  cur public.lobby_live_games;
begin
  if p_key is null or not exists (select 1 from public.versus_cf_writer_keys
      where key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex')) then
    raise exception 'not_authorized';
  end if;
  if p_game is null or p_game !~ '^[!-~]{1,80}$' then raise exception 'bad_game'; end if;
  -- Removal (the game ended or was abandoned): only a Cloudflare-hosted row.
  if p_row is null or jsonb_typeof(p_row) <> 'object' then
    delete from public.lobby_live_games where game_id = p_game and live_host is not null;
    return jsonb_build_object('ok', true, 'removed', true);
  end if;
  if octet_length(p_row::text) > 8192 then raise exception 'bad_row'; end if;
  begin v_user := (p_row->>'user')::uuid; exception when others then raise exception 'bad_row'; end;
  if v_user is null or not exists (select 1 from auth.users u where u.id = v_user) then raise exception 'bad_row'; end if;
  v_phase := p_row->>'phase';
  if v_phase is null or v_phase not in ('hero', 'shop', 'combat') then raise exception 'bad_phase'; end if;
  v_mode := case when p_row->>'mode' in ('casual', 'practice') then p_row->>'mode' end;
  v_host := p_row->>'host';
  if v_host is null or v_host !~ '^cf:[0-9A-Za-z._-]{1,64}$' then raise exception 'bad_row'; end if;
  select * into cur from public.lobby_live_games where game_id = p_game;
  if found and cur.user_id <> v_user then raise exception 'not_owner'; end if;
  delete from public.lobby_live_games where last_seen_at < now() - interval '10 minutes' and (live_until is null or live_until < now());
  -- One live game per player (as the heartbeat): the player's other row goes (its watchers / frames by cascade).
  delete from public.lobby_live_games where user_id = v_user and game_id <> p_game;
  select * into prof from public.profiles where user_id = v_user;
  insert into public.lobby_live_games (game_id, user_id, display_name, hero_id, cosmetics, division_index, rank_points, rating,
      round, phase, spectators, live_until, mode, live_host)
    values (p_game, v_user, left(coalesce(nullif(trim(p_row->>'name'), ''), 'Player'), 40),
      left(coalesce(nullif(trim(p_row->>'hero'), ''), 'warden'), 60),
      case when jsonb_typeof(p_row->'cosmetics') = 'object' and octet_length((p_row->'cosmetics')::text) <= 4096 then p_row->'cosmetics' end,
      coalesce(prof.rank_division, 0), coalesce(prof.rank_points, 0), coalesce(prof.rating, 0),
      greatest(1, least(200, coalesce((p_row->>'round')::int, 1))), v_phase,
      greatest(0, least(99, coalesce((p_row->>'spectators')::int, 0))), now() + interval '4 minutes', v_mode, v_host)
    on conflict (game_id) do update set
      display_name = excluded.display_name, hero_id = excluded.hero_id, cosmetics = excluded.cosmetics,
      division_index = excluded.division_index, rank_points = excluded.rank_points, rating = excluded.rating,
      round = excluded.round, phase = excluded.phase, spectators = excluded.spectators, last_seen_at = now(),
      live_until = excluded.live_until, mode = excluded.mode, live_host = excluded.live_host
    where public.lobby_live_games.user_id = v_user;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.lobby_live_cf(text, text, jsonb) from public;
grant execute on function public.lobby_live_cf(text, text, jsonb) to anon, authenticated;

-- The heartbeat (the Supabase path): as 2026-11-08, and it takes the row back from Cloudflare (`live_host` null, no
-- `live_until`), so a client that fell back to Supabase mid-game is listed and watched on Supabase from then on.
create or replace function public.lobby_live_heartbeat(
  p_game text, p_name text, p_hero text, p_cosmetics jsonb, p_round int, p_phase text, p_mode text default null
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  prof public.profiles;
  v_watchers int;
  v_mode text := case when p_mode in ('casual', 'practice') then p_mode end;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if p_phase not in ('hero', 'shop', 'combat', 'end') then raise exception 'bad_phase'; end if;
  delete from public.lobby_live_games where last_seen_at < now() - interval '10 minutes' and (live_until is null or live_until < now());
  delete from public.lobby_live_watchers where last_seen_at < now() - interval '2 minutes';
  select * into prof from public.profiles where user_id = v_uid;
  delete from public.lobby_live_games where user_id = v_uid and game_id <> p_game;
  select count(*) into v_watchers from public.lobby_live_watchers
    where game_id = p_game and last_seen_at > now() - interval '30 seconds';
  insert into public.lobby_live_games (game_id, user_id, display_name, hero_id, cosmetics, division_index, rank_points, rating, round, phase, spectators, mode)
    values (p_game, v_uid, left(coalesce(nullif(trim(p_name), ''), 'Player'), 40), p_hero, p_cosmetics,
            coalesce(prof.rank_division, 0), coalesce(prof.rank_points, 0), coalesce(prof.rating, 0),
            greatest(1, least(200, p_round)), p_phase, v_watchers, v_mode)
    on conflict (game_id) do update set
      display_name = excluded.display_name, hero_id = excluded.hero_id, cosmetics = excluded.cosmetics,
      division_index = excluded.division_index, rank_points = excluded.rank_points, rating = excluded.rating,
      round = excluded.round, phase = excluded.phase, spectators = excluded.spectators, last_seen_at = now(), mode = excluded.mode,
      live_host = null, live_until = null
    where public.lobby_live_games.user_id = v_uid;
  return v_watchers;
end;
$$;
revoke all on function public.lobby_live_heartbeat(text, text, text, jsonb, int, text, text) from public, anon;
grant execute on function public.lobby_live_heartbeat(text, text, text, jsonb, int, text, text) to authenticated;

-- ── 4. The Supabase watch refuses a Cloudflare-hosted game ────────────────────────────────────────────────
create or replace function public.lobby_live_watch(p_game text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  g public.lobby_live_games;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  select * into g from public.lobby_live_games where game_id = p_game and last_seen_at > now() - interval '60 seconds';
  if not found then raise exception 'no_game'; end if;
  if g.live_host is not null then raise exception 'other_host'; end if;
  if g.user_id = v_uid then raise exception 'own_game'; end if;
  if not exists (select 1 from public.lobby_live_watchers where game_id = p_game and user_id = v_uid)
     and (select count(*) from public.lobby_live_watchers where game_id = p_game and last_seen_at > now() - interval '30 seconds') >= 20 then
    raise exception 'spectators_full';
  end if;
  insert into public.lobby_live_watchers (game_id, user_id) values (p_game, v_uid)
    on conflict (game_id, user_id) do update set last_seen_at = now();
  return to_jsonb(g) - 'user_id';
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
declare
  v_uid uuid := auth.uid();
  g public.lobby_live_games;
  v_name text := left(coalesce(trim(p_name), ''), 40);
  v_profile jsonb := case when p_profile is null or jsonb_typeof(p_profile) <> 'object' or octet_length(p_profile::text) > 4096
                          then '{}'::jsonb else p_profile end;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  select * into g from public.lobby_live_games where game_id = p_game and last_seen_at > now() - interval '60 seconds';
  if not found then raise exception 'no_game'; end if;
  if g.live_host is not null then raise exception 'other_host'; end if;
  if g.user_id = v_uid then raise exception 'own_game'; end if;
  if not exists (select 1 from public.lobby_live_watchers where game_id = p_game and user_id = v_uid)
     and (select count(*) from public.lobby_live_watchers where game_id = p_game and last_seen_at > now() - interval '30 seconds') >= 20 then
    raise exception 'spectators_full';
  end if;
  insert into public.lobby_live_watchers (game_id, user_id, display_name, profile) values (p_game, v_uid, v_name, v_profile)
    on conflict (game_id, user_id) do update set last_seen_at = now(), display_name = excluded.display_name, profile = excluded.profile;
  return to_jsonb(g) - 'user_id';
end;
$$;
revoke all on function public.lobby_live_watch_as(text, text, jsonb) from public, anon;
grant execute on function public.lobby_live_watch_as(text, text, jsonb) to authenticated;

-- ── 5. The watch record for a Cloudflare watch ─────────────────────────────────────────────────────────────
-- p_beats: a JSON array (at most 64) of { user, kind ('lobby' | 'versus' | 'group'), target, watched_user, started_at,
-- ended }, every spectator an object has in its stands right now (or who just left). Each is `spectate_beat` for that
-- user at now(): same target checks, same 45 s continuity rule, same one-game-at-a-time presence. A malformed beat is
-- skipped, never the batch. Returns { ok, recorded }.
create or replace function public.spectate_cf_beat(p_key text, p_beats jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_gap     constant interval := interval '45 seconds';
  c_keep    constant interval := interval '7 days';
  v_now     timestamptz := now();
  b         jsonb;
  v_uid     uuid;
  v_kind    text;
  v_target  text;
  v_watched uuid;
  v_started timestamptz;
  v_ended   boolean;
  v_run     text;
  v_pres    public.spectate_presence%rowtype;
  v_add     bigint;
  v_n       int := 0;
begin
  if p_key is null or not exists (select 1 from public.versus_cf_writer_keys
      where key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex')) then
    raise exception 'not_authorized';
  end if;
  if p_beats is null or jsonb_typeof(p_beats) <> 'array' or jsonb_array_length(p_beats) > 64 then raise exception 'bad_beats'; end if;
  for b in select * from jsonb_array_elements(p_beats) loop
    begin
      v_uid := (b->>'user')::uuid;
      v_kind := b->>'kind';
      v_target := b->>'target';
      v_watched := nullif(b->>'watched_user', '')::uuid;
      v_started := nullif(b->>'started_at', '')::timestamptz;
      v_ended := coalesce((b->>'ended')::boolean, false);
    exception when others then
      continue;
    end;
    if v_uid is null or v_kind is null or v_target is null then continue; end if;
    if v_kind = 'lobby' then
      if v_target !~ '^[!-~]{1,80}$' or v_watched is null or v_watched = v_uid then continue; end if;
    elsif v_kind in ('versus', 'group') then
      if v_target !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then continue; end if;
      v_watched := null;
      v_started := null;
    else
      continue;
    end if;
    if not exists (select 1 from auth.users u where u.id = v_uid) then continue; end if;
    v_run := 'watch:' || v_kind || ':' || v_target;
    v_add := 0;
    perform pg_advisory_xact_lock(hashtextextended('spectate:' || v_uid::text, 0));
    delete from public.spectate_sessions where user_id = v_uid and last_seen_at < v_now - c_keep;
    select * into v_pres from public.spectate_presence where user_id = v_uid;
    if found and v_pres.run_id = v_run and v_now > v_pres.at and v_now - v_pres.at <= c_gap then
      v_add := floor(extract(epoch from (v_now - v_pres.at)) * 1000)::bigint;
    end if;
    insert into public.spectate_sessions as ss (user_id, run_id, kind, target, watched_user, watched_ms, first_seen_at, last_seen_at, game_started_at, saw_end_at)
      values (v_uid, v_run, v_kind, v_target, v_watched, 0, v_now, v_now, v_started, case when v_ended and v_kind = 'lobby' then v_now end)
      on conflict (user_id, run_id) do update set
        watched_ms = ss.watched_ms + v_add,
        last_seen_at = v_now,
        watched_user = coalesce(ss.watched_user, excluded.watched_user),
        game_started_at = coalesce(ss.game_started_at, excluded.game_started_at),
        saw_end_at = coalesce(ss.saw_end_at, excluded.saw_end_at);
    insert into public.spectate_presence (user_id, run_id, at) values (v_uid, v_run, v_now)
      on conflict (user_id) do update set run_id = excluded.run_id, at = excluded.at;
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'recorded', v_n);
end;
$$;
revoke all on function public.spectate_cf_beat(text, jsonb) from public;
grant execute on function public.spectate_cf_beat(text, jsonb) to anon, authenticated;
