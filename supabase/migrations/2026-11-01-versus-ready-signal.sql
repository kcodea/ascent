-- VERSUS: END TURN IS A READY SIGNAL (owner 2026-10-26, fix/duos-ready-flow-portraits). APPLY AFTER
-- 2026-10-31-ranked-duos-live-fixes.sql. Idempotent. No function redeploy needed (versus-resolve is unchanged: it already
-- fights each seat's final side as stored when the round closed).
--
-- Owner: "hitting end turn shouldn't restrict anything, it should just signal that you are ready to move on, but you
-- should be able to move things around on your board/view your teammate's board etc still." Then: "the end turn
-- ready-signal should be the same for versus modes too. it's a ready signal, not a 'i cant do anything anymore'".
--
-- In EVERY Versus mode (1v1, Versus Group, Versus Duos, Ranked Duos) a seat's `locked` flag is now its READY signal, not
-- an irreversible lock:
--   1. RE-LOCK. A ready seat that keeps playing sends its board again as a final side (`p_final = true`, a higher
--      `p_seq`): the side, checkpoint and scout are replaced, the seat stays ready, and `locked_at` (Ranked Duos: when it
--      first readied, which the end-turn gate reads) is kept. The round fights whatever each seat's newest final side is
--      when the round CLOSES. A lower or equal seq is an old send arriving late and changes nothing. A plain candidate
--      after the lock is ignored the same way (no error: the client only re-locks while ready).
--   2. PASSING stays open after End Turn (`versus_duos_pass` no longer refuses a ready sender).
--   3. UN-READY (`versus_unready` for 1v1, `versus_group_unready` for Group / Duos / Ranked Duos). Pressing End Turn again
--      while the clock is above 0:00 takes the signal back: the seat is no longer locked, its side goes back to a
--      candidate. Refused once the round has closed (`stale_round`) or at 0:00 and after (`deadline_passed`), and for a
--      seat on auto / out / gone. `p_seq` also fences out a re-lock still in flight from before the press.
--
-- `versus_submit` (6-argument; the 7-argument scout wrapper calls it) is 2026-10-16-versus-clock-grace.sql's body, and
-- `versus_group_submit` / `versus_ranked_duos_submit` are 2026-10-29-ranked-duos.sql's, each with the `already_locked`
-- refusal replaced by the re-lock above. Lock order (R-VERSUS-LOCK-ORDER-01): the match row first, then its seats.

-- 1v1: the re-lock.
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
  -- READY SIGNAL: a seat that already ended may send its board again (a newer seq), and stays ended.
  if found and s.final then
    if not p_final or p_seq <= s.candidate_seq then return public.versus__match_json(m); end if;
    update public.versus_submissions set candidate_seq = p_seq, prepared_side = p_side,
      checkpoint = coalesce(p_checkpoint, checkpoint), updated_at = now()
      where match_id = p_match and round = p_round and seat = v_seat;
    return public.versus__match_json(m);
  end if;
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

-- 1v1: un-ready while the clock is above 0:00.
create or replace function public.versus_unready(p_match uuid, p_round int, p_seq int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.versus_matches;
  v_seat text;
begin
  select * into m from public.versus_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  v_seat := public.versus__seat_of(m, auth.uid());
  if v_seat is null then raise exception 'not_a_player'; end if;
  if m.phase <> 'shop' or m.round <> p_round then raise exception 'stale_round'; end if;
  if m.shop_deadline is null or m.paused_at is not null then raise exception 'not_running'; end if;
  if public.versus_clock() >= m.shop_deadline then raise exception 'deadline_passed'; end if;
  if (v_seat = 'p1' and m.p1_auto) or (v_seat = 'p2' and m.p2_auto) then raise exception 'eliminated'; end if;
  update public.versus_submissions set final = false, source = 'candidate', candidate_seq = greatest(candidate_seq, p_seq), updated_at = now()
    where match_id = p_match and round = p_round and seat = v_seat;
  if v_seat = 'p1' then update public.versus_matches set p1_locked = false, revision = revision + 1 where id = p_match returning * into m;
  else update public.versus_matches set p2_locked = false, revision = revision + 1 where id = p_match returning * into m; end if;
  return public.versus__match_json(m);
end;
$$;

create or replace function public.versus_ranked_duos_submit(p_match uuid, p_round int, p_seq int, p_side jsonb, p_final boolean, p_checkpoint jsonb, p_scout jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_now timestamptz := public.versus_clock();
  m public.versus_group_matches;
  v_seat text;
  v_close timestamptz;
  s public.versus_group_submissions;
begin
  select * into m from public.versus_group_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  if not public.versus_ranked_duos__is(m) then raise exception 'not_ranked_duos'; end if;
  v_seat := public.versus_group__seat_of(p_match, v_user);
  if v_seat is null then raise exception 'not_a_player'; end if;
  if exists (select 1 from public.versus_group_seats where match_id = p_match and seat = v_seat and (eliminated_round is not null or left_at is not null)) then
    raise exception 'eliminated';
  end if;
  if m.phase <> 'shop' or m.round <> p_round then raise exception 'stale_round'; end if;
  v_close := public.versus_ranked_duos__close_at(m);
  if v_close is not null and v_now >= v_close + public.versus__shop_grace() then raise exception 'deadline_passed'; end if;
  if p_side is null or octet_length(p_side::text) > 262144 then raise exception 'side_too_large'; end if;
  if p_checkpoint is not null and octet_length(p_checkpoint::text) > 1048576 then raise exception 'checkpoint_too_large'; end if;
  if p_scout is not null and (jsonb_typeof(p_scout) <> 'object' or octet_length(p_scout::text) > 8192) then raise exception 'scout_too_large'; end if;
  select * into s from public.versus_group_submissions where match_id = p_match and round = p_round and seat = v_seat;
  -- READY SIGNAL: a seat that already ended may send its board again (a newer seq), and stays ended.
  if found and s.final then
    if not p_final or p_seq <= s.candidate_seq then return public.versus_ranked_duos__json(m); end if;
    update public.versus_group_submissions set candidate_seq = p_seq, prepared_side = p_side,
      checkpoint = coalesce(p_checkpoint, checkpoint), scout = coalesce(p_scout, scout), updated_at = now()
      where match_id = p_match and round = p_round and seat = v_seat;
    return public.versus_ranked_duos__json(m);
  end if;
  if found and p_seq <= s.candidate_seq and not p_final then
    return public.versus_ranked_duos__json(m);
  end if;
  insert into public.versus_group_submissions (match_id, round, seat, user_id, candidate_seq, prepared_side, final, source, checkpoint, scout)
    values (p_match, p_round, v_seat, v_user, p_seq, p_side, p_final, case when p_final then 'lock' else 'candidate' end, p_checkpoint, p_scout)
    on conflict (match_id, round, seat) do update set candidate_seq = greatest(excluded.candidate_seq, public.versus_group_submissions.candidate_seq),
      prepared_side = excluded.prepared_side, final = excluded.final, source = excluded.source,
      checkpoint = coalesce(excluded.checkpoint, public.versus_group_submissions.checkpoint),
      scout = coalesce(excluded.scout, public.versus_group_submissions.scout), updated_at = now();
  if p_final then
    -- A lock sent inside the grace after the close still counts as the player's own, at the close.
    update public.versus_group_seats set locked = true, locked_at = least(v_now, coalesce(v_close, v_now))
      where match_id = p_match and seat = v_seat;
    m := public.versus_group__touch(p_match);
    m := public.versus_ranked_duos__maybe_close(m);
  end if;
  return public.versus_ranked_duos__json(m);
end;
$$;

create or replace function public.versus_group_submit(p_match uuid, p_round int, p_seq int, p_side jsonb, p_final boolean, p_checkpoint jsonb, p_scout jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  m public.versus_group_matches;
  v_seat text;
  s public.versus_group_submissions;
begin
  select * into m from public.versus_group_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  if public.versus_ranked_duos__is(m) then
    return public.versus_ranked_duos_submit(p_match, p_round, p_seq, p_side, p_final, p_checkpoint, p_scout);
  end if;
  v_seat := public.versus_group__seat_of(p_match, v_user);
  if v_seat is null then raise exception 'not_a_player'; end if;
  if exists (select 1 from public.versus_group_seats where match_id = p_match and seat = v_seat and eliminated_round is not null) then raise exception 'eliminated'; end if;
  if m.phase <> 'shop' or m.round <> p_round then raise exception 'stale_round'; end if;
  if m.paused_at is null and m.shop_deadline is not null and public.versus_clock() >= m.shop_deadline + public.versus__shop_grace() then raise exception 'deadline_passed'; end if;
  if p_side is null or octet_length(p_side::text) > 262144 then raise exception 'side_too_large'; end if;
  if p_checkpoint is not null and octet_length(p_checkpoint::text) > 1048576 then raise exception 'checkpoint_too_large'; end if;
  if p_scout is not null and (jsonb_typeof(p_scout) <> 'object' or octet_length(p_scout::text) > 8192) then raise exception 'scout_too_large'; end if;
  select * into s from public.versus_group_submissions where match_id = p_match and round = p_round and seat = v_seat;
  if found and s.final then
    -- READY SIGNAL: a ready seat may send its board again (a newer seq) and stays ready.
    if not p_final or p_seq <= s.candidate_seq then return public.versus_group__match_json(m); end if;
    update public.versus_group_submissions set candidate_seq = p_seq, prepared_side = p_side,
      checkpoint = coalesce(p_checkpoint, checkpoint), scout = coalesce(p_scout, scout), updated_at = now()
      where match_id = p_match and round = p_round and seat = v_seat;
    return public.versus_group__match_json(m);
  end if;
  if found and p_seq <= s.candidate_seq and not p_final then
    return public.versus_group__match_json(m); -- an older candidate arriving late: ignore
  end if;
  insert into public.versus_group_submissions (match_id, round, seat, user_id, candidate_seq, prepared_side, final, source, checkpoint, scout)
    values (p_match, p_round, v_seat, v_user, p_seq, p_side, p_final, case when p_final then 'lock' else 'candidate' end, p_checkpoint, p_scout)
    on conflict (match_id, round, seat) do update set candidate_seq = greatest(excluded.candidate_seq, public.versus_group_submissions.candidate_seq),
      prepared_side = excluded.prepared_side, final = excluded.final, source = excluded.source,
      checkpoint = coalesce(excluded.checkpoint, public.versus_group_submissions.checkpoint),
      scout = coalesce(excluded.scout, public.versus_group_submissions.scout), updated_at = now();
  if p_final then
    update public.versus_group_seats set locked = true where match_id = p_match and seat = v_seat;
    m := public.versus_group__touch(p_match);
    m := public.versus_group__maybe_resolve(m);
  end if;
  return public.versus_group__match_json(m);
end;
$$;

-- PASSING AFTER END TURN: a ready seat may still pass a card (it is a shop action, and End Turn no longer ends the shop).
-- 2026-10-25-versus-duos-pass-back.sql's body with the sender's `locked` refusal dropped (an out seat is still refused).
create or replace function public.versus_duos_pass(p_match uuid, p_round int, p_seq int, p_card jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.versus_group_matches;
  v_seat text;
  v_mate text;
  v_room int;
  v_row public.versus_duos_passes;
begin
  select * into m from public.versus_group_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  if not public.versus_duos__is(m) then raise exception 'not_duos'; end if;
  v_seat := public.versus_group__seat_of(p_match, auth.uid());
  if v_seat is null then raise exception 'not_a_player'; end if;
  -- Exactly once: a retry of a recorded pass answers with the recorded row.
  select * into v_row from public.versus_duos_passes where match_id = p_match and from_seat = v_seat and seq = p_seq;
  if found then return to_jsonb(v_row); end if;
  if m.phase <> 'shop' or m.round <> p_round then raise exception 'not_shop'; end if;
  if m.paused_at is null and m.shop_deadline is not null and public.versus_clock() >= m.shop_deadline + public.versus__shop_grace() then
    raise exception 'deadline_passed';
  end if;
  -- READY SIGNAL (R-DUOS-READY-01): a seat that pressed End Turn still plays its shop, passing included. Only a seat that
  -- is out is refused.
  if exists (select 1 from public.versus_group_seats where match_id = p_match and seat = v_seat and eliminated_round is not null) then
    raise exception 'locked';
  end if;
  v_mate := public.versus_duos__mate(v_seat);
  select hand_room into v_room from public.versus_group_seats where match_id = p_match and seat = v_mate and eliminated_round is null;
  if not found then raise exception 'no_teammate'; end if;
  -- A teammate who dropped out (their board plays on auto) or the one the match is paused for cannot take a card: it
  -- would wait here, the sender's Gold paid, until they came back.
  if exists (select 1 from public.versus_group_seats where match_id = p_match and seat = v_mate and auto)
     or (m.paused_at is not null and m.paused_seat = v_mate) then
    raise exception 'teammate_away';
  end if;
  if v_room is not null and v_room - (select count(*) from public.versus_duos_passes
      where match_id = p_match and to_seat = v_mate and status = 'sent') <= 0 then
    raise exception 'hand_full';
  end if;
  if p_seq is null or p_seq < 0 or p_card is null or jsonb_typeof(p_card) <> 'object' or coalesce(jsonb_typeof(p_card->'cardId'), '') <> 'string'
     or octet_length(p_card::text) > 16384 then
    raise exception 'bad_card';
  end if;
  -- HAND ONLY (owner 2026-10-25): a pass not marked as leaving the hand is never recorded.
  if coalesce(p_card->>'passFrom', '') <> 'hand' then
    raise exception 'bad_card';
  end if;
  -- Passing back and passing again are allowed (owner 2026-10-25); only the anti-spam cap bounds a round.
  if (select count(*) from public.versus_duos_passes where match_id = p_match and from_seat = v_seat and round = p_round) >= 10 then
    raise exception 'too_many_passes';
  end if;
  insert into public.versus_duos_passes (match_id, round, from_seat, to_seat, seq, card)
    values (p_match, p_round, v_seat, v_mate, p_seq, p_card) returning * into v_row;
  return to_jsonb(v_row);
end;
$$;


-- GROUP / DUOS / RANKED DUOS: UN-READY, take back my End Turn while the clock is above 0:00. The seat is no longer locked
-- and its side is a candidate again (still my newest board, so a deadline promotes it as before). Answers the match json
-- of the mode.
create or replace function public.versus_group_unready(p_match uuid, p_round int, p_seq int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  m public.versus_group_matches;
  v_seat text;
begin
  select * into m from public.versus_group_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  v_seat := public.versus_group__seat_of(p_match, v_user);
  if v_seat is null then raise exception 'not_a_player'; end if;
  if m.phase <> 'shop' or m.round <> p_round then raise exception 'stale_round'; end if;
  if m.shop_deadline is null or m.paused_at is not null then raise exception 'not_running'; end if;
  if public.versus_clock() >= m.shop_deadline then raise exception 'deadline_passed'; end if;
  if exists (select 1 from public.versus_group_seats where match_id = p_match and seat = v_seat
      and (eliminated_round is not null or auto or left_at is not null)) then
    raise exception 'eliminated';
  end if;
  update public.versus_group_submissions set final = false, source = 'candidate',
    candidate_seq = greatest(candidate_seq, p_seq), updated_at = now()
    where match_id = p_match and round = p_round and seat = v_seat;
  update public.versus_group_seats set locked = false, locked_at = null where match_id = p_match and seat = v_seat;
  m := public.versus_group__touch(p_match);
  if public.versus_ranked_duos__is(m) then return public.versus_ranked_duos__json(m); end if;
  return public.versus_group__match_json(m);
end;
$$;

revoke all on function public.versus_group_unready(uuid, int, int) from public, anon;
grant execute on function public.versus_group_unready(uuid, int, int) to authenticated;
revoke all on function public.versus_unready(uuid, int, int) from public, anon;
grant execute on function public.versus_unready(uuid, int, int) to authenticated;
