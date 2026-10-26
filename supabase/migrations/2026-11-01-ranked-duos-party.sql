-- RANKED DUOS, phase 3: the party, the leaderboard and Live Games (owner design 2026-10-26;
-- docs/design/2026-10-26-ranked-duos.md section 8; GAME-RULES.md "Ranked Duos"). APPLY AFTER
-- 2026-10-31-ranked-duos-live-fixes.sql and 2026-10-28-friends.sql. Idempotent.
--
--  1. FRIENDS-ONLY parties (owner Q6: "Listed by default, friends-only toggle"): `versus_rooms.friends_only`, set by the
--     host (`versus_set_friends_only`, open rooms only). A friends-only room is listed (`versus_list_rooms`), counted
--     (`versus_open_rooms`) and joinable (`versus_join_room`) only for the host's accepted friends and its own members.
--     Every other room: unchanged.
--  2. `versus_open_rooms` also answers `duosOpen` (Ranked Duos parties with a free seat), and the Versus counts leave
--     Ranked Duos parties out (they are listed in the Duos play area, not the Versus browser).
--  3. `duos_leaderboard(p_limit, p_offset)`: the Duos tab, TEAMS ordered by division then points (this season), each with
--     its name and both players' public profile fields.
--  4. `lobby_live_duos_heartbeat(p_room, p_round, p_phase)`: a Ranked Duos game in Live Games, ONE row per team
--     (`game_id` = 'duos:<room id>'), the team's name, the first seat's hero, the TEAM's medal. Sent by seat p1 only.

-- ── 1. Friends-only parties ───────────────────────────────────────────────────────────────────────────────────────
alter table public.versus_rooms add column if not exists friends_only boolean not null default false;

