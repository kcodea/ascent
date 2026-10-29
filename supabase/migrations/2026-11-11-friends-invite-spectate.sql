-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- FRIENDS: "INVITE TO SPECTATE" (2026-11-11, feat/ingame-friends-dock). Run AFTER
-- 2026-11-08-versus-cf-live-games-invites.sql (the four-argument `friends_invite` this replaces, `versus_cf__invite_proof_ok`)
-- and 2026-11-10-lobby-live-cf.sql (Cloudflare-hosted lobby games keep a `lobby_live_games` row). Idempotent.
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- OWNER (2026-10-29): "There should be a right click -> spectate/invite to lobby/invite to duos/invite to spectate
-- features as well from this friends list". R-FRIENDS-MENU-02.
--
-- A new invite kind, 'spectate': "come and watch MY game". The friend gets the normal invite notice; Accept drops them
-- straight into watching (the client's existing Watch paths). The target names the game:
--   - `live:<game id>`: a lobby / Practice game on Live Games (either host). Checked here: a listed row of that id that
--     is MINE and still live (the read policy's own freshness rule).
--   - `versus:<room ref>` / `duos:<room ref>` (a Ranked Duos room): a Versus match. A Supabase room is checked here (I
--     am in it, its game is running, the friend is not in it yet); a Cloudflare room (`cf:<id>`) cannot be seen from
--     Postgres, so the ROOM ran those checks and signed this exact invite (kind 'spectate'), as for room invites
--     (R-VERSUS-CF-INVITE-01). A new error code: `no_game` (that game is not running / not mine).
-- Everything else (friends, blocked, online, the hourly rate, one pending invite per friend and kind) is unchanged.

alter table public.friend_invites drop constraint if exists friend_invites_kind;
alter table public.friend_invites add constraint friend_invites_kind check (kind in ('versus_room', 'duos_party', 'spectate'));

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
      -- My own live game, still listed.
      if not exists (select 1 from public.lobby_live_games g where g.game_id = substr(p_target, 6) and g.user_id = v_me
          and (g.last_seen_at > now() - interval '60 seconds' or g.live_until > now())) then
        raise exception 'no_game';
      end if;
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
