-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- LIVE INFORMATION ON CLOUDFLARE: the friends hub's two writers (2026-11-18, feat/cf-live-directory). R-LIVE-DIR-01,
-- R-FRIENDS-HUB-LIVE-01; runbook docs/versus-cf-cutover.md ("Live Games and friends on the hub").
-- Run AFTER 2026-11-10-friends-activity.sql (the friends_beat this re-creates), 2026-11-12-direct-messages.sql (the
-- hub's writer key row) and 2026-11-07-versus-cf-ranked.sql (duos_team_ranks). APPLY IT BEFORE uploading the first pack
-- built from this branch: that pack's clients no longer beat, so their presence comes only from the hub's mirror (and
-- `friends_invite` refuses an invite to a friend whose presence row is stale). Idempotent. No secret in here.
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- OWNER (2026-10-30): "I want us to make cloudflare work as our source for live information and action like spectating".
--
-- 1. `hub_presence_cf(p_key, p_user, p_presence)`: the friends hub (`ascent-hub`) is now the live source of presence (its
--    sockets push it to connected friends at once). It MIRRORS each connected account's presence into `player_presence`
--    on a change, every 2.5 minutes while connected, and Offline at the last close, so the server-side "is this friend
--    online" check (`friends__online`, used by `friends_invite`) and an older client's friends list keep reading it.
--    Key-gated like every Cloudflare writer (`versus_cf_writer_keys`; the hub's own key, note 'ascent-hub'), never the
--    service role. Same cleaning as `friends_beat`.
-- 2. `live_dir_meta(p_key, p_users, p_teams)`: the hub's Live Games directory looks up the rank of a listed player
--    (`profiles`) or Ranked Duos team (`duos_teams` + `duos_team_ranks`, season 3), once per 10 minutes per id (the SQL
--    listing used to read them on every row write). At most 50 of each per call.
-- 3. `player_presence.source`: 'hub' (the mirror) or 'beat' (an older client's `friends_beat`), so the retire migration's
--    check query can see when no older client is still beating. `friends_beat` is re-created unchanged apart from
--    stamping it.

create extension if not exists pgcrypto with schema extensions;

alter table public.player_presence add column if not exists source text;
alter table public.player_presence drop constraint if exists player_presence_source;
alter table public.player_presence add constraint player_presence_source check (source is null or source in ('hub', 'beat'));

-- ── 1. The hub's presence mirror ───────────────────────────────────────────────────────────────────────────
create or replace function public.hub_presence_cf(p_key text, p_user uuid, p_presence jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_mode text;
  v_wk text;
  v_wid text;
  v_game jsonb;
begin
  if p_key is null or not exists (select 1 from public.versus_cf_writer_keys
      where key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex')) then
    raise exception 'not_authorized';
  end if;
  if p_user is null or not exists (select 1 from auth.users u where u.id = p_user) then raise exception 'bad_user'; end if;
  -- null (or anything that is not a presence) = offline.
  v_status := case when jsonb_typeof(p_presence) = 'object' and p_presence->>'status' in ('online', 'in_game') then p_presence->>'status' else 'offline' end;
  if v_status <> 'offline' then
    v_mode := nullif(left(coalesce(p_presence->>'mode', ''), 24), '');
    if v_mode is not null and v_mode !~ '^[a-z0-9_]{1,24}$' then v_mode := null; end if;
    if p_presence->>'watchKind' in ('live', 'versus') and coalesce(p_presence->>'watchId', '') <> '' then
      v_wk := p_presence->>'watchKind';
      v_wid := left(p_presence->>'watchId', 64);
    end if;
    -- The beat's `p_game` slot: an in-game status, or an online activity (R-FRIENDS-ACTIVITY-01). Junk is dropped.
    v_game := case when v_status = 'in_game' then p_presence->'game' else p_presence->'activity' end;
    if v_game is not null and (jsonb_typeof(v_game) <> 'object' or octet_length(v_game::text) > 1024) then v_game := null; end if;
  end if;
  insert into public.player_presence (user_id, status, mode, watch_kind, watch_id, updated_at, game, source)
    values (p_user, v_status, v_mode, v_wk, v_wid, now(), v_game, 'hub')
    on conflict (user_id) do update set status = excluded.status, mode = excluded.mode, watch_kind = excluded.watch_kind,
      watch_id = excluded.watch_id, updated_at = excluded.updated_at, game = excluded.game, source = 'hub';
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.hub_presence_cf(text, uuid, jsonb) from public;
grant execute on function public.hub_presence_cf(text, uuid, jsonb) to anon, authenticated;

-- ── 2. The directory's rank lookup ─────────────────────────────────────────────────────────────────────────
create or replace function public.live_dir_meta(p_key text, p_users uuid[], p_teams uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_key is null or not exists (select 1 from public.versus_cf_writer_keys
      where key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex')) then
    raise exception 'not_authorized';
  end if;
  if coalesce(array_length(p_users, 1), 0) > 50 or coalesce(array_length(p_teams, 1), 0) > 50 then raise exception 'too_many'; end if;
  return jsonb_build_object(
    'users', coalesce((select jsonb_object_agg(p.user_id::text, jsonb_build_object(
        'division', coalesce(p.rank_division, 0), 'points', coalesce(p.rank_points, 0), 'rating', coalesce(p.rating, 0)))
      from public.profiles p where p.user_id = any(coalesce(p_users, '{}'::uuid[]))), '{}'::jsonb),
    'teams', coalesce((select jsonb_object_agg(t.id::text, jsonb_build_object(
        'name', t.name, 'division', coalesce(k.division, 0), 'points', coalesce(k.points, 0),
        'rating', 100 * coalesce(k.division, 0) + coalesce(k.points, 0)))
      from public.duos_teams t left join public.duos_team_ranks k on k.team_id = t.id and k.season = 3
      where t.id = any(coalesce(p_teams, '{}'::uuid[]))), '{}'::jsonb)
  );
end;
$$;
revoke all on function public.live_dir_meta(text, uuid[], uuid[]) from public;
grant execute on function public.live_dir_meta(text, uuid[], uuid[]) to anon, authenticated;

-- ── 3. friends_beat (2026-11-10-friends-activity.sql), stamping its rows 'beat' ────────────────────────────
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
  v_game jsonb := case when p_status in ('online', 'in_game') and jsonb_typeof(p_game) = 'object' and octet_length(p_game::text) <= 1024 then p_game end;
begin
  if p_status is null or p_status not in ('online', 'in_game', 'offline') then raise exception 'bad_status'; end if;
  if v_mode is not null and v_mode !~ '^[a-z0-9_]{1,24}$' then v_mode := null; end if;
  insert into public.player_presence (user_id, status, mode, watch_kind, watch_id, updated_at, game, source)
    values (v_me, p_status, v_mode, v_wk, v_wid, now(), v_game, 'beat')
    on conflict (user_id) do update set status = excluded.status, mode = excluded.mode, watch_kind = excluded.watch_kind,
      watch_id = excluded.watch_id, updated_at = excluded.updated_at, game = excluded.game, source = 'beat';
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
