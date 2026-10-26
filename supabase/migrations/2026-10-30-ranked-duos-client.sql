-- RANKED DUOS, phase 2: what the client reads (owner design 2026-10-26; docs/design/2026-10-26-ranked-duos.md).
-- APPLY AFTER 2026-10-29-ranked-duos.sql. Idempotent. Redeploy `versus-resolve` with this phase too (the live team's
-- fight now carries every board and the order by seat, the Versus Duos shape the client plays).
--
-- `versus_ranked_duos_table(p_match)`: the recorded teams as the rail and the scout cards show them, for the members of
-- the match's room (the two players and the stands). One small read per shop (the client asks when a shop opens):
--   { round, teamName,
--     served: [{ team, member, name, hero, kind, board: { minions, tier } | null }],
--     orders: { team: 0 | 1 }   a recorded duo run's own fight order for the round served (absent = the seeded 50/50),
--     teamNames: { team: name } a recorded duo run's team name, when that pair named itself (else "Name1 & Name2") }
-- `board` is each recorded member's board for THIS round by the round-exact serving rule (a team that is out: the round
-- it fell), exactly what a solo lobby's rail shows of a seat (R-LOBBY-SCOUT-01). Never the whole recording.

create or replace function public.versus_ranked_duos_table(p_match uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  m public.versus_group_matches;
  v_round int;
begin
  select * into m from public.versus_group_matches where id = p_match;
  if not found then raise exception 'no_match'; end if;
  if not public.versus_ranked_duos__is(m) then raise exception 'not_ranked_duos'; end if;
  if v_user is null or not (
      exists (select 1 from public.versus_group_seats where match_id = p_match and user_id = v_user)
      or exists (select 1 from public.versus_members where room_id = m.room_id and user_id = v_user)) then
    raise exception 'not_a_member';
  end if;
  v_round := greatest(m.round, 1);
  return jsonb_build_object(
    'round', m.round,
    'teamName', (select d.name from public.duos_teams d where d.id = m.ranked_team),
    'served', coalesce((
      select jsonb_agg(jsonb_build_object(
          'team', v.team, 'member', v.member, 'name', v.name, 'hero', v.hero, 'kind', v.kind,
          'board', case when x.b->>'form' = 'snapshot' then jsonb_build_object('minions', x.b->'board'->'minions', 'tier', x.b->'board'->'tier')
                        when x.b->>'form' = 'side' then jsonb_build_object('minions', x.b->'board'->'board', 'tier', x.b->'board'->'state'->'tier')
                   end)
        order by v.team, v.member)
      from public.versus_ranked_duos_served v
      join public.versus_group_teams t on t.match_id = v.match_id and t.team = v.team
      cross join lateral (select public.versus_ranked_duos__member_board(v.recording,
        case when t.eliminated_round is not null and t.eliminated_round < v_round then t.eliminated_round else v_round end) as b) x
      where v.match_id = p_match), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_object_agg(t.team, coalesce(
          (t.recorded_order->>(case when t.eliminated_round is not null and t.eliminated_round < v_round then t.eliminated_round else v_round end)::text)::int,
          (select (t.recorded_order->>k)::int from jsonb_object_keys(t.recorded_order) k order by k::int desc limit 1)))
      from public.versus_group_teams t
      where t.match_id = p_match and jsonb_typeof(t.recorded_order) = 'object'), '{}'::jsonb),
    'teamNames', coalesce((
      select jsonb_object_agg(t.team, d.name)
      from public.versus_group_teams t
      join public.duo_runs r on r.id = t.duo_run_id
      join public.duos_teams d on d.id = r.team_id
      where t.match_id = p_match and d.name is not null), '{}'::jsonb));
end;
$$;

revoke all on function public.versus_ranked_duos_table(uuid) from public, anon;
grant execute on function public.versus_ranked_duos_table(uuid) to authenticated;

-- ── The two live teammates never play the same hero (lead 2026-10-26; the lobby's "all eight heroes unique") ────────
-- A pick of the hero my teammate already picked is refused (`hero_taken`; the client also shows it as taken), and when the
-- clock picks for a seat (no pick in time) it never lands on the teammate's hero. Every other mode: unchanged (the bodies
-- below are 2026-10-24-versus-group.sql's, with the Ranked Duos branch added).
create or replace function public.versus_group_pick_hero(p_match uuid, p_index int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.versus_group_matches;
  v_seat text;
  v_mine text;
  v_mate text;
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
  if public.versus_ranked_duos__is(m) then
    select hero_offer[p_index + 1] into v_mine from public.versus_group_seat_private where match_id = p_match and seat = v_seat;
    select p.hero_offer[p.hero_index + 1] into v_mate from public.versus_group_seat_private p
      where p.match_id = p_match and p.seat <> v_seat and p.hero_index is not null;
    if v_mine is not null and v_mine = v_mate then raise exception 'hero_taken'; end if;
  end if;
  update public.versus_group_seat_private set hero_index = p_index where match_id = p_match and seat = v_seat and hero_index is null;
  m := public.versus_group__maybe_start(m);
  return public.versus_group__match_json(m);
end;
$$;

create or replace function public.versus_group__maybe_start(m public.versus_group_matches)
returns public.versus_group_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  r record;
  v_other text;
  k int;
begin
  if m.phase <> 'hero_select' then return m; end if;
  if v_now < m.hero_deadline and exists (
      select 1 from public.versus_group_seat_private p join public.versus_group_seats s on s.match_id = p.match_id and s.seat = p.seat
      where p.match_id = m.id and p.hero_index is null and s.eliminated_round is null) then
    return m;
  end if;
  update public.versus_group_seat_private set hero_index = public.versus__pick(m.seed, 'hero:' || seat, 3), hero_auto = true
    where match_id = m.id and hero_index is null;
  -- RANKED DUOS: a clock pick never lands on the teammate's hero (the next offered hero that differs).
  if public.versus_ranked_duos__is(m) then
    for r in select * from public.versus_group_seat_private where match_id = m.id and hero_auto and hero_offer is not null loop
      select p.hero_offer[p.hero_index + 1] into v_other from public.versus_group_seat_private p
        where p.match_id = m.id and p.seat <> r.seat and p.hero_index is not null;
      if v_other is not null and r.hero_offer[r.hero_index + 1] = v_other then
        for k in 0..2 loop
          if r.hero_offer[k + 1] is distinct from v_other then
            update public.versus_group_seat_private set hero_index = k where match_id = m.id and seat = r.seat;
            exit;
          end if;
        end loop;
      end if;
    end loop;
  end if;
  update public.versus_group_seats s set hero = case when p.hero_offer is null then null else p.hero_offer[p.hero_index + 1] end
    from public.versus_group_seat_private p where p.match_id = m.id and s.match_id = m.id and s.seat = p.seat;
  update public.versus_group_matches set heroes_revealed = true where id = m.id returning * into m;
  return public.versus_group__open_shop(m, 1);
end;
$$;
