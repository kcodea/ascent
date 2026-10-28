-- RANKED DUOS: the party is its own place, apart from Versus (owner 2026-10-27: "lobby/versus modes need to stay
-- separate from ranked modes ... separate them so they arent included in each others menus"; R-RANKED-DUOS-SPLIT-01).
-- APPLY AFTER 2026-11-01-ranked-duos-party.sql. Idempotent.
--
--  1. `versus_list_rooms(p_area)`: the room browser asks for ONE area. 'versus' (the default, so today's client call
--     with no argument keeps working) lists Versus rooms only; 'duos' lists Ranked Duos parties only. A party never
--     reaches the Versus browser, even from an old client.
--  2. `versus_set_options` refuses to move a room across the line: a Versus room never becomes a Ranked Duos party, and
--     a party never becomes a Versus room (`bad_mode`). Within each side it is unchanged.
--
-- RATING (checked, no change needed): only a STARTED Ranked Duos match can settle a team's rating. `settle_duos_rank` is
-- called only by `versus_ranked_duos__place_team`, which needs a `versus_group_matches` row, and that row is created only
-- by `versus_press_gate` once both teammates pressed their gate. Leaving the party while it is open or sealed
-- (`versus_leave_room`) finds no match, deletes the member and reopens a sealed room: no placement, no rating, no run.

-- ── 1. The browser lists one area ─────────────────────────────────────────────────────────────────────────────────
drop function if exists public.versus_list_rooms();

create or replace function public.versus_list_rooms(p_area text default 'versus')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  v_me uuid := auth.uid();
  v_duos boolean := coalesce(p_area, 'versus') = 'duos';
begin
  -- THE PRUNE, at most once per 30 s across every caller, never waiting on a lock (SKIP LOCKED throughout).
  perform 1 from public.versus_housekeeping where id = 1 and pruned_at < v_now - interval '30 seconds' for update skip locked;
  if found then
    update public.versus_housekeeping set pruned_at = v_now where id = 1;
    with gone as (
      delete from public.versus_members d where (d.room_id, d.user_id) in (
        select mm.room_id, mm.user_id from public.versus_members mm join public.versus_rooms r on r.id = mm.room_id
          where r.status = 'open' and mm.last_seen_at < v_now - interval '2 minutes'
          for update of mm skip locked)
      returning d.room_id
    )
    update public.versus_rooms u set revision = u.revision + 1, updated_at = v_now
      where u.id in (select r.id from public.versus_rooms r where r.id in (select room_id from gone) for update of r skip locked);
    delete from public.versus_rooms d where d.id in (
      select r.id from public.versus_rooms r where not exists (select 1 from public.versus_members mm where mm.room_id = r.id)
        for update of r skip locked);
  end if;
  return coalesce((select jsonb_agg(j order by j->>'createdAt' desc) from (
    select jsonb_build_object(
      'id', r.id, 'name', r.name, 'status', r.status, 'setId', r.set_id, 'contentRevision', r.content_revision,
      'protocol', r.protocol, 'createdAt', r.created_at, 'currentMatchId', r.current_match_id,
      'hostName', (select display_name from public.versus_members where room_id = r.id and user_id = r.host_user_id),
      'hostProfile', (select profile from public.versus_members where room_id = r.id and user_id = r.host_user_id),
      'players', (select count(*) from public.versus_members where room_id = r.id and role <> 'spectator'),
      'maxPlayers', cardinality(public.versus__mode_roles(r.options->>'mode')),
      'options', public.versus__normalize_options(r.options),
      'spectators', (select count(*) from public.versus_members where room_id = r.id and role = 'spectator'),
      'friendsOnly', r.friends_only
    ) as j from public.versus_rooms r
    where public.versus__room_visible(r, v_me)
      and (coalesce(r.options->>'mode', 'duel') = 'ranked_duos') = v_duos) q), '[]'::jsonb);
end;
$$;

-- ── 2. Options never cross the line ───────────────────────────────────────────────────────────────────────────────
-- 2026-10-24-versus-group.sql's body + the cross-line refusal.
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
  -- A Ranked Duos party and a Versus room are different places: neither turns into the other.
  if ((public.versus__normalize_options(r.options)->>'mode') = 'ranked_duos') <> ((v_new->>'mode') = 'ranked_duos') then
    raise exception 'bad_mode';
  end if;
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

-- ── Grants ────────────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function public.versus_list_rooms(text) from public, anon;
grant execute on function public.versus_list_rooms(text) to authenticated;
revoke all on function public.versus_set_options(uuid, jsonb) from public, anon;
grant execute on function public.versus_set_options(uuid, jsonb) to authenticated;
