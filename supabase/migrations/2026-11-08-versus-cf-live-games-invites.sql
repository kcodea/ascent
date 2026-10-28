-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- LIVE GAMES FOR EVERY GAME + VERSUS ON CLOUDFLARE invite checks at send time (2026-11-08,
-- fix/versus-cf-livegames-invites). Run AFTER 2026-11-07-versus-cf-ranked.sql (needs versus_cf_writer_keys, 2026-11-04)
-- and 2026-11-05-versus-host-config.sql (the friends_invite this replaces). Idempotent. No secret in here: both
-- Cloudflare pieces reuse the Worker's writer key hashes.
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- 1. LIVE GAMES LISTS EVERY LIVE GAME (owner ruling 2026-10-28: "all games should show as live games, and pressing watch
--    from friends list should take the spectator into that game"; R-LIVE-ALL-GAMES-01, R-VERSUS-CF-LIVE-01).
--    `lobby_live_games` already held ranked lobby runs and Ranked Duos teams (`duos:<room>`). It now also holds every
--    Versus match (1v1, Group, Versus Duos) as `versus:<room>` (a Supabase room) or `versus:cf:<room>` (a Cloudflare
--    room), and Cloudflare Ranked Duos teams as `duos:cf:<room>`. New columns: `mode` (null = a solo lobby run),
--    `players` (the listing's "Ann vs Bob" line), `private_host` and `live_until`.
--      - Supabase Versus rooms add NO client traffic: a deferred trigger on the match rows writes the listing row from
--        state the server already holds, only when the phase, round, pause or first hero changes, and removes it when
--        the match completes. It can never fail a match (errors become warnings).
--      - Cloudflare rooms write their own row through ONE limited, key-gated function, `versus_cf_live` (owner ruling
--        2026-10-28: never the service role), only when their listing changes plus a 2-minute keep-alive.
--      - Event-driven rows carry `live_until` (4 minutes past the last write, 11 while paused) and the read policy shows
--        them until then; every heartbeated row keeps the 60 s rule.
--      - Visibility follows the room list: a friends-only Versus room is listed only to its host and the host's friends
--        (`private_host` + `lobby_live__may_see`). A friends-only Ranked Duos party stays unlisted (as
--        `lobby_live_duos_heartbeat` already does).
--
-- 2. INVITES (R-VERSUS-CF-INVITE-01). `friends_invite` gains `p_proof`. A `cf:<room>` target must carry a proof the
--    room signed after running the same checks this function runs on a Supabase room (open, inviter inside, invitee
--    not): `<expiry epoch s>.<hex hmac-sha256>` over `ascent.invite.v1|<room>|<from>|<to>|<kind>|<expiry>`, keyed with
--    one of `versus_cf_writer_keys.key_hash` (the sha256 of the Worker's writer secret). Bound to the room, both users and
--    the kind; at most 5 minutes ahead (the Worker issues 2). A Supabase target is checked exactly as before, and a call
--    without `p_proof` (every older client) still resolves to this function through the default.
--
-- 3. Practice and casual lobby games are live games: `lobby_live_heartbeat` gains `p_mode` (older six-argument calls
--    still resolve; their rows are ranked games, as before).
--
-- 4. A RICHER FRIENDS STATUS (owner approved 2026-10-28; R-FRIENDS-STATUS-01): `player_presence.game` (<= 1 KB), written
--    by `friends_beat`'s new `p_game` (older four-argument beats still resolve), read back through `friends__presence`.

create extension if not exists pgcrypto with schema extensions;

-- ── 1. Live Games ──────────────────────────────────────────────────────────────────────────────────────────
alter table public.lobby_live_games add column if not exists live_until timestamptz;
alter table public.lobby_live_games add column if not exists mode text;
alter table public.lobby_live_games drop constraint if exists lobby_live_games_mode_check;
alter table public.lobby_live_games add constraint lobby_live_games_mode_check check (mode is null or mode in ('duel', 'group', 'duos', 'ranked_duos'));
alter table public.lobby_live_games add column if not exists players text;
alter table public.lobby_live_games drop constraint if exists lobby_live_games_players_check;
alter table public.lobby_live_games add constraint lobby_live_games_players_check check (players is null or char_length(players) <= 160);
alter table public.lobby_live_games add column if not exists private_host uuid;

-- May the caller see a friends-only room's game? The host and the host's friends (the room list's own rule).
create or replace function public.lobby_live__may_see(p_host uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_host is null or (auth.uid() is not null and (auth.uid() = p_host or public.friends__are_friends(p_host, auth.uid())));
$$;
revoke all on function public.lobby_live__may_see(uuid) from public;
grant execute on function public.lobby_live__may_see(uuid) to anon, authenticated;

drop policy if exists "lobby live read games" on public.lobby_live_games;
create policy "lobby live read games" on public.lobby_live_games for select to anon, authenticated
  using ((last_seen_at > now() - interval '60 seconds' or live_until > now())
    and (private_host is null or public.lobby_live__may_see(private_host)));

-- One Versus listing row (both hosts). Rank, medal and rating are the first seat's own, read here. Internal.
create or replace function public.lobby_live__versus_upsert(
  p_game text, p_mode text, p_p1 uuid, p_players text, p_hero text, p_round int, p_phase text, p_spectators int,
  p_private uuid, p_ttl interval
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  prof public.profiles;
  v_name text;
begin
  select * into prof from public.profiles where user_id = p_p1;
  v_name := left(coalesce(nullif(trim(split_part(coalesce(p_players, ''), ' vs ', 1)), ''), nullif(trim(prof.author), ''), 'Player'), 40);
  delete from public.lobby_live_games where last_seen_at < now() - interval '10 minutes' and (live_until is null or live_until < now());
  -- One live game per player: the first seat's other row goes (and its watchers / frames by cascade).
  delete from public.lobby_live_games where user_id = p_p1 and game_id <> p_game;
  insert into public.lobby_live_games (game_id, user_id, display_name, hero_id, cosmetics, division_index, rank_points, rating,
      round, phase, spectators, live_until, mode, players, private_host)
    values (p_game, p_p1, v_name, left(coalesce(nullif(trim(p_hero), ''), 'warden'), 60), null,
      coalesce(prof.rank_division, 0), coalesce(prof.rank_points, 0), coalesce(prof.rating, 0),
      greatest(1, least(200, coalesce(p_round, 1))), p_phase, greatest(0, least(99, coalesce(p_spectators, 0))),
      now() + p_ttl, p_mode, left(p_players, 160), p_private)
    on conflict (game_id) do update set
      user_id = excluded.user_id, display_name = excluded.display_name, hero_id = excluded.hero_id,
      division_index = excluded.division_index, rank_points = excluded.rank_points, rating = excluded.rating,
      round = excluded.round, phase = excluded.phase, spectators = excluded.spectators, last_seen_at = now(),
      live_until = excluded.live_until, mode = excluded.mode, players = excluded.players, private_host = excluded.private_host;
end;
$$;
revoke all on function public.lobby_live__versus_upsert(text, text, uuid, text, text, int, text, int, uuid, interval) from public, anon, authenticated;

-- The listing phase of a match phase (`duosLivePhase` in the client).
create or replace function public.lobby_live__phase(p text)
returns text
language sql
immutable
as $$
  select case when p = 'hero_select' then 'hero' when p = 'combat' then 'combat' when p = 'complete' then 'end' else 'shop' end;
$$;

-- ── 1a. Supabase Versus rooms: from the match rows, no client traffic ─────────────────────────────────────
create or replace function public.lobby_live__sync_versus_match(p_match uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.versus_matches;
  r public.versus_rooms;
  v_game text;
begin
  select * into m from public.versus_matches where id = p_match;
  if not found or m.backend <> 'supabase' or m.room_id is null then return; end if;
  v_game := 'versus:' || m.room_id::text;
  select * into r from public.versus_rooms where id = m.room_id;
  if m.phase = 'complete' or not found or r.current_match_id is distinct from m.id then
    delete from public.lobby_live_games where game_id = v_game;
    return;
  end if;
  perform public.lobby_live__versus_upsert(v_game, 'duel', m.p1_user, m.p1_name || ' vs ' || m.p2_name, m.p1_hero, m.round,
    public.lobby_live__phase(m.phase),
    (select count(*)::int from public.versus_members vm where vm.room_id = r.id and vm.role = 'spectator'),
    case when r.friends_only then r.host_user_id end,
    case when m.paused_at is not null then interval '11 minutes' else interval '4 minutes' end);
end;
$$;
revoke all on function public.lobby_live__sync_versus_match(uuid) from public, anon, authenticated;

create or replace function public.lobby_live__sync_group_match(p_match uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.versus_group_matches;
  r public.versus_rooms;
  v_game text;
  v_mode text;
  v_players text;
  v_p1 uuid;
  v_hero text;
begin
  select * into g from public.versus_group_matches where id = p_match;
  if not found then return; end if;
  v_mode := coalesce(g.options->>'mode', 'group');
  -- Ranked Duos keeps its own listing (`lobby_live_duos_heartbeat`); a Cloudflare match is written by its room.
  if g.backend <> 'supabase' or g.room_id is null or v_mode = 'ranked_duos' then return; end if;
  v_game := 'versus:' || g.room_id::text;
  select * into r from public.versus_rooms where id = g.room_id;
  if g.phase = 'complete' or not found or r.current_match_id is distinct from g.id then
    delete from public.lobby_live_games where game_id = v_game;
    return;
  end if;
  select s.user_id, s.hero into v_p1, v_hero from public.versus_group_seats s where s.match_id = g.id order by s.seat limit 1;
  if v_p1 is null then return; end if; -- no seats yet (the next change lists it)
  if v_mode = 'duos' then
    select coalesce(string_agg(s.name, ' & ' order by s.seat) filter (where s.team = 'a'), '') || ' vs '
        || coalesce(string_agg(s.name, ' & ' order by s.seat) filter (where s.team is distinct from 'a'), '')
      into v_players from public.versus_group_seats s where s.match_id = g.id;
  else
    select string_agg(s.name, ' vs ' order by s.seat) into v_players from public.versus_group_seats s where s.match_id = g.id;
  end if;
  perform public.lobby_live__versus_upsert(v_game, case when v_mode = 'duos' then 'duos' else 'group' end, v_p1, v_players, v_hero,
    g.round, public.lobby_live__phase(g.phase),
    (select count(*)::int from public.versus_members vm where vm.room_id = r.id and vm.role = 'spectator'),
    case when r.friends_only then r.host_user_id end,
    case when g.paused_at is not null then interval '11 minutes' else interval '4 minutes' end);
end;
$$;
revoke all on function public.lobby_live__sync_group_match(uuid) from public, anon, authenticated;

-- The triggers: deferred to the end of the transaction (a group match's seats are inserted after its row), fired only
-- by a change the listing shows, and never able to fail the match (Live Games is a view, not a rule).
create or replace function public.lobby_live__versus_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if tg_table_name = 'versus_matches' then perform public.lobby_live__sync_versus_match(new.id);
    else perform public.lobby_live__sync_group_match(new.id);
    end if;
  exception when others then
    raise warning 'lobby_live versus sync (%): %', tg_table_name, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public.lobby_live__versus_trg() from public, anon, authenticated;

drop trigger if exists lobby_live_versus_ins on public.versus_matches;
create constraint trigger lobby_live_versus_ins after insert on public.versus_matches
  deferrable initially deferred for each row execute function public.lobby_live__versus_trg();
drop trigger if exists lobby_live_versus_upd on public.versus_matches;
create constraint trigger lobby_live_versus_upd after update on public.versus_matches
  deferrable initially deferred for each row
  when (old.phase is distinct from new.phase or old.round is distinct from new.round
    or (old.paused_at is null) <> (new.paused_at is null) or old.p1_hero is distinct from new.p1_hero)
  execute function public.lobby_live__versus_trg();
drop trigger if exists lobby_live_group_ins on public.versus_group_matches;
create constraint trigger lobby_live_group_ins after insert on public.versus_group_matches
  deferrable initially deferred for each row execute function public.lobby_live__versus_trg();
drop trigger if exists lobby_live_group_upd on public.versus_group_matches;
create constraint trigger lobby_live_group_upd after update on public.versus_group_matches
  deferrable initially deferred for each row
  when (old.phase is distinct from new.phase or old.round is distinct from new.round
    or (old.paused_at is null) <> (new.paused_at is null))
  execute function public.lobby_live__versus_trg();

-- ── 1b. Cloudflare rooms: the room's own row, through the limited writer ─────────────────────────────────
create or replace function public.versus_cf_live(p_key text, p_room uuid, p_row jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text;
  v_game text;
  v_p1 uuid;
  v_team uuid;
  v_phase text;
  v_name text;
  v_hero text;
  v_private uuid;
  k public.duos_team_ranks;
begin
  if p_key is null or not exists (select 1 from public.versus_cf_writer_keys
      where key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex')) then
    raise exception 'not_authorized';
  end if;
  if p_room is null then raise exception 'bad_row'; end if;
  -- Removal: the match ended, the room closed, or a party went friends-only (either prefix: a room changes mode).
  if p_row is null or jsonb_typeof(p_row) <> 'object' or p_row->>'phase' = 'end' then
    delete from public.lobby_live_games where game_id in ('duos:cf:' || p_room::text, 'versus:cf:' || p_room::text);
    return jsonb_build_object('ok', true, 'removed', true);
  end if;
  if octet_length(p_row::text) > 4096 then raise exception 'bad_row'; end if;
  v_mode := coalesce(p_row->>'mode', 'ranked_duos');
  if v_mode not in ('duel', 'group', 'duos', 'ranked_duos') then raise exception 'bad_mode'; end if;
  v_phase := p_row->>'phase';
  if v_phase is null or v_phase not in ('hero', 'shop', 'combat') then raise exception 'bad_phase'; end if;
  begin v_p1 := (p_row->>'p1')::uuid; exception when others then raise exception 'bad_row'; end;
  if v_p1 is null then raise exception 'bad_row'; end if;
  v_hero := left(coalesce(nullif(trim(p_row->>'hero'), ''), 'warden'), 60);

  if v_mode <> 'ranked_duos' then
    v_game := 'versus:cf:' || p_room::text;
    delete from public.lobby_live_games where game_id = 'duos:cf:' || p_room::text;
    if coalesce(p_row->>'private_host', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v_private := (p_row->>'private_host')::uuid; end if;
    perform public.lobby_live__versus_upsert(v_game, v_mode, v_p1, nullif(trim(p_row->>'players'), ''), v_hero,
      coalesce((p_row->>'round')::int, 1), v_phase, coalesce((p_row->>'spectators')::int, 0), v_private, interval '4 minutes');
    return jsonb_build_object('ok', true);
  end if;

  -- RANKED DUOS: the team's name, medal and rating (as `lobby_live_duos_heartbeat`).
  v_game := 'duos:cf:' || p_room::text;
  delete from public.lobby_live_games where game_id = 'versus:cf:' || p_room::text;
  if coalesce(p_row->>'team', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v_team := (p_row->>'team')::uuid; end if;
  select d.name into v_name from public.duos_teams d where d.id = v_team;
  v_name := left(coalesce(nullif(trim(v_name), ''), nullif(trim(p_row->>'players'), ''), 'Duo'), 40);
  select * into k from public.duos_team_ranks where team_id = v_team and season = 3;
  delete from public.lobby_live_games where last_seen_at < now() - interval '10 minutes' and (live_until is null or live_until < now());
  delete from public.lobby_live_games where user_id = v_p1 and game_id <> v_game;
  insert into public.lobby_live_games (game_id, user_id, display_name, hero_id, cosmetics, division_index, rank_points, rating,
      round, phase, spectators, live_until, mode, players, private_host)
    values (v_game, v_p1, v_name, v_hero, null, coalesce(k.division, 0), coalesce(k.points, 0),
      100 * coalesce(k.division, 0) + coalesce(k.points, 0),
      greatest(1, least(200, coalesce((p_row->>'round')::int, 1))), v_phase,
      greatest(0, least(99, coalesce((p_row->>'spectators')::int, 0))), now() + interval '4 minutes', 'ranked_duos',
      left(nullif(trim(p_row->>'players'), ''), 160), null)
    on conflict (game_id) do update set
      user_id = excluded.user_id, display_name = excluded.display_name, hero_id = excluded.hero_id,
      division_index = excluded.division_index, rank_points = excluded.rank_points, rating = excluded.rating,
      round = excluded.round, phase = excluded.phase, spectators = excluded.spectators,
      last_seen_at = now(), live_until = excluded.live_until, mode = excluded.mode, players = excluded.players, private_host = null;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.versus_cf_live(text, uuid, jsonb) from public;
grant execute on function public.versus_cf_live(text, uuid, jsonb) to anon, authenticated;

-- ── 2. Invites: the room's signed check ────────────────────────────────────────────────────────────────────
-- Is `p_proof` the room's signature over this exact invite, unexpired? Internal (no grants).
create or replace function public.versus_cf__invite_proof_ok(p_room uuid, p_from uuid, p_to uuid, p_kind text, p_proof text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_exp bigint;
  v_sig text;
  v_now bigint := floor(extract(epoch from now()))::bigint;
  v_payload text;
begin
  if p_proof is null or p_proof !~ '^[0-9]{1,12}\.[0-9a-f]{64}$' then return false; end if;
  v_exp := split_part(p_proof, '.', 1)::bigint;
  v_sig := split_part(p_proof, '.', 2);
  if v_exp < v_now or v_exp > v_now + 300 then return false; end if;
  v_payload := 'ascent.invite.v1|' || p_room::text || '|' || p_from::text || '|' || p_to::text || '|' || p_kind || '|' || v_exp::text;
  return exists (select 1 from public.versus_cf_writer_keys k
    where encode(extensions.hmac(convert_to(v_payload, 'UTF8'), convert_to(k.key_hash, 'UTF8'), 'sha256'), 'hex') = v_sig);
end;
$$;
revoke all on function public.versus_cf__invite_proof_ok(uuid, uuid, uuid, text, text) from public, anon, authenticated;

-- As 2026-11-05-versus-host-config.sql, plus `p_proof` (a `cf:` target needs it, for either kind). The three-argument
-- version goes, so PostgREST never has two candidates for a call with three named arguments.
drop function if exists public.friends_invite(uuid, text, text);
create or replace function public.friends_invite(p_user uuid, p_kind text, p_target text, p_proof text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.friends__me();
  v_room uuid;
  v_status text;
  i public.friend_invites;
begin
  if p_kind is null or p_kind not in ('versus_room', 'duos_party') then raise exception 'bad_kind'; end if;
  if p_target is null or char_length(p_target) not between 1 and 64 then raise exception 'bad_target'; end if;
  if p_user is null or p_user = v_me then raise exception 'self'; end if;
  if public.friends__blocked(v_me, p_user) then raise exception 'blocked'; end if;
  if not public.friends__are_friends(v_me, p_user) then raise exception 'not_friends'; end if;
  if not public.friends__online(p_user) then raise exception 'not_online'; end if;
  if p_target like 'cf:%' then
    -- A Cloudflare room: Postgres cannot see it, so the ROOM ran the checks (open, I am in it, they are not) and signed
    -- this exact invite; no valid proof, no invite.
    begin v_room := substr(p_target, 4)::uuid; exception when others then raise exception 'bad_target'; end;
    if not public.versus_cf__invite_proof_ok(v_room, v_me, p_user, p_kind, p_proof) then raise exception 'room_check'; end if;
  elsif p_kind = 'versus_room' then
    begin v_room := p_target::uuid; exception when others then raise exception 'bad_target'; end;
    select r.status into v_status from public.versus_rooms r where r.id = v_room;
    if v_status is null then raise exception 'room_not_open'; end if;
    if not exists (select 1 from public.versus_members m where m.room_id = v_room and m.user_id = v_me) then raise exception 'not_in_room'; end if;
    if v_status <> 'open' then raise exception 'room_not_open'; end if;
    if exists (select 1 from public.versus_members m where m.room_id = v_room and m.user_id = p_user) then raise exception 'already_in_room'; end if;
  end if;
  perform public.friends__rate(v_me, 'invite', 30);
  delete from public.friend_invites where from_user = v_me and created_at < now() - interval '1 day';
  update public.friend_invites set status = 'cancelled', responded_at = now()
    where from_user = v_me and to_user = p_user and kind = p_kind and status = 'pending';
  insert into public.friend_invites (from_user, to_user, kind, target, expires_at)
    values (v_me, p_user, p_kind, p_target, now() + public.friends__invite_ttl())
    returning * into i;
  return jsonb_build_object('id', i.id, 'kind', i.kind, 'target', i.target, 'expiresAt', i.expires_at);
end;
$$;
revoke all on function public.friends_invite(uuid, text, text, text) from public, anon;
grant execute on function public.friends_invite(uuid, text, text, text) to authenticated;

-- ── 3. Practice and casual lobby games are live games too (owner ruling 2026-10-28) ─────────────────────────
-- `lobby_live_heartbeat` gains `p_mode` ('casual' or 'practice'; null = a ranked game, every older client), stored in
-- `mode` so the listing can label the game. Body otherwise as 2026-10-26-lobby-live-hero-select.sql.
alter table public.lobby_live_games drop constraint if exists lobby_live_games_mode_check;
alter table public.lobby_live_games add constraint lobby_live_games_mode_check
  check (mode is null or mode in ('duel', 'group', 'duos', 'ranked_duos', 'casual', 'practice'));
drop function if exists public.lobby_live_heartbeat(text, text, text, jsonb, int, text);
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
      round = excluded.round, phase = excluded.phase, spectators = excluded.spectators, last_seen_at = now(), mode = excluded.mode
    where public.lobby_live_games.user_id = v_uid;
  return v_watchers;
end;
$$;
revoke all on function public.lobby_live_heartbeat(text, text, text, jsonb, int, text, text) from public, anon;
grant execute on function public.lobby_live_heartbeat(text, text, text, jsonb, int, text, text) to authenticated;

-- ── 4. A richer Friends status for a friend in a game (owner approved 2026-10-28) ───────────────────────────
-- `player_presence.game`: what the friend's game looks like right now (mode, hero, round + phase, Health + Armor, tavern
-- tier, lobby place or Versus players), the client's typed `FriendGameStatus` (packages/ui/src/friends/gameStatus.ts),
-- capped at 1 KB. Written by the same beat, which the client sends on a change of phase or round, never per tick.
-- `friends_beat` gains `p_game` (older clients: null). Read back through `friends__presence` (friends only, as before).
alter table public.player_presence add column if not exists game jsonb;
alter table public.player_presence drop constraint if exists player_presence_game;
alter table public.player_presence add constraint player_presence_game
  check (game is null or (jsonb_typeof(game) = 'object' and octet_length(game::text) <= 1024));

create or replace function public.friends__presence(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case
    when pr.user_id is null then jsonb_build_object('status', 'offline', 'lastSeen', null)
    when pr.status = 'offline' or pr.updated_at < now() - public.friends__stale()
      then jsonb_build_object('status', 'offline', 'lastSeen', pr.updated_at)
    else jsonb_build_object('status', pr.status, 'mode', pr.mode, 'watchKind', pr.watch_kind, 'watchId', pr.watch_id,
      'lastSeen', pr.updated_at, 'game', case when pr.status = 'in_game' then pr.game end)
  end
  from (select 1) one
  left join public.player_presence pr on pr.user_id = p_user
$$;
revoke all on function public.friends__presence(uuid) from public, anon, authenticated;

drop function if exists public.friends_beat(text, text, text, text);
create or replace function public.friends_beat(p_status text, p_mode text default null, p_watch_kind text default null,
  p_watch_id text default null, p_game jsonb default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.friends__me();
  v_mode text := nullif(left(coalesce(p_mode, ''), 24), '');
  v_wk text := case when p_watch_kind in ('live', 'versus') and coalesce(p_watch_id, '') <> '' then p_watch_kind else null end;
  v_wid text := case when p_watch_kind in ('live', 'versus') and coalesce(p_watch_id, '') <> '' then left(p_watch_id, 64) else null end;
  -- A junk or oversized status is dropped, never an error (the beat must always land).
  v_game jsonb := case when p_status = 'in_game' and jsonb_typeof(p_game) = 'object' and octet_length(p_game::text) <= 1024 then p_game end;
begin
  if p_status is null or p_status not in ('online', 'in_game', 'offline') then raise exception 'bad_status'; end if;
  if v_mode is not null and v_mode !~ '^[a-z0-9_]{1,24}$' then v_mode := null; end if;
  insert into public.player_presence (user_id, status, mode, watch_kind, watch_id, updated_at, game)
    values (v_me, p_status, v_mode, v_wk, v_wid, now(), v_game)
    on conflict (user_id) do update set status = excluded.status, mode = excluded.mode, watch_kind = excluded.watch_kind,
      watch_id = excluded.watch_id, updated_at = excluded.updated_at, game = excluded.game;
  return jsonb_build_object(
    'friends', (select count(*) from public.friendships where (user_a = v_me or user_b = v_me) and status = 'accepted'),
    'online', (select count(*) from public.friendships f
                 join public.player_presence pr on pr.user_id = case when f.user_a = v_me then f.user_b else f.user_a end
                where (f.user_a = v_me or f.user_b = v_me) and f.status = 'accepted'
                  and pr.status <> 'offline' and pr.updated_at >= now() - public.friends__stale()),
    'incoming', (select count(*) from public.friendships where (user_a = v_me or user_b = v_me) and status = 'pending' and requester <> v_me),
    'invites', public.friends__my_invites(v_me),
    'serverNow', now()
  );
end;
$$;
revoke all on function public.friends_beat(text, text, text, text, jsonb) from public, anon;
grant execute on function public.friends_beat(text, text, text, text, jsonb) to authenticated;
