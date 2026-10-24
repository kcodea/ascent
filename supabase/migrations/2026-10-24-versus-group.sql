-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- VERSUS GROUP + ROOM OPTIONS: 3-4 player round-robin Versus, and host options on the room  (2026-10-24)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER every earlier Versus file (2026-10-13-versus.sql through
-- 2026-10-17-versus-open-rooms.sql; it replaces functions those files define and uses `versus__shop_grace` from
-- 2026-10-16-versus-clock-grace.sql). Idempotent (safe to re-run). THEN `npm run versus:bundle` and deploy the
-- `versus-resolve` Edge Function: its new `finalize_group` action calls `versus_group_commit_round` below. Until the
-- function is redeployed a group match stalls in `resolving` (1v1 is unaffected either way).
--
-- OWNER (2026-10-24):
--   "for versus, how hard would it be to make a 4 player round robin lobby version?" Hearts 7, last one standing,
--   3 or 4 players (today's 1v1 stays exactly as it is), unrated; "if it's a 3 player game, maybe a player faces a
--   copy of another player's board instead of a ghost".
--   "i think it would be fun to add custom options/modes to versus lobbies as well. this can be where the 1v1 or 4
--   player options live for now ... fun modifiers such as our old rift concepts".
--   "all these options should be customizable within a lobby, so a player can host a room and change them game to
--   game without needing to rehost a lobby". "remove time/lives from options for now".
--
-- THE DATA MODEL (lowest-risk path): the 1v1 tables, their columns and their match RPCs are KEPT. A 1v1 match is
-- still a `versus_matches` row with p1_/p2_ columns, resolved by the unchanged `finalize` action. What changes:
--
--  1. ROOM OPTIONS live on the ROOM (`versus_rooms.options`, one versioned jsonb: { v: 1, mode: 'duel' | 'group',
--     modifiers: [] | ['freedom'] | ['summit'] }), set by the host through `versus_set_options` while the room is Open,
--     validated here (`versus__options_error`, a mirror of packages/sim/src/versus/options.ts) and bumped in
--     `options_rev` so every member can say "options changed". Defaults = today's 1v1. Every new match SNAPSHOTS the
--     room's options (`versus_matches.options` / `versus_group_matches.options`), so a game in progress never changes.
--  2. ROOM SEATS: roles `p3` / `p4` exist for group rooms. A room's player seats follow its mode (1v1: p1, p2; group:
--     p1..p4). Switching a room to 1v1 with more than two seated moves the extras to the stands (the lowest seats keep
--     theirs; p3/p4 first fill an empty p1/p2). The room RPCs below (join, take seat, leave, start, gate, heartbeat,
--     list, open count) are the 2026-10-13 / 10-14 / 10-17 functions with ONLY those branches added; on a 1v1 room
--     every one of them does exactly what it did.
--  3. GROUP MATCHES get their own tables (`versus_group_*`): the match, one row per seat (hearts, hero, lock, ready,
--     intro, auto, missed rounds, elimination round, placement), the seat's private seeds/offer, submissions, one row
--     per committed round and one per FIGHT, and spectator keyframes. Their RPCs are `versus_group_*`, the 1v1 RPCs
--     generalised to N seats; pairing is NOT stored ahead of a round: every client and the resolver derive it from
--     the seats' elimination rounds (`versusGroupPairings`, packages/sim/src/versus/group.ts).
--
-- GROUP RULES (R-VERSUS-GROUP-01):
--  - Start needs 3 or 4 seated players (all press their gate gem). Hero Select 20 s, the intro barrier, server shop
--    deadlines with the 250 ms grace, the 90 s combat cap: all as 1v1, over every LIVING seat.
--  - All living seats lock (or are on auto / time out) → `resolving` → ONE finalize resolves every fight of the round
--    → `versus_group_commit_round`: a fight's loser loses a heart (a draw nobody; a COPY or a ghost never), seats at 0
--    hearts are eliminated together and SHARE a placement (the lobby's rule for simultaneous knockouts), then the
--    missed-round forfeits; one seat left = it wins (placement 1), the room goes back to Open.
--  - Leaving the room or conceding mid-match eliminates that seat at once (placement = seats still in + 1); the match
--    goes on while two or more remain. A seat that goes out during a round's shop still fights that round as a ghost
--    of its last locked board, so the round's pairing never changes under the players.
--  - End Combat: when every living seat but one is back, the last one has 5 s (the 90 s cap stays the outer bound).
--  - Disconnects: as 1v1 (pause, 30 s grace, any present living player may unpause → the absent seat on auto, 3 auto
--    rounds in a row = out), over living seats only. An eliminated player's absence never pauses anything.
--  - Unrated: nothing here touches rank, rating, MMR or medals. (Group XP/achievements are not wired: settle_progression
--    reads `versus_matches` only, so a group match is not a progression source yet.)

-- ── 1. Options: the whitelist (mirror of packages/sim/src/versus/options.ts; versusOptions.test.ts pins it) ───────
create or replace function public.versus__options_error(p jsonb)
returns text
language sql
immutable
as $$
  select case
    when p is null or jsonb_typeof(p) <> 'object' then 'options_not_object'
    when exists (select 1 from jsonb_object_keys(p) k where k not in ('v', 'mode', 'modifiers')) then 'unknown_option'
    when p ? 'v' and p->'v' <> '1'::jsonb then 'bad_version'
    when p ? 'mode' and (jsonb_typeof(p->'mode') <> 'string' or p->>'mode' not in ('duel', 'group')) then 'bad_mode'
    when p ? 'modifiers' and (
      jsonb_typeof(p->'modifiers') <> 'array'
      or jsonb_array_length(p->'modifiers') > 1
      or exists (select 1 from jsonb_array_elements(p->'modifiers') e where jsonb_typeof(e) <> 'string' or e #>> '{}' not in ('freedom', 'summit'))
      or (select count(distinct e) from jsonb_array_elements(p->'modifiers') e) <> jsonb_array_length(p->'modifiers')
    ) then 'bad_modifiers'
    else null
  end;
$$;

-- A valid options object with every missing field filled from the defaults.
create or replace function public.versus__normalize_options(p jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'v', 1,
    'mode', coalesce(p->>'mode', 'duel'),
    'modifiers', coalesce(p->'modifiers', '[]'::jsonb));
$$;

-- The player roles a mode seats, in seat order.
create or replace function public.versus__mode_roles(p_mode text)
returns text[]
language sql
immutable
as $$
  select case when p_mode = 'group' then array['p1', 'p2', 'p3', 'p4'] else array['p1', 'p2'] end;
$$;

-- Fewest seated players to Start.
create or replace function public.versus__mode_min_players(p_mode text)
returns int
language sql
immutable
as $$
  select case when p_mode = 'group' then 3 else 2 end;
$$;

-- ── 2. Room columns, seat roles, the 1v1 match's options snapshot ─────────────────────────────────────────────
alter table public.versus_rooms add column if not exists options jsonb not null default '{"v": 1, "mode": "duel", "modifiers": []}'::jsonb;
alter table public.versus_rooms add column if not exists options_rev int not null default 0;
alter table public.versus_rooms add column if not exists options_changed_at timestamptz;
alter table public.versus_rooms add column if not exists p3_gate boolean not null default false;
alter table public.versus_rooms add column if not exists p4_gate boolean not null default false;

-- `versus_members.role` accepts p3 / p4 (the inline check was created unnamed; drop whatever CHECK constrains `role`).
do $$
declare c record;
begin
  for c in select conname from pg_constraint
    where conrelid = 'public.versus_members'::regclass and contype = 'c' and pg_get_constraintdef(oid) ~ '\mrole\M'
  loop
    execute format('alter table public.versus_members drop constraint %I', c.conname);
  end loop;
end;
$$;
alter table public.versus_members add constraint versus_members_role_check check (role in ('p1', 'p2', 'p3', 'p4', 'spectator'));
-- One holder per player seat, any seat (the old index only covered p1/p2; it stays, as a subset).
create unique index if not exists versus_members_one_player_seat on public.versus_members (room_id, role) where role <> 'spectator';

-- 1v1 matches snapshot the room's options too (null on every match before this file = the defaults).
alter table public.versus_matches add column if not exists options jsonb;

-- ── 3. Group tables ───────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.versus_group_matches (
  id                 uuid primary key default gen_random_uuid(),
  room_id            uuid references public.versus_rooms(id) on delete set null,
  seed               bigint not null,
  set_id             text not null,
  content_revision   text not null,
  protocol           int  not null,
  options            jsonb not null,
  phase              text not null check (phase in ('hero_select', 'shop', 'resolving', 'combat', 'complete')),
  revision           bigint not null default 1,
  round              int  not null default 0,
  seat_count         int  not null check (seat_count between 3 and 4),
  heroes_revealed    boolean not null default false,
  hero_deadline      timestamptz,
  shop_starts_at     timestamptz,
  shop_deadline      timestamptz,
  intro_deadline     timestamptz,
  combat_deadline    timestamptz,
  paused_seat        text check (paused_seat in ('p1', 'p2', 'p3', 'p4')),
  paused_at          timestamptz,
  pause_grace_until  timestamptz,
  resume_at          timestamptz,
  winner_seat        text check (winner_seat in ('p1', 'p2', 'p3', 'p4')),
  end_reason         text check (end_reason in ('hearts', 'forfeit', 'missed', 'abandoned')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  completed_at       timestamptz
);
create index if not exists versus_group_matches_room on public.versus_group_matches (room_id, created_at desc);

create table if not exists public.versus_group_seats (
  match_id          uuid not null references public.versus_group_matches(id) on delete cascade,
  seat              text not null check (seat in ('p1', 'p2', 'p3', 'p4')),
  user_id           uuid not null,
  name              text not null,
  hearts            int  not null default 7,
  hero              text,
  locked            boolean not null default false,
  ready             boolean not null default false,
  intro             boolean not null default false,
  auto              boolean not null default false,
  missed            int  not null default 0,
  eliminated_round  int,
  out_reason        text check (out_reason in ('hearts', 'forfeit', 'left', 'missed')),
  placement         int  check (placement between 1 and 4),
  primary key (match_id, seat)
);
create unique index if not exists versus_group_seats_user on public.versus_group_seats (match_id, user_id);
create index if not exists versus_group_seats_by_user on public.versus_group_seats (user_id);

create table if not exists public.versus_group_seat_private (
  match_id    uuid not null references public.versus_group_matches(id) on delete cascade,
  seat        text not null check (seat in ('p1', 'p2', 'p3', 'p4')),
  user_id     uuid not null,
  hero_seed   bigint not null,
  run_seed    bigint not null,
  hero_offer  text[] check (hero_offer is null or cardinality(hero_offer) = 3),
  hero_index  smallint check (hero_index between 0 and 2),
  hero_auto   boolean not null default false,
  hero_reroll jsonb,
  primary key (match_id, seat)
);

create table if not exists public.versus_group_submissions (
  match_id       uuid not null references public.versus_group_matches(id) on delete cascade,
  round          int  not null,
  seat           text not null check (seat in ('p1', 'p2', 'p3', 'p4')),
  user_id        uuid not null,
  candidate_seq  int  not null,
  prepared_side  jsonb check (prepared_side is null or octet_length(prepared_side::text) <= 262144),
  final          boolean not null default false,
  source         text not null default 'candidate' check (source in ('candidate', 'lock', 'deadline', 'auto', 'empty')),
  checkpoint     jsonb check (checkpoint is null or octet_length(checkpoint::text) <= 1048576),
  scout          jsonb check (scout is null or octet_length(scout::text) <= 8192),
  updated_at     timestamptz not null default now(),
  primary key (match_id, round, seat)
);

-- One row per committed round (the realtime wake-up + every seat's hearts after it); the fights are below.
create table if not exists public.versus_group_rounds (
  match_id      uuid not null references public.versus_group_matches(id) on delete cascade,
  round         int  not null,
  digest        text not null,
  hearts        jsonb not null,
  eliminated    jsonb not null default '[]'::jsonb,
  committed_at  timestamptz not null default now(),
  primary key (match_id, round)
);

-- One authoritative fight: side a is simulate's `player`, side b the mirror. `b_copy`: b is a COPY of seat b's board.
create table if not exists public.versus_group_fights (
  match_id       uuid not null references public.versus_group_matches(id) on delete cascade,
  round          int  not null,
  fight          smallint not null,
  a_seat         text not null check (a_seat in ('p1', 'p2', 'p3', 'p4')),
  b_seat         text not null check (b_seat in ('p1', 'p2', 'p3', 'p4')),
  b_copy         boolean not null default false,
  chair          text not null check (chair in ('a', 'b')),
  outcome        text not null check (outcome in ('a', 'b', 'draw')),
  heart_lost_by  text check (heart_lost_by in ('p1', 'p2', 'p3', 'p4')),
  a_result       jsonb not null,
  b_result       jsonb not null,
  a_scout        jsonb,
  b_scout        jsonb,
  primary key (match_id, round, fight)
);

create table if not exists public.versus_group_spectator_frames (
  match_id    uuid not null references public.versus_group_matches(id) on delete cascade,
  seat        text not null check (seat in ('p1', 'p2', 'p3', 'p4')),
  seq         bigint not null,
  round       int not null,
  frame       jsonb not null check (octet_length(frame::text) <= 196608),
  updated_at  timestamptz not null default now(),
  primary key (match_id, seat)
);

alter table public.versus_group_matches enable row level security;
alter table public.versus_group_seats enable row level security;
alter table public.versus_group_seat_private enable row level security;
alter table public.versus_group_submissions enable row level security;
alter table public.versus_group_rounds enable row level security;
alter table public.versus_group_fights enable row level security;
alter table public.versus_group_spectator_frames enable row level security;

drop policy if exists "versus group read matches" on public.versus_group_matches;
create policy "versus group read matches" on public.versus_group_matches for select to authenticated using (true);
drop policy if exists "versus group read seats" on public.versus_group_seats;
create policy "versus group read seats" on public.versus_group_seats for select to authenticated using (true);
drop policy if exists "versus group read own private" on public.versus_group_seat_private;
create policy "versus group read own private" on public.versus_group_seat_private for select to authenticated using (auth.uid() = user_id);
drop policy if exists "versus group read own submissions" on public.versus_group_submissions;
create policy "versus group read own submissions" on public.versus_group_submissions for select to authenticated using (auth.uid() = user_id);
drop policy if exists "versus group read rounds" on public.versus_group_rounds;
create policy "versus group read rounds" on public.versus_group_rounds for select to authenticated using (true);
drop policy if exists "versus group read fights" on public.versus_group_fights;
create policy "versus group read fights" on public.versus_group_fights for select to authenticated using (true);
drop policy if exists "versus group read frames" on public.versus_group_spectator_frames;
create policy "versus group read frames" on public.versus_group_spectator_frames for select to authenticated using (true);

grant select on public.versus_group_matches, public.versus_group_seats, public.versus_group_seat_private,
  public.versus_group_submissions, public.versus_group_rounds, public.versus_group_fights,
  public.versus_group_spectator_frames to authenticated;

-- ── 4. Rooms: the 1v1 functions with the mode-aware seat branches ─────────────────────────────────────────────
-- Create with options (the 6-argument version is untouched: a room it creates gets the default options).
create or replace function public.versus_create_room(p_name text, p_display text, p_profile jsonb, p_set_id text, p_content text, p_protocol int, p_options jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room jsonb;
  v_err text := case when p_options is null then null else public.versus__options_error(p_options) end;
begin
  if v_err is not null then raise exception '%', v_err; end if;
  v_room := public.versus_create_room(p_name, p_display, p_profile, p_set_id, p_content, p_protocol);
  if p_options is not null then
    update public.versus_rooms set options = public.versus__normalize_options(p_options) where id = (v_room->>'id')::uuid;
    v_room := public.versus__room_json((v_room->>'id')::uuid);
  end if;
  return v_room;
end;
$$;

-- The host sets the room's options while it is Open (R-VERSUS-OPTIONS-01). Switching to 1v1 with more than two seated
-- moves the extras to the stands: the lowest seats keep theirs, and a p3/p4 first fills an empty p1/p2.
create or replace function public.versus_set_options(p_room uuid, p_options jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.versus_rooms;
  v_err text := public.versus__options_error(p_options);
  v_new jsonb;
  v_roles text[];
  mm record;
  v_free text;
begin
  select * into r from public.versus_rooms where id = p_room for update;
  if not found then raise exception 'no_room'; end if;
  if r.host_user_id <> auth.uid() then raise exception 'not_host'; end if;
  if r.status <> 'open' then raise exception 'room_not_open'; end if;
  if v_err is not null then raise exception '%', v_err; end if;
  v_new := public.versus__normalize_options(p_options);
  if v_new = public.versus__normalize_options(r.options) then return public.versus__room_json(p_room); end if;
  v_roles := public.versus__mode_roles(v_new->>'mode');
  for mm in select user_id, role from public.versus_members
      where room_id = p_room and role <> 'spectator' and not (role = any (v_roles)) order by role loop
    select s into v_free from unnest(v_roles) with ordinality as t(s, n)
      where not exists (select 1 from public.versus_members where room_id = p_room and role = s) order by n limit 1;
    update public.versus_members set role = coalesce(v_free, 'spectator') where room_id = p_room and user_id = mm.user_id;
  end loop;
  update public.versus_rooms set options = v_new, options_rev = options_rev + 1, options_changed_at = public.versus_clock(),
    revision = revision + 1, updated_at = public.versus_clock()
    where id = p_room;
  return public.versus__room_json(p_room);
end;
$$;

-- Join as a player (atomically claims the room's first empty seat of an OPEN room) or as a spectator (cap 20).
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
    select s into v_role from unnest(public.versus__mode_roles(r.options->>'mode')) with ordinality as t(s, n)
      where not exists (select 1 from public.versus_members where room_id = p_room and role = s) order by n limit 1;
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

-- Swap between an empty player seat (of the room's mode) and the stands. Only while the room is open.
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
  if p_role is null or (p_role <> 'spectator' and not (p_role = any (public.versus__mode_roles(r.options->>'mode')))) then raise exception 'bad_role'; end if;
  if v_cur = p_role then return public.versus__room_json(p_room); end if;
  if p_role <> 'spectator' and exists (select 1 from public.versus_members where room_id = p_room and role = p_role) then raise exception 'seat_taken'; end if;
  if p_role = 'spectator' and (select count(*) from public.versus_members where room_id = p_room and role = 'spectator') >= 20 then raise exception 'spectators_full'; end if;
  update public.versus_members set role = p_role where room_id = p_room and user_id = v_user;
  update public.versus_rooms set revision = revision + 1, updated_at = public.versus_clock() where id = p_room;
  return public.versus__room_json(p_room);
end;
$$;

-- Host: close the player gates. 1v1: both seats filled; group: three or four seated.
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
    raise exception '%', case when v_mode = 'group' then 'need_three_players' else 'need_two_players' end;
  end if;
  update public.versus_rooms set status = 'sealed', p1_gate = false, p2_gate = false, p3_gate = false, p4_gate = false,
    gate_deadline = public.versus_clock() + interval '30 seconds', revision = revision + 1, updated_at = public.versus_clock()
    where id = p_room;
  return public.versus__room_json(p_room);
end;
$$;

-- Room-level deadline: a sealed room whose gems were not all pressed in 30 s returns to Open (ruling 5).
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
    update public.versus_rooms set status = 'open', p1_gate = false, p2_gate = false, p3_gate = false, p4_gate = false, gate_deadline = null,
      revision = revision + 1, updated_at = public.versus_clock() where id = p_room;
  end if;
  return public.versus__room_json(p_room);
end;
$$;

-- A player presses their gate gem. Every seated player in time → the match begins with Hero Select (20 s): a 1v1
-- `versus_matches` row, or a group `versus_group_matches` row, by the room's mode. Either snapshots the room's options.
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
  if v_mode = 'group' then
    select bool_and(case mm2.role when 'p1' then r.p1_gate when 'p2' then r.p2_gate when 'p3' then r.p3_gate else r.p4_gate end)
      into v_all from public.versus_members mm2 where mm2.room_id = p_room and mm2.role <> 'spectator';
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

-- The lobby browser: every room with its occupancy, mode and options. Prunes members of OPEN rooms not seen for 2 min.
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
      'players', (select count(*) from public.versus_members where room_id = r.id and role <> 'spectator'),
      'maxPlayers', cardinality(public.versus__mode_roles(r.options->>'mode')),
      'options', public.versus__normalize_options(r.options),
      'spectators', (select count(*) from public.versus_members where room_id = r.id and role = 'spectator')
    ) as j from public.versus_rooms r) q), '[]'::jsonb);
end;
$$;

-- The menus' open-room count (2026-10-17-versus-open-rooms.sql): a seat is open while fewer than the mode's seats are taken.
create or replace function public.versus_open_rooms(p_protocol int, p_content text)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with fresh as (
    -- (security invoker: the seat count is inlined, the private `versus__mode_roles` helper is not callable here)
    select r.id, case when r.options->>'mode' = 'group' then 4 else 2 end as cap,
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

-- ── 5. Group match helpers (not callable by clients) ──────────────────────────────────────────────────────────
create or replace function public.versus_group__match_json(m public.versus_group_matches)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(m) || jsonb_build_object(
    'seats', coalesce((select jsonb_agg(jsonb_build_object(
        'seat', s.seat, 'userId', s.user_id, 'name', s.name, 'hearts', s.hearts, 'hero', s.hero, 'locked', s.locked,
        'ready', s.ready, 'intro', s.intro, 'auto', s.auto, 'missed', s.missed, 'eliminatedRound', s.eliminated_round,
        'outReason', s.out_reason, 'placement', s.placement) order by s.seat)
      from public.versus_group_seats s where s.match_id = m.id), '[]'::jsonb),
    'serverNow', public.versus_clock());
$$;

create or replace function public.versus_group__seat_of(p_match uuid, p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select seat from public.versus_group_seats where match_id = p_match and user_id = p_user;
$$;

create or replace function public.versus_group__living(p_match uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.versus_group_seats where match_id = p_match and eliminated_round is null;
$$;

-- Bump the match row (every seat change wakes Realtime through the match).
create or replace function public.versus_group__touch(p_match uuid)
returns public.versus_group_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_out public.versus_group_matches;
begin
  update public.versus_group_matches set revision = revision + 1, updated_at = public.versus_clock() where id = p_match returning * into v_out;
  return v_out;
end;
$$;

-- Open round p_round's shop: round 1 waits for the intros (no clock), later rounds start their clock now.
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
    revision = revision + 1, updated_at = v_now
  where id = m.id returning * into v_out;
  return v_out;
end;
$$;

create or replace function public.versus_group__start_clock(m public.versus_group_matches)
returns public.versus_group_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  v_out public.versus_group_matches;
begin
  if m.phase <> 'shop' or m.shop_deadline is not null then return m; end if;
  update public.versus_group_matches set
    shop_starts_at = v_now, shop_deadline = v_now + make_interval(secs => public.versus_turn_seconds(m.round)),
    intro_deadline = null, revision = revision + 1, updated_at = v_now
  where id = m.id returning * into v_out;
  return v_out;
end;
$$;

-- Fill an unlocked seat's final side for the round and mark it locked: `versus__finalize_seat` over N seats. Auto (an
-- absent seat, or a seat gone out during the shop: a ghost): its LAST LOCKED board (ruling 6). Deadline: the newest
-- candidate, else the last locked board, else an empty board, so AFK players never deadlock a round.
create or replace function public.versus_group__finalize_seat(p_match uuid, p_round int, p_seat text, p_user uuid, p_auto boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last jsonb;
begin
  select prepared_side into v_last from public.versus_group_submissions
    where match_id = p_match and seat = p_seat and final and round < p_round and prepared_side is not null
    order by round desc limit 1;
  if p_auto then
    insert into public.versus_group_submissions (match_id, round, seat, user_id, candidate_seq, prepared_side, final, source)
      values (p_match, p_round, p_seat, p_user, 0, v_last, true, case when v_last is null then 'empty' else 'auto' end)
      on conflict (match_id, round, seat) do update set prepared_side = coalesce(excluded.prepared_side, public.versus_group_submissions.prepared_side),
        final = true, source = case when public.versus_group_submissions.prepared_side is not null then 'deadline' else excluded.source end,
        updated_at = now();
  elsif exists (select 1 from public.versus_group_submissions where match_id = p_match and round = p_round and seat = p_seat and prepared_side is not null) then
    update public.versus_group_submissions set final = true, source = 'deadline', updated_at = now()
      where match_id = p_match and round = p_round and seat = p_seat;
  else
    insert into public.versus_group_submissions (match_id, round, seat, user_id, candidate_seq, prepared_side, final, source)
      values (p_match, p_round, p_seat, p_user, 0, v_last, true, case when v_last is null then 'empty' else 'auto' end)
      on conflict (match_id, round, seat) do update set prepared_side = excluded.prepared_side, final = true,
        source = excluded.source, updated_at = now();
  end if;
  update public.versus_group_seats set locked = true where match_id = p_match and seat = p_seat;
end;
$$;

-- Every living seat locked (or on auto) → `resolving`. Seats that fight this round but are not locked (auto, or gone
-- out during the shop: a ghost) get their last locked board.
create or replace function public.versus_group__maybe_resolve(m public.versus_group_matches)
returns public.versus_group_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  v_out public.versus_group_matches;
begin
  if m.phase <> 'shop' then return m; end if;
  if exists (select 1 from public.versus_group_seats where match_id = m.id and eliminated_round is null and not (locked or auto)) then return m; end if;
  for s in select * from public.versus_group_seats where match_id = m.id and not locked
      and (eliminated_round is null or eliminated_round >= m.round) loop
    perform public.versus_group__finalize_seat(m.id, m.round, s.seat, s.user_id, true);
  end loop;
  update public.versus_group_matches set phase = 'resolving', revision = revision + 1, updated_at = public.versus_clock()
    where id = m.id returning * into v_out;
  return v_out;
end;
$$;

-- Every living seat back from the fight (or on auto) → the next shop.
create or replace function public.versus_group__maybe_next(m public.versus_group_matches)
returns public.versus_group_matches
language plpgsql
security definer
set search_path = public
as $$
begin
  if m.phase <> 'combat' or m.paused_at is not null then return m; end if;
  if exists (select 1 from public.versus_group_seats where match_id = m.id and eliminated_round is null and not (ready or auto)) then return m; end if;
  return public.versus_group__open_shop(m, m.round + 1);
end;
$$;

-- Round 1's clock: every living seat's intro done (or on auto).
create or replace function public.versus_group__maybe_clock(m public.versus_group_matches)
returns public.versus_group_matches
language plpgsql
security definer
set search_path = public
as $$
begin
  if m.phase <> 'shop' or m.shop_deadline is not null or m.paused_at is not null then return m; end if;
  if exists (select 1 from public.versus_group_seats where match_id = m.id and eliminated_round is null and not (intro or auto)) then return m; end if;
  return public.versus_group__start_clock(m);
end;
$$;

create or replace function public.versus_group__resume(m public.versus_group_matches)
returns public.versus_group_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  v_delta interval;
  v_out public.versus_group_matches;
begin
  if m.paused_at is null then return m; end if;
  v_delta := v_now - m.paused_at;
  update public.versus_group_matches set
    hero_deadline = hero_deadline + v_delta, shop_starts_at = shop_starts_at + v_delta,
    shop_deadline = shop_deadline + v_delta, combat_deadline = combat_deadline + v_delta,
    intro_deadline = intro_deadline + v_delta,
    paused_seat = null, paused_at = null, pause_grace_until = null, resume_at = null,
    revision = revision + 1, updated_at = v_now
  where id = m.id returning * into v_out;
  return public.versus_group__maybe_clock(v_out);
end;
$$;

-- End the match; the room goes back to `open` with everyone still in it (ruling 10).
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
    update public.versus_group_seats set placement = 1 where match_id = m.id and seat = p_winner;
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

-- A seat goes out now (left the room, conceded, or missed three rounds): placement = seats still in + 1. One seat left
-- wins. Otherwise the match goes on; any barrier the seat was holding up is re-checked.
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

-- Hero picks are in for every living seat (or timed out): reveal and open round 1.
create or replace function public.versus_group__maybe_start(m public.versus_group_matches)
returns public.versus_group_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
begin
  if m.phase <> 'hero_select' then return m; end if;
  if v_now < m.hero_deadline and exists (
      select 1 from public.versus_group_seat_private p join public.versus_group_seats s on s.match_id = p.match_id and s.seat = p.seat
      where p.match_id = m.id and p.hero_index is null and s.eliminated_round is null) then
    return m;
  end if;
  update public.versus_group_seat_private set hero_index = public.versus__pick(m.seed, 'hero:' || seat, 3), hero_auto = true
    where match_id = m.id and hero_index is null;
  update public.versus_group_seats s set hero = case when p.hero_offer is null then null else p.hero_offer[p.hero_index + 1] end
    from public.versus_group_seat_private p where p.match_id = m.id and s.match_id = m.id and s.seat = p.seat;
  update public.versus_group_matches set heroes_revealed = true where id = m.id returning * into m;
  return public.versus_group__open_shop(m, 1);
end;
$$;

-- ── 6. Group match RPCs (the 1v1 ones over N seats) ───────────────────────────────────────────────────────────
create or replace function public.versus_group_register_offer(p_match uuid, p_offer text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.versus_group_matches;
  v_seat text;
begin
  select * into m from public.versus_group_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  v_seat := public.versus_group__seat_of(p_match, auth.uid());
  if v_seat is null then raise exception 'not_a_player'; end if;
  if cardinality(p_offer) <> 3 or exists (select 1 from unnest(p_offer) o where o is null or char_length(o) > 32) then raise exception 'bad_offer'; end if;
  update public.versus_group_seat_private set hero_offer = p_offer where match_id = p_match and seat = v_seat and hero_offer is null;
  return public.versus_group__match_json(m);
end;
$$;

create or replace function public.versus_group_pick_hero(p_match uuid, p_index int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.versus_group_matches;
  v_seat text;
begin
  select * into m from public.versus_group_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  v_seat := public.versus_group__seat_of(p_match, auth.uid());
  if v_seat is null then raise exception 'not_a_player'; end if;
  if m.phase <> 'hero_select' then raise exception 'wrong_phase'; end if;
  if p_index not between 0 and 2 then raise exception 'bad_index'; end if;
  if public.versus_clock() >= m.hero_deadline then
    m := public.versus_group__maybe_start(m);
    raise exception 'hero_deadline_passed';
  end if;
  update public.versus_group_seat_private set hero_index = p_index where match_id = p_match and seat = v_seat and hero_index is null;
  m := public.versus_group__maybe_start(m);
  return public.versus_group__match_json(m);
end;
$$;

-- The one hero re-roll (R-HERO-REROLL-01), drawn by the server: as `versus_reroll_hero`.
create or replace function public.versus_group_reroll_hero(p_match uuid, p_slot int, p_candidates text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.versus_group_matches;
  v_seat text;
  p public.versus_group_seat_private;
  v_n int;
  v_to text;
  v_offer text[];
  v_reroll jsonb;
begin
  select * into m from public.versus_group_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  v_seat := public.versus_group__seat_of(p_match, auth.uid());
  if v_seat is null then raise exception 'not_a_player'; end if;
  if m.phase <> 'hero_select' then raise exception 'wrong_phase'; end if;
  if p_slot is null or p_slot not between 0 and 2 then raise exception 'bad_index'; end if;
  if public.versus_clock() >= m.hero_deadline then raise exception 'hero_deadline_passed'; end if;
  select * into p from public.versus_group_seat_private where match_id = p_match and seat = v_seat for update;
  if not found or p.hero_offer is null then raise exception 'no_offer'; end if;
  if p.hero_index is not null then raise exception 'already_picked'; end if;
  if p.hero_reroll is not null then raise exception 'reroll_used'; end if;
  v_n := coalesce(cardinality(p_candidates), 0);
  if v_n < 1 or v_n > 128
     or exists (select 1 from unnest(p_candidates) c where c is null or char_length(c) = 0 or char_length(c) > 32)
     or (select count(distinct c) from unnest(p_candidates) c) <> v_n
     or exists (select 1 from unnest(p_candidates) c where c = any (p.hero_offer)) then
    raise exception 'bad_candidates';
  end if;
  v_to := p_candidates[public.versus__pick(m.seed, 'hero-reroll:' || v_seat, v_n) + 1];
  v_offer := p.hero_offer;
  v_reroll := jsonb_build_object('slot', p_slot, 'from', v_offer[p_slot + 1], 'to', v_to);
  v_offer[p_slot + 1] := v_to;
  update public.versus_group_seat_private set hero_offer = v_offer, hero_reroll = v_reroll where match_id = p_match and seat = v_seat;
  return jsonb_build_object('match', public.versus_group__match_json(m), 'offer', to_jsonb(v_offer), 'reroll', v_reroll);
end;
$$;

create or replace function public.versus_group_intro_done(p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.versus_group_matches;
  v_seat text;
begin
  select * into m from public.versus_group_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  v_seat := public.versus_group__seat_of(p_match, auth.uid());
  if v_seat is null then raise exception 'not_a_player'; end if;
  if m.phase <> 'shop' or m.shop_deadline is not null then return public.versus_group__match_json(m); end if;
  update public.versus_group_seats set intro = true where match_id = p_match and seat = v_seat;
  m := public.versus_group__touch(p_match);
  m := public.versus_group__maybe_clock(m);
  return public.versus_group__match_json(m);
end;
$$;

-- Upload a turn candidate (`p_final` = End Turn: irreversible). Living seats only; the 250 ms grace as 1v1.
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
  v_seat := public.versus_group__seat_of(p_match, v_user);
  if v_seat is null then raise exception 'not_a_player'; end if;
  if exists (select 1 from public.versus_group_seats where match_id = p_match and seat = v_seat and eliminated_round is not null) then raise exception 'eliminated'; end if;
  if m.phase <> 'shop' or m.round <> p_round then raise exception 'stale_round'; end if;
  if m.paused_at is null and m.shop_deadline is not null and public.versus_clock() >= m.shop_deadline + public.versus__shop_grace() then raise exception 'deadline_passed'; end if;
  if p_side is null or octet_length(p_side::text) > 262144 then raise exception 'side_too_large'; end if;
  if p_checkpoint is not null and octet_length(p_checkpoint::text) > 1048576 then raise exception 'checkpoint_too_large'; end if;
  if p_scout is not null and (jsonb_typeof(p_scout) <> 'object' or octet_length(p_scout::text) > 8192) then raise exception 'scout_too_large'; end if;
  select * into s from public.versus_group_submissions where match_id = p_match and round = p_round and seat = v_seat;
  if found and s.final then raise exception 'already_locked'; end if;
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

-- A living player is back from round p_round's fight. All back → the next shop; all but one back → the last has 5 s.
create or replace function public.versus_group_combat_ready(p_match uuid, p_round int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  m public.versus_group_matches;
  v_seat text;
begin
  select * into m from public.versus_group_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  v_seat := public.versus_group__seat_of(p_match, auth.uid());
  if v_seat is null then raise exception 'not_a_player'; end if;
  if m.phase <> 'combat' or m.round <> p_round then return public.versus_group__match_json(m); end if;
  update public.versus_group_seats set ready = true where match_id = p_match and seat = v_seat;
  m := public.versus_group__touch(p_match);
  m := public.versus_group__maybe_next(m);
  if m.phase = 'combat' and (select count(*) from public.versus_group_seats
      where match_id = p_match and eliminated_round is null and not (ready or auto)) = 1 then
    update public.versus_group_matches set combat_deadline = least(combat_deadline, v_now + interval '5 seconds'), updated_at = v_now
      where id = p_match returning * into m;
  end if;
  return public.versus_group__match_json(m);
end;
$$;

-- Concede: this seat is out now; the match goes on while two or more remain.
create or replace function public.versus_group_forfeit(p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.versus_group_matches;
  v_seat text;
begin
  select * into m from public.versus_group_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  v_seat := public.versus_group__seat_of(p_match, auth.uid());
  if v_seat is null then raise exception 'not_a_player'; end if;
  m := public.versus_group__eliminate(m, v_seat, 'forfeit');
  return public.versus_group__match_json(m);
end;
$$;

-- The returning player presses Unpause: the 3-2-1.
create or replace function public.versus_group_request_resume(p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  m public.versus_group_matches;
  v_seat text;
begin
  select * into m from public.versus_group_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  v_seat := public.versus_group__seat_of(p_match, auth.uid());
  if v_seat is null then raise exception 'not_a_player'; end if;
  if m.paused_at is null or m.resume_at is not null then return public.versus_group__match_json(m); end if;
  if m.paused_seat <> v_seat then raise exception 'not_your_pause'; end if;
  update public.versus_group_matches set resume_at = v_now + interval '3 seconds', revision = revision + 1, updated_at = v_now
    where id = p_match returning * into m;
  return public.versus_group__match_json(m);
end;
$$;

-- Past the 30 s grace, any OTHER living player may unpause: the absent seat goes on auto, after the 3-2-1.
create or replace function public.versus_group_unpause(p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  m public.versus_group_matches;
  v_seat text;
begin
  select * into m from public.versus_group_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  v_seat := public.versus_group__seat_of(p_match, auth.uid());
  if v_seat is null then raise exception 'not_a_player'; end if;
  if exists (select 1 from public.versus_group_seats where match_id = p_match and seat = v_seat and eliminated_round is not null) then raise exception 'eliminated'; end if;
  if m.paused_at is null or m.resume_at is not null then return public.versus_group__match_json(m); end if;
  if m.paused_seat = v_seat then raise exception 'cannot_unpause_own_absence'; end if;
  if v_now < m.pause_grace_until then raise exception 'grace_running'; end if;
  update public.versus_group_seats set auto = true where match_id = p_match and seat = m.paused_seat;
  update public.versus_group_matches set resume_at = v_now + interval '3 seconds', revision = revision + 1, updated_at = v_now
    where id = p_match returning * into m;
  return public.versus_group__match_json(m);
end;
$$;

-- Apply whatever is due: pause detection (living seats), the 3-2-1, hero timeout, the intro cap, the shop deadline
-- (+ grace), the combat cap, abandonment. Any member may call it; it is idempotent.
create or replace function public.versus_group_reconcile(p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  m public.versus_group_matches;
  v_gone text;
  v_all_gone boolean;
  s record;
begin
  select * into m from public.versus_group_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  if m.phase = 'complete' then return public.versus_group__match_json(m); end if;
  -- Living seats whose lease lapsed (no heartbeat for 12 s), in seat order.
  select s2.seat into v_gone from public.versus_group_seats s2
    left join public.versus_members mm on mm.room_id = m.room_id and mm.user_id = s2.user_id
    where s2.match_id = m.id and s2.eliminated_round is null and not s2.auto
      and (mm.last_seen_at is null or mm.last_seen_at < v_now - interval '12 seconds')
    order by s2.seat limit 1;
  select bool_and(mm.last_seen_at is null or mm.last_seen_at < v_now - interval '12 seconds') into v_all_gone
    from public.versus_group_seats s2
    left join public.versus_members mm on mm.room_id = m.room_id and mm.user_id = s2.user_id
    where s2.match_id = m.id and s2.eliminated_round is null;

  if m.paused_at is not null then
    if m.resume_at is not null and v_now >= m.resume_at then
      m := public.versus_group__resume(m);
      m := public.versus_group__maybe_resolve(m);
      m := public.versus_group__maybe_next(m);
    elsif coalesce(v_all_gone, true) and v_now >= m.paused_at + interval '10 minutes' then
      m := public.versus_group__complete(m, null, 'abandoned');
      return public.versus_group__match_json(m);
    else
      return public.versus_group__match_json(m);
    end if;
  end if;

  if v_gone is not null then
    update public.versus_group_matches set paused_seat = v_gone, paused_at = v_now, pause_grace_until = v_now + interval '30 seconds',
      revision = revision + 1, updated_at = v_now
      where id = m.id returning * into m;
    return public.versus_group__match_json(m);
  end if;

  if m.phase = 'hero_select' and v_now >= m.hero_deadline then
    m := public.versus_group__maybe_start(m);
  elsif m.phase = 'shop' and m.shop_deadline is null then
    if v_now >= m.intro_deadline then m := public.versus_group__start_clock(m); else m := public.versus_group__maybe_clock(m); end if;
  elsif m.phase = 'shop' and v_now >= m.shop_deadline + public.versus__shop_grace() then
    for s in select * from public.versus_group_seats where match_id = m.id and not locked and eliminated_round is null loop
      perform public.versus_group__finalize_seat(m.id, m.round, s.seat, s.user_id, s.auto);
    end loop;
    m := public.versus_group__maybe_resolve(m);
  elsif m.phase = 'shop' then
    m := public.versus_group__maybe_resolve(m);
  elsif m.phase = 'combat' and v_now >= m.combat_deadline then
    m := public.versus_group__open_shop(m, m.round + 1);
  end if;
  return public.versus_group__match_json(m);
end;
$$;

-- THE ROUND COMMIT. Service role only (the `versus-resolve` Edge Function's `finalize_group`, after its simulate()s).
-- Idempotent: a second commit for the same round returns the stored state and changes nothing.
-- `p_fights`: [{ fight, a, b, copy, chair, outcome, heartLostBy, aResult, bResult }, ...].
create or replace function public.versus_group_commit_round(p_match uuid, p_round int, p_fights jsonb, p_digest text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  m public.versus_group_matches;
  f jsonb;
  v_a text;
  v_b text;
  v_h text;
  v_copy boolean;
  v_hit text[] := '{}';
  v_dead text[];
  v_living int;
  v_winner text;
  v_reason text := 'hearts';
  s record;
begin
  select * into m from public.versus_group_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  if exists (select 1 from public.versus_group_rounds where match_id = p_match and round = p_round) then
    return jsonb_build_object('alreadyCommitted', true, 'match', public.versus_group__match_json(m));
  end if;
  if m.phase <> 'resolving' or m.round <> p_round then raise exception 'not_resolving'; end if;
  if p_fights is null or jsonb_typeof(p_fights) <> 'array' or jsonb_array_length(p_fights) > 2 then raise exception 'bad_fights'; end if;

  for f in select value from jsonb_array_elements(p_fights) loop
    v_a := f->>'a'; v_b := f->>'b'; v_h := f->>'heartLostBy'; v_copy := coalesce((f->>'copy')::boolean, false);
    if not exists (select 1 from public.versus_group_seats where match_id = p_match and seat = v_a)
       or not exists (select 1 from public.versus_group_seats where match_id = p_match and seat = v_b)
       or v_a = v_b or f->>'outcome' not in ('a', 'b', 'draw') or f->>'chair' not in ('a', 'b') then
      raise exception 'bad_fights';
    end if;
    if v_h is not null and (v_h not in (v_a, v_b) or (v_copy and v_h = v_b) or v_h = any (v_hit)
        or (f->>'outcome' = 'draw') or (f->>'outcome' = 'a' and v_h <> v_b) or (f->>'outcome' = 'b' and v_h <> v_a)) then
      raise exception 'bad_fights';
    end if;
    insert into public.versus_group_fights (match_id, round, fight, a_seat, b_seat, b_copy, chair, outcome, heart_lost_by, a_result, b_result, a_scout, b_scout)
      values (p_match, p_round, (f->>'fight')::smallint, v_a, v_b, v_copy, f->>'chair', f->>'outcome', v_h, f->'aResult', f->'bResult',
        (select coalesce(su.scout, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('tier', su.prepared_side -> 'state' -> 'tier'))
           from public.versus_group_submissions su where su.match_id = p_match and su.round = p_round and su.seat = v_a),
        (select coalesce(su.scout, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('tier', su.prepared_side -> 'state' -> 'tier'))
           from public.versus_group_submissions su where su.match_id = p_match and su.round = p_round and su.seat = v_b));
    if v_h is not null then
      v_hit := array_append(v_hit, v_h);
      -- A copy and a ghost never lose a heart: only a seat still in.
      update public.versus_group_seats set hearts = hearts - 1 where match_id = p_match and seat = v_h and eliminated_round is null;
    end if;
  end loop;

  -- Out of hearts: eliminated TOGETHER, sharing a placement (the lobby's rule for simultaneous knockouts).
  -- Ordered healthiest first, then seat: the lobby's wipeout tiebreak (every one of them lost exactly one heart).
  select coalesce(array_agg(seat order by hearts desc, seat), '{}') into v_dead from public.versus_group_seats
    where match_id = p_match and eliminated_round is null and hearts <= 0;
  v_living := public.versus_group__living(p_match);
  if cardinality(v_dead) > 0 and cardinality(v_dead) >= v_living then
    -- WIPEOUT GUARD (the lobby's): never a round with nobody standing. Two living players can both lose to ghosts of
    -- seats that left during the shop; the first by the tiebreak survives the round, and so wins the match.
    v_dead := v_dead[2:];
  end if;
  update public.versus_group_seats set eliminated_round = p_round, out_reason = 'hearts', auto = false, placement = v_living
    where match_id = p_match and seat = any (v_dead);

  -- Missed rounds: an auto seat's count grows, a present seat's resets; three in a row is out (never the last seat).
  update public.versus_group_seats set missed = case when auto then missed + 1 else 0 end
    where match_id = p_match and eliminated_round is null;
  for s in select seat from public.versus_group_seats where match_id = p_match and eliminated_round is null and missed >= 3 order by seat loop
    exit when public.versus_group__living(p_match) <= 1;
    update public.versus_group_seats set eliminated_round = p_round, out_reason = 'missed', auto = false,
      placement = public.versus_group__living(p_match)
      where match_id = p_match and seat = s.seat;
    v_dead := array_append(v_dead, s.seat);
    if public.versus_group__living(p_match) <= 1 and cardinality(v_hit) = 0 then v_reason := 'missed'; end if;
  end loop;

  insert into public.versus_group_rounds (match_id, round, digest, hearts, eliminated)
    values (p_match, p_round, p_digest,
      (select jsonb_object_agg(seat, hearts) from public.versus_group_seats where match_id = p_match),
      to_jsonb(v_dead));
  update public.versus_group_seats set ready = false where match_id = p_match;
  update public.versus_group_matches set phase = 'combat', combat_deadline = v_now + interval '90 seconds',
    revision = revision + 1, updated_at = v_now
    where id = p_match returning * into m;
  if public.versus_group__living(p_match) <= 1 then
    select seat into v_winner from public.versus_group_seats where match_id = p_match and eliminated_round is null;
    m := public.versus_group__complete(m, v_winner, v_reason);
  end if;
  return jsonb_build_object('alreadyCommitted', false, 'match', public.versus_group__match_json(m));
end;
$$;

create or replace function public.versus_group_publish_frame(p_match uuid, p_seq bigint, p_round int, p_frame jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seat text;
begin
  if not exists (select 1 from public.versus_group_matches where id = p_match) then raise exception 'no_match'; end if;
  v_seat := public.versus_group__seat_of(p_match, auth.uid());
  if v_seat is null then raise exception 'not_a_player'; end if;
  if p_frame is null or octet_length(p_frame::text) > 196608 then raise exception 'frame_too_large'; end if;
  insert into public.versus_group_spectator_frames (match_id, seat, seq, round, frame) values (p_match, v_seat, p_seq, p_round, p_frame)
    on conflict (match_id, seat) do update set seq = excluded.seq, round = excluded.round, frame = excluded.frame, updated_at = now()
    where public.versus_group_spectator_frames.seq < excluded.seq;
end;
$$;

-- ── 7. Room functions that end or watch a GROUP match ─────────────────────────────────────────────────────────
-- Leave. A 1v1 player leaving a running match forfeits it (unchanged); a group player leaving is out of the group match,
-- which goes on. The host role passes on (players first); an empty room is removed.
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
begin
  select * into r from public.versus_rooms where id = p_room for update;
  if not found then return jsonb_build_object('left', true); end if;
  select role into v_role from public.versus_members where room_id = p_room and user_id = v_user;
  if v_role is null then return jsonb_build_object('left', true); end if;
  if r.status = 'in_game' and v_role <> 'spectator' and r.current_match_id is not null then
    select * into m from public.versus_matches where id = r.current_match_id for update;
    if found then
      if m.phase <> 'complete' then
        perform public.versus__complete(m, case when v_role = 'p1' then 'p2' else 'p1' end, 'forfeit');
      end if;
    else
      select * into g from public.versus_group_matches where id = r.current_match_id for update;
      if found and g.phase <> 'complete' then
        v_seat := public.versus_group__seat_of(g.id, v_user);
        if v_seat is not null then perform public.versus_group__eliminate(g, v_seat, 'left'); end if;
      end if;
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

-- Heartbeat: keeps the lease; a returning player leaves auto (ruling 6). 1v1 as 2026-10-14-versus-ready-pause.sql.
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
  v_seat text;
begin
  update public.versus_members set last_seen_at = v_now where room_id = p_room and user_id = v_user;
  if not found then raise exception 'not_a_member'; end if;
  select * into r from public.versus_rooms where id = p_room;
  if r.current_match_id is not null then
    select * into m from public.versus_matches where id = r.current_match_id for update;
    if found then
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
    else
      select * into g from public.versus_group_matches where id = r.current_match_id for update;
      if found and g.phase <> 'complete' then
        v_seat := public.versus_group__seat_of(g.id, v_user);
        if v_seat is not null then
          update public.versus_group_seats set auto = false, missed = 0
            where match_id = g.id and seat = v_seat and auto and eliminated_round is null;
          if found then g := public.versus_group__touch(g.id); end if;
          return jsonb_build_object('serverNow', v_now, 'groupMatch', public.versus_group__match_json(g));
        end if;
      end if;
    end if;
  end if;
  return jsonb_build_object('serverNow', v_now);
end;
$$;

-- ── 8. Grants: clients call the public RPCs; helpers and the commit are not theirs ────────────────────────────
revoke all on function public.versus__options_error(jsonb) from public, anon, authenticated;
revoke all on function public.versus__normalize_options(jsonb) from public, anon, authenticated;
revoke all on function public.versus__mode_roles(text) from public, anon, authenticated;
revoke all on function public.versus__mode_min_players(text) from public, anon, authenticated;
revoke all on function public.versus_group__match_json(public.versus_group_matches) from public, anon, authenticated;
revoke all on function public.versus_group__seat_of(uuid, uuid) from public, anon, authenticated;
revoke all on function public.versus_group__living(uuid) from public, anon, authenticated;
revoke all on function public.versus_group__touch(uuid) from public, anon, authenticated;
revoke all on function public.versus_group__open_shop(public.versus_group_matches, int) from public, anon, authenticated;
revoke all on function public.versus_group__start_clock(public.versus_group_matches) from public, anon, authenticated;
revoke all on function public.versus_group__finalize_seat(uuid, int, text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.versus_group__maybe_resolve(public.versus_group_matches) from public, anon, authenticated;
revoke all on function public.versus_group__maybe_next(public.versus_group_matches) from public, anon, authenticated;
revoke all on function public.versus_group__maybe_clock(public.versus_group_matches) from public, anon, authenticated;
revoke all on function public.versus_group__resume(public.versus_group_matches) from public, anon, authenticated;
revoke all on function public.versus_group__complete(public.versus_group_matches, text, text) from public, anon, authenticated;
revoke all on function public.versus_group__eliminate(public.versus_group_matches, text, text) from public, anon, authenticated;
revoke all on function public.versus_group__maybe_start(public.versus_group_matches) from public, anon, authenticated;
revoke all on function public.versus_group_commit_round(uuid, int, jsonb, text) from public, anon, authenticated;
grant execute on function public.versus_group_commit_round(uuid, int, jsonb, text) to service_role;

revoke all on function public.versus_create_room(text, text, jsonb, text, text, int, jsonb) from public, anon;
revoke all on function public.versus_set_options(uuid, jsonb) from public, anon;
revoke all on function public.versus_join_room(uuid, text, text, jsonb, text, int) from public, anon;
revoke all on function public.versus_take_seat(uuid, text) from public, anon;
revoke all on function public.versus_leave_room(uuid) from public, anon;
revoke all on function public.versus_start_game(uuid) from public, anon;
revoke all on function public.versus_reconcile_room(uuid) from public, anon;
revoke all on function public.versus_press_gate(uuid) from public, anon;
revoke all on function public.versus_heartbeat(uuid) from public, anon;
revoke all on function public.versus_list_rooms() from public, anon;
revoke all on function public.versus_open_rooms(int, text) from public, anon;
revoke all on function public.versus_group_register_offer(uuid, text[]) from public, anon;
revoke all on function public.versus_group_pick_hero(uuid, int) from public, anon;
revoke all on function public.versus_group_reroll_hero(uuid, int, text[]) from public, anon;
revoke all on function public.versus_group_intro_done(uuid) from public, anon;
revoke all on function public.versus_group_submit(uuid, int, int, jsonb, boolean, jsonb, jsonb) from public, anon;
revoke all on function public.versus_group_combat_ready(uuid, int) from public, anon;
revoke all on function public.versus_group_forfeit(uuid) from public, anon;
revoke all on function public.versus_group_request_resume(uuid) from public, anon;
revoke all on function public.versus_group_unpause(uuid) from public, anon;
revoke all on function public.versus_group_reconcile(uuid) from public, anon;
revoke all on function public.versus_group_publish_frame(uuid, bigint, int, jsonb) from public, anon;

grant execute on function public.versus_create_room(text, text, jsonb, text, text, int, jsonb) to authenticated;
grant execute on function public.versus_set_options(uuid, jsonb) to authenticated;
grant execute on function public.versus_join_room(uuid, text, text, jsonb, text, int) to authenticated;
grant execute on function public.versus_take_seat(uuid, text) to authenticated;
grant execute on function public.versus_leave_room(uuid) to authenticated;
grant execute on function public.versus_start_game(uuid) to authenticated;
grant execute on function public.versus_reconcile_room(uuid) to authenticated;
grant execute on function public.versus_press_gate(uuid) to authenticated;
grant execute on function public.versus_heartbeat(uuid) to authenticated;
grant execute on function public.versus_list_rooms() to authenticated;
grant execute on function public.versus_open_rooms(int, text) to authenticated;
grant execute on function public.versus_group_register_offer(uuid, text[]) to authenticated;
grant execute on function public.versus_group_pick_hero(uuid, int) to authenticated;
grant execute on function public.versus_group_reroll_hero(uuid, int, text[]) to authenticated;
grant execute on function public.versus_group_intro_done(uuid) to authenticated;
grant execute on function public.versus_group_submit(uuid, int, int, jsonb, boolean, jsonb, jsonb) to authenticated;
grant execute on function public.versus_group_combat_ready(uuid, int) to authenticated;
grant execute on function public.versus_group_forfeit(uuid) to authenticated;
grant execute on function public.versus_group_request_resume(uuid) to authenticated;
grant execute on function public.versus_group_unpause(uuid) to authenticated;
grant execute on function public.versus_group_reconcile(uuid) to authenticated;
grant execute on function public.versus_group_publish_frame(uuid, bigint, int, jsonb) to authenticated;

-- ── 9. Realtime: group matches and rounds wake clients (rows stay the truth) ──────────────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'versus_group_matches') then
      alter publication supabase_realtime add table public.versus_group_matches;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'versus_group_rounds') then
      alter publication supabase_realtime add table public.versus_group_rounds;
    end if;
  end if;
end;
$$;
