-- LIVE RANKED LOBBY GAMES: who is watching (owner 2026-10-15: "can we add something in the ui for a player in the top
-- left if a spectator joins? it can show their portrait and name and say spectating?"; R-SPECTATE-WATCHERS-01).
--
-- The watcher rows gain the watcher's display name and profile (avatar + equipped cosmetics, the same shape and 4 KB
-- cap as a Versus room member's `profile`), written by the watcher's own `lobby_live_watch_as` call. The PLAYER reads
-- its own game's live watchers with `lobby_live_watchers` (nobody else can: no read policy on the table).
--
-- Additive and backward compatible: `lobby_live_watch(p_game)` is unchanged (an older client keeps working; its row
-- simply has no name, which the indicator shows as "Spectator"). Apply after `2026-10-15-lobby-live.sql`.

alter table public.lobby_live_watchers add column if not exists display_name text not null default ''
  check (char_length(display_name) <= 40);
alter table public.lobby_live_watchers add column if not exists profile jsonb not null default '{}'::jsonb
  check (octet_length(profile::text) <= 4096);

-- Watch (or refresh) WITH an identity. Same rules as `lobby_live_watch`: signed in, a live game, not your own, cap 20.
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

-- The player's own game's LIVE watchers (seen in the last 30 s, as the heartbeat counts them): name + profile, never
-- the user id of anyone else's game. A JSON array, at most 20 (the watcher cap).
create or replace function public.lobby_live_watchers(p_game text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if not exists (select 1 from public.lobby_live_games where game_id = p_game and user_id = v_uid) then
    raise exception 'no_game';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', w.user_id, 'display_name', w.display_name, 'profile', w.profile) order by w.last_seen_at)
    from (
      select user_id, display_name, profile, last_seen_at from public.lobby_live_watchers
      where game_id = p_game and last_seen_at > now() - interval '30 seconds'
      order by last_seen_at limit 20
    ) w
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.lobby_live_watch_as(text, text, jsonb) from public, anon;
revoke all on function public.lobby_live_watchers(text) from public, anon;
grant execute on function public.lobby_live_watch_as(text, text, jsonb) to authenticated;
grant execute on function public.lobby_live_watchers(text) to authenticated;
