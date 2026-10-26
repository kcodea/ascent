-- LIVE GAMES: HERO SELECT IS WATCHABLE (owner 2026-10-26: "I want spectating to show up when a player goes into hero
-- select. this should work in all modes. hero select should be spectatable."; R-SPECTATE-HEROSELECT-01).
--
-- A ranked lobby game is now listed from its Hero Select (the ranked entry's id is the game id, the same id the run takes
-- at the pick), with the new phase 'hero'. While on Hero Select the row's hero is the picked hero once there is one, else
-- the first offered (the list says "Picking a hero" for this phase). Nothing else changes: the frame table already takes
-- any keyframe (a Hero Select frame is small), and every other RPC is phase-blind.
--
-- Additive and idempotent. Apply after 2026-10-15-lobby-live.sql. A client on a server without it simply is not listed
-- until its shop opens (the heartbeat's 'bad_phase' is caught), as before.

alter table public.lobby_live_games drop constraint if exists lobby_live_games_phase_check;
alter table public.lobby_live_games add constraint lobby_live_games_phase_check check (phase in ('hero', 'shop', 'combat', 'end'));

create or replace function public.lobby_live_heartbeat(
  p_game text, p_name text, p_hero text, p_cosmetics jsonb, p_round int, p_phase text
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  prof public.profiles;
  v_watchers int;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if p_phase not in ('hero', 'shop', 'combat', 'end') then raise exception 'bad_phase'; end if;
  -- Housekeeping: games silent for 10 minutes and watchers silent for 2 are gone for good.
  delete from public.lobby_live_games where last_seen_at < now() - interval '10 minutes';
  delete from public.lobby_live_watchers where last_seen_at < now() - interval '2 minutes';
  select * into prof from public.profiles where user_id = v_uid;
  -- One live game per player: a new game id replaces the old row (and its watchers and frames, by cascade).
  delete from public.lobby_live_games where user_id = v_uid and game_id <> p_game;
  select count(*) into v_watchers from public.lobby_live_watchers
    where game_id = p_game and last_seen_at > now() - interval '30 seconds';
  insert into public.lobby_live_games (game_id, user_id, display_name, hero_id, cosmetics, division_index, rank_points, rating, round, phase, spectators)
    values (p_game, v_uid, left(coalesce(nullif(trim(p_name), ''), 'Player'), 40), p_hero, p_cosmetics,
            coalesce(prof.rank_division, 0), coalesce(prof.rank_points, 0), coalesce(prof.rating, 0),
            greatest(1, least(200, p_round)), p_phase, v_watchers)
    on conflict (game_id) do update set
      display_name = excluded.display_name, hero_id = excluded.hero_id, cosmetics = excluded.cosmetics,
      division_index = excluded.division_index, rank_points = excluded.rank_points, rating = excluded.rating,
      round = excluded.round, phase = excluded.phase, spectators = excluded.spectators, last_seen_at = now()
    where public.lobby_live_games.user_id = v_uid;
  return v_watchers;
end;
$$;

revoke all on function public.lobby_live_heartbeat(text, text, text, jsonb, int, text) from public, anon;
grant execute on function public.lobby_live_heartbeat(text, text, text, jsonb, int, text) to authenticated;
