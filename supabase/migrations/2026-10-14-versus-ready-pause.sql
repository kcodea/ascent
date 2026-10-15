-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- VERSUS: End Combat waits for both (5 s for the second), and a reconnect unpauses with a 3-2-1  (2026-10-14)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-10-14-versus-shop-start.sql (it replaces functions that file
-- defines). Idempotent. One new column, one new RPC; replaces versus__resume, versus_reconcile, versus_heartbeat,
-- versus_unpause and versus_combat_ready in place. Nothing else is touched; the Edge Function is unchanged.
--
-- WHAT (live PvP feedback 2026-10-14):
--  - END COMBAT: "the end combat button should not take a player back to shop until both players go back to shop. it
--    should instead enforce a 5s timer for the other player to hit end combat". The first `versus_combat_ready` of a
--    round pulls `combat_deadline` in to 5 s from now (the 90 s cap stays the outer bound); at it, `versus_reconcile`
--    opens the next shop for both, and both clients leave the fight together.
--  - DISCONNECT: "when that player reconnects allow them to unpause which shows a 3/2/1". A returning player no longer
--    resumes the match by heartbeating: it stays paused until they press Unpause (`versus_request_resume`), which sets
--    `resume_at` 3 s ahead; `versus_reconcile` resumes it then, every deadline shifted by the whole pause (countdown
--    included), so each clock picks up where it froze. Past the 30 s grace the opponent's Unpause (the absent seat goes
--    on auto, as before) takes the same 3-2-1.

-- ── 1. Column ─────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.versus_matches add column if not exists resume_at timestamptz;

-- ── 2. Resume clears the countdown ────────────────────────────────────────────────────────────────────────────
create or replace function public.versus__resume(m public.versus_matches)
returns public.versus_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  v_delta interval;
  v_out public.versus_matches;
begin
  if m.paused_at is null then return m; end if;
  v_delta := v_now - m.paused_at;
  update public.versus_matches set
    hero_deadline = hero_deadline + v_delta, shop_starts_at = shop_starts_at + v_delta,
    shop_deadline = shop_deadline + v_delta, combat_deadline = combat_deadline + v_delta,
    intro_deadline = intro_deadline + v_delta,
    paused_seat = null, paused_at = null, pause_grace_until = null, resume_at = null,
    revision = revision + 1, updated_at = v_now
  where id = m.id returning * into v_out;
  -- Back with both intros already in (the second came in while paused): the clock starts now.
  if v_out.phase = 'shop' and v_out.shop_deadline is null and (v_out.p1_intro or v_out.p1_auto) and (v_out.p2_intro or v_out.p2_auto) then
    v_out := public.versus__start_clock(v_out);
  end if;
  return v_out;
end;
$$;

