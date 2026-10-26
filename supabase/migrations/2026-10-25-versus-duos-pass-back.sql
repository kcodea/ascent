-- 2026-10-25 · Versus Duos: passing back, and passing from the HAND only (R-DUOS-PASS-01).
-- Owner rulings 2026-10-25:
--   "you should be able to pass cards back to your teammate". The server never had a per-card rule (it holds no run
--   state): a card the teammate just passed can go straight back, and a card can be passed again later the same
--   round, each pass its own row (its own seq) and its own 1 Gold on the sender's run. The per-round cap stays as an
--   anti-spam limit: 10 passes per sender per round ('too_many_passes', VERSUS_DUOS_PASS_CAP).
--   "you aren't supposed to be able to pass a card off your board, only from hand." The client marks every pass with
--   where it left from (`passFrom` in the card) and the run refuses a board card itself; the server now refuses any
--   pass not marked 'hand'. It raises 'bad_card' (not a new code) on purpose: a client from before this change does
--   not send the marker, and 'bad_card' is already one of its refusals, so it gets its card and its Gold back instead
--   of retrying a pass that will never be recorded.
-- Idempotent: one CREATE OR REPLACE of the function (same signature, grants kept).

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
  if exists (select 1 from public.versus_group_seats where match_id = p_match and seat = v_seat and (locked or eliminated_round is not null)) then
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
