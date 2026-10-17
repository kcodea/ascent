-- LIVE RANKED LOBBY GAMES: a spectator sees the OTHER spectators (owner 2026-10-16: "add a feature that allows
-- spectators to emote to players and they can see in the top left where the spectators are"; R-SPECTATE-EMOTE-01).
--
-- `lobby_live_watchers(p_game)` was readable by the PLAYER only. A spectator's own top-left row now lists the other
-- people watching the same game, and a fellow spectator's emote pops from their chip, so a CURRENT watcher of the game
-- (a watcher row seen in the last 30 s, the same window the heartbeat counts) may read the list too. Nothing else
-- changes: same columns (user id, display name, profile), same 30 s window, same cap of 20, still nobody else.
--
-- Additive and backward compatible: the player's read is unchanged, and a client that never asks is unaffected. Until
-- this is applied, a spectator's read is refused (`no_game`) and their row shows only themselves; spectator emotes
-- still reach the player either way. Apply after `2026-10-15-lobby-live-watcher-identity.sql`.

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
  if not exists (select 1 from public.lobby_live_games where game_id = p_game and user_id = v_uid)
     and not exists (select 1 from public.lobby_live_watchers
                     where game_id = p_game and user_id = v_uid and last_seen_at > now() - interval '30 seconds') then
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

revoke all on function public.lobby_live_watchers(text) from public, anon;
grant execute on function public.lobby_live_watchers(text) to authenticated;