-- ── 3. Reconcile: the 3-2-1 resumes a pause (a heartbeat no longer does) ─────────────────────────────────
-- The 2026-10-14-versus-shop-start.sql function with its pause branch changed.
create or replace function public.versus_reconcile(p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  m public.versus_matches;
  v_seen1 timestamptz;
  v_seen2 timestamptz;
  v_gone1 boolean;
  v_gone2 boolean;
begin
  select * into m from public.versus_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  if m.phase = 'complete' then return public.versus__match_json(m); end if;
  select last_seen_at into v_seen1 from public.versus_members where room_id = m.room_id and user_id = m.p1_user;
  select last_seen_at into v_seen2 from public.versus_members where room_id = m.room_id and user_id = m.p2_user;
  v_gone1 := v_seen1 is null or v_seen1 < v_now - interval '12 seconds';
  v_gone2 := v_seen2 is null or v_seen2 < v_now - interval '12 seconds';

  if m.paused_at is not null then
    -- The 3-2-1 that an Unpause started has run out: play on. Both players gone for 10 minutes: abandoned.
    if m.resume_at is not null and v_now >= m.resume_at then
      m := public.versus__resume(m);
      m := public.versus__maybe_resolve(m);
      if m.phase = 'combat' and (m.p1_ready or m.p1_auto) and (m.p2_ready or m.p2_auto) then m := public.versus__open_shop(m, m.round + 1); end if;
    elsif v_gone1 and v_gone2 and v_now >= m.paused_at + interval '10 minutes' then
      m := public.versus__complete(m, null, 'abandoned');
      return public.versus__match_json(m);
    else
      return public.versus__match_json(m);
    end if;
  end if;

  -- A newly absent player (not already on auto) pauses the shared clock.
  if (v_gone1 and not m.p1_auto) or (v_gone2 and not m.p2_auto) then
    update public.versus_matches set
      paused_seat = case when v_gone1 and not m.p1_auto then 'p1' else 'p2' end,
      paused_at = v_now, pause_grace_until = v_now + interval '30 seconds',
      revision = revision + 1, updated_at = v_now
      where id = m.id returning * into m;
    return public.versus__match_json(m);
  end if;

  if m.phase = 'hero_select' and v_now >= m.hero_deadline then
    m := public.versus__maybe_start(m);
  elsif m.phase = 'shop' and m.shop_deadline is null then
    -- Round 1 before its clock: started by both intros, or by the cap.
    if v_now >= m.intro_deadline or ((m.p1_intro or m.p1_auto) and (m.p2_intro or m.p2_auto)) then
      m := public.versus__start_clock(m);
    end if;
  elsif m.phase = 'shop' and v_now >= m.shop_deadline then
    if not m.p1_locked then perform public.versus__finalize_seat(m.id, m.round, 'p1', m.p1_user, m.p1_auto); end if;
    if not m.p2_locked then perform public.versus__finalize_seat(m.id, m.round, 'p2', m.p2_user, m.p2_auto); end if;
    update public.versus_matches set p1_locked = true, p2_locked = true where id = m.id returning * into m;
    m := public.versus__maybe_resolve(m);
  elsif m.phase = 'shop' then
    m := public.versus__maybe_resolve(m); -- an auto seat never locks: the present player's lock is enough
  elsif m.phase = 'combat' and v_now >= m.combat_deadline then
    m := public.versus__open_shop(m, m.round + 1);
  end if;
  return public.versus__match_json(m);
end;
$$;

-- ── 4. A heartbeat records presence; it no longer resumes a pause (the returning player presses Unpause) ────
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
  v_seat text;
begin
  update public.versus_members set last_seen_at = v_now where room_id = p_room and user_id = v_user;
  if not found then raise exception 'not_a_member'; end if;
  select * into r from public.versus_rooms where id = p_room;
  if r.current_match_id is not null then
    select * into m from public.versus_matches where id = r.current_match_id for update;
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
  end if;
  return jsonb_build_object('serverNow', v_now);
end;
$$;

-- ── 5. Unpause: the returning player (any time), or the opponent past the grace (the absent seat on auto) ──────
-- Either starts the 3-2-1 (`resume_at`); `versus_reconcile` resumes the match when it runs out.
create or replace function public.versus_request_resume(p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  m public.versus_matches;
  v_seat text;
begin
  select * into m from public.versus_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  v_seat := public.versus__seat_of(m, auth.uid());
  if v_seat is null then raise exception 'not_a_player'; end if;
  if m.paused_at is null or m.resume_at is not null then return public.versus__match_json(m); end if;
  if m.paused_seat <> v_seat then raise exception 'not_your_pause'; end if;
  update public.versus_matches set resume_at = v_now + interval '3 seconds', revision = revision + 1, updated_at = v_now
    where id = p_match returning * into m;
  return public.versus__match_json(m);
end;
$$;

create or replace function public.versus_unpause(p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  m public.versus_matches;
  v_seat text;
  v_absent text;
begin
  select * into m from public.versus_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  v_seat := public.versus__seat_of(m, auth.uid());
  if v_seat is null then raise exception 'not_a_player'; end if;
  if m.paused_at is null or m.resume_at is not null then return public.versus__match_json(m); end if;
  v_absent := m.paused_seat;
  if v_absent = v_seat then raise exception 'cannot_unpause_own_absence'; end if;
  if v_now < m.pause_grace_until then raise exception 'grace_running'; end if;
  update public.versus_matches set p1_auto = p1_auto or v_absent = 'p1', p2_auto = p2_auto or v_absent = 'p2',
    resume_at = v_now + interval '3 seconds', revision = revision + 1, updated_at = v_now
    where id = p_match returning * into m;
  return public.versus__match_json(m);
end;
$$;

-- ── 6. End Combat: the first one back gives the other 5 s ─────────────────────────────────────────────────────
create or replace function public.versus_combat_ready(p_match uuid, p_round int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  m public.versus_matches;
  v_seat text;
begin
  select * into m from public.versus_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  v_seat := public.versus__seat_of(m, auth.uid());
  if v_seat is null then raise exception 'not_a_player'; end if;
  if m.phase <> 'combat' or m.round <> p_round then return public.versus__match_json(m); end if;
  if v_seat = 'p1' then update public.versus_matches set p1_ready = true, revision = revision + 1 where id = p_match returning * into m;
  else update public.versus_matches set p2_ready = true, revision = revision + 1 where id = p_match returning * into m; end if;
  if (m.p1_ready or m.p1_auto) and (m.p2_ready or m.p2_auto) and m.paused_at is null then
    m := public.versus__open_shop(m, m.round + 1);
  else
    -- The other player has 5 s to press End Combat (the 90 s cap stays the outer bound).
    update public.versus_matches set combat_deadline = least(combat_deadline, v_now + interval '5 seconds'), updated_at = v_now
      where id = p_match returning * into m;
  end if;
  return public.versus__match_json(m);
end;
$$;

-- ── 7. Grants ─────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function public.versus__resume(public.versus_matches) from public, anon, authenticated;
revoke all on function public.versus_request_resume(uuid) from public, anon;
grant execute on function public.versus_request_resume(uuid) to authenticated;
revoke all on function public.versus_reconcile(uuid) from public, anon;
grant execute on function public.versus_reconcile(uuid) to authenticated;
revoke all on function public.versus_heartbeat(uuid) from public, anon;
grant execute on function public.versus_heartbeat(uuid) to authenticated;
revoke all on function public.versus_unpause(uuid) from public, anon;
grant execute on function public.versus_unpause(uuid) to authenticated;
revoke all on function public.versus_combat_ready(uuid, int) from public, anon;
grant execute on function public.versus_combat_ready(uuid, int) to authenticated;
