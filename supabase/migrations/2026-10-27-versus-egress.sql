-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- VERSUS EGRESS (2026-10-27, perf/supabase-egress-audit). Run AFTER 2026-10-26-versus-lock-order.sql.
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Measured 2026-10-26 (scripts/egress-probe.mjs): every member's 4-second heartbeat rewrote its versus_members row and
-- Realtime pushed each rewrite to every client in the room (~0.9 KB x members x subscribers per beat: 34 KB/min per
-- client in a 1v1, 52 KB/min in Duos, the biggest Versus egress line). The client no longer subscribes to member rows
-- (R-NET-REALTIME-01); everything it learned from them now comes another way, which this file adds:
--
--   1. versus_heartbeat bumps the ROOM's revision when a member comes BACK (their previous beat was older than the
--      12 s lease). That one room update wakes every client at once, exactly when the old member update did, so the
--      "<name> is back" notice shows as fast as before. A beat from someone already present bumps nothing.
--   2. versus_heartbeat answers `seen` (each room member's last beat) while the room's match is PAUSED, so the
--      notice stays right while the pause lasts. Outside a pause the answer is unchanged.
--   3. versus_list_rooms (every room browser calls it every 5 s) no longer prunes on every call: the prune runs at most
--      once per 30 s across all callers (a housekeeping row taken with SKIP LOCKED, so a list never waits), and a
--      prune now bumps the revision of each room it removed members from (those rooms' clients re-read the room, as the
--      old member DELETE event made them do).
--
-- Same lock order as 2026-10-26-versus-lock-order.sql (match, room, members; R-VERSUS-LOCK-ORDER-01), proved by
-- packages/sim/src/versus/versusLockOrder.test.ts. Old clients keep working: the member subscription they still hold
-- just receives fewer updates (an old client shows "has not come back" instead of "is back" until it reloads), and the
-- extra `seen` field is ignored. Idempotent.

create table if not exists public.versus_housekeeping (
  id         int primary key,
  pruned_at  timestamptz not null default 'epoch'
);
insert into public.versus_housekeeping (id) values (1) on conflict (id) do nothing;
alter table public.versus_housekeeping enable row level security; -- no policies: only the SECURITY DEFINER RPCs touch it
revoke all on public.versus_housekeeping from anon, authenticated;

create or replace function public.versus_heartbeat(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_now timestamptz := public.versus_clock();
  r public.versus_rooms;
  m public.versus_matches;
  g public.versus_group_matches;
  v_role text;
  v_prev timestamptz;
  v_seat text;
  v_out jsonb;
  v_paused boolean := false;
begin
  -- Plain reads first (no row locks): who am I in this room, when did I last beat, and is a match running.
  select role, last_seen_at into v_role, v_prev from public.versus_members where room_id = p_room and user_id = v_user;
  if v_role is null then raise exception 'not_a_member'; end if;
  select * into r from public.versus_rooms where id = p_room;
  -- A seated player locks the MATCH first (the order every match writer uses), then its seat, then the room, then
  -- its member row last. A spectator takes no match lock at all.
  if r.current_match_id is not null then
    if v_role <> 'spectator' then
      select * into m from public.versus_matches where id = r.current_match_id for update;
      if not found then select * into g from public.versus_group_matches where id = r.current_match_id for update; end if;
    else
      select * into m from public.versus_matches where id = r.current_match_id;
      if not found then select * into g from public.versus_group_matches where id = r.current_match_id; end if;
    end if;
  end if;
  if m.id is not null then
    v_paused := m.paused_at is not null and m.phase <> 'complete';
    v_seat := case when v_role <> 'spectator' then public.versus__seat_of(m, v_user) end;
    if v_seat is not null and m.phase <> 'complete' then
      if (v_seat = 'p1' and m.p1_auto) or (v_seat = 'p2' and m.p2_auto) then
        update public.versus_matches set
          p1_auto = case when v_seat = 'p1' then false else p1_auto end, p1_missed = case when v_seat = 'p1' then 0 else p1_missed end,
          p2_auto = case when v_seat = 'p2' then false else p2_auto end, p2_missed = case when v_seat = 'p2' then 0 else p2_missed end,
          revision = revision + 1, updated_at = v_now
          where id = m.id returning * into m;
      end if;
      v_out := jsonb_build_object('serverNow', v_now, 'match', public.versus__match_json(m));
    end if;
  elsif g.id is not null then
    v_paused := g.paused_at is not null and g.phase <> 'complete';
    if v_role <> 'spectator' and g.phase <> 'complete' then
      v_seat := public.versus_group__seat_of(g.id, v_user);
      if v_seat is not null then
        update public.versus_group_seats set auto = false, missed = 0
          where match_id = g.id and seat = v_seat and auto and eliminated_round is null;
        if found then g := public.versus_group__touch(g.id); end if;
        v_out := jsonb_build_object('serverNow', v_now, 'groupMatch', public.versus_group__match_json(g));
      end if;
    end if;
  end if;
  -- Back after a lapse (no beat for a lease): the room's revision wakes every client now (the "is back" notice).
  if v_prev is null or v_prev < v_now - interval '12 seconds' then
    update public.versus_rooms set revision = revision + 1, updated_at = v_now where id = p_room;
  end if;
  update public.versus_members set last_seen_at = v_now where room_id = p_room and user_id = v_user;
  if not found then raise exception 'not_a_member'; end if;
  v_out := coalesce(v_out, jsonb_build_object('serverNow', v_now));
  -- While the match is paused: every member's last beat (who is back), a few dozen bytes per member.
  if v_paused then
    v_out := v_out || jsonb_build_object('seen', (select coalesce(jsonb_object_agg(user_id, last_seen_at), '{}'::jsonb)
      from public.versus_members where room_id = p_room));
  end if;
  return v_out;
end;
$$;

create or replace function public.versus_list_rooms()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
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
      'spectators', (select count(*) from public.versus_members where room_id = r.id and role = 'spectator')
    ) as j from public.versus_rooms r) q), '[]'::jsonb);
end;
$$;
