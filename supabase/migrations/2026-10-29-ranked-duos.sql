-- RANKED DUOS, phase 1 part 1: the server pieces that do not need Versus Health / Armor (owner design 2026-10-26;
-- docs/design/2026-10-26-ranked-duos.md; GAME-RULES.md "Ranked Duos").
--
--   "i now want to add a duo's ranked option. this should be its own rank/snapshots etc, but follow the lobby rule set.
--    the only difference is it won't have a gold fuse, and timer cannot stop since both players are playing live."
--   "the team gets their own matchmaking rating i think, so me and lemon have a different duos rating than me and
--    ionlime. i think it'd also be fun to be able to name your team."
--
-- APPLY AFTER every Versus migration through 2026-10-28-versus-health.sql (the round commit writes the team pools it
-- added). Idempotent: safe to re-run. Nothing is reachable by players until the client
-- ships the Ranked Duos door (phase 3): no existing mode changes behaviour.
--
-- WHAT IT ADDS
--  1. A room option `mode: 'ranked_duos'`: seats p1 + p2 (the live pair), no modifiers. Its match is a Versus Group
--     match (seat_count 2) with FOUR teams: `a` = the live pair, `b`-`d` = recorded teams (no seats of their own).
--  2. TEAMS as their own identity (`duos_teams`: the unordered pair of accounts) with a NAME (2-16 letters, digits and
--     single spaces, the guides word filter, not unique; either teammate renames between games; `duos_team_set_name`).
--  3. The TEAM's rating (`duos_team_ranks`) and its immutable ledger (`duos_rank_results`), settled ONLY by the server
--     (`settle_duos_rank`, called when the live team is placed; no client ever sends a placement). The medal ladder with
--     the Duos table +34 / +11 / -11 / -34, top 2 for a division promotion, 1st for a medal, 3rd / 4th demotes.
--  4. The DUO POOL (`duo_runs` + `duo_run_rounds`), written by the server from the match's own final submissions when the
--     live team's game ends (exact by construction: every round, both boards as they fought, empty ones included, the
--     fight order), and `duo_runs_sample` for the seating.
--  5. The PINNED TABLE (`versus_ranked_duos_served`): each recorded team's two members with their WHOLE recordings,
--     written once by `versus_ranked_duos_seat` (service role, from `versus-resolve`'s `seat_ranked_duos`).
--  6. The END-TURN GATE (owner: "the game will still halt ... until both players hit their end turn/combat gem"):
--     `versus_ranked_duos__close_at` (both ended = now; else 5 s after the later of 0:00 and the first End Turn; nobody
--     ended = the 30 s AFK backstop past 0:00); an auto seat (disconnected or left) counts as ended. No pause, ever.
--     `versus_ranked_duos_submit` (candidates accepted past 0:00 for re-ordering until the round closes; the shop rule
--     "no buying from 0:00" is the client's, R-TIMER-LOCK-01) and `versus_ranked_duos_reconcile`. The group RPCs hand a
--     Ranked Duos match to these, so an older code path cannot apply the group rules to it.
--  7. LEAVING (owner Q3 under the team rating): a leaver's board plays on auto and the team plays on, settled once at
--     its real place; when BOTH have left the team is placed at once in the lowest open place and the match ends.
--  8. `versus_ranked_duos__place_team`: the one place a team's placement is written. For the live team it settles the
--     rating (rated tables only), records the duo run and ends the match.
--  9. THE ROUND: `versus_ranked_duos_round_input` (one read: each recorded member's board for the round by the
--     round-exact rule, the live sides, the pools, the meetings) and `versus_ranked_duos_commit_round` (the fights, the
--     team pools, the placements; the live team through place_team), driven by `versus-resolve`'s `finalize_ranked_duos`.

-- ── 1. Options and modes (mirror of packages/sim/src/versus/options.ts) ──────────────────────────────────────────
create or replace function public.versus__options_error(p jsonb)
returns text
language sql
immutable
as $$
  select case
    when p is null or jsonb_typeof(p) <> 'object' then 'options_not_object'
    when exists (select 1 from jsonb_object_keys(p) k where k not in ('v', 'mode', 'modifiers')) then 'unknown_option'
    when p ? 'v' and p->'v' <> '1'::jsonb then 'bad_version'
    when p ? 'mode' and (jsonb_typeof(p->'mode') <> 'string' or p->>'mode' not in ('duel', 'group', 'duos', 'ranked_duos')) then 'bad_mode'
    when p ? 'modifiers' and (
      jsonb_typeof(p->'modifiers') <> 'array'
      or jsonb_array_length(p->'modifiers') > 1
      or exists (select 1 from jsonb_array_elements(p->'modifiers') e where jsonb_typeof(e) <> 'string' or e #>> '{}' not in ('freedom', 'summit'))
      or (select count(distinct e) from jsonb_array_elements(p->'modifiers') e) <> jsonb_array_length(p->'modifiers')
      or (p->>'mode' = 'ranked_duos' and jsonb_array_length(p->'modifiers') > 0)
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

-- Ranked Duos is a Duos match for passing and the fight order (the pass RPCs, the shop opening).
create or replace function public.versus_duos__is(m public.versus_group_matches)
returns boolean
language sql
immutable
as $$
  select coalesce(m.options->>'mode', 'group') in ('duos', 'ranked_duos');
$$;

create or replace function public.versus_ranked_duos__is(m public.versus_group_matches)
returns boolean
language sql
immutable
as $$
  select coalesce(m.options->>'mode', '') = 'ranked_duos';
$$;

-- ── 2. Columns ────────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.versus_group_matches drop constraint if exists versus_group_matches_seat_count_check;
alter table public.versus_group_matches add constraint versus_group_matches_seat_count_check check (seat_count between 2 and 4);
-- The live pair's team identity (duos_teams.id), when the table was seated, and why it is unrated (null = rated).
alter table public.versus_group_matches add column if not exists ranked_team uuid;
alter table public.versus_group_matches add column if not exists seated_at timestamptz;
alter table public.versus_group_matches add column if not exists unrated text check (unrated is null or unrated in ('generated', 'not_seated', 'bot', 'dev'));
-- When a seat ended its turn (End Turn), went auto (disconnected / left), and left the match for good.
alter table public.versus_group_seats add column if not exists locked_at timestamptz;
alter table public.versus_group_seats add column if not exists auto_since timestamptz;
alter table public.versus_group_seats add column if not exists left_at timestamptz;
-- A recorded team's kind, its duo run, its name and (a duo run) its recorded fight order: round -> member 0 / 1.
alter table public.versus_group_teams add column if not exists served_kind text check (served_kind is null or served_kind in ('duo', 'pair', 'generated'));
alter table public.versus_group_teams add column if not exists duo_run_id uuid;
alter table public.versus_group_teams add column if not exists name text;
alter table public.versus_group_teams add column if not exists recorded_order jsonb;
-- The round's fight order as it fought (team -> the seat / member first), kept for the duo run.
alter table public.versus_group_rounds add column if not exists first jsonb;

-- ── 3. Teams and team names ───────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.duos_teams (
  id          uuid primary key default gen_random_uuid(),
  user_lo     uuid not null,
  user_hi     uuid not null,
  name        text check (name is null or char_length(name) between 2 and 16),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (user_lo < user_hi),
  unique (user_lo, user_hi)
);
alter table public.duos_teams enable row level security;
drop policy if exists "duos teams read" on public.duos_teams;
create policy "duos teams read" on public.duos_teams for select to authenticated using (true);
grant select on public.duos_teams to authenticated;

-- The guides word filter (packages/guides/src/wordFilter.ts, isBlockedText + isReservedByline), for a name of letters,
-- digits and spaces only: lower case, digit swaps undone, runs of 3+ squeezed to 2 (and fully squeezed for words with no
-- double letter), whole words, stems anywhere, reserved staff words / "team ascent". Parity: rankedDuos.db.test.ts.
create or replace function public.duos__name_blocked(p text)
returns text
language plpgsql
immutable
as $$
declare
  c_words  constant text[] := array['shit', 'shitty', 'cunt', 'bitch', 'asshole', 'dick', 'cock', 'pussy', 'whore', 'slut',
    'bastard', 'retard', 'rape', 'rapist', 'nigga', 'kike', 'spic', 'chink', 'tranny', 'nazi', 'hitler'];
  c_stems  constant text[] := array['fuck', 'nigger', 'faggot', 'bullshit'];
  c_staff  constant text[] := array['admin', 'moderator', 'developer', 'oficial'];
  c_phrase constant text[] := array['teamascent', 'ascenteam', 'ascentoficial'];  -- squeezed, as the guides list
  v_fold text := translate(lower(p), '013457', 'oieast');
  t text;
  two text;
  one text;
  w text;
  v_joined text := '';
begin
  foreach t in array regexp_split_to_array(v_fold, '[^a-z]+') loop
    continue when t = '';
    two := regexp_replace(t, '(.)\1{2,}', '\1\1', 'g');
    one := regexp_replace(t, '(.)\1+', '\1', 'g');
    if two = any (c_words) then return 'name_blocked'; end if;
    foreach w in array c_words loop
      if w !~ '(.)\1' and one = w then return 'name_blocked'; end if;
    end loop;
    foreach w in array c_stems loop
      if position(w in two) > 0 or (w !~ '(.)\1' and position(w in one) > 0) then return 'name_blocked'; end if;
    end loop;
    if one = any (c_staff) then return 'name_reserved'; end if;
    v_joined := v_joined || one;
  end loop;
  v_joined := regexp_replace(v_joined, '(.)\1+', '\1', 'g');
  foreach w in array c_phrase loop
    if position(w in v_joined) > 0 then return 'name_reserved'; end if;
  end loop;
  return null;
end;
$$;

-- Null when the (already cleaned) name is fine; else the reason (mirror of teamNameProblem + the filter).
create or replace function public.duos__team_name_error(p text)
returns text
language sql
immutable
as $$
  select case
    when p is null or char_length(p) < 2 or char_length(p) > 16 then 'name_length'
    when p !~ '^[A-Za-z0-9]+( [A-Za-z0-9]+)*$' then 'name_chars'
    else public.duos__name_blocked(p)
  end;
$$;

-- The pair's team id, created on first use.
create or replace function public.duos__ensure_team(p_a uuid, p_b uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_a is null or p_b is null or p_a = p_b then raise exception 'bad_team'; end if;
  insert into public.duos_teams (user_lo, user_hi) values (least(p_a, p_b), greatest(p_a, p_b))
    on conflict (user_lo, user_hi) do nothing;
  select id into v_id from public.duos_teams where user_lo = least(p_a, p_b) and user_hi = greatest(p_a, p_b);
  return v_id;
end;
$$;

-- Name (or, with null / blank, un-name) the caller's team with p_partner. Refused while that team is in a game.
create or replace function public.duos_team_set_name(p_partner uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_team uuid;
  v_name text := nullif(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), '');
  v_err text;
  t public.duos_teams;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  if p_partner is null or p_partner = v_user then raise exception 'bad_team'; end if;
  if v_name is not null then
    v_err := public.duos__team_name_error(v_name);
    if v_err is not null then raise exception '%', v_err; end if;
  end if;
  v_team := public.duos__ensure_team(v_user, p_partner);
  select * into t from public.duos_teams where id = v_team for update;
  if exists (select 1 from public.versus_group_matches where ranked_team = v_team and phase <> 'complete') then
    raise exception 'team_in_game';
  end if;
  update public.duos_teams set name = v_name, updated_at = now() where id = v_team returning * into t;
  return jsonb_build_object('id', t.id, 'name', t.name, 'userLo', t.user_lo, 'userHi', t.user_hi);
end;
$$;

-- ── 4. The team's rating ──────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.duos_team_ranks (
  team_id               uuid primary key references public.duos_teams(id) on delete cascade,
  season                int  not null default 0,
  rules_version         int  not null default 1,
  division              int  not null default 0 check (division between 0 and 17),
  points                int  not null default 0 check (points >= 0),
  demotion_ready        boolean not null default false,
  highest_division      int  not null default 0,
  highest_points        int  not null default 0,
  revision              int  not null default 0,
  updated_at            timestamptz not null default now(),
  check (division = 17 or points <= 100),
  check (not demotion_ready or (points = 0 and division > 0))
);
create index if not exists duos_team_ranks_order on public.duos_team_ranks (season, division desc, points desc);
alter table public.duos_team_ranks enable row level security;
drop policy if exists "duos team ranks read" on public.duos_team_ranks;
create policy "duos team ranks read" on public.duos_team_ranks for select to authenticated using (true);
grant select on public.duos_team_ranks to authenticated;

create table if not exists public.duos_rank_results (
  team_id                uuid not null references public.duos_teams(id) on delete cascade,
  match_id               uuid not null,
  season                 int  not null,
  rules_version          int  not null,
  placement              int  not null check (placement between 1 and 4),
  revision_before        int  not null,
  revision_after         int  not null,
  division_before        int  not null,
  points_before          int  not null,
  demotion_ready_before  boolean not null,
  division_after         int  not null,
  points_after           int  not null,
  demotion_ready_after   boolean not null,
  highest_division_after int  not null,
  highest_points_after   int  not null,
  base_delta             int  not null,
  applied_delta          int  not null,
  capped_points          int  not null,
  was_promotion_game     boolean not null,
  promotion_kind         text check (promotion_kind is null or promotion_kind in ('division', 'medal')),
  required_finish        int,
  promotion_unlocked     boolean not null,
  promoted               boolean not null,
  was_demotion_game      boolean not null,
  demotion_unlocked      boolean not null,
  demoted                boolean not null,
  created_at             timestamptz not null default now(),
  primary key (team_id, match_id)
);
alter table public.duos_rank_results enable row level security;
drop policy if exists "duos rank results read own" on public.duos_rank_results;
create policy "duos rank results read own" on public.duos_rank_results for select to authenticated using (
  exists (select 1 from public.duos_teams t where t.id = duos_rank_results.team_id and auth.uid() in (t.user_lo, t.user_hi)));
grant select on public.duos_rank_results to authenticated;

create or replace function public.duos_rank_result_json(r public.duos_rank_results)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'teamId', r.team_id, 'matchId', r.match_id, 'seasonId', r.season, 'rulesVersion', r.rules_version,
    'placement', r.placement, 'revisionBefore', r.revision_before, 'revisionAfter', r.revision_after,
    'before', jsonb_build_object('divisionIndex', r.division_before, 'points', r.points_before, 'demotionReady', r.demotion_ready_before),
    'after', jsonb_build_object('divisionIndex', r.division_after, 'points', r.points_after, 'demotionReady', r.demotion_ready_after),
    'highestAfter', jsonb_build_object('divisionIndex', r.highest_division_after, 'points', r.highest_points_after),
    'baseDelta', r.base_delta, 'strengthBonus', 0, 'lobbyStrength', null, 'appliedDelta', r.applied_delta,
    'cappedPoints', r.capped_points, 'wasPromotionGame', r.was_promotion_game, 'promotionKind', r.promotion_kind,
    'requiredFinish', r.required_finish, 'promotionUnlocked', r.promotion_unlocked, 'promoted', r.promoted,
    'wasDemotionGame', r.was_demotion_game, 'demotionUnlocked', r.demotion_unlocked, 'demoted', r.demoted);
$$;

-- THE SETTLEMENT. Internal: called by `versus_ranked_duos__place_team` (service role / definer chain only). The rules
-- are `settle_rank`'s with the Duos table (mirror of DUOS_RANK_RULES in packages/sim/src/rank.ts; parity is a db test).
-- Once per (team, match): a second call returns the original result.
create or replace function public.settle_duos_rank(p_team uuid, p_match uuid, p_placement int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_season          constant int := 3;      -- the live medal season (settle_rank's c_season); resets with it
  c_rules           constant int := 1;
  c_cap             constant int := 100;
  c_top             constant int := 17;
  c_per_medal       constant int := 3;
  c_awards          constant int[] := array[34, 11, -11, -34];
  c_division_finish constant int := 2;
  c_medal_finish    constant int := 1;
  c_demotion_finish constant int := 2;     -- worst placement that still ESCAPES a demotion game
  c_promo_landing   constant int := 10;
  rk   public.duos_team_ranks%rowtype;
  prev public.duos_rank_results%rowtype;
  v_base int; v_pts int;
  d0 int; p0 int; d1 int; p1 int; hd int; hp int;
  r0 boolean; r1 boolean := false;
  v_gate boolean := false; v_kind text := null; v_required int := null; v_unlocked boolean := false; v_promoted boolean := false;
  v_dgate boolean := false; v_demoted boolean := false;
  v_applied int; v_capped int;
begin
  if p_placement is null or p_placement < 1 or p_placement > 4 then raise exception 'bad_placement'; end if;
  insert into public.duos_team_ranks (team_id) values (p_team) on conflict (team_id) do nothing;
  select * into rk from public.duos_team_ranks where team_id = p_team for update;
  select * into prev from public.duos_rank_results where team_id = p_team and match_id = p_match;
  if found then return jsonb_build_object('status', 'deduped', 'result', public.duos_rank_result_json(prev)); end if;

  if rk.season is distinct from c_season then
    d0 := 0; p0 := 0; r0 := false; hd := 0; hp := 0;
  else
    d0 := rk.division; p0 := rk.points; r0 := rk.demotion_ready; hd := rk.highest_division; hp := rk.highest_points;
  end if;
  v_base := c_awards[p_placement];
  d1 := d0; p1 := p0;

  if d0 < c_top and p0 = c_cap then
    v_gate := true;
    if (d0 % c_per_medal) = c_per_medal - 1 then v_kind := 'medal'; v_required := c_medal_finish;
    else v_kind := 'division'; v_required := c_division_finish; end if;
    if p_placement <= v_required then
      v_promoted := true; d1 := d0 + 1; p1 := c_promo_landing;
    elsif v_base >= 0 then
      d1 := d0; p1 := p0;
    else
      v_pts := p0 + v_base;
      if v_pts <= 0 and d0 > 0 then d1 := d0; p1 := 0; r1 := true;
      elsif v_pts < 0 then d1 := 0; p1 := 0;
      else d1 := d0; p1 := v_pts;
      end if;
    end if;
  elsif r0 then
    v_dgate := true; v_required := c_demotion_finish;
    if p_placement <= v_required then
      v_pts := p0 + v_base;
      if v_base < 0 and v_pts <= 0 and d0 > 0 then d1 := d0; p1 := 0; r1 := true;
      elsif d0 = c_top then d1 := c_top; p1 := v_pts;
      elsif v_pts >= c_cap then v_unlocked := true; d1 := d0; p1 := c_cap;
      else d1 := d0; p1 := v_pts;
      end if;
    else
      v_demoted := true; d1 := d0 - 1; p1 := c_cap + v_base;
    end if;
  else
    v_pts := p0 + v_base;
    if v_base < 0 and v_pts <= 0 and d0 > 0 then d1 := d0; p1 := 0; r1 := true;
    elsif v_pts < 0 then d1 := 0; p1 := 0;
    elsif d0 = c_top then d1 := c_top; p1 := v_pts;
    elsif v_pts >= c_cap then v_unlocked := true; d1 := d0; p1 := c_cap;
    else d1 := d0; p1 := v_pts;
    end if;
  end if;

  v_applied := (c_cap * d1 + p1) - (c_cap * d0 + p0);
  if v_promoted then v_capped := 0; else v_capped := greatest(0, abs(v_base) - abs(v_applied)); end if;
  if d1 > hd or (d1 = hd and p1 > hp) then hd := d1; hp := p1; end if;

  update public.duos_team_ranks set season = c_season, rules_version = c_rules, division = d1, points = p1,
    demotion_ready = r1, highest_division = hd, highest_points = hp, revision = rk.revision + 1, updated_at = now()
    where team_id = p_team;
  insert into public.duos_rank_results (
    team_id, match_id, season, rules_version, placement, revision_before, revision_after,
    division_before, points_before, demotion_ready_before, division_after, points_after, demotion_ready_after,
    highest_division_after, highest_points_after, base_delta, applied_delta, capped_points,
    was_promotion_game, promotion_kind, required_finish, promotion_unlocked, promoted,
    was_demotion_game, demotion_unlocked, demoted
  ) values (
    p_team, p_match, c_season, c_rules, p_placement, rk.revision, rk.revision + 1,
    d0, p0, r0, d1, p1, r1, hd, hp, v_base, v_applied, v_capped,
    v_gate, v_kind, v_required, v_unlocked, v_promoted,
    v_dgate, r1, v_demoted
  ) returning * into prev;
  return jsonb_build_object('status', 'ok', 'result', public.duos_rank_result_json(prev));
end;
$$;

-- ── 5. The duo pool ───────────────────────────────────────────────────────────────────────────────────────────────
-- One row per finished live team's game. Server-written only; no client reads it (the seating samples it server side).
create table if not exists public.duo_runs (
  id                uuid primary key default gen_random_uuid(),
  match_id          uuid not null unique,
  team_id           uuid,
  set_id            text not null,
  content_revision  text not null,
  members           jsonb not null,      -- [{ seat, userId, name, heroId, runKey }, ...] in seat order
  first_round       int  not null,
  last_round        int  not null,
  round_count       int  not null,
  placement         int,
  strength          numeric,
  strength_early    numeric,
  strength_late     numeric,
  eligible          boolean not null default false,
  created_at        timestamptz not null default now()
);
create index if not exists duo_runs_sample on public.duo_runs (set_id, eligible);
create table if not exists public.duo_run_rounds (
  duo_run_id  uuid not null references public.duo_runs(id) on delete cascade,
  round       int  not null,
  sides       jsonb not null,            -- { p1: prepared side | null, p2: ... } exactly as fought
  sources     jsonb not null,            -- { p1: 'lock' | 'deadline' | 'auto' | 'empty', p2: ... }
  first       text,                      -- the seat whose board fought first ('p1' / 'p2'), null if not recorded
  primary key (duo_run_id, round)
);
alter table public.duo_runs enable row level security;
alter table public.duo_run_rounds enable row level security;

-- Record the live team's game (idempotent: one duo run per match). Eligible to be served (mirror of R-LOBBY-07): at
-- least 4 rounds, starting at round 1 or 2, no hole longer than one round (rounds are contiguous by construction), no
-- test bot in the team and not a dev-forced match.
create or replace function public.versus_ranked_duos__record_run(m public.versus_group_matches, p_placement int)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_first int; v_last int; v_count int; v_gap int;
  v_bot boolean := false;
begin
  select id into v_id from public.duo_runs where match_id = m.id;
  if found then return v_id; end if;
  select min(round), max(round), count(distinct round) into v_first, v_last, v_count
    from public.versus_group_submissions where match_id = m.id and final and seat in ('p1', 'p2');
  if v_count is null or v_count = 0 then return null; end if;
  select coalesce(max(round - prev - 1), 0) into v_gap from (
    select round, lag(round) over (order by round) as prev
    from (select distinct round from public.versus_group_submissions where match_id = m.id and final and seat in ('p1', 'p2')) r) g;
  if to_regclass('public.versus_test_bots') is not null then
    execute 'select exists (select 1 from public.versus_test_bots b join public.versus_group_seats s on s.user_id = b.user_id where s.match_id = $1)'
      into v_bot using m.id;
  end if;
  insert into public.duo_runs (match_id, team_id, set_id, content_revision, members, first_round, last_round, round_count, placement, eligible)
  values (m.id, m.ranked_team, m.set_id, m.content_revision,
    (select jsonb_agg(jsonb_build_object('seat', s.seat, 'userId', s.user_id, 'name', s.name, 'heroId', s.hero,
        'runKey', 'duo:' || m.id::text || ':' || s.seat) order by s.seat)
      from public.versus_group_seats s where s.match_id = m.id and s.seat in ('p1', 'p2')),
    v_first, v_last, v_count, p_placement,
    v_count >= 4 and v_first <= 2 and v_gap <= 1 and not v_bot
      and not coalesce((to_jsonb(m)->>'dev_forced')::boolean, false)
      and (select count(*) from public.versus_group_seats where match_id = m.id and hero is not null and seat in ('p1', 'p2')) = 2)
  returning id into v_id;
  insert into public.duo_run_rounds (duo_run_id, round, sides, sources, first)
  select v_id, x.round,
    jsonb_build_object('p1', max(x.prepared_side::text) filter (where x.seat = 'p1')::jsonb, 'p2', max(x.prepared_side::text) filter (where x.seat = 'p2')::jsonb),
    jsonb_build_object('p1', max(x.source) filter (where x.seat = 'p1'), 'p2', max(x.source) filter (where x.seat = 'p2')),
    (select r.first->>'a' from public.versus_group_rounds r where r.match_id = m.id and r.round = x.round)
  from public.versus_group_submissions x
  where x.match_id = m.id and x.final and x.seat in ('p1', 'p2')
  group by x.round;
  return v_id;
end;
$$;

-- A seeded sample of eligible duo runs of a set, each with every round (service role only: `seat_ranked_duos`).
create or replace function public.duo_runs_sample(p_limit int default 40, p_set text default null, p_seed text default null)
returns table (id uuid, members jsonb, strength numeric, strength_early numeric, strength_late numeric, rounds jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.members, r.strength, r.strength_early, r.strength_late,
    (select coalesce(jsonb_agg(jsonb_build_object('round', x.round, 'sides', x.sides, 'first', x.first) order by x.round), '[]'::jsonb)
       from public.duo_run_rounds x where x.duo_run_id = r.id)
  from public.duo_runs r
  where r.eligible and (p_set is null or r.set_id = p_set)
  order by md5(coalesce(p_seed, '') || ':' || r.id::text)
  limit least(greatest(coalesce(p_limit, 40), 0), 100);
$$;

-- ── 6. The pinned table ───────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.versus_ranked_duos_served (
  match_id    uuid not null references public.versus_group_matches(id) on delete cascade,
  team        text not null check (team in ('b', 'c', 'd')),
  member      smallint not null check (member in (0, 1)),
  kind        text not null check (kind in ('duo', 'solo', 'generated')),
  source_key  text not null,
  owner_id    uuid,
  name        text not null,
  hero        text not null,
  recording   jsonb not null check (octet_length(recording::text) <= 4194304),
  primary key (match_id, team, member)
);
-- No client policy: a client never reads a whole recording (the current round's boards reach it through the match RPCs).
alter table public.versus_ranked_duos_served enable row level security;

-- Seat the table (service role: `versus-resolve`'s `seat_ranked_duos`). Idempotent: the first table written wins.
-- p_table: { unrated, teams: [{ team, kind, duoRunId, order, recordedOrder, members: [{ member, kind, key, ownerId,
-- name, heroId, recording }, x2] }, x3] }.
create or replace function public.versus_ranked_duos_seat(p_match uuid, p_table jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.versus_group_matches;
  t jsonb;
  x jsonb;
  v_heroes text[];
begin
  select * into m from public.versus_group_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  if not public.versus_ranked_duos__is(m) then raise exception 'not_ranked_duos'; end if;
  if m.seated_at is not null then return jsonb_build_object('seated', true, 'already', true); end if;
  if m.phase = 'complete' then raise exception 'match_over'; end if;
  if jsonb_typeof(p_table->'teams') <> 'array' or jsonb_array_length(p_table->'teams') <> 3 then raise exception 'bad_table'; end if;
  select array_agg(hero) into v_heroes from public.versus_group_seats where match_id = p_match and hero is not null;
  if coalesce(array_length(v_heroes, 1), 0) <> 2 then raise exception 'heroes_not_locked'; end if;
  for t in select * from jsonb_array_elements(p_table->'teams') loop
    if t->>'team' not in ('b', 'c', 'd') or t->>'kind' not in ('duo', 'pair', 'generated')
        or jsonb_typeof(t->'members') <> 'array' or jsonb_array_length(t->'members') <> 2 then
      raise exception 'bad_table';
    end if;
    for x in select * from jsonb_array_elements(t->'members') loop
      if x->>'kind' not in ('duo', 'solo', 'generated') or coalesce(x->>'heroId', '') = '' or coalesce(x->>'key', '') = ''
          or jsonb_typeof(x->'recording') <> 'object' or (x->>'member')::int not in (0, 1) then
        raise exception 'bad_table';
      end if;
      if (x->>'heroId') = any (v_heroes) then raise exception 'hero_taken'; end if;
      v_heroes := v_heroes || (x->>'heroId');
      insert into public.versus_ranked_duos_served (match_id, team, member, kind, source_key, owner_id, name, hero, recording)
        values (p_match, t->>'team', (x->>'member')::int, x->>'kind', x->>'key',
                case when coalesce(x->>'ownerId', '') ~ '^[0-9a-f-]{36}$' then (x->>'ownerId')::uuid end,
                left(coalesce(nullif(x->>'name', ''), 'Player'), 40), x->>'heroId', x->'recording');
    end loop;
    insert into public.versus_group_teams (match_id, team) values (p_match, t->>'team') on conflict do nothing;
    update public.versus_group_teams set served_kind = t->>'kind',
      duo_run_id = case when coalesce(t->>'duoRunId', '') ~ '^[0-9a-f-]{36}$' then (t->>'duoRunId')::uuid end,
      recorded_order = case when jsonb_typeof(t->'recordedOrder') = 'object' then t->'recordedOrder' end
      where match_id = p_match and team = t->>'team';
  end loop;
  update public.versus_group_matches set seated_at = public.versus_clock(),
    unrated = case when coalesce((p_table->>'unrated')::boolean, false) then 'generated' else unrated end,
    revision = revision + 1, updated_at = public.versus_clock()
    where id = p_match;
  return jsonb_build_object('seated', true, 'already', false);
end;
$$;

-- ── 7. Placement, rating and the duo run ──────────────────────────────────────────────────────────────────────────
-- THE one place a Ranked Duos team is placed. For the live team (`a`): its seats take the place, the rating settles
-- (rated tables only: seated, not all generated, no test bot, not dev-forced), the duo run is recorded and the match
-- ends. Idempotent per team.
create or replace function public.versus_ranked_duos__place_team(m public.versus_group_matches, p_team text, p_placement int, p_reason text)
returns public.versus_group_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bot boolean := false;
  v_unrated text;
  v_now timestamptz := public.versus_clock();
  -- The seat / team out_reason vocabulary (an abandoned team is out as 'left').
  v_reason text := case when p_reason in ('hearts', 'forfeit', 'left', 'missed') then p_reason else 'left' end;
begin
  if p_placement is null or p_placement < 1 or p_placement > 4 then raise exception 'bad_placement'; end if;
  update public.versus_group_teams set placement = p_placement,
    eliminated_round = case when p_placement = 1 then eliminated_round else coalesce(eliminated_round, m.round) end,
    out_reason = case when p_placement = 1 then out_reason else coalesce(out_reason, v_reason) end
    where match_id = m.id and team = p_team and placement is null;
  if not found or p_team <> 'a' then return m; end if;

  update public.versus_group_seats set placement = p_placement,
    eliminated_round = case when p_placement = 1 then eliminated_round else coalesce(eliminated_round, m.round) end,
    out_reason = case when p_placement = 1 then out_reason else coalesce(out_reason, v_reason) end,
    auto = case when p_placement = 1 then auto else false end
    where match_id = m.id and team = 'a';

  if to_regclass('public.versus_test_bots') is not null then
    execute 'select exists (select 1 from public.versus_test_bots b join public.versus_group_seats s on s.user_id = b.user_id where s.match_id = $1)'
      into v_bot using m.id;
  end if;
  v_unrated := coalesce(m.unrated,
    case when m.seated_at is null then 'not_seated'
         when v_bot then 'bot'
         when coalesce((to_jsonb(m)->>'dev_forced')::boolean, false) then 'dev' end);
  if v_unrated is null and m.ranked_team is not null then
    perform public.settle_duos_rank(m.ranked_team, m.id, p_placement);
  end if;
  update public.versus_group_matches set unrated = v_unrated where id = m.id returning * into m;
  perform public.versus_ranked_duos__record_run(m, p_placement);

  update public.versus_group_matches set phase = 'complete', winner_seat = case when p_placement = 1 then 'p1' end,
    end_reason = case when p_reason in ('hearts', 'forfeit', 'missed', 'abandoned') then p_reason
                      when p_reason = 'left' then 'abandoned' else 'hearts' end,
    paused_seat = null, paused_at = null, pause_grace_until = null, resume_at = null,
    completed_at = v_now, revision = revision + 1, updated_at = v_now
    where id = m.id returning * into m;
  update public.versus_rooms set status = 'open', p1_gate = false, p2_gate = false, p3_gate = false, p4_gate = false, gate_deadline = null,
    revision = revision + 1, updated_at = v_now
    where id = m.room_id and current_match_id = m.id;
  return m;
end;
$$;

-- ── 8. The end-turn gate ──────────────────────────────────────────────────────────────────────────────────────────
-- When the round's shop closes (mirror of rankedDuosCloseAt in packages/sim/src/versus/rankedDuos.ts), or null.
create or replace function public.versus_ranked_duos__close_at(m public.versus_group_matches)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_all boolean;
  v_last timestamptz;
  v_first timestamptz;
begin
  -- A seat that LEFT counts as ended even if the room heartbeat cleared its auto flag (the leaver may still be in the room).
  select bool_and(locked or auto or left_at is not null),
         max(coalesce(case when locked then locked_at end, case when auto then auto_since end, left_at, locked_at)),
         min(case when locked then coalesce(locked_at, m.shop_deadline)
                  when auto or left_at is not null then coalesce(auto_since, left_at, m.shop_deadline) end)
    into v_all, v_last, v_first
    from public.versus_group_seats where match_id = m.id and eliminated_round is null;
  if coalesce(v_all, false) then return coalesce(v_last, public.versus_clock()); end if;
  if m.shop_deadline is null then return null; end if;
  if v_first is null then return m.shop_deadline + interval '30 seconds'; end if;
  return greatest(m.shop_deadline, v_first) + interval '5 seconds';
end;
$$;

-- Close the round when its moment has come: every unlocked seat takes its newest candidate (or, on auto, its last
-- locked board), then `resolving`.
create or replace function public.versus_ranked_duos__maybe_close(m public.versus_group_matches)
returns public.versus_group_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_close timestamptz;
  s record;
  v_out public.versus_group_matches;
begin
  if m.phase <> 'shop' then return m; end if;
  v_close := public.versus_ranked_duos__close_at(m);
  if v_close is null or public.versus_clock() < v_close then return m; end if;
  for s in select * from public.versus_group_seats where match_id = m.id and not locked and eliminated_round is null loop
    perform public.versus_group__finalize_seat(m.id, m.round, s.seat, s.user_id, s.auto or s.left_at is not null);
  end loop;
  update public.versus_group_matches set phase = 'resolving', revision = revision + 1, updated_at = public.versus_clock()
    where id = m.id returning * into v_out;
  return v_out;
end;
$$;

create or replace function public.versus_ranked_duos__json(m public.versus_group_matches)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.versus_group__match_json(m) || jsonb_build_object(
    'closeAt', case when m.phase = 'shop' then public.versus_ranked_duos__close_at(m) end,
    'seated', m.seated_at is not null, 'unrated', m.unrated,
    'endedAt', coalesce((select jsonb_object_agg(s.seat, coalesce(case when s.locked then s.locked_at end, case when s.auto then s.auto_since end))
        from public.versus_group_seats s where s.match_id = m.id), '{}'::jsonb),
    'leftAt', coalesce((select jsonb_object_agg(s.seat, s.left_at) from public.versus_group_seats s where s.match_id = m.id and s.left_at is not null), '{}'::jsonb),
    'teams', coalesce((select jsonb_agg(jsonb_build_object('team', t.team, 'kind', coalesce(t.served_kind, 'live'),
        'placement', t.placement, 'eliminatedRound', t.eliminated_round) order by t.team)
      from public.versus_group_teams t where t.match_id = m.id), '[]'::jsonb),
    'teamName', (select d.name from public.duos_teams d where d.id = m.ranked_team));
$$;

-- Submit a side. Candidates are accepted until the round CLOSES (past 0:00 a teammate may still re-order; buying stops
-- at 0:00 on the client, R-TIMER-LOCK-01); a final side (End Turn) the same, with the 250 ms grace.
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
  if found and s.final then raise exception 'already_locked'; end if;
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

-- The clock's driver (any member calls it on the backed-off cadence). NO PAUSE: a lapsed lease (12 s) puts that seat on
-- auto (it counts as ended); the caller's own fresh call takes it off auto, unless they left.
create or replace function public.versus_ranked_duos_reconcile(p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  m public.versus_group_matches;
begin
  select * into m from public.versus_group_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  if not public.versus_ranked_duos__is(m) then raise exception 'not_ranked_duos'; end if;
  if m.phase = 'complete' then return public.versus_ranked_duos__json(m); end if;

  -- Back: the caller's own seat comes off auto (never a seat that left).
  update public.versus_group_seats set auto = false, auto_since = null
    where match_id = m.id and user_id = auth.uid() and auto and left_at is null and eliminated_round is null;
  -- Gone: a living seat whose lease lapsed goes on auto, from now.
  update public.versus_group_seats s2 set auto = true, auto_since = v_now
    from public.versus_group_matches gm
    left join public.versus_members mm on mm.room_id = gm.room_id
    where gm.id = m.id and s2.match_id = m.id and s2.eliminated_round is null and not s2.auto
      and s2.user_id is distinct from auth.uid()
      and mm.user_id = s2.user_id and (mm.last_seen_at is null or mm.last_seen_at < v_now - interval '12 seconds');
  update public.versus_group_seats s2 set auto = true, auto_since = v_now
    where s2.match_id = m.id and s2.eliminated_round is null and not s2.auto and s2.user_id is distinct from auth.uid()
      and not exists (select 1 from public.versus_members mm where mm.room_id = m.room_id and mm.user_id = s2.user_id);
  select * into m from public.versus_group_matches where id = p_match;

  if m.phase = 'hero_select' and v_now >= m.hero_deadline then
    m := public.versus_group__maybe_start(m);
  elsif m.phase = 'shop' and m.shop_deadline is null then
    if v_now >= m.intro_deadline then m := public.versus_group__start_clock(m); else m := public.versus_group__maybe_clock(m); end if;
  elsif m.phase = 'shop' then
    m := public.versus_ranked_duos__maybe_close(m);
  elsif m.phase = 'combat' and v_now >= m.combat_deadline then
    m := public.versus_group__open_shop(m, m.round + 1);
  end if;
  return public.versus_ranked_duos__json(m);
end;
$$;

-- The group RPCs hand a Ranked Duos match over, so no older path applies the group clock (lock at 0:00) or the pause.
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
  if public.versus_ranked_duos__is(m) then return public.versus_ranked_duos_reconcile(p_match); end if;
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

-- ── 9. Leaving (owner Q3 under the team rating) ───────────────────────────────────────────────────────────────────
-- Every leave / concede path calls `versus_group__eliminate` (versus_leave_room, versus_group_forfeit). In Ranked Duos a
-- leaver is NOT out: their seat goes on auto for good (their last locked board fights) and the team plays on. When BOTH
-- have left, the team is placed at once in the lowest open place and the match ends. Group and Duos: unchanged (copied
-- from 2026-10-25-versus-duos.sql).
create or replace function public.versus_group__eliminate(m public.versus_group_matches, p_seat text, p_reason text)
returns public.versus_group_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_left int;
  v_winner text;
  v_now timestamptz := public.versus_clock();
begin
  if m.phase = 'complete' then return m; end if;
  if public.versus_ranked_duos__is(m) then
    update public.versus_group_seats set left_at = coalesce(left_at, v_now), auto = true, auto_since = coalesce(auto_since, v_now)
      where match_id = m.id and seat = p_seat and eliminated_round is null;
    if not found then return m; end if;
    m := public.versus_group__touch(m.id);
    if not exists (select 1 from public.versus_group_seats where match_id = m.id and team = 'a' and left_at is null) then
      return public.versus_ranked_duos__place_team(m, 'a', public.versus_duos__living_teams(m.id), 'left');
    end if;
    return public.versus_ranked_duos__maybe_close(m);
  end if;
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

-- Both teammates silent for 10 minutes (closed the game, never came back): nobody is left to drive the rounds, so the
-- team is placed in the lowest open place and settled (a disconnect must not dodge a loss). Service role: run it on a
-- schedule (pg_cron, every few minutes); a returning player's own reconcile clears auto first, so it never fires on them.
create or replace function public.versus_ranked_duos_sweep_abandoned()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  v_id uuid;
  m public.versus_group_matches;
  v_n int := 0;
begin
  for v_id in select g.id from public.versus_group_matches g
      where g.phase <> 'complete' and coalesce(g.options->>'mode', '') = 'ranked_duos' loop
    -- The match row first (R-VERSUS-LOCK-ORDER-01), then re-check under the lock.
    select * into m from public.versus_group_matches where id = v_id for update;
    continue when m.phase = 'complete';
    continue when exists (
      select 1 from public.versus_group_seats s
      join public.versus_members mm on mm.room_id = m.room_id and mm.user_id = s.user_id
      where s.match_id = m.id and s.team = 'a' and s.left_at is null and mm.last_seen_at >= v_now - interval '10 minutes');
    perform public.versus_ranked_duos__place_team(m, 'a', public.versus_duos__living_teams(m.id), 'abandoned');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- ── 10. Starting a Ranked Duos match from the party room ──────────────────────────────────────────────────────────
-- Copied from 2026-10-25-versus-duos.sql with the Ranked Duos branch: exactly the two seats, team `a` for both, the
-- four team rows, the pair's team identity.
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
  v_team uuid;
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
  if v_mode in ('group', 'duos', 'ranked_duos') then
    select bool_and(case mm2.role when 'p1' then r.p1_gate when 'p2' then r.p2_gate when 'p3' then r.p3_gate else r.p4_gate end)
      into v_all from public.versus_members mm2 where mm2.room_id = p_room and mm2.role <> 'spectator';
    -- Duos needs all four seats (a seat emptied while sealed cannot start a 2v2); Ranked Duos exactly its two.
    if v_mode = 'duos' and (select count(*) from public.versus_members where room_id = p_room and role <> 'spectator') <> 4 then
      v_all := false;
    end if;
    if v_mode = 'ranked_duos' and (select count(*) from public.versus_members where room_id = p_room and role in ('p1', 'p2')) <> 2 then
      v_all := false;
    end if;
    if coalesce(v_all, false) then
      -- Ranked Duos: the pair's team identity, written with the match (no update of fresh rows after the room lock).
      if v_mode = 'ranked_duos' then
        v_team := public.duos__ensure_team(
          (select user_id from public.versus_members where room_id = p_room and role = 'p1'),
          (select user_id from public.versus_members where room_id = p_room and role = 'p2'));
      end if;
      insert into public.versus_group_matches (room_id, seed, set_id, content_revision, protocol, options, phase, seat_count, hero_deadline, ranked_team)
        values (p_room, floor(random() * 2147483647)::bigint, r.set_id, r.content_revision, r.protocol, public.versus__normalize_options(r.options),
                'hero_select', (select count(*) from public.versus_members where room_id = p_room and role <> 'spectator'),
                v_now + interval '20 seconds', v_team)
        returning id into v_match;
      for mm in select * from public.versus_members where room_id = p_room and role <> 'spectator' order by role loop
        insert into public.versus_group_seats (match_id, seat, user_id, name, team)
          values (v_match, mm.role, mm.user_id, mm.display_name, case when v_mode = 'ranked_duos' then 'a' end);
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
      -- Ranked Duos: the pair is team a; b-d are the recorded teams, seated by `seat_ranked_duos`.
      if v_mode = 'ranked_duos' then
        insert into public.versus_group_teams (match_id, team) select v_match, t from unnest(array['a', 'b', 'c', 'd']) t
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

-- ── 10b. The round: input, fights and the commit (needs 2026-10-28-versus-health.sql: the team pools) ─────────────
-- Every fight of a Ranked Duos round. The live team's own fight keeps its full view (`live_result`); every other fight
-- keeps only who met, the outcome and the damage (owner 2026-10-26: "you dont watch other opponents in the lobby mode
-- either"). `ghost`: `b_team` is a fallen team's boards (the bye team's ghost fight).
create table if not exists public.versus_ranked_duos_fights (
  match_id     uuid not null references public.versus_group_matches(id) on delete cascade,
  round        int  not null,
  fight        smallint not null,
  a_team       text not null check (a_team in ('a', 'b', 'c', 'd')),
  b_team       text not null check (b_team in ('a', 'b', 'c', 'd')),
  ghost        boolean not null default false,
  chair        text not null check (chair in ('a', 'b')),
  outcome      text not null check (outcome in ('a', 'b', 'draw')),
  loser        text check (loser is null or loser in ('a', 'b', 'c', 'd')),
  damage       int  not null default 0 check (damage >= 0),
  first        jsonb,
  live_result  jsonb,
  primary key (match_id, round, fight)
);
alter table public.versus_ranked_duos_fights enable row level security;
drop policy if exists "ranked duos fights read" on public.versus_ranked_duos_fights;
create policy "ranked duos fights read" on public.versus_ranked_duos_fights for select to authenticated using (true);
grant select on public.versus_ranked_duos_fights to authenticated;

-- One served member's board for round p_round from its pinned recording: THE ROUND-EXACT RULE (R-LOBBY-SERVE-01 /
-- R-LOBBY-08, the SQL twin of `boardAt` + `recordedSeat.prepare` + the lobby's repeatFinal): its own round; a hole
-- inside the recording = an EMPTY board in the previous recorded round's state; before the recording begins = nothing
-- (an empty tier-1 board); past its end = its FINAL board. A solo run serves a `BoardSnapshot`, a duo member its
-- recorded prepared side as it fought. The first board of a round wins (a re-uploaded duplicate is ignored).
create or replace function public.versus_ranked_duos__member_board(p_rec jsonb, p_round int)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_kind text := p_rec->>'kind';
  v_list jsonb;
  v_key text;
  v_exact jsonb;
  v_prev jsonb;
  v_lo int;
  v_hi int;
begin
  if v_kind = 'solo' then
    v_list := coalesce(p_rec->'boards', '[]'::jsonb); v_key := 'wave';
  elsif v_kind = 'duo' then
    v_list := coalesce(p_rec->'rounds', '[]'::jsonb); v_key := 'round';
  else
    return jsonb_build_object('form', 'none', 'board', null);
  end if;
  if jsonb_typeof(v_list) <> 'array' then return jsonb_build_object('form', 'none', 'board', null); end if;
  select min((x.e->>v_key)::int), max((x.e->>v_key)::int) into v_lo, v_hi from jsonb_array_elements(v_list) x(e);
  if v_hi is null or p_round < v_lo then return jsonb_build_object('form', 'none', 'board', null); end if;
  select x.e into v_exact from jsonb_array_elements(v_list) with ordinality x(e, i)
    where (x.e->>v_key)::int = least(p_round, v_hi) order by x.i limit 1;
  if p_round <= v_hi and v_exact is not null or p_round > v_hi then
    -- Its own round, or past its end: the final board as it stood.
    if v_kind = 'solo' then return jsonb_build_object('form', 'snapshot', 'board', v_exact); end if;
    return jsonb_build_object('form', case when v_exact->'side' is null or v_exact->'side' = 'null'::jsonb then 'none' else 'side' end, 'board', v_exact->'side');
  end if;
  -- A hole: the previous recorded round's state, nothing on board.
  select x.e into v_prev from jsonb_array_elements(v_list) with ordinality x(e, i)
    where (x.e->>v_key)::int < p_round order by (x.e->>v_key)::int desc, x.i limit 1;
  if v_kind = 'solo' then
    return jsonb_build_object('form', 'snapshot', 'board', (v_prev - 'id') || '{"minions": [], "power": 0, "tribes": []}'::jsonb);
  end if;
  if v_prev->'side' is null or v_prev->'side' = 'null'::jsonb then return jsonb_build_object('form', 'none', 'board', null); end if;
  return jsonb_build_object('form', 'side', 'board', jsonb_set(v_prev->'side', '{board}', '[]'::jsonb));
end;
$$;

-- Everything one round needs, in ONE read (service role: `finalize_ranked_duos`). Only the boards this round fights
-- with leave the database: each recorded member's board for the round (a fallen team: for the round it fell), the live
-- pair's final sides, every team's pools and the meetings so far.
create or replace function public.versus_ranked_duos_round_input(p_match uuid, p_round int)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  m public.versus_group_matches;
  t record;
  v_at int;
  v_order jsonb;
  v_teams jsonb := '[]'::jsonb;
begin
  select * into m from public.versus_group_matches where id = p_match;
  if not found then return null; end if;
  for t in select * from public.versus_group_teams where match_id = p_match order by team loop
    v_at := case when t.eliminated_round is not null and t.eliminated_round < p_round then t.eliminated_round else p_round end;
    v_order := t.recorded_order;
    v_teams := v_teams || jsonb_build_object(
      'team', t.team,
      'kind', case when t.team = 'a' then 'live' else coalesce(t.served_kind, 'generated') end,
      'health', t.health, 'armor', t.armor, 'eliminatedRound', t.eliminated_round, 'at', v_at,
      'heroes', case when t.team = 'a'
        then (select coalesce(jsonb_agg(s.hero order by s.seat), '[]'::jsonb) from public.versus_group_seats s where s.match_id = p_match and s.seat in ('p1', 'p2'))
        else (select coalesce(jsonb_agg(v.hero order by v.member), '[]'::jsonb) from public.versus_ranked_duos_served v where v.match_id = p_match and v.team = t.team) end,
      -- A duo run's recorded order for the round served (past its end: its last recorded round's order).
      'recordedFirst', case when jsonb_typeof(v_order) = 'object' then coalesce(
          (v_order->>(v_at::text))::int,
          (select (v_order->>k)::int from jsonb_object_keys(v_order) k order by k::int desc limit 1)) end,
      'members', case when t.team = 'a' then '[]'::jsonb else (select coalesce(jsonb_agg(
          jsonb_build_object('member', v.member, 'kind', v.kind) || public.versus_ranked_duos__member_board(v.recording, v_at)
          order by v.member), '[]'::jsonb)
        from public.versus_ranked_duos_served v where v.match_id = p_match and v.team = t.team) end);
  end loop;
  return jsonb_build_object(
    'match', jsonb_build_object('id', m.id, 'phase', m.phase, 'round', m.round, 'seed', m.seed, 'content_revision', m.content_revision,
      'options', m.options, 'seated', m.seated_at is not null),
    'teams', v_teams,
    'live', jsonb_build_object(
      'p1', (select jsonb_build_object('side', su.prepared_side, 'source', su.source) from public.versus_group_submissions su
        where su.match_id = p_match and su.round = p_round and su.seat = 'p1' and su.final),
      'p2', (select jsonb_build_object('side', su.prepared_side, 'source', su.source) from public.versus_group_submissions su
        where su.match_id = p_match and su.round = p_round and su.seat = 'p2' and su.final)),
    'history', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('round', f.round, 'a', f.a_team, 'b', f.b_team,
        'bye', case when f.ghost then f.a_team end)) order by f.round, f.fight)
      from public.versus_ranked_duos_fights f where f.match_id = p_match and f.round < p_round), '[]'::jsonb));
end;
$$;

-- THE ROUND COMMIT (service role: `finalize_ranked_duos`, after its simulate()s). Idempotent under the match lock.
-- p_result: { fights: [{ fight, a, b, ghost, chair, outcome, loser, damage, first, liveResult? }], vitals: { team: { health,
-- armor } } (every team still in), placed: [{ team, placement }], liveFirst: 0 | 1 | null }.
create or replace function public.versus_ranked_duos_commit_round(p_match uuid, p_round int, p_result jsonb, p_digest text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  m public.versus_group_matches;
  f jsonb;
  p jsonb;
  t record;
  v_live_place int;
  v_dead jsonb := '[]'::jsonb;
begin
  select * into m from public.versus_group_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  if not public.versus_ranked_duos__is(m) then raise exception 'not_ranked_duos'; end if;
  if exists (select 1 from public.versus_group_rounds where match_id = p_match and round = p_round) then
    return jsonb_build_object('alreadyCommitted', true, 'match', public.versus_ranked_duos__json(m));
  end if;
  if m.phase <> 'resolving' or m.round <> p_round then raise exception 'not_resolving'; end if;
  if p_result is null or jsonb_typeof(p_result->'fights') <> 'array' or jsonb_typeof(p_result->'vitals') <> 'object'
     or jsonb_typeof(p_result->'placed') <> 'array' then
    raise exception 'bad_result';
  end if;
  for f in select * from jsonb_array_elements(p_result->'fights') loop
    if f->>'a' not in ('a', 'b', 'c', 'd') or f->>'b' not in ('a', 'b', 'c', 'd') or f->>'a' = f->>'b'
       or f->>'outcome' not in ('a', 'b', 'draw') or f->>'chair' not in ('a', 'b')
       or (f ? 'loser' and f->>'loser' is not null and f->>'loser' not in (f->>'a', f->>'b'))
       or coalesce((f->>'damage')::int, -1) < 0 then
      raise exception 'bad_fight';
    end if;
    insert into public.versus_ranked_duos_fights (match_id, round, fight, a_team, b_team, ghost, chair, outcome, loser, damage, first, live_result)
      values (p_match, p_round, (f->>'fight')::int, f->>'a', f->>'b', coalesce((f->>'ghost')::boolean, false), f->>'chair', f->>'outcome',
        f->>'loser', (f->>'damage')::int, f->'first',
        case when 'a' in (f->>'a', f->>'b') then f->'liveResult' end);
  end loop;
  -- Every team still in carries its pool after the round.
  for t in select team from public.versus_group_teams where match_id = p_match and eliminated_round is null loop
    update public.versus_group_teams set health = public.versus__vital(p_result->'vitals'->t.team, 'health'),
      armor = public.versus__vital(p_result->'vitals'->t.team, 'armor')
      where match_id = p_match and team = t.team;
  end loop;
  update public.versus_group_seats s set health = tt.health, armor = tt.armor
    from public.versus_group_teams tt where s.match_id = p_match and tt.match_id = p_match and tt.team = 'a' and s.team = 'a';
  -- Placements: a recorded team is simply out (or 1st); the live team goes through place_team (after the round row).
  for p in select * from jsonb_array_elements(p_result->'placed') loop
    if p->>'team' not in ('a', 'b', 'c', 'd') or (p->>'placement')::int not between 1 and 4 then raise exception 'bad_placement'; end if;
    if p->>'team' = 'a' then
      v_live_place := (p->>'placement')::int;
    else
      update public.versus_group_teams set placement = (p->>'placement')::int,
        eliminated_round = case when (p->>'placement')::int = 1 then eliminated_round else p_round end,
        out_reason = case when (p->>'placement')::int = 1 then out_reason else 'hearts' end
        where match_id = p_match and team = p->>'team' and placement is null;
    end if;
    if (p->>'placement')::int > 1 then v_dead := v_dead || to_jsonb(p->>'team'); end if;
  end loop;
  insert into public.versus_group_rounds (match_id, round, digest, hearts, vitals, eliminated, first)
    values (p_match, p_round, p_digest, null, p_result->'vitals', v_dead,
      case when p_result->>'liveFirst' in ('0', '1') then jsonb_build_object('a', 'p' || ((p_result->>'liveFirst')::int + 1)::text) end);
  update public.versus_group_seats set ready = false where match_id = p_match;
  update public.versus_group_matches set phase = 'combat', combat_deadline = v_now + interval '90 seconds',
    revision = revision + 1, updated_at = v_now
    where id = p_match returning * into m;
  if v_live_place is null and not exists (select 1 from public.versus_group_teams where match_id = p_match and team <> 'a' and eliminated_round is null) then
    v_live_place := 1; -- every recorded team is out: the live team wins
  end if;
  if v_live_place is not null then
    m := public.versus_ranked_duos__place_team(m, 'a', v_live_place, 'hearts');
  end if;
  return jsonb_build_object('alreadyCommitted', false, 'match', public.versus_ranked_duos__json(m));
end;
$$;

-- ── 11. Grants ────────────────────────────────────────────────────────────────────────────────────────────────────
-- Internal helpers: no client may call them.
revoke all on function public.versus_ranked_duos__is(public.versus_group_matches) from public, anon, authenticated;
revoke all on function public.duos__ensure_team(uuid, uuid) from public, anon, authenticated;
grant execute on function public.duos__ensure_team(uuid, uuid) to service_role;
revoke all on function public.settle_duos_rank(uuid, uuid, int) from public, anon, authenticated;
revoke all on function public.versus_ranked_duos__record_run(public.versus_group_matches, int) from public, anon, authenticated;
revoke all on function public.versus_ranked_duos__place_team(public.versus_group_matches, text, int, text) from public, anon, authenticated;
revoke all on function public.versus_ranked_duos__close_at(public.versus_group_matches) from public, anon, authenticated;
revoke all on function public.versus_ranked_duos__maybe_close(public.versus_group_matches) from public, anon, authenticated;
revoke all on function public.versus_ranked_duos__json(public.versus_group_matches) from public, anon, authenticated;
revoke all on function public.duo_runs_sample(int, text, text) from public, anon, authenticated;
revoke all on function public.versus_ranked_duos_seat(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.versus_ranked_duos_sweep_abandoned() from public, anon, authenticated;
grant execute on function public.versus_ranked_duos_sweep_abandoned() to service_role;
grant execute on function public.settle_duos_rank(uuid, uuid, int) to service_role;
grant execute on function public.duo_runs_sample(int, text, text) to service_role;
grant execute on function public.versus_ranked_duos_seat(uuid, jsonb) to service_role;
-- Client RPCs.
grant execute on function public.duos_team_set_name(uuid, text) to authenticated;
grant execute on function public.versus_ranked_duos_submit(uuid, int, int, jsonb, boolean, jsonb, jsonb) to authenticated;
grant execute on function public.versus_ranked_duos_reconcile(uuid) to authenticated;
revoke all on function public.versus_ranked_duos__member_board(jsonb, int) from public, anon, authenticated;
revoke all on function public.versus_ranked_duos_round_input(uuid, int) from public, anon, authenticated;
revoke all on function public.versus_ranked_duos_commit_round(uuid, int, jsonb, text) from public, anon, authenticated;
grant execute on function public.versus_ranked_duos_round_input(uuid, int) to service_role;
grant execute on function public.versus_ranked_duos_commit_round(uuid, int, jsonb, text) to service_role;
