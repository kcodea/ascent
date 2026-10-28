-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- VERSUS CUTOVER: the per-mode host switch + Cloudflare room invites (2026-11-05, feat/versus-cf-cutover).
-- Run AFTER 2026-10-28-friends.sql. Independent of 2026-11-04-versus-cf-writer.sql (apply that one before any
-- mode is flipped to 'cf', or Cloudflare matches leave no records). Idempotent. Docs: docs/versus-cf-cutover.md.
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Owner decision 2026-10-28: live Versus moves to Cloudflare Durable Objects one mode at a time, with no downtime and an
-- instant rollback. This file adds:
--
--   1. versus_host_config: one row per mode, host 'supabase' | 'cf'. It decides where NEW rooms of that mode are created
--      and nothing else: a room keeps its host for life (the client remembers it), so flipping a mode back to
--      'supabase' is the rollback (new rooms go to Supabase at once; Cloudflare rooms finish where they are).
--      Every mode starts on 'supabase'. Flip with plain SQL (docs/versus-cf-cutover.md), no game build needed.
--   2. versus_host_config(): the client's read. One jsonb of four short strings ({"duel":"supabase",...}), read once at
--      launch and at most every 30 s while creating rooms, and only by builds that carry a Cloudflare Worker URL.
--   3. friends_invite accepts a Cloudflare room: target 'cf:<room uuid>' with kind 'versus_room'. Postgres cannot see
--      a Cloudflare room, so the room checks (open, I am in it, they are not) are the Worker's at join time; the
--      friendship, online, block and rate checks still run here exactly as before.

-- ── 1. The switch ──────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.versus_host_config (
  mode        text primary key check (mode in ('duel', 'group', 'duos', 'ranked_duos')),
  host        text not null default 'supabase' check (host in ('supabase', 'cf')),
  updated_at  timestamptz not null default now(),
  note        text
);
insert into public.versus_host_config (mode, host) values
  ('duel', 'supabase'), ('group', 'supabase'), ('duos', 'supabase'), ('ranked_duos', 'supabase')
on conflict (mode) do nothing;
alter table public.versus_host_config enable row level security; -- no policies: read only through the function
revoke all on public.versus_host_config from anon, authenticated;

-- ── 2. The read ────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.versus_host_config()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(mode, host), '{}'::jsonb) from public.versus_host_config;
$$;
revoke all on function public.versus_host_config() from public;
grant execute on function public.versus_host_config() to anon, authenticated;

-- ── 3. Invites to a Cloudflare room ────────────────────────────────────────────────────────────────────────
-- As 2026-10-28-friends.sql, plus the 'cf:<uuid>' target. Everything else is unchanged.
create or replace function public.friends_invite(p_user uuid, p_kind text, p_target text)
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
  if p_kind = 'versus_room' and p_target like 'cf:%' then
    -- A Cloudflare room: only the id's shape is checkable here; the Worker refuses a closed / started room at join.
    begin v_room := substr(p_target, 4)::uuid; exception when others then raise exception 'bad_target'; end;
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
revoke all on function public.friends_invite(uuid, text, text) from public, anon;
grant execute on function public.friends_invite(uuid, text, text) to authenticated;
