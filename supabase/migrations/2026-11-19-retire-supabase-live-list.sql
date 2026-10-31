-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- RETIRE THE SUPABASE LIVE LIST, THE PRESENCE BEAT AND THE INVITE WAKE-UP (2026-11-19, feat/cf-live-directory).
-- R-LIVE-DIR-01, R-FRIENDS-HUB-LIVE-01; runbook docs/versus-cf-cutover.md ("Live Games and friends on the hub").
-- Run AFTER 2026-11-18-live-directory.sql, about 24 HOURS AFTER the first pack built from this branch is live (only a
-- tab left open from before that upload still reads the Supabase list or beats). Idempotent. NOT applied by the builder.
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- CHECK FIRST (both should read as expected; if the first is not 0, wait and run it again):
--
--   -- older clients still beating in the last 15 minutes (expected 0, or a stray tab or two):
--   select count(*) from public.player_presence where source = 'beat' and updated_at > now() - interval '15 minutes';
--   -- the hub's mirror is working (expected > 0 whenever anyone with friends is online):
--   select count(*) from public.player_presence where source = 'hub' and updated_at > now() - interval '15 minutes';
--
-- WHAT IT DOES (sections 1 to 5). Live Games, its glow count and a friend's Watch read the friends hub's directory now; presence, friend
-- requests and invites arrive over the hub socket. So:
--   1. `versus_cf_live` / `lobby_live_cf` (the Versus Workers' Supabase listing writers) still check the key, then write
--      NOTHING and answer `{ ok, retired: true }`: each Worker object stops calling them for its life (`live.ts`).
--   2. Every `lobby_live_games` row is cleared (the table is transient; it is NOT dropped) and nobody may read it any
--      more: an old tab's Live Games page reads as empty.
--   3. `friends_beat` is refused (`beat_moved`): an old tab's beat backs off and its inbox stops updating; presence is
--      the hub's mirror (`hub_presence_cf`). Nothing else in the friends SQL changes: `friends_list`, requests, invites
--      and `friends__online` (which reads the mirrored row) stay.
--   4. `friend_invites` leaves the Realtime publication (the invite wake-up is the hub's `inbox` push now).
--   5. `friends_invite`'s `live:<game>` spectate target no longer looks for MY `lobby_live_games` row (the table is empty
--      now): the id must be well formed. Every listed public game is watchable by anyone from Live Games anyway.
--
-- STORAGE STAYS IN SUPABASE: friendships, requests, blocks, invites, direct messages, presence rows (as a mirror),
-- results, ratings. Nothing here drops a table.

-- ── 1. the Worker listing writers: retired, never an error ──────────────────────────────────────────────────
create or replace function public.versus_cf_live(p_key text, p_room uuid, p_row jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_key is null or not exists (select 1 from public.versus_cf_writer_keys
      where key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex')) then
    raise exception 'not_authorized';
  end if;
  return jsonb_build_object('ok', true, 'retired', true);
end;
$$;
revoke all on function public.versus_cf_live(text, uuid, jsonb) from public;
grant execute on function public.versus_cf_live(text, uuid, jsonb) to anon, authenticated;

create or replace function public.lobby_live_cf(p_key text, p_game text, p_row jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_key is null or not exists (select 1 from public.versus_cf_writer_keys
      where key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex')) then
    raise exception 'not_authorized';
  end if;
  return jsonb_build_object('ok', true, 'retired', true);
end;
$$;
revoke all on function public.lobby_live_cf(text, text, jsonb) from public;
grant execute on function public.lobby_live_cf(text, text, jsonb) to anon, authenticated;

-- ── 2. the Supabase list: empty, and unreadable ────────────────────────────────────────────────────────────
delete from public.lobby_live_games;
drop policy if exists "lobby live read games" on public.lobby_live_games;
revoke select on public.lobby_live_games from anon, authenticated;

-- ── 3. the presence beat ───────────────────────────────────────────────────────────────────────────────────
create or replace function public.friends_beat(p_status text, p_mode text default null, p_watch_kind text default null,
  p_watch_id text default null, p_game jsonb default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  raise exception 'beat_moved';
end;
$$;
revoke all on function public.friends_beat(text, text, text, text, jsonb) from public, anon;
grant execute on function public.friends_beat(text, text, text, text, jsonb) to authenticated;

-- ── 4. the invite wake-up ──────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'friend_invites') then
    alter publication supabase_realtime drop table public.friend_invites;
  end if;
end;
$$;

-- ── 5. invite to spectate a live lobby game: no Supabase row to check any more ─────────────────────────────
-- `friends_invite` (2026-11-11-friends-invite-spectate.sql) checked a `live:<game>` target against MY `lobby_live_games`
-- row. That table is empty now, so the check is only that the id is well formed; every other rule is unchanged.
create or replace function public.friends_invite(p_user uuid, p_kind text, p_target text, p_proof text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.friends__me();
  v_room uuid;
  v_status text;
  v_ref text;
  i public.friend_invites;
begin
  if p_kind is null or p_kind not in ('versus_room', 'duos_party', 'spectate') then raise exception 'bad_kind'; end if;
  if p_target is null or char_length(p_target) not between 1 and 64 then raise exception 'bad_target'; end if;
  if p_user is null or p_user = v_me then raise exception 'self'; end if;
  if public.friends__blocked(v_me, p_user) then raise exception 'blocked'; end if;
  if not public.friends__are_friends(v_me, p_user) then raise exception 'not_friends'; end if;
  if not public.friends__online(p_user) then raise exception 'not_online'; end if;
  if p_kind = 'spectate' then
    if p_target like 'live:%' then
      -- A live lobby / Practice game: listed on the friends hub now, which Postgres cannot see. Its id must be well
      -- formed; the friend's Watch asks the hub and says so when the game is over. (Every listed public game is
      -- watchable by anyone from Live Games, so this check never guarded who may watch.)
      if p_target !~ '^live:[!-~]{1,58}$' then raise exception 'bad_target'; end if;
    elsif p_target like 'versus:%' or p_target like 'duos:%' then
      v_ref := regexp_replace(p_target, '^(versus|duos):', '');
      if v_ref like 'cf:%' then
        begin v_room := substr(v_ref, 4)::uuid; exception when others then raise exception 'bad_target'; end;
        if not public.versus_cf__invite_proof_ok(v_room, v_me, p_user, p_kind, p_proof) then raise exception 'room_check'; end if;
      else
        begin v_room := v_ref::uuid; exception when others then raise exception 'bad_target'; end;
        select r.status into v_status from public.versus_rooms r where r.id = v_room;
        if v_status is null then raise exception 'no_game'; end if;
        if not exists (select 1 from public.versus_members m where m.room_id = v_room and m.user_id = v_me) then raise exception 'not_in_room'; end if;
        if v_status <> 'in_game' then raise exception 'no_game'; end if;
        if exists (select 1 from public.versus_members m where m.room_id = v_room and m.user_id = p_user) then raise exception 'already_in_room'; end if;
      end if;
    else
      raise exception 'bad_target';
    end if;
  elsif p_target like 'cf:%' then
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
