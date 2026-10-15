-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- VERSUS: real-time 1v1 rooms, matches, rounds and spectator frames  (2026-10-13)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run. ADDITIVE ONLY: new `versus_*` tables, functions, policies and
-- Realtime publication entries; it touches no existing table or row. Idempotent (safe to re-run). Deploy the
-- `versus-resolve` Edge Function (supabase/README.md) with or after it: the function's `finalize` action calls
-- `versus_commit_round` below as the service role.
--
-- THE MODEL (blueprint docs/superpowers/specs/2026-10-13-versus-mode-design.md, owner rulings 2026-10-13):
--  - A ROOM is a continuous lobby (ruling 10): it outlives its matches. Members hold one of three roles: `p1`,
--    `p2` (the two player seats) or `spectator` (up to 20, ruling 8; every room is watchable). While the room is
--    `open`, members may swap freely between an empty player seat and the stands.
--  - The HOST presses Start: the room goes `sealed` (player seats frozen) and both players must press their gate
--    gem within 30 s (ruling 5), or the room returns to `open`. Both gems → a MATCH row, `in_game`.
--  - A MATCH: Hero Select (20 s; a missing pick is a deterministic random index of the seat's three, ruling 2) →
--    rounds of `shop` (server deadline, `versus_turn_seconds`, no Gold Fuse) → `resolving` (the Edge Function
--    fights the two locked sides ONCE and commits) → `combat` (both players watch; a ready barrier, capped) → the
--    next shop. Each lost round strikes one of the loser's 7 hearts (ruling 1); a draw strikes nobody (ruling 4).
--    0 hearts ends the match, the room goes back to `open` with everyone still in it.
--  - Every transition locks the row and bumps `revision`. No scheduler: any member calls `versus_reconcile` when a
--    known deadline passes, and it applies whatever is due, idempotently.
--  - DISCONNECTS (ruling 6): a player whose heartbeat is older than the lease PAUSES the match (deadlines stop). Back
--    within the 30 s grace, the match resumes with every deadline shifted by the pause. Past the grace the opponent
--    may unpause: the absent seat is then on AUTO (its last locked board fights for it every round), and 3
--    consecutive auto rounds forfeit the match. Returning clears auto.
--  - Rating, rank, medals: never touched (ruling 9). XP, achievements and history are granted client-side through
--    the existing progression path; this file only records the matches.
--  - Writes go through the security-definer RPCs below; the tables have no client write policy. A player's
--    candidate sides and private seeds are owner-only; everything else in a room is public to signed-in players.
--
-- Constants mirrored from packages/sim/src/versus/constants.ts (versusConstants.test.ts pins them):
--   hearts 7 · hero select 20 s · gate 30 s · pause grace 30 s · missed rounds 3 · spectators 20 · lead 3 s ·
--   combat cap 90 s · lease 12 s · side 262144 B · frame 196608 B.

-- ── 0. Clock (a hook so the pglite tests can move time; honoured only for the database owner's session) ────
create or replace function public.versus_clock()
returns timestamptz
language sql
stable
as $$
  select case
    when session_user = 'postgres' and coalesce(current_setting('versus.test_now', true), '') <> ''
      then current_setting('versus.test_now', true)::timestamptz
    else now()
  end;
$$;

-- The round timer, mirrored from packages/ui/src/turnClock.ts `standardTurnSeconds(wave)` (multiplier 1).
-- versusConstants.test.ts compares this function with the TS for rounds 1-80.
create or replace function public.versus_turn_seconds(p_round int)
returns int
language sql
immutable
as $$
  select greatest(21, least(80, 18 + (p_round - 1) * 4 + case when p_round >= 6 then 6 else 0 end)
                     + case when p_round >= 12 then 12 else 0 end);
$$;

-- ── 1. Tables ──────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.versus_rooms (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (char_length(name) between 1 and 40),
  host_user_id       uuid not null,
  status             text not null default 'open' check (status in ('open', 'sealed', 'in_game')),
  set_id             text not null check (char_length(set_id) between 1 and 16),
  content_revision   text not null check (char_length(content_revision) between 1 and 32),
  protocol           int  not null,
  revision           bigint not null default 1,
  gate_deadline      timestamptz,
  p1_gate            boolean not null default false,
  p2_gate            boolean not null default false,
  current_match_id   uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists public.versus_members (
  room_id       uuid not null references public.versus_rooms(id) on delete cascade,
  user_id       uuid not null,
  role          text not null check (role in ('p1', 'p2', 'spectator')),
  display_name  text not null check (char_length(display_name) between 1 and 40),
  profile       jsonb not null default '{}'::jsonb check (octet_length(profile::text) <= 4096),
  joined_at     timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  primary key (room_id, user_id)
);
-- One room per account at a time; one holder per player seat.
create unique index if not exists versus_members_one_room on public.versus_members (user_id);
create unique index if not exists versus_members_one_seat on public.versus_members (room_id, role) where role in ('p1', 'p2');

create table if not exists public.versus_matches (
  id                 uuid primary key default gen_random_uuid(),
  room_id            uuid references public.versus_rooms(id) on delete set null,
  seed               bigint not null,
  set_id             text not null,
  content_revision   text not null,
  protocol           int  not null,
  phase              text not null check (phase in ('hero_select', 'shop', 'resolving', 'combat', 'complete')),
  revision           bigint not null default 1,
  round              int  not null default 0,
  p1_user            uuid not null,
  p2_user            uuid not null,
  p1_name            text not null,
  p2_name            text not null,
  p1_hearts          int  not null default 7,
  p2_hearts          int  not null default 7,
  p1_hero            text,
  p2_hero            text,
  heroes_revealed    boolean not null default false,
  hero_deadline      timestamptz,
  shop_starts_at     timestamptz,
  shop_deadline      timestamptz,
  combat_deadline    timestamptz,
  p1_locked          boolean not null default false,
  p2_locked          boolean not null default false,
  p1_ready           boolean not null default false,
  p2_ready           boolean not null default false,
  paused_seat        text check (paused_seat in ('p1', 'p2')),
  paused_at          timestamptz,
  pause_grace_until  timestamptz,
  p1_auto            boolean not null default false,
  p2_auto            boolean not null default false,
  p1_missed          int  not null default 0,
  p2_missed          int  not null default 0,
  winner_seat        text check (winner_seat in ('p1', 'p2')),
  end_reason         text check (end_reason in ('hearts', 'forfeit', 'missed', 'abandoned')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  completed_at       timestamptz
);
create index if not exists versus_matches_room on public.versus_matches (room_id, created_at desc);
create index if not exists versus_matches_p1 on public.versus_matches (p1_user, created_at desc);
create index if not exists versus_matches_p2 on public.versus_matches (p2_user, created_at desc);

-- Per-seat private state: the hidden hero offer (ruling 3) and the seat's own run seed. Owner-only read.
create table if not exists public.versus_seat_private (
  match_id    uuid not null references public.versus_matches(id) on delete cascade,
  seat        text not null check (seat in ('p1', 'p2')),
  user_id     uuid not null,
  hero_seed   bigint not null,
  run_seed    bigint not null,
  hero_offer  text[] check (hero_offer is null or cardinality(hero_offer) = 3),
  hero_index  smallint check (hero_index between 0 and 2),
  hero_auto   boolean not null default false,
  primary key (match_id, seat)
);

-- A seat's turn: the newest candidate (promoted at the deadline) and, once locked, the final side. Owner-only read.
create table if not exists public.versus_submissions (
  match_id       uuid not null references public.versus_matches(id) on delete cascade,
  round          int  not null,
  seat           text not null check (seat in ('p1', 'p2')),
  user_id        uuid not null,
  candidate_seq  int  not null,
  prepared_side  jsonb check (prepared_side is null or octet_length(prepared_side::text) <= 262144),
  final          boolean not null default false,
  source         text not null default 'candidate' check (source in ('candidate', 'lock', 'deadline', 'auto', 'empty')),
  checkpoint     jsonb check (checkpoint is null or octet_length(checkpoint::text) <= 1048576),
  updated_at     timestamptz not null default now(),
  primary key (match_id, round, seat)
);

-- One authoritative fight per round, both perspectives. Public once committed.
create table if not exists public.versus_rounds (
  match_id       uuid not null references public.versus_matches(id) on delete cascade,
  round          int  not null,
  chair          text not null check (chair in ('p1', 'p2')),
  outcome        text not null check (outcome in ('p1', 'p2', 'draw')),
  heart_lost_by  text check (heart_lost_by in ('p1', 'p2')),
  p1_result      jsonb not null,
  p2_result      jsonb not null,
  digest         text not null,
  p1_hearts      int  not null,
  p2_hearts      int  not null,
  committed_at   timestamptz not null default now(),
  primary key (match_id, round)
);

-- The latest spectator KEYFRAME per seat (blueprint 8): deltas ride the Realtime broadcast channel; a late joiner
-- or a subscriber that sees a sequence gap reads this row and resumes after its `seq`.
create table if not exists public.versus_spectator_frames (
  match_id    uuid not null references public.versus_matches(id) on delete cascade,
  seat        text not null check (seat in ('p1', 'p2')),
  seq         bigint not null,
  round       int not null,
  frame       jsonb not null check (octet_length(frame::text) <= 196608),
  updated_at  timestamptz not null default now(),
  primary key (match_id, seat)
);

-- ── 2. Row level security: reads only; every write is an RPC ──────────────────────────────────────────────
alter table public.versus_rooms enable row level security;
alter table public.versus_members enable row level security;
alter table public.versus_matches enable row level security;
alter table public.versus_seat_private enable row level security;
alter table public.versus_submissions enable row level security;
alter table public.versus_rounds enable row level security;
alter table public.versus_spectator_frames enable row level security;

drop policy if exists "versus read rooms" on public.versus_rooms;
create policy "versus read rooms" on public.versus_rooms for select to authenticated using (true);
drop policy if exists "versus read members" on public.versus_members;
create policy "versus read members" on public.versus_members for select to authenticated using (true);
drop policy if exists "versus read matches" on public.versus_matches;
create policy "versus read matches" on public.versus_matches for select to authenticated using (true);
drop policy if exists "versus read own private" on public.versus_seat_private;
create policy "versus read own private" on public.versus_seat_private for select to authenticated using (auth.uid() = user_id);
drop policy if exists "versus read own submissions" on public.versus_submissions;
create policy "versus read own submissions" on public.versus_submissions for select to authenticated using (auth.uid() = user_id);
drop policy if exists "versus read rounds" on public.versus_rounds;
create policy "versus read rounds" on public.versus_rounds for select to authenticated using (true);
drop policy if exists "versus read frames" on public.versus_spectator_frames;
create policy "versus read frames" on public.versus_spectator_frames for select to authenticated using (true);

grant select on public.versus_rooms, public.versus_members, public.versus_matches, public.versus_seat_private,
  public.versus_submissions, public.versus_rounds, public.versus_spectator_frames to authenticated;

-- ── 3. Internal helpers (not callable by clients) ──────────────────────────────────────────────────────────
-- The JSON a client reads back from every RPC: the match's public row.
create or replace function public.versus__match_json(m public.versus_matches)
returns jsonb
language sql
stable
as $$
  select to_jsonb(m) || jsonb_build_object('serverNow', public.versus_clock());
$$;

create or replace function public.versus__room_json(p_room uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(r) || jsonb_build_object(
    'members', coalesce((select jsonb_agg(jsonb_build_object(
        'userId', mm.user_id, 'role', mm.role, 'displayName', mm.display_name, 'profile', mm.profile,
        'lastSeenAt', mm.last_seen_at) order by mm.joined_at)
      from public.versus_members mm where mm.room_id = r.id), '[]'::jsonb),
    'serverNow', public.versus_clock())
  from public.versus_rooms r where r.id = p_room;
$$;

-- The caller's seat in a match, or null.
create or replace function public.versus__seat_of(m public.versus_matches, p_user uuid)
returns text
language sql
immutable
as $$
  select case when p_user = m.p1_user then 'p1' when p_user = m.p2_user then 'p2' else null end;
$$;

-- Deterministic pick in [0, n): the match seed folded with a label (hero timeout, ruling 2).
create or replace function public.versus__pick(p_seed bigint, p_label text, p_n int)
returns int
language sql
immutable
as $$
  select (abs(hashtext(p_seed::text || ':' || p_label)::bigint) % p_n)::int;
$$;

-- Open round p_round's shop, starting `lead` after now (ruling: normal round timer, no Gold Fuse).
create or replace function public.versus__open_shop(m public.versus_matches, p_round int)
returns public.versus_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  v_out public.versus_matches;
begin
  update public.versus_matches set
    phase = 'shop', round = p_round,
    shop_starts_at = v_now + interval '3 seconds',
    shop_deadline = v_now + interval '3 seconds' + make_interval(secs => public.versus_turn_seconds(p_round)),
    combat_deadline = null, p1_locked = false, p2_locked = false, p1_ready = false, p2_ready = false,
    revision = revision + 1, updated_at = v_now
  where id = m.id returning * into v_out;
  return v_out;
end;
$$;

-- Fill an unlocked seat's final side for the round (deadline promotion / auto / empty) and mark it locked.
create or replace function public.versus__finalize_seat(p_match uuid, p_round int, p_seat text, p_user uuid, p_auto boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last jsonb;
begin
  if p_auto then
    -- ruling 6: an absent player's LAST LOCKED board plays for them.
    select prepared_side into v_last from public.versus_submissions
      where match_id = p_match and seat = p_seat and final and round < p_round and prepared_side is not null
      order by round desc limit 1;
    insert into public.versus_submissions (match_id, round, seat, user_id, candidate_seq, prepared_side, final, source)
      values (p_match, p_round, p_seat, p_user, 0, v_last, true, case when v_last is null then 'empty' else 'auto' end)
      on conflict (match_id, round, seat) do update set prepared_side = coalesce(excluded.prepared_side, public.versus_submissions.prepared_side),
        final = true, source = case when public.versus_submissions.prepared_side is not null then 'deadline' else excluded.source end,
        updated_at = now();
    return;
  end if;
  -- Deadline: promote the newest candidate. None at all (the client never uploaded): the seat's last locked board,
  -- else an empty board, so two AFK players can never deadlock a round.
  if exists (select 1 from public.versus_submissions where match_id = p_match and round = p_round and seat = p_seat and prepared_side is not null) then
    update public.versus_submissions set final = true, source = 'deadline', updated_at = now()
      where match_id = p_match and round = p_round and seat = p_seat;
  else
    select prepared_side into v_last from public.versus_submissions
      where match_id = p_match and seat = p_seat and final and round < p_round and prepared_side is not null
      order by round desc limit 1;
    insert into public.versus_submissions (match_id, round, seat, user_id, candidate_seq, prepared_side, final, source)
      values (p_match, p_round, p_seat, p_user, 0, v_last, true, case when v_last is null then 'empty' else 'auto' end)
      on conflict (match_id, round, seat) do update set prepared_side = excluded.prepared_side, final = true,
        source = excluded.source, updated_at = now();
  end if;
end;
$$;

-- Both seats locked (or on auto) → `resolving`.
create or replace function public.versus__maybe_resolve(m public.versus_matches)
returns public.versus_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_out public.versus_matches := m;
begin
  if m.phase <> 'shop' then return m; end if;
  if not ((m.p1_locked or m.p1_auto) and (m.p2_locked or m.p2_auto)) then return m; end if;
  if m.p1_auto and not m.p1_locked then perform public.versus__finalize_seat(m.id, m.round, 'p1', m.p1_user, true); end if;
  if m.p2_auto and not m.p2_locked then perform public.versus__finalize_seat(m.id, m.round, 'p2', m.p2_user, true); end if;
  update public.versus_matches set phase = 'resolving', p1_locked = true, p2_locked = true,
    revision = revision + 1, updated_at = public.versus_clock()
    where id = m.id returning * into v_out;
  return v_out;
end;
$$;

-- Shift every live deadline by the pause and clear it.
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
    paused_seat = null, paused_at = null, pause_grace_until = null,
    revision = revision + 1, updated_at = v_now
  where id = m.id returning * into v_out;
  return v_out;
end;
$$;

-- End the match; the room goes back to `open` with everyone still seated (ruling 10).
create or replace function public.versus__complete(m public.versus_matches, p_winner text, p_reason text)
returns public.versus_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  v_out public.versus_matches;
begin
  update public.versus_matches set phase = 'complete', winner_seat = p_winner, end_reason = p_reason,
    paused_seat = null, paused_at = null, pause_grace_until = null,
    completed_at = v_now, revision = revision + 1, updated_at = v_now
    where id = m.id returning * into v_out;
  update public.versus_rooms set status = 'open', p1_gate = false, p2_gate = false, gate_deadline = null,
    revision = revision + 1, updated_at = v_now
    where id = m.room_id and current_match_id = m.id;
  return v_out;
end;
$$;

-- Hero picks are in (or timed out): reveal and open round 1.
create or replace function public.versus__maybe_start(m public.versus_matches)
returns public.versus_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  v_out public.versus_matches := m;
  r record;
begin
  if m.phase <> 'hero_select' then return m; end if;
  if v_now < m.hero_deadline and exists (select 1 from public.versus_seat_private where match_id = m.id and hero_index is null) then
    return m;
  end if;
  -- Timeout: a deterministic random pick from the seat's own three (ruling 2).
  update public.versus_seat_private set hero_index = public.versus__pick(m.seed, 'hero:' || seat, 3), hero_auto = true
    where match_id = m.id and hero_index is null;
  for r in select seat, hero_offer, hero_index from public.versus_seat_private where match_id = m.id loop
    if r.seat = 'p1' then
      update public.versus_matches set p1_hero = case when r.hero_offer is null then null else r.hero_offer[r.hero_index + 1] end where id = m.id;
    else
      update public.versus_matches set p2_hero = case when r.hero_offer is null then null else r.hero_offer[r.hero_index + 1] end where id = m.id;
    end if;
  end loop;
  update public.versus_matches set heroes_revealed = true where id = m.id returning * into v_out;
  return public.versus__open_shop(v_out, 1);
end;
$$;

-- ── 4. Rooms ───────────────────────────────────────────────────────────────────────────────────────────────
-- Create a room and take Player 1. An account in another room must leave it first.
create or replace function public.versus_create_room(p_name text, p_display text, p_profile jsonb, p_set_id text, p_content text, p_protocol int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_room uuid;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  if exists (select 1 from public.versus_members where user_id = v_user) then raise exception 'already_in_room'; end if;
  insert into public.versus_rooms (name, host_user_id, set_id, content_revision, protocol)
    values (left(coalesce(nullif(trim(p_name), ''), 'Versus'), 40), v_user, p_set_id, p_content, p_protocol)
    returning id into v_room;
  insert into public.versus_members (room_id, user_id, role, display_name, profile, last_seen_at)
    values (v_room, v_user, 'p1', left(coalesce(nullif(trim(p_display), ''), 'Player'), 40), coalesce(p_profile, '{}'::jsonb), public.versus_clock());
  return public.versus__room_json(v_room);
end;
$$;

-- Join as a player (atomically claims an empty seat of an OPEN room) or as a spectator (any status, cap 20).
create or replace function public.versus_join_room(p_room uuid, p_as text, p_display text, p_profile jsonb, p_content text, p_protocol int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  r public.versus_rooms;
  v_role text;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  select * into r from public.versus_rooms where id = p_room for update;
  if not found then raise exception 'no_room'; end if;
  if r.protocol <> p_protocol or r.content_revision <> p_content then raise exception 'version_mismatch'; end if;
  if exists (select 1 from public.versus_members where user_id = v_user and room_id = p_room) then
    return public.versus__room_json(p_room); -- already here: idempotent re-join
  end if;
  if exists (select 1 from public.versus_members where user_id = v_user) then raise exception 'already_in_room'; end if;
  if p_as = 'player' then
    if r.status <> 'open' then raise exception 'room_not_open'; end if;
    select s into v_role from unnest(array['p1', 'p2']) s
      where not exists (select 1 from public.versus_members where room_id = p_room and role = s) limit 1;
    if v_role is null then raise exception 'seats_full'; end if;
  elsif p_as = 'spectator' then
    if (select count(*) from public.versus_members where room_id = p_room and role = 'spectator') >= 20 then raise exception 'spectators_full'; end if;
    v_role := 'spectator';
  else
    raise exception 'bad_role';
  end if;
  insert into public.versus_members (room_id, user_id, role, display_name, profile, last_seen_at)
    values (p_room, v_user, v_role, left(coalesce(nullif(trim(p_display), ''), 'Player'), 40), coalesce(p_profile, '{}'::jsonb), public.versus_clock());
  update public.versus_rooms set revision = revision + 1, updated_at = public.versus_clock() where id = p_room;
  return public.versus__room_json(p_room);
end;
$$;

-- Swap between an empty player seat and the stands (ruling 10). Only while the room is open.
create or replace function public.versus_take_seat(p_room uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  r public.versus_rooms;
  v_cur text;
begin
  select * into r from public.versus_rooms where id = p_room for update;
  if not found then raise exception 'no_room'; end if;
  select role into v_cur from public.versus_members where room_id = p_room and user_id = v_user;
  if v_cur is null then raise exception 'not_a_member'; end if;
  if r.status <> 'open' then raise exception 'room_not_open'; end if;
  if p_role not in ('p1', 'p2', 'spectator') then raise exception 'bad_role'; end if;
  if v_cur = p_role then return public.versus__room_json(p_room); end if;
  if p_role in ('p1', 'p2') and exists (select 1 from public.versus_members where room_id = p_room and role = p_role) then raise exception 'seat_taken'; end if;
  if p_role = 'spectator' and (select count(*) from public.versus_members where room_id = p_room and role = 'spectator') >= 20 then raise exception 'spectators_full'; end if;
  update public.versus_members set role = p_role where room_id = p_room and user_id = v_user;
  update public.versus_rooms set revision = revision + 1, updated_at = public.versus_clock() where id = p_room;
  return public.versus__room_json(p_room);
end;
$$;

-- Leave. A player leaving a running match forfeits it. The host role passes on (players first); an empty room is removed.
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
  v_role text;
  v_next uuid;
begin
  select * into r from public.versus_rooms where id = p_room for update;
  if not found then return jsonb_build_object('left', true); end if;
  select role into v_role from public.versus_members where room_id = p_room and user_id = v_user;
  if v_role is null then return jsonb_build_object('left', true); end if;
  if r.status = 'in_game' and v_role in ('p1', 'p2') and r.current_match_id is not null then
    select * into m from public.versus_matches where id = r.current_match_id for update;
    if found and m.phase <> 'complete' then
      perform public.versus__complete(m, case when v_role = 'p1' then 'p2' else 'p1' end, 'forfeit');
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
    p1_gate = false, p2_gate = false, gate_deadline = case when status = 'sealed' then null else gate_deadline end,
    revision = revision + 1, updated_at = public.versus_clock() where id = p_room;
  return jsonb_build_object('left', true);
end;
$$;

-- Host: close the player gates. Both seats must be filled.
create or replace function public.versus_start_game(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.versus_rooms;
begin
  select * into r from public.versus_rooms where id = p_room for update;
  if not found then raise exception 'no_room'; end if;
  if r.host_user_id <> auth.uid() then raise exception 'not_host'; end if;
  if r.status <> 'open' then raise exception 'room_not_open'; end if;
  if (select count(*) from public.versus_members where room_id = p_room and role in ('p1', 'p2')) < 2 then raise exception 'need_two_players'; end if;
  update public.versus_rooms set status = 'sealed', p1_gate = false, p2_gate = false,
    gate_deadline = public.versus_clock() + interval '30 seconds', revision = revision + 1, updated_at = public.versus_clock()
    where id = p_room;
  return public.versus__room_json(p_room);
end;
$$;

-- Room-level deadline: a sealed room whose gems were not both pressed in 30 s returns to Open (ruling 5).
create or replace function public.versus_reconcile_room(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.versus_rooms;
begin
  select * into r from public.versus_rooms where id = p_room for update;
  if not found then raise exception 'no_room'; end if;
  if r.status = 'sealed' and public.versus_clock() >= r.gate_deadline then
    update public.versus_rooms set status = 'open', p1_gate = false, p2_gate = false, gate_deadline = null,
      revision = revision + 1, updated_at = public.versus_clock() where id = p_room;
  end if;
  return public.versus__room_json(p_room);
end;
$$;

-- A player presses their gate gem. Both pressed in time → the match begins with Hero Select (20 s).
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
begin
  select * into r from public.versus_rooms where id = p_room for update;
  if not found then raise exception 'no_room'; end if;
  select role into v_role from public.versus_members where room_id = p_room and user_id = v_user;
  if v_role not in ('p1', 'p2') then raise exception 'not_a_player'; end if;
  if r.status <> 'sealed' then raise exception 'room_not_sealed'; end if;
  if v_now >= r.gate_deadline then
    update public.versus_rooms set status = 'open', p1_gate = false, p2_gate = false, gate_deadline = null,
      revision = revision + 1, updated_at = v_now where id = p_room;
    raise exception 'gate_expired';
  end if;
  if v_role = 'p1' then update public.versus_rooms set p1_gate = true where id = p_room returning * into r;
  else update public.versus_rooms set p2_gate = true where id = p_room returning * into r; end if;
  if r.p1_gate and r.p2_gate then
    select * into v_p1 from public.versus_members where room_id = p_room and role = 'p1';
    select * into v_p2 from public.versus_members where room_id = p_room and role = 'p2';
    insert into public.versus_matches (room_id, seed, set_id, content_revision, protocol, phase, p1_user, p2_user, p1_name, p2_name, hero_deadline)
      values (p_room, floor(random() * 2147483647)::bigint, r.set_id, r.content_revision, r.protocol, 'hero_select',
              v_p1.user_id, v_p2.user_id, v_p1.display_name, v_p2.display_name, v_now + interval '20 seconds')
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

-- Heartbeat: keeps the lease; a returning player resumes a pause on their seat and leaves auto (ruling 6).
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
      if m.paused_seat = v_seat then m := public.versus__resume(m); end if;
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

-- The lobby browser: every room with its occupancy. Prunes members of OPEN rooms not seen for 2 minutes.
create or replace function public.versus_list_rooms()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
begin
  delete from public.versus_members mm using public.versus_rooms r
    where mm.room_id = r.id and r.status = 'open' and mm.last_seen_at < v_now - interval '2 minutes';
  delete from public.versus_rooms r where not exists (select 1 from public.versus_members mm where mm.room_id = r.id);
  return coalesce((select jsonb_agg(j order by j->>'createdAt' desc) from (
    select jsonb_build_object(
      'id', r.id, 'name', r.name, 'status', r.status, 'setId', r.set_id, 'contentRevision', r.content_revision,
      'protocol', r.protocol, 'createdAt', r.created_at, 'currentMatchId', r.current_match_id,
      'hostName', (select display_name from public.versus_members where room_id = r.id and user_id = r.host_user_id),
      'hostProfile', (select profile from public.versus_members where room_id = r.id and user_id = r.host_user_id),
      'players', (select count(*) from public.versus_members where room_id = r.id and role in ('p1', 'p2')),
      'spectators', (select count(*) from public.versus_members where room_id = r.id and role = 'spectator')
    ) as j from public.versus_rooms r) q), '[]'::jsonb);
end;
$$;

-- ── 5. The match ───────────────────────────────────────────────────────────────────────────────────────────
-- The client registers its hidden three (computed from its private hero seed) so a timeout pick can name the hero.
create or replace function public.versus_register_offer(p_match uuid, p_offer text[])
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
  if cardinality(p_offer) <> 3 or exists (select 1 from unnest(p_offer) o where o is null or char_length(o) > 32) then raise exception 'bad_offer'; end if;
  update public.versus_seat_private set hero_offer = p_offer where match_id = p_match and seat = v_seat and hero_offer is null;
  return public.versus__match_json(m);
end;
$$;

-- Lock a hero (index into the seat's three). Hidden until both are in or the deadline passes.
create or replace function public.versus_pick_hero(p_match uuid, p_index int)
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
  if m.phase <> 'hero_select' then raise exception 'wrong_phase'; end if;
  if p_index not between 0 and 2 then raise exception 'bad_index'; end if;
  if public.versus_clock() >= m.hero_deadline then
    m := public.versus__maybe_start(m);
    raise exception 'hero_deadline_passed';
  end if;
  update public.versus_seat_private set hero_index = p_index where match_id = p_match and seat = v_seat and hero_index is null;
  m := public.versus__maybe_start(m);
  return public.versus__match_json(m);
end;
$$;

-- Upload a turn candidate (`p_final` = End Turn: irreversible). Newer sequence numbers only; refused once locked.
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
  if m.paused_at is null and public.versus_clock() >= m.shop_deadline then raise exception 'deadline_passed'; end if;
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

-- A player finished (or skipped) watching round p_round's fight. Both ready (auto seats count) → the next shop.
create or replace function public.versus_combat_ready(p_match uuid, p_round int)
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
  if m.phase <> 'combat' or m.round <> p_round then return public.versus__match_json(m); end if;
  if v_seat = 'p1' then update public.versus_matches set p1_ready = true where id = p_match returning * into m;
  else update public.versus_matches set p2_ready = true where id = p_match returning * into m; end if;
  if (m.p1_ready or m.p1_auto) and (m.p2_ready or m.p2_auto) and m.paused_at is null then
    m := public.versus__open_shop(m, m.round + 1);
  end if;
  return public.versus__match_json(m);
end;
$$;

-- Concede.
create or replace function public.versus_forfeit(p_match uuid)
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
  if m.phase <> 'complete' then m := public.versus__complete(m, case when v_seat = 'p1' then 'p2' else 'p1' end, 'forfeit'); end if;
  return public.versus__match_json(m);
end;
$$;

-- Past the 30 s grace, the PRESENT player may unpause: the absent seat goes on auto (ruling 6).
create or replace function public.versus_unpause(p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.versus_matches;
  v_seat text;
  v_absent text;
begin
  select * into m from public.versus_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  v_seat := public.versus__seat_of(m, auth.uid());
  if v_seat is null then raise exception 'not_a_player'; end if;
  if m.paused_at is null then return public.versus__match_json(m); end if;
  v_absent := m.paused_seat;
  if v_absent = v_seat then raise exception 'cannot_unpause_own_absence'; end if;
  if public.versus_clock() < m.pause_grace_until then raise exception 'grace_running'; end if;
  update public.versus_matches set p1_auto = p1_auto or v_absent = 'p1', p2_auto = p2_auto or v_absent = 'p2'
    where id = p_match returning * into m;
  m := public.versus__resume(m);
  m := public.versus__maybe_resolve(m);
  if m.phase = 'combat' and (m.p1_ready or m.p1_auto) and (m.p2_ready or m.p2_auto) then m := public.versus__open_shop(m, m.round + 1); end if;
  return public.versus__match_json(m);
end;
$$;

-- Apply whatever is due: pause detection, hero timeout, shop deadline promotion, the combat cap, abandonment.
-- Any member may call it; it is idempotent.
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

-- THE ROUND COMMIT. Service role only (the `versus-resolve` Edge Function, after its one `simulate()`).
-- Idempotent: a second commit for the same round returns the stored row and changes nothing.
create or replace function public.versus_commit_round(
  p_match uuid, p_round int, p_chair text, p_outcome text, p_heart_lost_by text, p_p1 jsonb, p_p2 jsonb, p_digest text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  m public.versus_matches;
  v_h1 int;
  v_h2 int;
begin
  select * into m from public.versus_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  if exists (select 1 from public.versus_rounds where match_id = p_match and round = p_round) then
    return jsonb_build_object('alreadyCommitted', true, 'match', public.versus__match_json(m));
  end if;
  if m.phase <> 'resolving' or m.round <> p_round then raise exception 'not_resolving'; end if;
  if p_outcome not in ('p1', 'p2', 'draw') then raise exception 'bad_outcome'; end if;
  if (p_outcome = 'draw') <> (p_heart_lost_by is null) then raise exception 'bad_outcome'; end if;
  v_h1 := m.p1_hearts - case when p_heart_lost_by = 'p1' then 1 else 0 end;
  v_h2 := m.p2_hearts - case when p_heart_lost_by = 'p2' then 1 else 0 end;
  insert into public.versus_rounds (match_id, round, chair, outcome, heart_lost_by, p1_result, p2_result, digest, p1_hearts, p2_hearts)
    values (p_match, p_round, p_chair, p_outcome, p_heart_lost_by, p_p1, p_p2, p_digest, v_h1, v_h2);
  update public.versus_matches set p1_hearts = v_h1, p2_hearts = v_h2,
    p1_missed = case when p1_auto then p1_missed + 1 else 0 end,
    p2_missed = case when p2_auto then p2_missed + 1 else 0 end,
    phase = 'combat', combat_deadline = v_now + interval '90 seconds', p1_ready = false, p2_ready = false,
    revision = revision + 1, updated_at = v_now
    where id = p_match returning * into m;
  if v_h1 <= 0 or v_h2 <= 0 then
    m := public.versus__complete(m, case when v_h1 <= 0 then 'p2' else 'p1' end, 'hearts');
  elsif m.p1_missed >= 3 then
    m := public.versus__complete(m, 'p2', 'missed');
  elsif m.p2_missed >= 3 then
    m := public.versus__complete(m, 'p1', 'missed');
  end if;
  return jsonb_build_object('alreadyCommitted', false, 'match', public.versus__match_json(m));
end;
$$;

-- A player's latest spectator keyframe (its own seat only; newer sequences only).
create or replace function public.versus_publish_frame(p_match uuid, p_seq bigint, p_round int, p_frame jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.versus_matches;
  v_seat text;
begin
  select * into m from public.versus_matches where id = p_match;
  if not found then raise exception 'no_match'; end if;
  v_seat := public.versus__seat_of(m, auth.uid());
  if v_seat is null then raise exception 'not_a_player'; end if;
  if p_frame is null or octet_length(p_frame::text) > 196608 then raise exception 'frame_too_large'; end if;
  insert into public.versus_spectator_frames (match_id, seat, seq, round, frame) values (p_match, v_seat, p_seq, p_round, p_frame)
    on conflict (match_id, seat) do update set seq = excluded.seq, round = excluded.round, frame = excluded.frame, updated_at = now()
    where public.versus_spectator_frames.seq < excluded.seq;
end;
$$;

-- ── 6. Grants: clients call the public RPCs; helpers and the commit are not theirs ────────────────────────
revoke all on function public.versus__match_json(public.versus_matches) from public, anon, authenticated;
revoke all on function public.versus__room_json(uuid) from public, anon, authenticated;
revoke all on function public.versus__seat_of(public.versus_matches, uuid) from public, anon, authenticated;
revoke all on function public.versus__pick(bigint, text, int) from public, anon, authenticated;
revoke all on function public.versus__open_shop(public.versus_matches, int) from public, anon, authenticated;
revoke all on function public.versus__finalize_seat(uuid, int, text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.versus__maybe_resolve(public.versus_matches) from public, anon, authenticated;
revoke all on function public.versus__resume(public.versus_matches) from public, anon, authenticated;
revoke all on function public.versus__complete(public.versus_matches, text, text) from public, anon, authenticated;
revoke all on function public.versus__maybe_start(public.versus_matches) from public, anon, authenticated;
revoke all on function public.versus_commit_round(uuid, int, text, text, text, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.versus_commit_round(uuid, int, text, text, text, jsonb, jsonb, text) to service_role;

revoke all on function public.versus_create_room(text, text, jsonb, text, text, int) from public, anon;
revoke all on function public.versus_join_room(uuid, text, text, jsonb, text, int) from public, anon;
revoke all on function public.versus_take_seat(uuid, text) from public, anon;
revoke all on function public.versus_leave_room(uuid) from public, anon;
revoke all on function public.versus_start_game(uuid) from public, anon;
revoke all on function public.versus_reconcile_room(uuid) from public, anon;
revoke all on function public.versus_press_gate(uuid) from public, anon;
revoke all on function public.versus_heartbeat(uuid) from public, anon;
revoke all on function public.versus_list_rooms() from public, anon;
revoke all on function public.versus_register_offer(uuid, text[]) from public, anon;
revoke all on function public.versus_pick_hero(uuid, int) from public, anon;
revoke all on function public.versus_submit(uuid, int, int, jsonb, boolean, jsonb) from public, anon;
revoke all on function public.versus_combat_ready(uuid, int) from public, anon;
revoke all on function public.versus_forfeit(uuid) from public, anon;
revoke all on function public.versus_unpause(uuid) from public, anon;
revoke all on function public.versus_reconcile(uuid) from public, anon;
revoke all on function public.versus_publish_frame(uuid, bigint, int, jsonb) from public, anon;

grant execute on function public.versus_create_room(text, text, jsonb, text, text, int) to authenticated;
grant execute on function public.versus_join_room(uuid, text, text, jsonb, text, int) to authenticated;
grant execute on function public.versus_take_seat(uuid, text) to authenticated;
grant execute on function public.versus_leave_room(uuid) to authenticated;
grant execute on function public.versus_start_game(uuid) to authenticated;
grant execute on function public.versus_reconcile_room(uuid) to authenticated;
grant execute on function public.versus_press_gate(uuid) to authenticated;
grant execute on function public.versus_heartbeat(uuid) to authenticated;
grant execute on function public.versus_list_rooms() to authenticated;
grant execute on function public.versus_register_offer(uuid, text[]) to authenticated;
grant execute on function public.versus_pick_hero(uuid, int) to authenticated;
grant execute on function public.versus_submit(uuid, int, int, jsonb, boolean, jsonb) to authenticated;
grant execute on function public.versus_combat_ready(uuid, int) to authenticated;
grant execute on function public.versus_forfeit(uuid) to authenticated;
grant execute on function public.versus_unpause(uuid) to authenticated;
grant execute on function public.versus_reconcile(uuid) to authenticated;
grant execute on function public.versus_publish_frame(uuid, bigint, int, jsonb) to authenticated;

-- ── 7. Realtime: rooms, members, matches and rounds wake clients (rows stay the truth) ────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'versus_rooms') then
      alter publication supabase_realtime add table public.versus_rooms;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'versus_members') then
      alter publication supabase_realtime add table public.versus_members;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'versus_matches') then
      alter publication supabase_realtime add table public.versus_matches;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'versus_rounds') then
      alter publication supabase_realtime add table public.versus_rounds;
    end if;
  end if;
end;
$$;
