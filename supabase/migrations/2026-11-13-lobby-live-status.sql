-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- A LIVE GAME AT A GLANCE (2026-11-13, feat/live-games-rich-status). Run AFTER 2026-11-10-lobby-live-cf.sql (this
-- replaces its `lobby_live_heartbeat` and `lobby_live_cf`). Idempotent. ADDITIVE: one nullable column, one optional
-- argument. No secret in here. No Edge Function. The Worker that sends the status over the Cloudflare path needs the
-- matching versioned redeploy, but the order does not matter: an older Worker simply sends no status (null), and this
-- writer stores whatever status a newer one sends.
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- OWNER (2026-10-29): "give live games the same granularity that friends show". R-LIVE-STATUS-01.
--
-- 1. `lobby_live_games.status` (jsonb, null): a live LOBBY game's status in the Friends shape (`FriendGameStatus`,
--    packages/ui/src/friends/gameStatus.ts, the same value `player_presence.game` holds): the step and whom the player
--    fights, place, Health, Armor and tier. Bounded like `player_presence.game` (an object, at most 1 KB); anything else
--    is stored as null, never an error (the listing must never fail over a cosmetic field). Public like the rest of the
--    row (the game is already listed and watchable by anyone).
-- 2. `lobby_live_heartbeat` gains `p_status` (default null): the Supabase path. The seven-argument version is DROPPED
--    first (two overloads would make every older call ambiguous); older six- and seven-argument calls still resolve to
--    this one through the defaults, and write a null status.
-- 3. `lobby_live_cf` stores `p_row->'status'`: the Cloudflare path (the object passes the player's status through).
--
-- Versus and Ranked Duos rows are untouched (their status stays null; the client shows what the row itself says).
-- Egress: the 10 s Live Games read gains this column, a few hundred bytes per row at most.

-- ── 1. The column ──────────────────────────────────────────────────────────────────────────────────────────
alter table public.lobby_live_games add column if not exists status jsonb;
alter table public.lobby_live_games drop constraint if exists lobby_live_games_status_check;
alter table public.lobby_live_games add constraint lobby_live_games_status_check
  check (status is null or (jsonb_typeof(status) = 'object' and octet_length(status::text) <= 1024));

-- A status as the listing stores it: an object of at most 1 KB, else null. Internal.
create or replace function public.lobby_live__status(p jsonb)
returns jsonb
language sql
immutable
as $$
  select case when p is not null and jsonb_typeof(p) = 'object' and octet_length(p::text) <= 1024 then p end;
$$;
revoke all on function public.lobby_live__status(jsonb) from public, anon, authenticated;

-- ── 2. The heartbeat (the Supabase path) ───────────────────────────────────────────────────────────────────
drop function if exists public.lobby_live_heartbeat(text, text, text, jsonb, int, text, text);
create or replace function public.lobby_live_heartbeat(
  p_game text, p_name text, p_hero text, p_cosmetics jsonb, p_round int, p_phase text, p_mode text default null,
  p_status jsonb default null
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
  v_status jsonb := public.lobby_live__status(p_status);
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if p_phase not in ('hero', 'shop', 'combat', 'end') then raise exception 'bad_phase'; end if;
  delete from public.lobby_live_games where last_seen_at < now() - interval '10 minutes' and (live_until is null or live_until < now());
  delete from public.lobby_live_watchers where last_seen_at < now() - interval '2 minutes';
  select * into prof from public.profiles where user_id = v_uid;
  delete from public.lobby_live_games where user_id = v_uid and game_id <> p_game;
  select count(*) into v_watchers from public.lobby_live_watchers
    where game_id = p_game and last_seen_at > now() - interval '30 seconds';
  insert into public.lobby_live_games (game_id, user_id, display_name, hero_id, cosmetics, division_index, rank_points, rating, round, phase, spectators, mode, status)
    values (p_game, v_uid, left(coalesce(nullif(trim(p_name), ''), 'Player'), 40), p_hero, p_cosmetics,
            coalesce(prof.rank_division, 0), coalesce(prof.rank_points, 0), coalesce(prof.rating, 0),
            greatest(1, least(200, p_round)), p_phase, v_watchers, v_mode, v_status)
    on conflict (game_id) do update set
      display_name = excluded.display_name, hero_id = excluded.hero_id, cosmetics = excluded.cosmetics,
      division_index = excluded.division_index, rank_points = excluded.rank_points, rating = excluded.rating,
      round = excluded.round, phase = excluded.phase, spectators = excluded.spectators, last_seen_at = now(), mode = excluded.mode,
      live_host = null, live_until = null, status = excluded.status
    where public.lobby_live_games.user_id = v_uid;
  return v_watchers;
end;
$$;
revoke all on function public.lobby_live_heartbeat(text, text, text, jsonb, int, text, text, jsonb) from public, anon;
grant execute on function public.lobby_live_heartbeat(text, text, text, jsonb, int, text, text, jsonb) to authenticated;


-- ── 3. The Worker's row writer (the Cloudflare path) ───────────────────────────────────────────────────────
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
  v_status jsonb;
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
  v_status := public.lobby_live__status(p_row->'status');
  select * into cur from public.lobby_live_games where game_id = p_game;
  if found and cur.user_id <> v_user then raise exception 'not_owner'; end if;
  delete from public.lobby_live_games where last_seen_at < now() - interval '10 minutes' and (live_until is null or live_until < now());
  -- One live game per player (as the heartbeat): the player's other row goes (its watchers / frames by cascade).
  delete from public.lobby_live_games where user_id = v_user and game_id <> p_game;
  select * into prof from public.profiles where user_id = v_user;
  insert into public.lobby_live_games (game_id, user_id, display_name, hero_id, cosmetics, division_index, rank_points, rating,
      round, phase, spectators, live_until, mode, live_host, status)
    values (p_game, v_user, left(coalesce(nullif(trim(p_row->>'name'), ''), 'Player'), 40),
      left(coalesce(nullif(trim(p_row->>'hero'), ''), 'warden'), 60),
      case when jsonb_typeof(p_row->'cosmetics') = 'object' and octet_length((p_row->'cosmetics')::text) <= 4096 then p_row->'cosmetics' end,
      coalesce(prof.rank_division, 0), coalesce(prof.rank_points, 0), coalesce(prof.rating, 0),
      greatest(1, least(200, coalesce((p_row->>'round')::int, 1))), v_phase,
      greatest(0, least(99, coalesce((p_row->>'spectators')::int, 0))), now() + interval '4 minutes', v_mode, v_host, v_status)
    on conflict (game_id) do update set
      display_name = excluded.display_name, hero_id = excluded.hero_id, cosmetics = excluded.cosmetics,
      division_index = excluded.division_index, rank_points = excluded.rank_points, rating = excluded.rating,
      round = excluded.round, phase = excluded.phase, spectators = excluded.spectators, last_seen_at = now(),
      live_until = excluded.live_until, mode = excluded.mode, live_host = excluded.live_host, status = excluded.status
    where public.lobby_live_games.user_id = v_user;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.lobby_live_cf(text, text, jsonb) from public;
grant execute on function public.lobby_live_cf(text, text, jsonb) to anon, authenticated;

