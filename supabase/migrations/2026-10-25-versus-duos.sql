-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- VERSUS DUOS: the 2v2 tag-team mode (owner design + rulings 2026-10-25)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER every earlier Versus file (through 2026-10-24-versus-group.sql,
-- 2026-10-24-versus-group-knockout-stands.sql and 2026-10-24-versus-records-24.sql). Idempotent (safe to re-run).
-- THEN `npm run versus:bundle` and deploy `versus-resolve`: its new `finalize_duos` action calls
-- `versus_duos_commit_round` below. Until the function is redeployed a Duos match stalls in `resolving` (1v1 and
-- Group are unaffected either way: every function replaced here only gains a `duos` branch).
--
-- OWNER (2026-10-25): "TAG-TEAM, like Hearthstone Battlegrounds Duos: one combat per round, team vs team. Your board
-- fights first; when it is wiped, your teammate's board steps in against whatever survived on the other side."
-- "SHARED team hearts; a team loses when it hits zero." "a pass slot: drag a card from your hand/board to your
-- teammate's portrait". "EXACTLY 2v2: 4 players, 2 teams, fits the current 4-seat Versus room and server. Unrated."
-- Rulings: "you have all the rules right except passing should cost 1 gold" (docs/design/2026-10-25-versus-duos.md).
--
-- Rulings 2026-10-25 (later): "Pass is refused if hand is full." "In duos you only place 1 and 2 in a 2v2. We will
-- likely add 4 team duos at some point as well."
--
-- THE DATA MODEL: a Duos match IS a Versus Group match (`versus_group_matches` with options.mode = 'duos', exactly four
-- seats), so Hero Select, the intro barrier, the shop clock + grace, locks, auto / pause / unpause, End Combat, the
-- spectator frames and the knockout-to-the-stands trigger all work unchanged. What Duos adds:
--  1. Options: mode 'duos' (exactly four seats; Start needs four).
--  2. TEAMS (`versus_group_teams`, `versus_group_seats.team`): a team id is a letter per seat pair (p1 + p2 = a,
--     p3 + p4 = b, p5 + p6 = c, ...), each team has its own hearts (7), elimination round and PLACEMENT. Nothing below
--     assumes two teams except where the room / start enforces it today, so a future 4-team Duos (8 seats) extends it.
--     Each seat mirrors its team's hearts and placement so every seat-reading screen (the rail, the stands, XP) reads
--     them unchanged.
--  3. The round's FIGHT ORDER (`duos_first`: which seat of each team fights first): the default alternates (odd rounds
--     each team's first seat, even rounds its second), set when the shop opens; either teammate may flip it
--     (`versus_duos_flip_order`) until the team's first lock.
--  4. ONE fight per round (`finalize_duos` → `versus_duos_commit_round`): one `versus_group_fights` row (a = team a's
--     first seat, b = team b's), team hearts (-1, or -2 when the winner never needed its second board); a team at 0
--     is out together and placed by how many teams were still in (2nd in a 2v2); the last team in is 1st; three auto
--     rounds in a row put the team out.
--  5. A teammate leaving or conceding puts the TEAM out (owner: "concede = team out").
--  6. PASSES (`versus_duos_passes`): `versus_duos_pass` records a seat's pass to its teammate during the shop, once per
--     (seat, seq). The 1 Gold is paid in the sender's run (the reducer's Gold-spend chokepoint, as every Versus shop
--     action: the server never holds a run's Gold). "Pass is refused if hand is full": each seat reports its hand
--     room (`versus_duos_hand_room`), and the server refuses a pass (`hand_full`) while the teammate's reported room,
--     less the passes not yet answered, is gone; a pass that still reaches a full hand (a race) is refused by the
--     receiver's run and answered `refused` (`versus_duos_answer_pass`), and the sender's run gets the card and the
--     Gold back. The server also checks the phase, the clock, the team, the lock, the card's shape and 10 per round.
--  7. XP: `settle_progression` reads a Duos seat's TEAM placement on the scale of the number of TEAMS, so the winners
--     earn 125 and the losers 50 (owner: 125 / 125 vs 50 / 50): its own file, 2026-10-25-versus-duos-xp.sql (a
--     progression migration, also appended to schema.sql), applied right after this one.

-- ── 1. Options: 'duos' joins the whitelist (mirror of packages/sim/src/versus/options.ts) ────────────────────
create or replace function public.versus__options_error(p jsonb)
returns text
language sql
immutable
as $$
  select case
    when p is null or jsonb_typeof(p) <> 'object' then 'options_not_object'
    when exists (select 1 from jsonb_object_keys(p) k where k not in ('v', 'mode', 'modifiers')) then 'unknown_option'
    when p ? 'v' and p->'v' <> '1'::jsonb then 'bad_version'
    when p ? 'mode' and (jsonb_typeof(p->'mode') <> 'string' or p->>'mode' not in ('duel', 'group', 'duos')) then 'bad_mode'
    when p ? 'modifiers' and (
      jsonb_typeof(p->'modifiers') <> 'array'
      or jsonb_array_length(p->'modifiers') > 1
      or exists (select 1 from jsonb_array_elements(p->'modifiers') e where jsonb_typeof(e) <> 'string' or e #>> '{}' not in ('freedom', 'summit'))
      or (select count(distinct e) from jsonb_array_elements(p->'modifiers') e) <> jsonb_array_length(p->'modifiers')
    ) then 'bad_modifiers'
    else null
  end;
$$;

create or replace function public.versus__mode_roles(p_mode text)
returns text[]
language sql
immutable
as $$
  select case when p_mode in ('group', 'duos') then array['p1', 'p2', 'p3', 'p4'] else array['p1', 'p2'] end;
$$;

create or replace function public.versus__mode_min_players(p_mode text)
returns int
language sql
immutable
as $$
  select case when p_mode = 'duos' then 4 when p_mode = 'group' then 3 else 2 end;
$$;

-- ── 2. Team helpers (generic over N seat pairs; mirrors of packages/sim/src/versus/duos.ts) ─────────────────────
-- A seat's team: its seat pair's letter (p1 / p2 = a, p3 / p4 = b, p5 / p6 = c, ...).
create or replace function public.versus_duos__team(p_seat text)
returns text
language sql
immutable
as $$
  select case when p_seat ~ '^p[1-9][0-9]*$' then chr(97 + (substring(p_seat from 2)::int - 1) / 2) end;
$$;

-- A seat's teammate: the other seat of its pair.
create or replace function public.versus_duos__mate(p_seat text)
returns text
language sql
immutable
as $$
  select case when p_seat ~ '^p[1-9][0-9]*$' then
    'p' || case when substring(p_seat from 2)::int % 2 = 1 then substring(p_seat from 2)::int + 1 else substring(p_seat from 2)::int - 1 end end;
$$;

-- A team's two seats, in seat order.
create or replace function public.versus_duos__seats(p_team text)
returns text[]
language sql
immutable
as $$
  select array['p' || (2 * (ascii(p_team) - 97) + 1), 'p' || (2 * (ascii(p_team) - 97) + 2)];
$$;

drop function if exists public.versus_duos__default_first(int);
-- The default fight order of a round for p_teams teams: each team's first seat on odd rounds, its second on even ones.
create or replace function public.versus_duos__default_first(p_round int, p_teams int)
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_object_agg(chr(97 + k), 'p' || (2 * k + case when p_round % 2 = 1 then 1 else 2 end)), '{}'::jsonb)
    from generate_series(0, greatest(p_teams, 1) - 1) k;
$$;

create or replace function public.versus_duos__is(m public.versus_group_matches)
returns boolean
language sql
immutable
as $$
  select coalesce(m.options->>'mode', 'group') = 'duos';
$$;


-- ── 3. Columns, the teams table and the passes table ─────────────────────────────────────────────────────────
alter table public.versus_group_matches add column if not exists duos_first jsonb;
alter table public.versus_group_seats add column if not exists team text;
-- A seat's reported hand room (Duos passes: the server refuses a pass to a full hand). Null = not reported yet.
alter table public.versus_group_seats add column if not exists hand_room int check (hand_room is null or hand_room between 0 and 30);

create table if not exists public.versus_group_teams (
  match_id          uuid not null references public.versus_group_matches(id) on delete cascade,
  team              text not null check (team ~ '^[a-z]$'),
  hearts            int  not null default 7,
  eliminated_round  int,
  out_reason        text check (out_reason in ('hearts', 'forfeit', 'left', 'missed')),
  placement         int  check (placement between 1 and 8),
  primary key (match_id, team)
);
alter table public.versus_group_teams enable row level security;
drop policy if exists "versus group read teams" on public.versus_group_teams;
create policy "versus group read teams" on public.versus_group_teams for select to authenticated using (true);

-- Teams still in a match.
create or replace function public.versus_duos__living_teams(p_match uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.versus_group_teams where match_id = p_match and eliminated_round is null;
$$;

create table if not exists public.versus_duos_passes (
  match_id     uuid not null references public.versus_group_matches(id) on delete cascade,
  round        int  not null,
  from_seat    text not null check (from_seat ~ '^p[1-9][0-9]*$'),
  to_seat      text not null check (to_seat ~ '^p[1-9][0-9]*$'),
  seq          int  not null check (seq >= 0),
  card         jsonb not null check (jsonb_typeof(card) = 'object' and octet_length(card::text) <= 16384),
  -- 'sent' until the teammate's run answers: 'landed' in its hand, or 'refused' (its hand was full).
  status       text not null default 'sent' check (status in ('sent', 'landed', 'refused')),
  created_at   timestamptz not null default now(),
  answered_at  timestamptz,
  primary key (match_id, from_seat, seq)
);
alter table public.versus_duos_passes add column if not exists status text not null default 'sent' check (status in ('sent', 'landed', 'refused'));
alter table public.versus_duos_passes add column if not exists answered_at timestamptz;
create index if not exists versus_duos_passes_to on public.versus_duos_passes (match_id, to_seat, round);

alter table public.versus_duos_passes enable row level security;
-- The two teammates read their team's passes (the receiver lands them; the sender sees the answer). Spectators see the
-- pass through the players' own frames.
drop policy if exists "versus duos read team passes" on public.versus_duos_passes;
create policy "versus duos read team passes" on public.versus_duos_passes for select to authenticated using (
  exists (select 1 from public.versus_group_seats s where s.match_id = versus_duos_passes.match_id and s.user_id = auth.uid()
    and s.seat in (versus_duos_passes.from_seat, versus_duos_passes.to_seat)));

-- ── 4. Rooms: Duos starts with exactly four ────────────────────────────────────────────────────────────────────
create or replace function public.versus_start_game(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.versus_rooms;
  v_mode text;
begin
  select * into r from public.versus_rooms where id = p_room for update;
  if not found then raise exception 'no_room'; end if;
  if r.host_user_id <> auth.uid() then raise exception 'not_host'; end if;
  if r.status <> 'open' then raise exception 'room_not_open'; end if;
  v_mode := coalesce(r.options->>'mode', 'duel');
  if (select count(*) from public.versus_members where room_id = p_room and role = any (public.versus__mode_roles(v_mode)))
      < public.versus__mode_min_players(v_mode) then
    raise exception '%', case when v_mode = 'duos' then 'need_four_players' when v_mode = 'group' then 'need_three_players' else 'need_two_players' end;
  end if;
  update public.versus_rooms set status = 'sealed', p1_gate = false, p2_gate = false, p3_gate = false, p4_gate = false,
    gate_deadline = public.versus_clock() + interval '30 seconds', revision = revision + 1, updated_at = public.versus_clock()
    where id = p_room;
  return public.versus__room_json(p_room);
end;
$$;

-- A player presses their gate gem: the group branch also starts a Duos match (a group match whose options say duos).
create or replace function public.versus_press_gate(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_now timestamptz := public.versus_clock();
  r public.versus_rooms;
  v_role text;
  v_p1 public.versus_members;
  v_p2 public.versus_members;
  v_match uuid;
  v_mode text;
  v_all boolean;
  mm record;
begin
  select * into r from public.versus_rooms where id = p_room for update;
  if not found then raise exception 'no_room'; end if;
  select role into v_role from public.versus_members where room_id = p_room and user_id = v_user;
  if v_role is null or v_role = 'spectator' then raise exception 'not_a_player'; end if;
  if r.status <> 'sealed' then raise exception 'room_not_sealed'; end if;
  if v_now >= r.gate_deadline then
    update public.versus_rooms set status = 'open', p1_gate = false, p2_gate = false, p3_gate = false, p4_gate = false, gate_deadline = null,
      revision = revision + 1, updated_at = v_now where id = p_room;
    raise exception 'gate_expired';
  end if;
  update public.versus_rooms set
    p1_gate = p1_gate or v_role = 'p1', p2_gate = p2_gate or v_role = 'p2',
    p3_gate = p3_gate or v_role = 'p3', p4_gate = p4_gate or v_role = 'p4'
    where id = p_room returning * into r;
  v_mode := coalesce(r.options->>'mode', 'duel');
  if v_mode in ('group', 'duos') then
    select bool_and(case mm2.role when 'p1' then r.p1_gate when 'p2' then r.p2_gate when 'p3' then r.p3_gate else r.p4_gate end)
      into v_all from public.versus_members mm2 where mm2.room_id = p_room and mm2.role <> 'spectator';
    -- Duos needs all four seats (a seat emptied while sealed cannot start a 2v2).
    if v_mode = 'duos' and (select count(*) from public.versus_members where room_id = p_room and role <> 'spectator') <> 4 then
      v_all := false;
    end if;
    if coalesce(v_all, false) then
      insert into public.versus_group_matches (room_id, seed, set_id, content_revision, protocol, options, phase, seat_count, hero_deadline)
        values (p_room, floor(random() * 2147483647)::bigint, r.set_id, r.content_revision, r.protocol, public.versus__normalize_options(r.options),
                'hero_select', (select count(*) from public.versus_members where room_id = p_room and role <> 'spectator'),
                v_now + interval '20 seconds')
        returning id into v_match;
      for mm in select * from public.versus_members where room_id = p_room and role <> 'spectator' order by role loop
        insert into public.versus_group_seats (match_id, seat, user_id, name) values (v_match, mm.role, mm.user_id, mm.display_name);
        insert into public.versus_group_seat_private (match_id, seat, user_id, hero_seed, run_seed)
          values (v_match, mm.role, mm.user_id, floor(random() * 2147483647)::bigint, floor(random() * 2147483647)::bigint);
      end loop;
      -- Duos: every seat joins its seat pair's team; each team starts with its own hearts.
      if v_mode = 'duos' then
        update public.versus_group_seats set team = public.versus_duos__team(seat) where match_id = v_match;
        insert into public.versus_group_teams (match_id, team)
          select distinct v_match, public.versus_duos__team(seat) from public.versus_group_seats where match_id = v_match
          on conflict do nothing;
      end if;
      update public.versus_rooms set status = 'in_game', current_match_id = v_match, gate_deadline = null where id = p_room;
    end if;
  elsif r.p1_gate and r.p2_gate then
    select * into v_p1 from public.versus_members where room_id = p_room and role = 'p1';
    select * into v_p2 from public.versus_members where room_id = p_room and role = 'p2';
    insert into public.versus_matches (room_id, seed, set_id, content_revision, protocol, phase, p1_user, p2_user, p1_name, p2_name, hero_deadline, options)
      values (p_room, floor(random() * 2147483647)::bigint, r.set_id, r.content_revision, r.protocol, 'hero_select',
              v_p1.user_id, v_p2.user_id, v_p1.display_name, v_p2.display_name, v_now + interval '20 seconds',
              public.versus__normalize_options(r.options))
      returning id into v_match;
    insert into public.versus_seat_private (match_id, seat, user_id, hero_seed, run_seed) values
      (v_match, 'p1', v_p1.user_id, floor(random() * 2147483647)::bigint, floor(random() * 2147483647)::bigint),
      (v_match, 'p2', v_p2.user_id, floor(random() * 2147483647)::bigint, floor(random() * 2147483647)::bigint);
    update public.versus_rooms set status = 'in_game', current_match_id = v_match, gate_deadline = null where id = p_room;
  end if;
  update public.versus_rooms set revision = revision + 1, updated_at = v_now where id = p_room;
  return public.versus__room_json(p_room);
end;
$$;

-- The menus' open-room count: a Duos room has four seats too.
create or replace function public.versus_open_rooms(p_protocol int, p_content text)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with fresh as (
    -- (security invoker: the seat count is inlined, the private `versus__mode_roles` helper is not callable here)
    select r.id, case when r.options->>'mode' in ('group', 'duos') then 4 else 2 end as cap,
      (select count(*) from public.versus_members m
        where m.room_id = r.id and m.role <> 'spectator' and m.last_seen_at >= public.versus_clock() - interval '2 minutes') as players
    from public.versus_rooms r
    where r.status = 'open'
      and r.protocol = p_protocol
      and r.content_revision = p_content
      and exists (select 1 from public.versus_members m
        where m.room_id = r.id and m.last_seen_at >= public.versus_clock() - interval '2 minutes')
      and not exists (select 1 from public.versus_members m
        where m.room_id = r.id and m.user_id = auth.uid())
  )
  select jsonb_build_object(
    'open', count(*),
    'seatOpen', count(*) filter (where players < cap)
  ) from fresh;
$$;

-- ── 5. Group helpers with their Duos branches ────────────────────────────────────────────────────────────────
-- Open round p_round's shop (unchanged) + a Duos match's default fight order for the round.
create or replace function public.versus_group__open_shop(m public.versus_group_matches, p_round int)
returns public.versus_group_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  v_first boolean := p_round = 1;
  v_out public.versus_group_matches;
begin
  update public.versus_group_seats set locked = false, ready = false where match_id = m.id;
  update public.versus_group_matches set
    phase = 'shop', round = p_round,
    shop_starts_at = case when v_first then null else v_now end,
    shop_deadline = case when v_first then null else v_now + make_interval(secs => public.versus_turn_seconds(p_round)) end,
    intro_deadline = case when v_first then v_now + interval '45 seconds' else null end,
    combat_deadline = null,
    duos_first = case when public.versus_duos__is(m) then public.versus_duos__default_first(p_round, m.seat_count / 2) else duos_first end,
    revision = revision + 1, updated_at = v_now
  where id = m.id returning * into v_out;
  return v_out;
end;
$$;

-- End the match (unchanged) + in Duos the winner's TEAMMATE shares 1st.
create or replace function public.versus_group__complete(m public.versus_group_matches, p_winner text, p_reason text)
returns public.versus_group_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  v_out public.versus_group_matches;
begin
  if p_winner is not null then
    -- Duos: placement is by TEAM: the winner's whole team is 1st.
    update public.versus_group_seats set placement = 1 where match_id = m.id
      and (seat = p_winner or (public.versus_duos__is(m) and team = public.versus_duos__team(p_winner)));
    if public.versus_duos__is(m) then
      update public.versus_group_teams set placement = 1 where match_id = m.id and team = public.versus_duos__team(p_winner);
    end if;
  end if;
  update public.versus_group_matches set phase = 'complete', winner_seat = p_winner, end_reason = p_reason,
    paused_seat = null, paused_at = null, pause_grace_until = null, resume_at = null,
    completed_at = v_now, revision = revision + 1, updated_at = v_now
    where id = m.id returning * into v_out;
  update public.versus_rooms set status = 'open', p1_gate = false, p2_gate = false, p3_gate = false, p4_gate = false, gate_deadline = null,
    revision = revision + 1, updated_at = v_now
    where id = m.room_id and current_match_id = m.id;
  return v_out;
end;
$$;

-- A seat goes out now (left, conceded, or missed three rounds). Group: unchanged. Duos (owner: "concede = team out"):
-- the seat AND its teammate go out together (placement 3) and the other team wins.
create or replace function public.versus_group__eliminate(m public.versus_group_matches, p_seat text, p_reason text)
returns public.versus_group_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_left int;
  v_winner text;
begin
  if m.phase = 'complete' then return m; end if;
  if public.versus_duos__is(m) then
    -- The seat's TEAM goes out together, placed by how many teams were still in (2nd of 2).
    update public.versus_group_teams set eliminated_round = m.round, out_reason = p_reason,
      placement = public.versus_duos__living_teams(m.id)
      where match_id = m.id and team = public.versus_duos__team(p_seat) and eliminated_round is null;
    if not found then return m; end if;
    update public.versus_group_seats s set eliminated_round = m.round,
      out_reason = case when s.seat = p_seat then p_reason else 'forfeit' end, auto = false, placement = t.placement
      from public.versus_group_teams t
      where s.match_id = m.id and t.match_id = m.id and t.team = s.team and s.team = public.versus_duos__team(p_seat) and s.eliminated_round is null;
    m := public.versus_group__touch(m.id);
    if public.versus_duos__living_teams(m.id) <= 1 then
      select seat into v_winner from public.versus_group_seats where match_id = m.id and eliminated_round is null order by seat limit 1;
      return public.versus_group__complete(m, v_winner, case when p_reason = 'missed' then 'missed' else 'forfeit' end);
    end if;
    m := public.versus_group__maybe_resolve(m);
    m := public.versus_group__maybe_next(m);
    return m;
  end if;
  update public.versus_group_seats set eliminated_round = m.round, out_reason = p_reason, auto = false,
    placement = public.versus_group__living(m.id)
    where match_id = m.id and seat = p_seat and eliminated_round is null;
  if not found then return m; end if;
  m := public.versus_group__touch(m.id);
  v_left := public.versus_group__living(m.id);
  if v_left <= 1 then
    select seat into v_winner from public.versus_group_seats where match_id = m.id and eliminated_round is null;
    return public.versus_group__complete(m, v_winner, case when p_reason = 'missed' then 'missed' else 'forfeit' end);
  end if;
  if m.paused_seat = p_seat then m := public.versus_group__resume(m); end if;
  if m.phase = 'hero_select' then m := public.versus_group__maybe_start(m); end if;
  m := public.versus_group__maybe_clock(m);
  m := public.versus_group__maybe_resolve(m);
  m := public.versus_group__maybe_next(m);
  return m;
end;
$$;

-- ── 6. Duos RPCs ──────────────────────────────────────────────────────────────────────────────────────────────
-- Flip which of my team's boards fights first this round (owner: "flippable in shop until first End Turn").
create or replace function public.versus_duos_flip_order(p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.versus_group_matches;
  v_seat text;
  v_team text;
  v_first jsonb;
begin
  select * into m from public.versus_group_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  if not public.versus_duos__is(m) then raise exception 'not_duos'; end if;
  v_seat := public.versus_group__seat_of(p_match, auth.uid());
  if v_seat is null then raise exception 'not_a_player'; end if;
  if m.phase <> 'shop' then raise exception 'not_shop'; end if;
  if m.paused_at is null and m.shop_deadline is not null and public.versus_clock() >= m.shop_deadline + public.versus__shop_grace() then
    raise exception 'deadline_passed';
  end if;
  v_team := public.versus_duos__team(v_seat);
  if exists (select 1 from public.versus_group_seats where match_id = p_match and seat = any (public.versus_duos__seats(v_team)) and locked) then
    raise exception 'team_locked';
  end if;
  v_first := coalesce(m.duos_first, public.versus_duos__default_first(m.round, m.seat_count / 2));
  v_first := jsonb_set(v_first, array[v_team], to_jsonb(public.versus_duos__mate(v_first->>v_team)));
  update public.versus_group_matches set duos_first = v_first, revision = revision + 1, updated_at = public.versus_clock()
    where id = p_match returning * into m;
  return public.versus_group__match_json(m);
end;
$$;

-- My hand room, reported by my run whenever it changes (Duos passes: "Pass is refused if hand is full").
create or replace function public.versus_duos_hand_room(p_match uuid, p_room int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seat text;
begin
  v_seat := public.versus_group__seat_of(p_match, auth.uid());
  if v_seat is null then raise exception 'not_a_player'; end if;
  if p_room is null or p_room < 0 or p_room > 30 then raise exception 'bad_room'; end if;
  update public.versus_group_seats set hand_room = p_room where match_id = p_match and seat = v_seat;
end;
$$;

-- Pass a card to my teammate (owner: "drag a card from your hand/board to your teammate's portrait"; "passing should
-- cost 1 gold"; "Pass is refused if hand is full"). The run already moved the card and paid the Gold (its own recorded
-- `passCard`); this records it for the teammate, exactly once per (seat, seq). Shop only, before my lock and the clock
-- (with its grace), and never to a hand my teammate reported full (less the passes it has not answered yet).
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
  if v_room is not null and v_room - (select count(*) from public.versus_duos_passes
      where match_id = p_match and to_seat = v_mate and status = 'sent') <= 0 then
    raise exception 'hand_full';
  end if;
  if p_seq is null or p_seq < 0 or p_card is null or jsonb_typeof(p_card) <> 'object' or coalesce(jsonb_typeof(p_card->'cardId'), '') <> 'string'
     or octet_length(p_card::text) > 16384 then
    raise exception 'bad_card';
  end if;
  if (select count(*) from public.versus_duos_passes where match_id = p_match and from_seat = v_seat and round = p_round) >= 10 then
    raise exception 'too_many_passes';
  end if;
  insert into public.versus_duos_passes (match_id, round, from_seat, to_seat, seq, card)
    values (p_match, p_round, v_seat, v_mate, p_seq, p_card) returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

-- The receiver's run answers a pass: it landed in the hand, or the full hand refused it (the sender's run then gets
-- the card and the Gold back). Only the pass's own receiver answers, once.
create or replace function public.versus_duos_answer_pass(p_match uuid, p_from_seat text, p_seq int, p_landed boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seat text;
  v_row public.versus_duos_passes;
begin
  v_seat := public.versus_group__seat_of(p_match, auth.uid());
  if v_seat is null then raise exception 'not_a_player'; end if;
  select * into v_row from public.versus_duos_passes where match_id = p_match and from_seat = p_from_seat and seq = p_seq for update;
  if not found then raise exception 'no_pass'; end if;
  if v_row.to_seat <> v_seat then raise exception 'not_receiver'; end if;
  if v_row.status = 'sent' then
    update public.versus_duos_passes set status = case when p_landed then 'landed' else 'refused' end, answered_at = public.versus_clock()
      where match_id = p_match and from_seat = p_from_seat and seq = p_seq returning * into v_row;
  end if;
  return to_jsonb(v_row);
end;
$$;

-- The round's ONE tag-team fight, committed by `versus-resolve` (`finalize_duos`) as the service role. Idempotent.
--   p_fight: { a, b (each team's FIRST seat), chair ('a' | 'b'), outcome ('a' | 'b' | 'draw'), losingTeam, heartsLost
--             (0 | 1 | 2), aResult (team A's view), bResult (team B's view) }
create or replace function public.versus_duos_commit_round(p_match uuid, p_round int, p_fight jsonb, p_digest text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  m public.versus_group_matches;
  v_a text := p_fight->>'a';
  v_b text := p_fight->>'b';
  v_outcome text := p_fight->>'outcome';
  v_lose text := p_fight->>'losingTeam';
  v_hearts int := coalesce((p_fight->>'heartsLost')::int, 0);
  v_dead text[] := '{}';
  v_winner text;
  v_reason text := 'hearts';
  v_team text;
begin
  select * into m from public.versus_group_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  if not public.versus_duos__is(m) then raise exception 'not_duos'; end if;
  if exists (select 1 from public.versus_group_rounds where match_id = p_match and round = p_round) then
    return jsonb_build_object('alreadyCommitted', true, 'match', public.versus_group__match_json(m));
  end if;
  if m.phase <> 'resolving' or m.round <> p_round then raise exception 'not_resolving'; end if;
  if p_fight is null or jsonb_typeof(p_fight) <> 'object'
     or public.versus_duos__team(v_a) is distinct from 'a' or public.versus_duos__team(v_b) is distinct from 'b'
     or not exists (select 1 from public.versus_group_seats where match_id = p_match and seat = v_a)
     or not exists (select 1 from public.versus_group_seats where match_id = p_match and seat = v_b)
     or v_outcome not in ('a', 'b', 'draw') or p_fight->>'chair' not in ('a', 'b')
     or (v_outcome = 'draw') <> (v_lose is null) or (v_outcome = 'a' and v_lose <> 'b') or (v_outcome = 'b' and v_lose <> 'a')
     or (v_outcome = 'draw' and v_hearts <> 0) or (v_outcome <> 'draw' and v_hearts not in (1, 2)) then
    raise exception 'bad_fight';
  end if;
  insert into public.versus_group_fights (match_id, round, fight, a_seat, b_seat, b_copy, chair, outcome, heart_lost_by, a_result, b_result, a_scout, b_scout)
    values (p_match, p_round, 0, v_a, v_b, false, p_fight->>'chair', v_outcome,
      case v_lose when 'a' then v_a when 'b' then v_b end, p_fight->'aResult', p_fight->'bResult',
      (select coalesce(su.scout, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('tier', su.prepared_side -> 'state' -> 'tier'))
         from public.versus_group_submissions su where su.match_id = p_match and su.round = p_round and su.seat = v_a),
      (select coalesce(su.scout, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('tier', su.prepared_side -> 'state' -> 'tier'))
         from public.versus_group_submissions su where su.match_id = p_match and su.round = p_round and su.seat = v_b));

  -- TEAM hearts (the team's own row; each seat mirrors it). A team at 0 is out together, placed by how many teams were
  -- still in (2nd of 2); the last team in is 1st.
  if v_lose is not null then
    update public.versus_group_teams set hearts = greatest(0, hearts - v_hearts)
      where match_id = p_match and team = v_lose and eliminated_round is null;
    if exists (select 1 from public.versus_group_teams where match_id = p_match and team = v_lose and hearts <= 0 and eliminated_round is null) then
      update public.versus_group_teams set eliminated_round = p_round, out_reason = 'hearts', placement = public.versus_duos__living_teams(p_match)
        where match_id = p_match and team = v_lose;
      v_dead := public.versus_duos__seats(v_lose);
    end if;
  end if;

  -- Missed rounds: an auto seat's count grows, a present seat's resets; three in a row puts its TEAM out.
  update public.versus_group_seats set missed = case when auto then missed + 1 else 0 end
    where match_id = p_match and eliminated_round is null;
  if cardinality(v_dead) = 0 then
    select team into v_team from public.versus_group_seats
      where match_id = p_match and eliminated_round is null and missed >= 3 order by seat limit 1;
    if v_team is not null then
      update public.versus_group_teams set eliminated_round = p_round, out_reason = 'missed', placement = public.versus_duos__living_teams(p_match)
        where match_id = p_match and team = v_team and eliminated_round is null;
      v_dead := public.versus_duos__seats(v_team);
      if v_lose is null then v_reason := 'missed'; end if;
    end if;
  end if;

  -- Every seat mirrors its team (hearts, and when out: the round, why and the placement).
  update public.versus_group_seats s set hearts = t.hearts,
    eliminated_round = coalesce(s.eliminated_round, t.eliminated_round),
    out_reason = case when s.eliminated_round is null and t.eliminated_round is not null
      then case when t.out_reason = 'missed' and s.missed < 3 then 'forfeit' else t.out_reason end else s.out_reason end,
    auto = case when t.eliminated_round is not null then false else s.auto end,
    placement = coalesce(t.placement, s.placement)
    from public.versus_group_teams t where s.match_id = p_match and t.match_id = p_match and t.team = s.team;

  insert into public.versus_group_rounds (match_id, round, digest, hearts, eliminated)
    values (p_match, p_round, p_digest,
      (select jsonb_object_agg(seat, hearts) from public.versus_group_seats where match_id = p_match),
      to_jsonb(v_dead));
  update public.versus_group_seats set ready = false where match_id = p_match;
  update public.versus_group_matches set phase = 'combat', combat_deadline = v_now + interval '90 seconds',
    revision = revision + 1, updated_at = v_now
    where id = p_match returning * into m;
  if public.versus_duos__living_teams(p_match) <= 1 then
    select seat into v_winner from public.versus_group_seats where match_id = p_match and eliminated_round is null order by seat limit 1;
    m := public.versus_group__complete(m, v_winner, v_reason);
  end if;
  return jsonb_build_object('alreadyCommitted', false, 'match', public.versus_group__match_json(m));
end;
$$;

-- ── 7. Grants ─────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function public.versus__options_error(jsonb) from public, anon, authenticated;
revoke all on function public.versus__mode_roles(text) from public, anon, authenticated;
revoke all on function public.versus__mode_min_players(text) from public, anon, authenticated;
revoke all on function public.versus_duos__team(text) from public, anon, authenticated;
revoke all on function public.versus_duos__mate(text) from public, anon, authenticated;
revoke all on function public.versus_duos__seats(text) from public, anon, authenticated;
revoke all on function public.versus_duos__default_first(int, int) from public, anon, authenticated;
revoke all on function public.versus_duos__living_teams(uuid) from public, anon, authenticated;
revoke all on function public.versus_duos__is(public.versus_group_matches) from public, anon, authenticated;
revoke all on function public.versus_group__open_shop(public.versus_group_matches, int) from public, anon, authenticated;
revoke all on function public.versus_group__complete(public.versus_group_matches, text, text) from public, anon, authenticated;
revoke all on function public.versus_group__eliminate(public.versus_group_matches, text, text) from public, anon, authenticated;
revoke all on function public.versus_duos_commit_round(uuid, int, jsonb, text) from public, anon, authenticated;
grant execute on function public.versus_duos_commit_round(uuid, int, jsonb, text) to service_role;

revoke all on function public.versus_start_game(uuid) from public, anon;
revoke all on function public.versus_press_gate(uuid) from public, anon;
revoke all on function public.versus_open_rooms(int, text) from public, anon;
revoke all on function public.versus_duos_flip_order(uuid) from public, anon;
revoke all on function public.versus_duos_pass(uuid, int, int, jsonb) from public, anon;
revoke all on function public.versus_duos_hand_room(uuid, int) from public, anon;
revoke all on function public.versus_duos_answer_pass(uuid, text, int, boolean) from public, anon;
grant execute on function public.versus_start_game(uuid) to authenticated;
grant execute on function public.versus_press_gate(uuid) to authenticated;
grant execute on function public.versus_open_rooms(int, text) to authenticated;
grant execute on function public.versus_duos_flip_order(uuid) to authenticated;
grant execute on function public.versus_duos_pass(uuid, int, int, jsonb) to authenticated;
grant execute on function public.versus_duos_hand_room(uuid, int) to authenticated;
grant execute on function public.versus_duos_answer_pass(uuid, text, int, boolean) to authenticated;

-- ── 8. Realtime: a pass wakes the teammate (rows stay the truth) ──────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'versus_duos_passes') then
      alter publication supabase_realtime add table public.versus_duos_passes;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'versus_group_teams') then
      alter publication supabase_realtime add table public.versus_group_teams;
    end if;
  end if;
end;
$$;
