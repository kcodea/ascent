-- RANKED DUOS, live-test fixes (2026-10-26, fix/ranked-duos-p2-live). APPLY AFTER 2026-10-30-ranked-duos-client.sql.
-- Idempotent. No function redeploy needed.
--
-- THE BUG: the live team could never be PLACED. `versus_ranked_duos__place_team` and `versus_ranked_duos__record_run`
-- check for a test bot in the team through `versus_test_bots`, but read a `user_id` column; the table's column is
-- `bot_user` (2026-10-25-versus-test-bots.sql). On the live project (where that table exists) the check raised
-- "column b.user_id does not exist", so the round whose fight knocked the live team out (or left it last) failed to
-- commit (`resolver_failed`) and the match stuck in `resolving`. The PGlite suite created its own table with the wrong
-- column, so it never saw it; it now builds the real shape. Rounds with no placement were never affected.
--
-- Both bodies are 2026-10-29-ranked-duos.sql's with `b.user_id` -> `b.bot_user`.

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
    execute 'select exists (select 1 from public.versus_test_bots b join public.versus_group_seats s on s.user_id = b.bot_user where s.match_id = $1)'
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
    execute 'select exists (select 1 from public.versus_test_bots b join public.versus_group_seats s on s.user_id = b.bot_user where s.match_id = $1)'
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
