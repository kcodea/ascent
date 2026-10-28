-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- VERSUS ON CLOUDFLARE: Live Games rows + invite checks at send time (2026-11-08, fix/versus-cf-livegames-invites).
-- Run AFTER 2026-11-07-versus-cf-ranked.sql (needs versus_cf_writer_keys, 2026-11-04) and 2026-11-05-versus-host-config.sql
-- (the friends_invite this replaces). Idempotent. No secret in here: both pieces reuse the Worker's writer key hashes.
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- 1. LIVE GAMES (R-VERSUS-CF-LIVE-01). A Cloudflare Ranked Duos room publishes its team's row itself, as
--    `duos:cf:<room>`, through ONE limited, key-gated function (owner ruling 2026-10-28: never the service role):
--    `versus_cf_live(p_key, p_room, p_row)`. It can only upsert or remove a `duos:cf:` row. Name, medal and rating are
--    looked up here from the team id, as `lobby_live_duos_heartbeat` does. To keep egress low the room writes only when
--    the listing changes (start, round, phase, end) plus a keep-alive every 2 minutes, never every 15 s; so a Cloudflare
--    row carries `live_until` (4 minutes past its last write) and the read policy shows it until then. Every other row
--    keeps the 60 s rule unchanged (`live_until` is null on them).
--    1v1, Group and Versus Duos are not on Live Games on either backend (Friends "Watch" covers them), so nothing here.
--
-- 2. INVITES (R-VERSUS-CF-INVITE-01). `friends_invite` gains `p_proof`. A `cf:<room>` target must carry a proof the
--    room signed after running the same checks this function runs on a Supabase room (open, inviter inside, invitee
--    not): `<expiry epoch s>.<hex hmac-sha256>` over `ascent.invite.v1|<room>|<from>|<to>|<kind>|<expiry>`, keyed with
--    one of `versus_cf_writer_keys.key_hash` (the sha256 of the Worker's writer secret). Bound to the room, both users and
--    the kind; at most 5 minutes ahead (the Worker issues 2). A Supabase target is checked exactly as before, and a call
--    without `p_proof` (every older client) still resolves to this function through the default.

create extension if not exists pgcrypto with schema extensions;

-- ── 1. Live Games ──────────────────────────────────────────────────────────────────────────────────────────
alter table public.lobby_live_games add column if not exists live_until timestamptz;

drop policy if exists "lobby live read games" on public.lobby_live_games;
create policy "lobby live read games" on public.lobby_live_games for select to anon, authenticated
  using (last_seen_at > now() - interval '60 seconds' or live_until > now());

create or replace function public.versus_cf_live(p_key text, p_room uuid, p_row jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game text;
  v_p1 uuid;
  v_team uuid;
  v_phase text;
  v_name text;
  v_hero text;
  k public.duos_team_ranks;
begin
  if p_key is null or not exists (select 1 from public.versus_cf_writer_keys
      where key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex')) then
    raise exception 'not_authorized';
  end if;
  if p_room is null then raise exception 'bad_row'; end if;
  v_game := 'duos:cf:' || p_room::text;
  -- Removal: the match ended, the room closed, or the party went friends-only.
  if p_row is null or jsonb_typeof(p_row) <> 'object' or p_row->>'phase' = 'end' then
    delete from public.lobby_live_games where game_id = v_game;
    return jsonb_build_object('ok', true, 'removed', true);
  end if;
  if octet_length(p_row::text) > 4096 then raise exception 'bad_row'; end if;
  v_phase := p_row->>'phase';
  if v_phase is null or v_phase not in ('hero', 'shop', 'combat') then raise exception 'bad_phase'; end if;
  begin v_p1 := (p_row->>'p1')::uuid; exception when others then raise exception 'bad_row'; end;
  if v_p1 is null then raise exception 'bad_row'; end if;
  if coalesce(p_row->>'team', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v_team := (p_row->>'team')::uuid; end if;
  select d.name into v_name from public.duos_teams d where d.id = v_team;
  v_name := left(coalesce(nullif(trim(v_name), ''), nullif(trim(p_row->>'names'), ''), 'Duo'), 40);
  v_hero := left(coalesce(nullif(trim(p_row->>'hero'), ''), 'warden'), 60);
  select * into k from public.duos_team_ranks where team_id = v_team and season = 3;
  -- Housekeeping as the heartbeats do it (a live Cloudflare row is never silent for 10 minutes).
  delete from public.lobby_live_games where last_seen_at < now() - interval '10 minutes';
  -- One live game per player: the first seat's other row goes (and its watchers / frames by cascade).
  delete from public.lobby_live_games where user_id = v_p1 and game_id <> v_game;
  insert into public.lobby_live_games (game_id, user_id, display_name, hero_id, cosmetics, division_index, rank_points, rating,
      round, phase, spectators, live_until)
    values (v_game, v_p1, v_name, v_hero, null, coalesce(k.division, 0), coalesce(k.points, 0),
      100 * coalesce(k.division, 0) + coalesce(k.points, 0),
      greatest(1, least(200, coalesce((p_row->>'round')::int, 1))), v_phase,
      greatest(0, least(99, coalesce((p_row->>'spectators')::int, 0))), now() + interval '4 minutes')
    on conflict (game_id) do update set
      user_id = excluded.user_id, display_name = excluded.display_name, hero_id = excluded.hero_id,
      division_index = excluded.division_index, rank_points = excluded.rank_points, rating = excluded.rating,
      round = excluded.round, phase = excluded.phase, spectators = excluded.spectators,
      last_seen_at = now(), live_until = excluded.live_until;
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
