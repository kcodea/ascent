-- 2026-10-16 — VERSUS: the shop's 0:00 lock never lands early, and a side sent AT 0:00 still counts
-- (owner 2026-10-16: "make sure that everything locks actually like after 0, make sure it doesnt lock early. felt like
-- it was locking a second early sometimes"; R-VERSUS-CLOCK-LOCK-01).
--
-- The client used to lock its turn 400 ms BEFORE the deadline (so its final side beat the server's cut-off), on a
-- 500 ms tick, so the shop held while the clock still read 0:01. The client now locks AT 0:00 by the synced clock (the
-- server deadline stays authoritative), so the server gives a final side a short GRACE past the deadline to arrive:
--
--   1. `versus__shop_grace()` = 250 ms, the one place the grace lives.
--   2. `versus_submit` (6-argument; the 7-argument scout wrapper calls it) accepts until shop_deadline + grace
--      (was: until shop_deadline).
--   3. `versus_reconcile` promotes the seats' newest candidates only once shop_deadline + grace has passed (was: at
--      shop_deadline), so a reconcile racing the 0:00 lock cannot close the round under it.
--
-- Everything else in both functions is copied unchanged: `versus_submit` from 2026-10-13-versus.sql and
-- `versus_reconcile` from 2026-10-14-versus-ready-pause.sql (the version with the 3-2-1 `resume_at` branch and the
-- round-1 intro branch). No table, column or grant changes beyond re-granting the two functions. The versus-resolve
-- Edge Function does not read the shop deadline and needs no redeploy.

-- ── 1. The grace ─────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.versus__shop_grace()
returns interval
language sql
immutable
as $$ select interval '250 milliseconds' $$;

-- ── 2. Submit: a final side sent at 0:00 lands ───────────────────────────────────────────────────────────────
create or replace function public.versus_submit(p_match uuid, p_round int, p_seq int, p_side jsonb, p_final boolean, p_checkpoint jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  m public.versus_matches;
  v_seat text;
  s public.versus_submissions;
begin
  select * into m from public.versus_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  v_seat := public.versus__seat_of(m, v_user);
  if v_seat is null then raise exception 'not_a_player'; end if;
  if m.phase <> 'shop' or m.round <> p_round then raise exception 'stale_round'; end if;
  -- A side sent at 0:00 lands within the grace (R-VERSUS-CLOCK-LOCK-01); later than that it is too late.
  if m.paused_at is null and public.versus_clock() >= m.shop_deadline + public.versus__shop_grace() then raise exception 'deadline_passed'; end if;
  if p_side is null or octet_length(p_side::text) > 262144 then raise exception 'side_too_large'; end if;
  if p_checkpoint is not null and octet_length(p_checkpoint::text) > 1048576 then raise exception 'checkpoint_too_large'; end if;
  select * into s from public.versus_submissions where match_id = p_match and round = p_round and seat = v_seat;
  if found and s.final then raise exception 'already_locked'; end if;
  if found and p_seq <= s.candidate_seq and not p_final then
    return public.versus__match_json(m); -- an older candidate arriving late: ignore
  end if;
  insert into public.versus_submissions (match_id, round, seat, user_id, candidate_seq, prepared_side, final, source, checkpoint)
    values (p_match, p_round, v_seat, v_user, p_seq, p_side, p_final, case when p_final then 'lock' else 'candidate' end, p_checkpoint)
    on conflict (match_id, round, seat) do update set candidate_seq = greatest(excluded.candidate_seq, public.versus_submissions.candidate_seq),
      prepared_side = excluded.prepared_side, final = excluded.final, source = excluded.source,
      checkpoint = coalesce(excluded.checkpoint, public.versus_submissions.checkpoint), updated_at = now();
  if p_final then
    if v_seat = 'p1' then update public.versus_matches set p1_locked = true, revision = revision + 1 where id = p_match returning * into m;
    else update public.versus_matches set p2_locked = true, revision = revision + 1 where id = p_match returning * into m; end if;
    m := public.versus__maybe_resolve(m);
  end if;
  return public.versus__match_json(m);
end;
$$;

-- ── 3. Reconcile: the round closes only after the grace ──────────────────────────────────────────────────────
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
  elsif m.phase = 'shop' and v_now >= m.shop_deadline + public.versus__shop_grace() then
    -- Past the deadline AND its grace: a final side sent at 0:00 has had its 250 ms to land first.
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

-- ── 4. Grants ────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function public.versus__shop_grace() from public, anon, authenticated;
revoke all on function public.versus_submit(uuid, int, int, jsonb, boolean, jsonb) from public, anon;
grant execute on function public.versus_submit(uuid, int, int, jsonb, boolean, jsonb) to authenticated;
revoke all on function public.versus_reconcile(uuid) from public, anon;
grant execute on function public.versus_reconcile(uuid) to authenticated;
