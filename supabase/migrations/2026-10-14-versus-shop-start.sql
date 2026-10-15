-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- VERSUS: every shop starts when both players are there, with no lead  (2026-10-14)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-10-13-versus.sql. Idempotent. Adds two columns and one
-- RPC; replaces five Versus functions in place (no other table or function is touched).
--
-- WHAT THIS IS (owner 2026-10-14: "show the good luck screen, then have the timer start per usual ... do not have
-- round countdowns. when the players get back in together the round begins"):
--  - A round's shop opens the moment BOTH players are back from the fight (`versus_combat_ready`), and its deadline
--    is stamped from that moment: no 3 second lead any more. The 90 s combat cap stays as the silent backstop.
--  - Round 1 waits for the game start to play out on both screens: the full Hero Select ceremony and the Good Luck
--    intro. The match opens round 1's shop with NO clock (`shop_starts_at` / `shop_deadline` null); each client calls
--    `versus_intro_done` when its intro has finished, and the clock starts when both have (an auto seat counts). A
--    stuck client cannot stall it: `intro_deadline` (45 s after the heroes are revealed) starts it anyway, through
--    `versus_reconcile`.

-- ── 1. The intro acknowledgements ─────────────────────────────────────────────────────────────────────────────
alter table public.versus_matches add column if not exists p1_intro boolean not null default false;
alter table public.versus_matches add column if not exists p2_intro boolean not null default false;
alter table public.versus_matches add column if not exists intro_deadline timestamptz;

-- ── 2. Opening a shop: the clock starts now (round 2 on), or waits for both intros (round 1) ─────────────────
create or replace function public.versus__open_shop(m public.versus_matches, p_round int)
returns public.versus_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  v_first boolean := p_round = 1;
  v_out public.versus_matches;
begin
  update public.versus_matches set
    phase = 'shop', round = p_round,
    shop_starts_at = case when v_first then null else v_now end,
    shop_deadline = case when v_first then null else v_now + make_interval(secs => public.versus_turn_seconds(p_round)) end,
    intro_deadline = case when v_first then v_now + interval '45 seconds' else null end,
    combat_deadline = null, p1_locked = false, p2_locked = false, p1_ready = false, p2_ready = false,
    revision = revision + 1, updated_at = v_now
  where id = m.id returning * into v_out;
  return v_out;
end;
$$;

-- Round 1's clock starts (both intros done, or the cap passed).
create or replace function public.versus__start_clock(m public.versus_matches)
returns public.versus_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  v_out public.versus_matches;
begin
  if m.phase <> 'shop' or m.shop_deadline is not null then return m; end if;
  update public.versus_matches set
    shop_starts_at = v_now,
    shop_deadline = v_now + make_interval(secs => public.versus_turn_seconds(m.round)),
    intro_deadline = null,
    revision = revision + 1, updated_at = v_now
  where id = m.id returning * into v_out;
  return v_out;
end;
$$;

-- ── 3. A player's game start (ceremony + Good Luck) has finished ─────────────────────────────────────────────
create or replace function public.versus_intro_done(p_match uuid)
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
  if m.phase <> 'shop' or m.shop_deadline is not null then return public.versus__match_json(m); end if;
  if v_seat = 'p1' then update public.versus_matches set p1_intro = true, revision = revision + 1 where id = p_match returning * into m;
  else update public.versus_matches set p2_intro = true, revision = revision + 1 where id = p_match returning * into m; end if;
  if (m.p1_intro or m.p1_auto) and (m.p2_intro or m.p2_auto) and m.paused_at is null then
    m := public.versus__start_clock(m);
  end if;
  return public.versus__match_json(m);
end;
$$;

-- ── 4. A pause shifts the intro cap too ──────────────────────────────────────────────────────────────────────
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
    paused_seat = null, paused_at = null, pause_grace_until = null,
    revision = revision + 1, updated_at = v_now
  where id = m.id returning * into v_out;
  -- Back with both intros already in (the second came in while paused): the clock starts now.
  if v_out.phase = 'shop' and v_out.shop_deadline is null and (v_out.p1_intro or v_out.p1_auto) and (v_out.p2_intro or v_out.p2_auto) then
    v_out := public.versus__start_clock(v_out);
  end if;
  return v_out;
end;
$$;

-- ── 5. Reconcile: the intro cap is one more deadline ─────────────────────────────────────────────────────────
-- Byte-for-byte the 2026-10-13 function, plus the `intro_deadline` branch.
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
    -- Back in time: resume. Both players gone for 10 minutes: abandoned, nobody wins.
    if (m.paused_seat = 'p1' and not v_gone1) or (m.paused_seat = 'p2' and not v_gone2) then
      m := public.versus__resume(m);
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

-- ── 6. Grants ─────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function public.versus__open_shop(public.versus_matches, int) from public, anon, authenticated;
revoke all on function public.versus__start_clock(public.versus_matches) from public, anon, authenticated;
revoke all on function public.versus__resume(public.versus_matches) from public, anon, authenticated;
revoke all on function public.versus_intro_done(uuid) from public, anon;
revoke all on function public.versus_reconcile(uuid) from public, anon;
grant execute on function public.versus_intro_done(uuid) to authenticated;
grant execute on function public.versus_reconcile(uuid) to authenticated;
