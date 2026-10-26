-- VERSUS HEALTH AND ARMOR (owner 2026-10-26, R-VERSUS-HEALTH-01, R-DUOS-HEALTH-01, R-VERSUS-SUMMIT-01).
--
--   "I want to move the normal lobby mode health/damage system to versus so the experience is the same."
--   "The duo gets 30 hp plus the sum of both armors."
--
-- Hearts are gone from every Versus mode (1v1, the 3-4 player group, Duos). Each player (Duos: each TEAM) plays on
-- Health + Armor exactly like a lobby seat: it starts on its hero's own Health and Armor (Duos: 30 Health + both heroes'
-- Armor; Summit adds +10 Armor per hero again), a lost fight costs the lobby's damage formula round-capped by the lobby's
-- cap, Armor absorbs first, a draw costs nobody, and 0 Health is out.
--
-- THE ARITHMETIC IS THE RESOLVER'S. `versus-resolve` (`finalize` / `finalize_group` / `finalize_duos`, built from
-- `packages/sim/src/versus/vitals.ts`) reads each seat's (team's) stored pools (NULL = not started: its hero's start),
-- runs the one `simulate()`, charges the loser and passes every pool AFTER the round to the commit as `p_vitals`. The
-- commits below validate the numbers, store them under the row lock (idempotent as before) and apply the knockouts.
--
-- THE HEARTS COLUMNS STAY, readable, for the matches already played: `versus_matches.p1_hearts`, `versus_rounds.p*_hearts`,
-- `versus_group_seats.hearts`, `versus_group_teams.hearts`, `versus_group_rounds.hearts`. New rounds leave the round
-- tables' hearts NULL (their NOT NULL is dropped) and write the new columns; the seat / team / match hearts keep their
-- default and are simply no longer moved. The knockout reason keeps its id 'hearts' (end_reason / out_reason): it now
-- reads "knocked out in a fight" (the XP and record SQL key on it), never a heart count.
--
-- The resolver's commit signatures change (a `p_vitals` argument, `p_loser` in place of `p_heart_lost_by`), so the old
-- ones are dropped: APPLY THIS, THEN REDEPLOY `versus-resolve` AT ONCE (`npm run versus:bundle` + deploy). The client
-- protocol moves to 2 with it, so a room made by an older client is never joined by a newer one.
--
-- Also: `versus_dev_set_hearts` becomes `versus_dev_set_vitals` (the dev tuner's "Set Health / Armor").

-- ── 1. Columns ────────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.versus_matches add column if not exists p1_health int check (p1_health is null or p1_health between 0 and 999);
alter table public.versus_matches add column if not exists p1_armor  int check (p1_armor  is null or p1_armor  between 0 and 999);
alter table public.versus_matches add column if not exists p2_health int check (p2_health is null or p2_health between 0 and 999);
alter table public.versus_matches add column if not exists p2_armor  int check (p2_armor  is null or p2_armor  between 0 and 999);

alter table public.versus_rounds alter column p1_hearts drop not null;
alter table public.versus_rounds alter column p2_hearts drop not null;
alter table public.versus_rounds add column if not exists p1_health int;
alter table public.versus_rounds add column if not exists p1_armor  int;
alter table public.versus_rounds add column if not exists p2_health int;
alter table public.versus_rounds add column if not exists p2_armor  int;
alter table public.versus_rounds add column if not exists p1_damage int;
alter table public.versus_rounds add column if not exists p2_damage int;

alter table public.versus_group_seats add column if not exists health int check (health is null or health between 0 and 999);
alter table public.versus_group_seats add column if not exists armor  int check (armor  is null or armor  between 0 and 999);
-- (Guarded: the Duos table exists on the live project; a partial chain, as some PGlite suites load, may not have it.)
do $$
begin
  if to_regclass('public.versus_group_teams') is not null then
    alter table public.versus_group_teams add column if not exists health int check (health is null or health between 0 and 999);
    alter table public.versus_group_teams add column if not exists armor  int check (armor  is null or armor  between 0 and 999);
  end if;
end;
$$;

alter table public.versus_group_rounds alter column hearts drop not null;
-- Every seat's pools after the round: { "p1": { "health": 24, "armor": 0 }, ... } (Duos: each seat carries its team's).
alter table public.versus_group_rounds add column if not exists vitals jsonb;
-- The damage the fight's loser took (heart_lost_by now names that seat; NULL on a draw or a copy / ghost loss).
alter table public.versus_group_fights add column if not exists damage int;

-- ── 2. Helpers ────────────────────────────────────────────────────────────────────────────────────────────────────
-- One pool from the resolver's `p_vitals` entry, validated: { health, armor, damage, before } (whole numbers, sane).
create or replace function public.versus__vital(p jsonb, p_key text)
returns int
language plpgsql
immutable
as $$
declare
  v int;
begin
  if p is null or jsonb_typeof(p) <> 'object' or jsonb_typeof(p->p_key) <> 'number' then raise exception 'bad_vitals'; end if;
  v := (p->>p_key)::numeric::int;
  if v < 0 or v > 999 or (p->>p_key)::numeric <> v then raise exception 'bad_vitals'; end if;
  return v;
end;
$$;

-- ── 3. The 1v1 commit ─────────────────────────────────────────────────────────────────────────────────────────────
drop function if exists public.versus_commit_round(uuid, int, text, text, text, jsonb, jsonb, text);

-- THE ROUND COMMIT. Service role only (the `versus-resolve` Edge Function, after its one `simulate()`).
-- Idempotent: a second commit for the same round returns the stored row and changes nothing.
-- `p_vitals`: { p1: { health, armor, damage, before }, p2: { ... } } (each seat's pools AFTER the round).
create or replace function public.versus_commit_round(
  p_match uuid, p_round int, p_chair text, p_outcome text, p_loser text, p_p1 jsonb, p_p2 jsonb, p_digest text, p_vitals jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  m public.versus_matches;
  v_h1 int; v_a1 int; v_d1 int;
  v_h2 int; v_a2 int; v_d2 int;
begin
  select * into m from public.versus_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  if exists (select 1 from public.versus_rounds where match_id = p_match and round = p_round) then
    return jsonb_build_object('alreadyCommitted', true, 'match', public.versus__match_json(m));
  end if;
  if m.phase <> 'resolving' or m.round <> p_round then raise exception 'not_resolving'; end if;
  if p_outcome not in ('p1', 'p2', 'draw') then raise exception 'bad_outcome'; end if;
  if (p_outcome = 'draw') <> (p_loser is null) or (p_outcome = 'p1' and p_loser <> 'p2') or (p_outcome = 'p2' and p_loser <> 'p1') then
    raise exception 'bad_outcome';
  end if;
  v_h1 := public.versus__vital(p_vitals->'p1', 'health'); v_a1 := public.versus__vital(p_vitals->'p1', 'armor'); v_d1 := public.versus__vital(p_vitals->'p1', 'damage');
  v_h2 := public.versus__vital(p_vitals->'p2', 'health'); v_a2 := public.versus__vital(p_vitals->'p2', 'armor'); v_d2 := public.versus__vital(p_vitals->'p2', 'damage');
  -- Only the loser takes damage; a draw costs nobody.
  if (v_d1 > 0 and p_loser is distinct from 'p1') or (v_d2 > 0 and p_loser is distinct from 'p2') then raise exception 'bad_vitals'; end if;
  insert into public.versus_rounds (match_id, round, chair, outcome, heart_lost_by, p1_result, p2_result, digest,
      p1_hearts, p2_hearts, p1_health, p1_armor, p2_health, p2_armor, p1_damage, p2_damage)
    values (p_match, p_round, p_chair, p_outcome, p_loser, p_p1, p_p2, p_digest,
      null, null, v_h1, v_a1, v_h2, v_a2, v_d1, v_d2);
  update public.versus_matches set p1_health = v_h1, p1_armor = v_a1, p2_health = v_h2, p2_armor = v_a2,
    p1_missed = case when p1_auto then p1_missed + 1 else 0 end,
    p2_missed = case when p2_auto then p2_missed + 1 else 0 end,
    phase = 'combat', combat_deadline = v_now + interval '90 seconds', p1_ready = false, p2_ready = false,
    revision = revision + 1, updated_at = v_now
    where id = p_match returning * into m;
  -- Health 0 is out ('hearts' is the knockout reason's legacy id: "knocked out in a fight").
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

-- ── 4. The group: the seats' pools in the match json, and the commit ─────────────────────────────────────────────
create or replace function public.versus_group__match_json(m public.versus_group_matches)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(m) || jsonb_build_object(
    'seats', coalesce((select jsonb_agg(jsonb_build_object(
        'seat', s.seat, 'userId', s.user_id, 'name', s.name, 'hearts', s.hearts, 'health', s.health, 'armor', s.armor,
        'hero', s.hero, 'locked', s.locked,
        'ready', s.ready, 'intro', s.intro, 'auto', s.auto, 'missed', s.missed, 'eliminatedRound', s.eliminated_round,
        'outReason', s.out_reason, 'placement', s.placement) order by s.seat)
      from public.versus_group_seats s where s.match_id = m.id), '[]'::jsonb),
    'serverNow', public.versus_clock());
$$;

drop function if exists public.versus_group_commit_round(uuid, int, jsonb, text);

-- THE ROUND COMMIT. Service role only (the `versus-resolve` Edge Function's `finalize_group`, after its simulate()s).
-- Idempotent: a second commit for the same round returns the stored state and changes nothing.
-- `p_fights`: [{ fight, a, b, copy, chair, outcome, loser, damage, aResult, bResult }, ...].
-- `p_vitals`: { <seat still in>: { health, armor, damage, before }, ... } (each pool AFTER the round; `before` = Health +
-- Armor going in, the wipeout tiebreak).
create or replace function public.versus_group_commit_round(p_match uuid, p_round int, p_fights jsonb, p_digest text, p_vitals jsonb)
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
  v_l text;
  v_copy boolean;
  v_dmg int;
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
  if p_vitals is null or jsonb_typeof(p_vitals) <> 'object' then raise exception 'bad_vitals'; end if;
  -- Every seat still in carries its pools; nobody else does.
  if exists (select 1 from public.versus_group_seats where match_id = p_match and eliminated_round is null and not (p_vitals ? seat))
     or exists (select 1 from jsonb_object_keys(p_vitals) k where not exists (
       select 1 from public.versus_group_seats where match_id = p_match and seat = k and eliminated_round is null)) then
    raise exception 'bad_vitals';
  end if;

  for f in select value from jsonb_array_elements(p_fights) loop
    v_a := f->>'a'; v_b := f->>'b'; v_l := f->>'loser'; v_copy := coalesce((f->>'copy')::boolean, false);
    v_dmg := coalesce((f->>'damage')::int, 0);
    if not exists (select 1 from public.versus_group_seats where match_id = p_match and seat = v_a)
       or not exists (select 1 from public.versus_group_seats where match_id = p_match and seat = v_b)
       or v_a = v_b or f->>'outcome' not in ('a', 'b', 'draw') or f->>'chair' not in ('a', 'b') or v_dmg < 0 then
      raise exception 'bad_fights';
    end if;
    if v_l is not null and (v_l not in (v_a, v_b) or (v_copy and v_l = v_b) or v_l = any (v_hit)
        or (f->>'outcome' = 'draw') or (f->>'outcome' = 'a' and v_l <> v_b) or (f->>'outcome' = 'b' and v_l <> v_a)) then
      raise exception 'bad_fights';
    end if;
    if v_l is null and v_dmg <> 0 then raise exception 'bad_fights'; end if;
    -- The loser's charged damage must be the one its pools record.
    if v_l is not null and p_vitals ? v_l and public.versus__vital(p_vitals->v_l, 'damage') <> v_dmg then raise exception 'bad_vitals'; end if;
    insert into public.versus_group_fights (match_id, round, fight, a_seat, b_seat, b_copy, chair, outcome, heart_lost_by, damage, a_result, b_result, a_scout, b_scout)
      values (p_match, p_round, (f->>'fight')::smallint, v_a, v_b, v_copy, f->>'chair', f->>'outcome', v_l, v_dmg, f->'aResult', f->'bResult',
        (select coalesce(su.scout, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('tier', su.prepared_side -> 'state' -> 'tier'))
           from public.versus_group_submissions su where su.match_id = p_match and su.round = p_round and su.seat = v_a),
        (select coalesce(su.scout, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('tier', su.prepared_side -> 'state' -> 'tier'))
           from public.versus_group_submissions su where su.match_id = p_match and su.round = p_round and su.seat = v_b));
    if v_l is not null then v_hit := array_append(v_hit, v_l); end if;
  end loop;

  -- Every seat still in lands on its pools after the round (a copy and a ghost are never charged).
  update public.versus_group_seats gs set
      health = public.versus__vital(p_vitals->gs.seat, 'health'),
      armor = public.versus__vital(p_vitals->gs.seat, 'armor')
    where gs.match_id = p_match and gs.eliminated_round is null;

  -- Health 0: out TOGETHER, sharing a placement (the lobby's rule for simultaneous knockouts). Ordered by Health +
  -- Armor going INTO the round, then seat: the lobby's wipeout tiebreak.
  select coalesce(array_agg(seat order by public.versus__vital(p_vitals->seat, 'before') desc, seat), '{}') into v_dead
    from public.versus_group_seats
    where match_id = p_match and eliminated_round is null and health <= 0;
  v_living := public.versus_group__living(p_match);
  if cardinality(v_dead) > 0 and cardinality(v_dead) >= v_living then
    -- WIPEOUT GUARD (the lobby's): never a round with nobody standing. The healthiest going in survives the round, and
    -- so wins the match.
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

  insert into public.versus_group_rounds (match_id, round, digest, hearts, vitals, eliminated)
    values (p_match, p_round, p_digest, null,
      (select jsonb_object_agg(seat, jsonb_build_object('health', health, 'armor', armor)) from public.versus_group_seats
        where match_id = p_match and health is not null),
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

-- ── 5. Duos: the team's shared pool ───────────────────────────────────────────────────────────────────────────────
drop function if exists public.versus_duos_commit_round(uuid, int, jsonb, text);

-- The round's ONE tag-team fight, committed by `versus-resolve` (`finalize_duos`) as the service role. Idempotent.
--   p_fight:  { a, b (each team's FIRST seat), chair ('a' | 'b'), outcome ('a' | 'b' | 'draw'), losingTeam, damage,
--               aResult (team A's view), bResult (team B's view) }
--   p_vitals: { a: { health, armor, damage, before }, b: { ... } } (each team's shared pool AFTER the round)
create or replace function public.versus_duos_commit_round(p_match uuid, p_round int, p_fight jsonb, p_digest text, p_vitals jsonb)
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
  v_dmg int := coalesce((p_fight->>'damage')::int, 0);
  v_dead text[] := '{}';
  v_winner text;
  v_reason text := 'hearts';
  v_team text;
  t record;
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
     or v_dmg < 0 or (v_outcome = 'draw' and v_dmg <> 0) then
    raise exception 'bad_fight';
  end if;
  if p_vitals is null or jsonb_typeof(p_vitals) <> 'object' then raise exception 'bad_vitals'; end if;
  -- Every team still in carries its pool; the losing team's charged damage is the fight's.
  for t in select team from public.versus_group_teams where match_id = p_match and eliminated_round is null loop
    perform public.versus__vital(p_vitals->t.team, 'health');
    if public.versus__vital(p_vitals->t.team, 'damage') <> (case when t.team = v_lose then v_dmg else 0 end) then raise exception 'bad_vitals'; end if;
  end loop;
  insert into public.versus_group_fights (match_id, round, fight, a_seat, b_seat, b_copy, chair, outcome, heart_lost_by, damage, a_result, b_result, a_scout, b_scout)
    values (p_match, p_round, 0, v_a, v_b, false, p_fight->>'chair', v_outcome,
      case v_lose when 'a' then v_a when 'b' then v_b end, case when v_lose is null then 0 else v_dmg end, p_fight->'aResult', p_fight->'bResult',
      (select coalesce(su.scout, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('tier', su.prepared_side -> 'state' -> 'tier'))
         from public.versus_group_submissions su where su.match_id = p_match and su.round = p_round and su.seat = v_a),
      (select coalesce(su.scout, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('tier', su.prepared_side -> 'state' -> 'tier'))
         from public.versus_group_submissions su where su.match_id = p_match and su.round = p_round and su.seat = v_b));

  -- TEAM pools (the team's own row; each seat mirrors it). A team at 0 Health is out together, placed by how many teams
  -- were still in (2nd of 2); the last team in is 1st.
  update public.versus_group_teams tt set
      health = public.versus__vital(p_vitals->tt.team, 'health'),
      armor = public.versus__vital(p_vitals->tt.team, 'armor')
    where tt.match_id = p_match and tt.eliminated_round is null;
  if v_lose is not null and exists (select 1 from public.versus_group_teams where match_id = p_match and team = v_lose and health <= 0 and eliminated_round is null) then
    update public.versus_group_teams set eliminated_round = p_round, out_reason = 'hearts', placement = public.versus_duos__living_teams(p_match)
      where match_id = p_match and team = v_lose;
    v_dead := public.versus_duos__seats(v_lose);
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

  -- Every seat mirrors its team (the pool, and when out: the round, why and the placement).
  update public.versus_group_seats s set health = t2.health, armor = t2.armor,
    eliminated_round = coalesce(s.eliminated_round, t2.eliminated_round),
    out_reason = case when s.eliminated_round is null and t2.eliminated_round is not null
      then case when t2.out_reason = 'missed' and s.missed < 3 then 'forfeit' else t2.out_reason end else s.out_reason end,
    auto = case when t2.eliminated_round is not null then false else s.auto end,
    placement = coalesce(t2.placement, s.placement)
    from public.versus_group_teams t2 where s.match_id = p_match and t2.match_id = p_match and t2.team = s.team;

  insert into public.versus_group_rounds (match_id, round, digest, hearts, vitals, eliminated)
    values (p_match, p_round, p_digest, null,
      (select jsonb_object_agg(seat, jsonb_build_object('health', health, 'armor', armor)) from public.versus_group_seats
        where match_id = p_match and health is not null),
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

-- ── 6. Dev: set a living seat's Health and Armor (Duos: its TEAM's pool) ───────────────────────────────────────────
drop function if exists public.versus_dev_set_hearts(uuid, text, int);

create or replace function public.versus_dev_set_vitals(p_match uuid, p_seat text, p_health int, p_armor int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.versus_group_matches;
  v_now timestamptz := public.versus_clock();
begin
  m := public.versus_dev__gate(p_match);
  if m.phase = 'complete' then raise exception 'match_over'; end if;
  if p_health is null or p_health < 1 or p_health > 999 or p_armor is null or p_armor < 0 or p_armor > 999 then raise exception 'bad_vitals'; end if;
  if not exists (select 1 from public.versus_group_seats where match_id = m.id and seat = p_seat and eliminated_round is null) then
    raise exception 'bad_seat';
  end if;
  if public.versus_duos__is(m) then
    update public.versus_group_teams set health = p_health, armor = p_armor where match_id = m.id and team = public.versus_duos__team(p_seat);
    update public.versus_group_seats set health = p_health, armor = p_armor where match_id = m.id and team = public.versus_duos__team(p_seat);
  else
    update public.versus_group_seats set health = p_health, armor = p_armor where match_id = m.id and seat = p_seat;
  end if;
  update public.versus_group_matches set revision = revision + 1, updated_at = v_now where id = m.id returning * into m;
  return public.versus_group__match_json(m);
end;
$$;

-- ── 7. Grants ─────────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function public.versus__vital(jsonb, text) from public, anon, authenticated;
revoke all on function public.versus_commit_round(uuid, int, text, text, text, jsonb, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.versus_commit_round(uuid, int, text, text, text, jsonb, jsonb, text, jsonb) to service_role;
revoke all on function public.versus_group__match_json(public.versus_group_matches) from public, anon, authenticated;
revoke all on function public.versus_group_commit_round(uuid, int, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.versus_group_commit_round(uuid, int, jsonb, text, jsonb) to service_role;
revoke all on function public.versus_duos_commit_round(uuid, int, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.versus_duos_commit_round(uuid, int, jsonb, text, jsonb) to service_role;
revoke all on function public.versus_dev_set_vitals(uuid, text, int, int) from public;
grant execute on function public.versus_dev_set_vitals(uuid, text, int, int) to authenticated;