-- May `p_user` see / join room `r`? Everyone for a listed room; for a friends-only one, its members and the host's friends.
create or replace function public.versus__room_visible(r public.versus_rooms, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not r.friends_only
    or exists (select 1 from public.versus_members m where m.room_id = r.id and m.user_id = p_user)
    or (p_user is not null and r.host_user_id is not null and public.friends__are_friends(r.host_user_id, p_user));
$$;

create or replace function public.versus_set_friends_only(p_room uuid, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.versus_rooms;
begin
  select * into r from public.versus_rooms where id = p_room for update;
  if not found then raise exception 'no_room'; end if;
  if r.host_user_id <> auth.uid() then raise exception 'not_host'; end if;
  if r.status <> 'open' then raise exception 'room_not_open'; end if;
  update public.versus_rooms set friends_only = coalesce(p_on, false), revision = revision + 1, updated_at = public.versus_clock()
    where id = p_room;
  return public.versus__room_json(p_room) || jsonb_build_object('friendsOnly', coalesce(p_on, false));
end;
$$;

-- The room browser (2026-10-27-versus-egress.sql's body) + `friendsOnly`, and a friends-only room only for those who may
-- see it.
create or replace function public.versus_list_rooms()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  v_me uuid := auth.uid();
begin
  -- THE PRUNE, at most once per 30 s across every caller, never waiting on a lock (SKIP LOCKED throughout).
  perform 1 from public.versus_housekeeping where id = 1 and pruned_at < v_now - interval '30 seconds' for update skip locked;
  if found then
    update public.versus_housekeeping set pruned_at = v_now where id = 1;
    with gone as (
      delete from public.versus_members d where (d.room_id, d.user_id) in (
        select mm.room_id, mm.user_id from public.versus_members mm join public.versus_rooms r on r.id = mm.room_id
          where r.status = 'open' and mm.last_seen_at < v_now - interval '2 minutes'
          for update of mm skip locked)
      returning d.room_id
    )
    update public.versus_rooms u set revision = u.revision + 1, updated_at = v_now
      where u.id in (select r.id from public.versus_rooms r where r.id in (select room_id from gone) for update of r skip locked);
    delete from public.versus_rooms d where d.id in (
      select r.id from public.versus_rooms r where not exists (select 1 from public.versus_members mm where mm.room_id = r.id)
        for update of r skip locked);
  end if;
  return coalesce((select jsonb_agg(j order by j->>'createdAt' desc) from (
    select jsonb_build_object(
      'id', r.id, 'name', r.name, 'status', r.status, 'setId', r.set_id, 'contentRevision', r.content_revision,
      'protocol', r.protocol, 'createdAt', r.created_at, 'currentMatchId', r.current_match_id,
      'hostName', (select display_name from public.versus_members where room_id = r.id and user_id = r.host_user_id),
      'hostProfile', (select profile from public.versus_members where room_id = r.id and user_id = r.host_user_id),
      'players', (select count(*) from public.versus_members where room_id = r.id and role <> 'spectator'),
      'maxPlayers', cardinality(public.versus__mode_roles(r.options->>'mode')),
      'options', public.versus__normalize_options(r.options),
      'spectators', (select count(*) from public.versus_members where room_id = r.id and role = 'spectator'),
      'friendsOnly', r.friends_only
    ) as j from public.versus_rooms r where public.versus__room_visible(r, v_me)) q), '[]'::jsonb);
end;
$$;

-- The menus' open-room counts (2026-10-25-versus-duos.sql's body): Versus rooms (Ranked Duos parties left out), and the
-- Ranked Duos parties with a free seat (`duosOpen`). A friends-only room counts only for those who may see it.
-- The one friendship question a security-invoker reader may ask: is this host MY friend? (Only ever about the caller,
-- who can already read their own friends list; the private `friends__are_friends` stays private.)
create or replace function public.versus__host_is_my_friend(p_host uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and p_host is not null and public.friends__are_friends(p_host, auth.uid());
$$;
revoke all on function public.versus__host_is_my_friend(uuid) from public, anon;
grant execute on function public.versus__host_is_my_friend(uuid) to authenticated;

create or replace function public.versus_open_rooms(p_protocol int, p_content text)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with fresh as (
    -- (security invoker: the seat count is inlined, the private `versus__mode_roles` helper is not callable here)
    select r.id, coalesce(r.options->>'mode', 'duel') = 'ranked_duos' as duos,
      case when r.options->>'mode' in ('group', 'duos') then 4 else 2 end as cap,
      (select count(*) from public.versus_members m
        where m.room_id = r.id and m.role <> 'spectator' and m.last_seen_at >= public.versus_clock() - interval '2 minutes') as players
    from public.versus_rooms r
    where r.status = 'open'
      and r.protocol = p_protocol
      and r.content_revision = p_content
      and exists (select 1 from public.versus_members m
        where m.room_id = r.id and m.last_seen_at >= public.versus_clock() - interval '2 minutes')
      and not exists (select 1 from public.versus_members m
        where m.room_id = r.id and m.user_id = auth.uid())
      and (not r.friends_only or public.versus__host_is_my_friend(r.host_user_id))
  )
  select jsonb_build_object(
    'open', count(*) filter (where not duos),
    'seatOpen', count(*) filter (where not duos and players < cap),
    'duosOpen', count(*) filter (where duos and players < cap)
  ) from fresh;
$$;

-- Join (2026-10-24-versus-group.sql's body) + a friends-only room refuses everyone else (`friends_only`).
create or replace function public.versus_join_room(p_room uuid, p_as text, p_display text, p_profile jsonb, p_content text, p_protocol int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  r public.versus_rooms;
  v_role text;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  select * into r from public.versus_rooms where id = p_room for update;
  if not found then raise exception 'no_room'; end if;
  if r.protocol <> p_protocol or r.content_revision <> p_content then raise exception 'version_mismatch'; end if;
  if exists (select 1 from public.versus_members where user_id = v_user and room_id = p_room) then
    return public.versus__room_json(p_room); -- already here: idempotent re-join
  end if;
  if exists (select 1 from public.versus_members where user_id = v_user) then raise exception 'already_in_room'; end if;
  if not public.versus__room_visible(r, v_user) then raise exception 'friends_only'; end if;
  if p_as = 'player' then
    if r.status <> 'open' then raise exception 'room_not_open'; end if;
    select s into v_role from unnest(public.versus__mode_roles(r.options->>'mode')) with ordinality as t(s, n)
      where not exists (select 1 from public.versus_members where room_id = p_room and role = s) order by n limit 1;
    if v_role is null then raise exception 'seats_full'; end if;
  elsif p_as = 'spectator' then
    if (select count(*) from public.versus_members where room_id = p_room and role = 'spectator') >= 20 then raise exception 'spectators_full'; end if;
    v_role := 'spectator';
  else
    raise exception 'bad_role';
  end if;
  insert into public.versus_members (room_id, user_id, role, display_name, profile, last_seen_at)
    values (p_room, v_user, v_role, left(coalesce(nullif(trim(p_display), ''), 'Player'), 40), coalesce(p_profile, '{}'::jsonb), public.versus_clock());
  update public.versus_rooms set revision = revision + 1, updated_at = public.versus_clock() where id = p_room;
  return public.versus__room_json(p_room);
end;
$$;

-- ── 2. The Duos leaderboard (teams) ───────────────────────────────────────────────────────────────────────────────
create or replace function public.duos_leaderboard(p_limit int default 50, p_offset int default 0)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(j order by (j->>'division')::int desc, (j->>'points')::int desc, j->>'teamId'), '[]'::jsonb) from (
    select jsonb_build_object(
      'teamId', t.id, 'name', t.name, 'division', k.division, 'points', k.points, 'demotionReady', k.demotion_ready,
      'games', (select count(*) from public.duos_rank_results x where x.team_id = t.id and x.season = k.season),
      'players', jsonb_build_array(
        (select jsonb_build_object('userId', p.user_id, 'name', p.author, 'discriminator', p.discriminator, 'hero', p.favorite_hero)
           from public.profiles p where p.user_id = t.user_lo),
        (select jsonb_build_object('userId', p.user_id, 'name', p.author, 'discriminator', p.discriminator, 'hero', p.favorite_hero)
           from public.profiles p where p.user_id = t.user_hi))
    ) as j
    from public.duos_team_ranks k join public.duos_teams t on t.id = k.team_id
    where k.season = 3 and k.revision > 0
    order by k.division desc, k.points desc, t.id
    limit least(greatest(coalesce(p_limit, 50), 1), 100) offset greatest(coalesce(p_offset, 0), 0)
  ) q;
$$;

-- A player's Duos teams (the Career): each team with its name, partner and medal this season.
create or replace function public.duos_teams_of(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'teamId', t.id, 'name', t.name,
      'partner', (select jsonb_build_object('userId', p.user_id, 'name', p.author, 'discriminator', p.discriminator, 'hero', p.favorite_hero)
         from public.profiles p where p.user_id = case when t.user_lo = p_user then t.user_hi else t.user_lo end),
      'division', coalesce(k.division, 0), 'points', coalesce(k.points, 0),
      'games', (select count(*) from public.duos_rank_results x where x.team_id = t.id and x.season = 3))
    order by coalesce(k.division, 0) desc, coalesce(k.points, 0) desc), '[]'::jsonb)
  from public.duos_teams t
  left join public.duos_team_ranks k on k.team_id = t.id and k.season = 3
  where p_user in (t.user_lo, t.user_hi)
    and exists (select 1 from public.duos_rank_results x where x.team_id = t.id);
$$;

-- ── 3. Live Games: one row per Ranked Duos team ───────────────────────────────────────────────────────────────────
create or replace function public.lobby_live_duos_heartbeat(p_room uuid, p_round int, p_phase text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  r public.versus_rooms;
  m public.versus_group_matches;
  v_game text := 'duos:' || p_room::text;
  v_name text;
  v_hero text;
  k public.duos_team_ranks;
  v_watchers int;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if p_phase not in ('hero', 'shop', 'combat', 'end') then raise exception 'bad_phase'; end if;
  -- The game is over: the team's row leaves the list at once (as `lobby_live_end` does), whatever the room is doing.
  if p_phase = 'end' then
    delete from public.lobby_live_games where game_id = v_game and user_id = v_uid;
    return 0;
  end if;
  select * into r from public.versus_rooms where id = p_room;
  if not found or r.current_match_id is null then raise exception 'no_room'; end if;
  select * into m from public.versus_group_matches where id = r.current_match_id;
  if not found or not public.versus_ranked_duos__is(m) then raise exception 'not_ranked_duos'; end if;
  if not exists (select 1 from public.versus_group_seats where match_id = m.id and seat = 'p1' and user_id = v_uid) then raise exception 'not_p1'; end if;
  -- A friends-only party is never listed publicly.
  if r.friends_only then
    delete from public.lobby_live_games where game_id = v_game and user_id = v_uid;
    return 0;
  end if;
  select coalesce(d.name, (select string_agg(s.name, ' & ' order by s.seat) from public.versus_group_seats s where s.match_id = m.id))
    into v_name from public.duos_teams d where d.id = m.ranked_team;
  v_name := coalesce(v_name, (select string_agg(s.name, ' & ' order by s.seat) from public.versus_group_seats s where s.match_id = m.id));
  select coalesce(hero, 'warden') into v_hero from public.versus_group_seats where match_id = m.id and seat = 'p1';
  select * into k from public.duos_team_ranks where team_id = m.ranked_team and season = 3;
  delete from public.lobby_live_games where last_seen_at < now() - interval '10 minutes';
  delete from public.lobby_live_games where user_id = v_uid and game_id <> v_game;
  select count(*) into v_watchers from public.versus_members where room_id = p_room and role = 'spectator';
  insert into public.lobby_live_games (game_id, user_id, display_name, hero_id, cosmetics, division_index, rank_points, rating, round, phase, spectators)
    values (v_game, v_uid, left(coalesce(nullif(trim(v_name), ''), 'Duo'), 40), coalesce(v_hero, 'warden'), null,
            coalesce(k.division, 0), coalesce(k.points, 0), 100 * coalesce(k.division, 0) + coalesce(k.points, 0),
            greatest(1, least(200, coalesce(p_round, 1))), p_phase, v_watchers)
    on conflict (game_id) do update set
      display_name = excluded.display_name, hero_id = excluded.hero_id, division_index = excluded.division_index,
      rank_points = excluded.rank_points, rating = excluded.rating, round = excluded.round, phase = excluded.phase,
      spectators = excluded.spectators, last_seen_at = now()
    where public.lobby_live_games.user_id = v_uid;
  return v_watchers;
end;
$$;

-- ── Grants ────────────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function public.versus__room_visible(public.versus_rooms, uuid) from public, anon, authenticated;
revoke all on function public.versus_set_friends_only(uuid, boolean) from public, anon;
grant execute on function public.versus_set_friends_only(uuid, boolean) to authenticated;
revoke all on function public.duos_leaderboard(int, int) from public, anon;
grant execute on function public.duos_leaderboard(int, int) to authenticated;
revoke all on function public.duos_teams_of(uuid) from public, anon;
grant execute on function public.duos_teams_of(uuid) to authenticated;
revoke all on function public.lobby_live_duos_heartbeat(uuid, int, text) from public, anon;
grant execute on function public.lobby_live_duos_heartbeat(uuid, int, text) to authenticated;
