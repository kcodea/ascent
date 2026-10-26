-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- VERSUS LOCK ORDER (2026-10-26, DRAFT from perf/supabase-egress-audit; NOT APPLIED; owner/lead review first)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- The live Postgres log (2026-10-25 ~22:58 local) showed bursts of "deadlock detected" (40P01) with ~8 backends
-- queued on one versus_group_matches tuple. Two RPCs take the per-match locks in the OPPOSITE order to everything else:
--
--   versus_heartbeat   members row (UPDATE last_seen_at)  ->  match row (FOR UPDATE)
--   versus_leave_room  room row (FOR UPDATE)              ->  match row (FOR UPDATE)
--
-- while every match writer goes match first and reaches the members / room rows later:
--
--   versus_group_commit_round / versus_duos_commit_round / versus_group__eliminate (forfeit, leave, knockouts)
--     match (FOR UPDATE) -> seats (eliminated_round) -> TRIGGER versus_group__seat_out_to_stands -> members row
--     (role = 'spectator') -> room row (revision)
--   versus_group__complete / versus__complete: match -> room row (status = 'open')
--
-- So a knocked-out seat that heartbeats while its round commits (heartbeat holds its member row, waits on the match;
-- the commit holds the match, waits on that member row), or a player leaving while the match completes (leave holds
-- the room, waits on the match; complete holds the match, waits on the room), deadlocks. With one host tab driving
-- a human + 3 test bots (4 heartbeats every 4 s, each followed by a reconcile, a 500 ms reconcile tick, finalize
-- polling, Duos pass sync), the match row is hot enough that this happens in bursts.
--
-- THE RULE after this migration: a transaction that will touch a match AND its room / members / seats takes the
-- MATCH row lock FIRST. Only the two inverted functions change; their behaviour is otherwise identical (same answers,
-- same errors). Two side wins: a SPECTATOR's heartbeat no longer takes the match lock at all (it never needed it),
-- and a non-member heartbeat ('not_a_member') no longer locks anything.
--
-- Idempotent: CREATE OR REPLACE of both functions, same signatures, grants kept.

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
  v_seat text;
  v_is_duel boolean := false;
  v_is_group boolean := false;
begin
  -- Plain reads first (no row locks): who am I in this room, and is a match running.
  select role into v_role from public.versus_members where room_id = p_room and user_id = v_user;
  if v_role is null then raise exception 'not_a_member'; end if;
  select * into r from public.versus_rooms where id = p_room;
  -- A seated player locks the MATCH before its own member row (the lock order every match writer uses).
  if v_role <> 'spectator' and r.current_match_id is not null then
    select * into m from public.versus_matches where id = r.current_match_id for update;
    v_is_duel := found;
    if not v_is_duel then
      select * into g from public.versus_group_matches where id = r.current_match_id for update;
      v_is_group := found;
    end if;
  end if;
  update public.versus_members set last_seen_at = v_now where room_id = p_room and user_id = v_user;
  if not found then raise exception 'not_a_member'; end if;
  if v_is_duel then
    v_seat := public.versus__seat_of(m, v_user);
    if v_seat is not null and m.phase <> 'complete' then
      if (v_seat = 'p1' and m.p1_auto) or (v_seat = 'p2' and m.p2_auto) then
        update public.versus_matches set
          p1_auto = case when v_seat = 'p1' then false else p1_auto end, p1_missed = case when v_seat = 'p1' then 0 else p1_missed end,
          p2_auto = case when v_seat = 'p2' then false else p2_auto end, p2_missed = case when v_seat = 'p2' then 0 else p2_missed end,
          revision = revision + 1, updated_at = v_now
          where id = m.id returning * into m;
      end if;
      return jsonb_build_object('serverNow', v_now, 'match', public.versus__match_json(m));
    end if;
  elsif v_is_group and g.phase <> 'complete' then
    v_seat := public.versus_group__seat_of(g.id, v_user);
    if v_seat is not null then
      update public.versus_group_seats set auto = false, missed = 0
        where match_id = g.id and seat = v_seat and auto and eliminated_round is null;
      if found then g := public.versus_group__touch(g.id); end if;
      return jsonb_build_object('serverNow', v_now, 'groupMatch', public.versus_group__match_json(g));
    end if;
  end if;
  return jsonb_build_object('serverNow', v_now);
end;
$$;

create or replace function public.versus_leave_room(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  r public.versus_rooms;
  m public.versus_matches;
  g public.versus_group_matches;
  v_role text;
  v_seat text;
  v_next uuid;
  v_match uuid;
begin
  -- MATCH FIRST: peek the room unlocked, lock its running match, THEN the room.
  select current_match_id into v_match from public.versus_rooms where id = p_room;
  if v_match is not null then
    select * into m from public.versus_matches where id = v_match for update;
    if not found then select * into g from public.versus_group_matches where id = v_match for update; end if;
  end if;
  select * into r from public.versus_rooms where id = p_room for update;
  if not found then return jsonb_build_object('left', true); end if;
  select role into v_role from public.versus_members where room_id = p_room and user_id = v_user;
  if v_role is null then return jsonb_build_object('left', true); end if;
  -- The match locked above is still the room's (a new match cannot start while we hold the old one's row, and a
  -- changed id means the old one ended: nothing to forfeit).
  if r.status = 'in_game' and v_role <> 'spectator' and r.current_match_id is not null and r.current_match_id = v_match then
    if m.id is not null then
      if m.phase <> 'complete' then
        perform public.versus__complete(m, case when v_role = 'p1' then 'p2' else 'p1' end, 'forfeit');
      end if;
    elsif g.id is not null and g.phase <> 'complete' then
      v_seat := public.versus_group__seat_of(g.id, v_user);
      if v_seat is not null then perform public.versus_group__eliminate(g, v_seat, 'left'); end if;
    end if;
  end if;
  delete from public.versus_members where room_id = p_room and user_id = v_user;
  if not exists (select 1 from public.versus_members where room_id = p_room) then
    delete from public.versus_rooms where id = p_room;
    return jsonb_build_object('left', true, 'roomClosed', true);
  end if;
  if r.host_user_id = v_user then
    select user_id into v_next from public.versus_members where room_id = p_room
      order by (role = 'spectator'), joined_at limit 1;
    update public.versus_rooms set host_user_id = v_next where id = p_room;
  end if;
  -- A seat emptied during the gate ceremony reopens the room.
  update public.versus_rooms set status = case when status = 'sealed' then 'open' else status end,
    p1_gate = false, p2_gate = false, p3_gate = false, p4_gate = false,
    gate_deadline = case when status = 'sealed' then null else gate_deadline end,
    revision = revision + 1, updated_at = public.versus_clock() where id = p_room;
  return jsonb_build_object('left', true);
end;
$$;
