-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- FRIENDS ACTIVITY: what an ONLINE friend is doing (2026-11-10, feat/friend-activity-granular; R-FRIENDS-ACTIVITY-01).
-- Run AFTER 2026-10-28-friends.sql and 2026-11-09-friends-presence-window.sql (and after
-- 2026-11-08-versus-cf-live-games-invites.sql when it is applied: this file re-creates the same two functions, so it
-- must come last). Idempotent. NOT applied by the builder.
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Owner ask 2026-10-29: "Can we get more granular player online text in friends list like in main menu, browsing
-- career, browsing leaderboard, watching a replay, and then better in game granularity too".
--
-- The beat's `p_game` slot (a jsonb of at most 1 KB, `player_presence.game`) carried only an IN-GAME status. It now also
-- carries an ONLINE player's activity ({"v":1,"act":"career"}, {"v":1,"act":"versus_room","mode":"versus_group",
-- "players":3,"max":4}, ...), so the beat stores it for both 'online' and 'in_game', and `friends__presence` returns it
-- for both. Nothing else changes: same signature, same 1 KB cap, a junk or oversized value is still dropped (never an
-- error), Offline never carries one. A client older than this file never sends an online activity; a server older than
-- this file drops it (only an in-game status is kept), so either side can ship first.
--
-- Egress: no new call, no new column read. The beat is the same row and the list returns the same jsonb.

-- The column and its cap (also added by 2026-11-08; repeated so this file stands on the friends base alone).
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
      'lastSeen', pr.updated_at, 'game', case when pr.status in ('online', 'in_game') then pr.game end)
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
  -- An in-game status or an online activity; a junk or oversized value is dropped, never an error (the beat must
  -- always land). Offline never keeps one.
  v_game jsonb := case when p_status in ('online', 'in_game') and jsonb_typeof(p_game) = 'object' and octet_length(p_game::text) <= 1024 then p_game end;
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
