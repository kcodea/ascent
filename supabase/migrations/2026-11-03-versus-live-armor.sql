-- VERSUS: A SHOP ARMOR RAISE REACHES THE SERVER'S POOL THE MOMENT IT IS REPORTED (R-VERSUS-LIVE-ARMOR-01).
--
--   Owner (Versus Group / Duos with friends, 2026-10-27): "i casted mend to get armor but it didn't show to the other
--   players."
--
-- Mend ("Set your Armor to 5") is the one shop effect that raises a Versus pool. Until now the server only learned of
-- it when the round CLOSED: the resolver (`versusVitalsBefore`, packages/sim/src/versus/vitals.ts) raised the stored
-- Armor from the locked side's pool report for that fight. So nobody else's rail could show it during the shop, and in
-- Duos the teammate's own Health box never did.
--
-- Now every side a seat sends for the CURRENT round (a candidate, a lock, a re-lock, a deadline promotion; never an
-- auto-played old board) applies the SAME bounded rule to the stored pool at once: a reported Armor above the stored
-- Armor raises it, but never past the content's highest Armor floor (Mend: 5) and never above a stored Armor already
-- at or past that floor; Health is never raised. Because it is the resolver's own rule, the fight's result is
-- unchanged (the resolver still applies the report; raising an already-raised pool is a no-op). The match row's
-- revision is bumped only when a pool actually moved, so every client re-reads the row and shows it (no extra reads
-- otherwise). 1v1: `versus_matches.pN_armor`. Group: the seat. Duos / Ranked Duos: the TEAM's pool and both its seats.
--
-- A pool not stored yet (NULL: before round 1 commits) is left alone: the hero's start lives only in the client and
-- the resolver, and the report is still honoured when the round closes, exactly as before.
--
-- `versus__armor_floor_max()` MUST equal `versusArmorFloorMax()` (a test pins it). Trigger-only: no RPC signature
-- changes, so no `versus-resolve` redeploy is needed. Idempotent (create or replace / drop trigger if exists).

create or replace function public.versus__armor_floor_max()
returns int
language sql
immutable
as $$ select 5 $$;

-- The whole-number Armor a stored side reports (`prepared_side.vitals.armor`), or NULL when it carries none.
create or replace function public.versus__reported_armor(p_side jsonb)
returns int
language plpgsql
immutable
as $$
begin
  if p_side is null or jsonb_typeof(p_side->'vitals') <> 'object' or jsonb_typeof(p_side->'vitals'->'armor') <> 'number' then return null; end if;
  return greatest(0, floor((p_side->'vitals'->>'armor')::numeric))::int;
exception when others then
  return null;
end;
$$;

-- 1v1.
create or replace function public.versus__raise_reported_armor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rep int := public.versus__reported_armor(NEW.prepared_side);
  v_floor int := public.versus__armor_floor_max();
begin
  if v_rep is null or NEW.source not in ('candidate', 'lock', 'deadline') then return null; end if;
  if NEW.seat = 'p1' then
    update public.versus_matches set p1_armor = least(v_rep, v_floor), revision = revision + 1, updated_at = public.versus_clock()
      where id = NEW.match_id and round = NEW.round and phase in ('shop', 'resolving')
        and p1_health is not null and p1_armor is not null and p1_armor < v_floor and v_rep > p1_armor;
  elsif NEW.seat = 'p2' then
    update public.versus_matches set p2_armor = least(v_rep, v_floor), revision = revision + 1, updated_at = public.versus_clock()
      where id = NEW.match_id and round = NEW.round and phase in ('shop', 'resolving')
        and p2_health is not null and p2_armor is not null and p2_armor < v_floor and v_rep > p2_armor;
  end if;
  return null;
end;
$$;

drop trigger if exists versus_submissions_raise_armor on public.versus_submissions;
create trigger versus_submissions_raise_armor
  after insert or update of prepared_side, source on public.versus_submissions
  for each row execute function public.versus__raise_reported_armor();

-- Group / Duos / Ranked Duos.
create or replace function public.versus_group__raise_reported_armor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rep int := public.versus__reported_armor(NEW.prepared_side);
  v_floor int := public.versus__armor_floor_max();
  m public.versus_group_matches;
  v_team text;
  v_moved int := 0;
begin
  if v_rep is null or NEW.source not in ('candidate', 'lock', 'deadline') then return null; end if;
  select * into m from public.versus_group_matches where id = NEW.match_id;
  if not found or m.round <> NEW.round or m.phase not in ('shop', 'resolving') then return null; end if;
  if public.versus_duos__is(m) then
    -- The TEAM's shared pool (R-DUOS-HEALTH-01); each seat mirrors it.
    v_team := public.versus_duos__team(NEW.seat);
    update public.versus_group_teams set armor = least(v_rep, v_floor)
      where match_id = NEW.match_id and team = v_team and eliminated_round is null
        and health is not null and armor is not null and armor < v_floor and v_rep > armor;
    get diagnostics v_moved = row_count;
    if v_moved > 0 then
      update public.versus_group_seats s set armor = t.armor
        from public.versus_group_teams t
        where s.match_id = NEW.match_id and t.match_id = NEW.match_id and t.team = v_team and s.team = v_team;
    end if;
  else
    update public.versus_group_seats set armor = least(v_rep, v_floor)
      where match_id = NEW.match_id and seat = NEW.seat and eliminated_round is null
        and health is not null and armor is not null and armor < v_floor and v_rep > armor;
    get diagnostics v_moved = row_count;
  end if;
  if v_moved > 0 then
    update public.versus_group_matches set revision = revision + 1, updated_at = public.versus_clock() where id = NEW.match_id;
  end if;
  return null;
end;
$$;

drop trigger if exists versus_group_submissions_raise_armor on public.versus_group_submissions;
create trigger versus_group_submissions_raise_armor
  after insert or update of prepared_side, source on public.versus_group_submissions
  for each row execute function public.versus_group__raise_reported_armor();

revoke all on function public.versus__armor_floor_max() from public, anon, authenticated;
revoke all on function public.versus__reported_armor(jsonb) from public, anon, authenticated;
revoke all on function public.versus__raise_reported_armor() from public, anon, authenticated;
revoke all on function public.versus_group__raise_reported_armor() from public, anon, authenticated;
