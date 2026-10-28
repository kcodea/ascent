-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- VERSUS ON CLOUDFLARE: RANKED DUOS (2026-11-07, feat/versus-cf-ranked). Run AFTER 2026-11-06-versus-cf-writer-duos.sql.
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- The same limited, key-gated path (owner ruling 2026-10-28: never the service role):
--   1. versus_cf_ranked(p_key, 'team' | 'solo_sample' | 'duo_sample', p_args): the pair's team identity, name and
--      division (duos__ensure_team, duos_teams, duos_team_ranks), and the recorded solo / duo runs the table is seated from
--      (pool_runs_sample, duo_runs_sample + the duo teams' names).
--   2. versus_cf_persist gains 'ranked_finish': ONE call at the end writes the match, seats, teams, served recordings,
--      rounds and fights, the live boards per round, then settles the team rating (settle_duos_rank, deduped per team +
--      match) and records the duo run (versus_ranked_duos__record_run, returns the existing one). A repeat is `frozen`.
-- Idempotent.

create or replace function public.versus_cf_persist(p_key text, p_kind text, p_row jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.versus_matches;
  cur public.versus_matches;
  r public.versus_rounds;
  g public.versus_group_matches;
  gcur public.versus_group_matches;
  gs public.versus_group_seats;
  s record;
begin
  if p_key is null or not exists (select 1 from public.versus_cf_writer_keys
      where key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex')) then
    raise exception 'not_authorized';
  end if;
  if p_row is null or jsonb_typeof(p_row) <> 'object' or octet_length(p_row::text) > 2097152 then raise exception 'bad_row'; end if;

  if p_kind = 'match' then
    m := jsonb_populate_record(null::public.versus_matches, p_row);
    if m.id is null or m.p1_user is null or m.p2_user is null then raise exception 'bad_row'; end if;
    select * into cur from public.versus_matches where id = m.id for update;
    if found then
      if cur.backend <> 'cloudflare' then raise exception 'not_cloudflare'; end if;
      if cur.phase = 'complete' then return jsonb_build_object('ok', true, 'frozen', true); end if;
      update public.versus_matches set
        phase = m.phase, revision = m.revision, round = m.round, p1_hero = m.p1_hero, p2_hero = m.p2_hero,
        heroes_revealed = coalesce(m.heroes_revealed, false), p1_health = m.p1_health, p1_armor = m.p1_armor,
        p2_health = m.p2_health, p2_armor = m.p2_armor, p1_missed = coalesce(m.p1_missed, 0), p2_missed = coalesce(m.p2_missed, 0),
        p1_auto = coalesce(m.p1_auto, false), p2_auto = coalesce(m.p2_auto, false),
        winner_seat = m.winner_seat, end_reason = m.end_reason, completed_at = m.completed_at, updated_at = coalesce(m.updated_at, now())
        where id = m.id;
    else
      insert into public.versus_matches (id, room_id, seed, set_id, content_revision, protocol, phase, revision, round,
          p1_user, p2_user, p1_name, p2_name, p1_hearts, p2_hearts, p1_hero, p2_hero, heroes_revealed,
          p1_health, p1_armor, p2_health, p2_armor, p1_missed, p2_missed, p1_auto, p2_auto,
          winner_seat, end_reason, options, created_at, updated_at, completed_at, backend)
        values (m.id, null, m.seed, m.set_id, m.content_revision, m.protocol, m.phase, coalesce(m.revision, 1), coalesce(m.round, 0),
          m.p1_user, m.p2_user, m.p1_name, m.p2_name, 7, 7, m.p1_hero, m.p2_hero, coalesce(m.heroes_revealed, false),
          m.p1_health, m.p1_armor, m.p2_health, m.p2_armor, coalesce(m.p1_missed, 0), coalesce(m.p2_missed, 0),
          coalesce(m.p1_auto, false), coalesce(m.p2_auto, false), m.winner_seat, m.end_reason, m.options,
          coalesce(m.created_at, now()), coalesce(m.updated_at, now()), m.completed_at, 'cloudflare');
    end if;
    return jsonb_build_object('ok', true);
  elsif p_kind = 'round' then
    r := jsonb_populate_record(null::public.versus_rounds, p_row);
    if r.match_id is null or r.round is null then raise exception 'bad_row'; end if;
    if not exists (select 1 from public.versus_matches where id = r.match_id and backend = 'cloudflare') then
      raise exception 'not_cloudflare';
    end if;
    insert into public.versus_rounds (match_id, round, chair, outcome, heart_lost_by, p1_result, p2_result, digest,
        p1_hearts, p2_hearts, p1_health, p1_armor, p2_health, p2_armor, p1_damage, p2_damage, p1_scout, p2_scout, committed_at)
      values (r.match_id, r.round, r.chair, r.outcome, r.heart_lost_by, r.p1_result, r.p2_result, r.digest,
        null, null, r.p1_health, r.p1_armor, r.p2_health, r.p2_armor, r.p1_damage, r.p2_damage,
        coalesce(r.p1_scout, '{}'::jsonb), coalesce(r.p2_scout, '{}'::jsonb), coalesce(r.committed_at, now()))
      on conflict (match_id, round) do nothing;
    return jsonb_build_object('ok', true);
  elsif p_kind = 'group_match' then
    g := jsonb_populate_record(null::public.versus_group_matches, p_row);
    if g.id is null or jsonb_typeof(p_row->'seats') <> 'array' then raise exception 'bad_row'; end if;
    select * into gcur from public.versus_group_matches where id = g.id for update;
    if found then
      if gcur.backend <> 'cloudflare' then raise exception 'not_cloudflare'; end if;
      if gcur.phase = 'complete' then return jsonb_build_object('ok', true, 'frozen', true); end if;
      update public.versus_group_matches set phase = g.phase, revision = g.revision, round = g.round,
        heroes_revealed = coalesce(g.heroes_revealed, false), winner_seat = g.winner_seat, end_reason = g.end_reason,
        completed_at = g.completed_at, updated_at = coalesce(g.updated_at, now())
        where id = g.id;
    else
      insert into public.versus_group_matches (id, room_id, seed, set_id, content_revision, protocol, options, phase, revision, round,
          seat_count, heroes_revealed, winner_seat, end_reason, created_at, updated_at, completed_at, backend)
        values (g.id, null, g.seed, g.set_id, g.content_revision, g.protocol, coalesce(g.options, '{}'::jsonb), g.phase,
          coalesce(g.revision, 1), coalesce(g.round, 0), g.seat_count, coalesce(g.heroes_revealed, false), g.winner_seat, g.end_reason,
          coalesce(g.created_at, now()), coalesce(g.updated_at, now()), g.completed_at, 'cloudflare');
    end if;
    -- The seats (the room sends its whole seat list each time; a row is the seat's state after the round).
    for s in select value from jsonb_array_elements(p_row->'seats') loop
      gs := jsonb_populate_record(null::public.versus_group_seats, s.value || jsonb_build_object('match_id', g.id));
      insert into public.versus_group_seats (match_id, seat, user_id, name, hearts, hero, locked, ready, intro, auto, missed,
          eliminated_round, out_reason, placement, health, armor, team)
        values (g.id, gs.seat, gs.user_id, gs.name, 7, gs.hero, coalesce(gs.locked, false), coalesce(gs.ready, false),
          coalesce(gs.intro, false), coalesce(gs.auto, false), coalesce(gs.missed, 0), gs.eliminated_round, gs.out_reason,
          gs.placement, gs.health, gs.armor, gs.team)
        on conflict (match_id, seat) do update set hero = excluded.hero, auto = excluded.auto, missed = excluded.missed,
          eliminated_round = excluded.eliminated_round, out_reason = excluded.out_reason, placement = excluded.placement,
          health = excluded.health, armor = excluded.armor;
    end loop;
    -- VERSUS DUOS: the two teams' pools and fates (absent on a Group match).
    for s in select value from jsonb_array_elements(coalesce(p_row->'teams', '[]'::jsonb)) loop
      insert into public.versus_group_teams (match_id, team, hearts, health, armor, eliminated_round, out_reason, placement)
        values (g.id, s.value->>'team', 7, (s.value->>'health')::int, (s.value->>'armor')::int, (s.value->>'eliminated_round')::int,
          s.value->>'out_reason', (s.value->>'placement')::int)
        on conflict (match_id, team) do update set health = excluded.health, armor = excluded.armor,
          eliminated_round = excluded.eliminated_round, out_reason = excluded.out_reason, placement = excluded.placement;
    end loop;
    return jsonb_build_object('ok', true);
  elsif p_kind = 'group_round' then
    if (p_row->>'match_id') is null or (p_row->>'round') is null or jsonb_typeof(p_row->'fights') <> 'array' then raise exception 'bad_row'; end if;
    if not exists (select 1 from public.versus_group_matches where id = (p_row->>'match_id')::uuid and backend = 'cloudflare') then
      raise exception 'not_cloudflare';
    end if;
    insert into public.versus_group_rounds (match_id, round, digest, hearts, vitals, eliminated)
      values ((p_row->>'match_id')::uuid, (p_row->>'round')::int, p_row->>'digest', null, p_row->'vitals', coalesce(p_row->'eliminated', '[]'::jsonb))
      on conflict (match_id, round) do nothing;
    for s in select value from jsonb_array_elements(p_row->'fights') loop
      insert into public.versus_group_fights (match_id, round, fight, a_seat, b_seat, b_copy, chair, outcome, heart_lost_by, damage,
          a_result, b_result, a_scout, b_scout)
        values ((p_row->>'match_id')::uuid, (p_row->>'round')::int, (s.value->>'fight')::smallint, s.value->>'a_seat', s.value->>'b_seat',
          coalesce((s.value->>'b_copy')::boolean, false), s.value->>'chair', s.value->>'outcome', s.value->>'heart_lost_by',
          coalesce((s.value->>'damage')::int, 0), s.value->'a_result', s.value->'b_result', s.value->'a_scout', s.value->'b_scout')
        on conflict (match_id, round, fight) do nothing;
    end loop;
    return jsonb_build_object('ok', true);
  elsif p_kind = 'ranked_finish' then
    -- RANKED DUOS, once, at the end: every row the Supabase build holds, then the rating settle and the duo run.
    g := jsonb_populate_record(null::public.versus_group_matches, p_row->'match');
    if g.id is null or coalesce(g.options->>'mode', '') <> 'ranked_duos' or (p_row->>'placement') is null then raise exception 'bad_row'; end if;
    select * into gcur from public.versus_group_matches where id = g.id for update;
    if found then
      if gcur.backend <> 'cloudflare' then raise exception 'not_cloudflare'; end if;
      return jsonb_build_object('ok', true, 'frozen', true);
    end if;
    insert into public.versus_group_matches (id, room_id, seed, set_id, content_revision, protocol, options, phase, revision, round,
        seat_count, heroes_revealed, winner_seat, end_reason, created_at, updated_at, completed_at, ranked_team, unrated, seated_at, backend)
      values (g.id, null, g.seed, g.set_id, g.content_revision, g.protocol, g.options, 'complete', coalesce(g.revision, 1), coalesce(g.round, 0),
        2, true, g.winner_seat, g.end_reason, coalesce(g.created_at, now()), coalesce(g.updated_at, now()), coalesce(g.completed_at, now()),
        g.ranked_team, g.unrated, g.seated_at, 'cloudflare');
    for s in select value from jsonb_array_elements(coalesce(p_row->'seats', '[]'::jsonb)) loop
      gs := jsonb_populate_record(null::public.versus_group_seats, s.value || jsonb_build_object('match_id', g.id));
      insert into public.versus_group_seats (match_id, seat, user_id, name, hearts, hero, auto, missed, eliminated_round, out_reason, placement, health, armor, team)
        values (g.id, gs.seat, gs.user_id, gs.name, 7, gs.hero, coalesce(gs.auto, false), coalesce(gs.missed, 0), gs.eliminated_round, gs.out_reason,
          gs.placement, gs.health, gs.armor, 'a')
        on conflict (match_id, seat) do nothing;
    end loop;
    for s in select value from jsonb_array_elements(coalesce(p_row->'teams', '[]'::jsonb)) loop
      insert into public.versus_group_teams (match_id, team, hearts, health, armor, eliminated_round, out_reason, placement, served_kind, duo_run_id, recorded_order)
        values (g.id, s.value->>'team', 7, (s.value->>'health')::int, (s.value->>'armor')::int, (s.value->>'eliminated_round')::int,
          case when s.value->>'out_reason' in ('hearts', 'forfeit', 'left', 'missed') then s.value->>'out_reason' end, (s.value->>'placement')::int,
          s.value->>'served_kind', case when coalesce(s.value->>'duo_run_id', '') ~ '^[0-9a-f-]{36}$' then (s.value->>'duo_run_id')::uuid end,
          case when jsonb_typeof(s.value->'recorded_order') = 'object' then s.value->'recorded_order' end)
        on conflict (match_id, team) do nothing;
    end loop;
    for s in select value from jsonb_array_elements(coalesce(p_row->'served', '[]'::jsonb)) loop
      insert into public.versus_ranked_duos_served (match_id, team, member, kind, source_key, owner_id, name, hero, recording)
        values (g.id, s.value->>'team', (s.value->>'member')::smallint, s.value->>'kind', s.value->>'source_key',
          case when coalesce(s.value->>'owner_id', '') ~ '^[0-9a-f-]{36}$' then (s.value->>'owner_id')::uuid end,
          left(coalesce(nullif(s.value->>'name', ''), 'Player'), 40), s.value->>'hero', s.value->'recording')
        on conflict (match_id, team, member) do nothing;
    end loop;
    for s in select value from jsonb_array_elements(coalesce(p_row->'rounds', '[]'::jsonb)) loop
      insert into public.versus_group_rounds (match_id, round, digest, hearts, vitals, eliminated, first)
        values (g.id, (s.value->>'round')::int, s.value->>'digest', null, s.value->'vitals', coalesce(s.value->'eliminated', '[]'::jsonb),
          case when jsonb_typeof(s.value->'first') = 'object' then s.value->'first' end)
        on conflict (match_id, round) do nothing;
      insert into public.versus_ranked_duos_fights (match_id, round, fight, a_team, b_team, ghost, chair, outcome, loser, damage, first, live_result)
        select g.id, (f->>'round')::int, (f->>'fight')::smallint, f->>'a_team', f->>'b_team', coalesce((f->>'ghost')::boolean, false), f->>'chair',
          f->>'outcome', f->>'loser', coalesce((f->>'damage')::int, 0), f->'first', f->'live_result'
        from jsonb_array_elements(coalesce(s.value->'fights', '[]'::jsonb)) f
        on conflict (match_id, round, fight) do nothing;
    end loop;
    -- The live seats' final boards per round: what the duo run records (`versus_ranked_duos__record_run` reads them).
    insert into public.versus_group_submissions (match_id, round, seat, user_id, candidate_seq, prepared_side, final, source)
      select g.id, (x->>'round')::int, x->>'seat', (x->>'user_id')::uuid, 0, x->'prepared_side', true,
        case when x->>'source' in ('candidate', 'lock', 'deadline', 'auto', 'empty') then x->>'source' else 'lock' end
      from jsonb_array_elements(coalesce(p_row->'submissions', '[]'::jsonb)) x
      where x->>'seat' in ('p1', 'p2')
      on conflict (match_id, round, seat) do nothing;
    select * into gcur from public.versus_group_matches where id = g.id;
    -- The team rating (deduped per team + match inside settle_duos_rank), then the duo run (returns the existing one).
    if gcur.unrated is null and gcur.ranked_team is not null then
      perform public.settle_duos_rank(gcur.ranked_team, gcur.id, (p_row->>'placement')::int);
    end if;
    perform public.versus_ranked_duos__record_run(gcur, (p_row->>'placement')::int);
    return jsonb_build_object('ok', true);
  end if;
  raise exception 'bad_kind';
end;
$$;
revoke all on function public.versus_cf_persist(text, text, jsonb) from public;
grant execute on function public.versus_cf_persist(text, text, jsonb) to anon, authenticated;

-- The reads a Ranked Duos room needs from Supabase, behind the same key: the pair's team, the recorded runs to seat from.
create or replace function public.versus_cf_ranked(p_key text, p_kind text, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team uuid;
  v_out jsonb;
begin
  if p_key is null or not exists (select 1 from public.versus_cf_writer_keys
      where key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex')) then
    raise exception 'not_authorized';
  end if;
  if p_kind = 'team' then
    v_team := public.duos__ensure_team((p_args->>'a')::uuid, (p_args->>'b')::uuid);
    return jsonb_build_object('teamId', v_team,
      'name', (select d.name from public.duos_teams d where d.id = v_team),
      'division', coalesce((select r.division from public.duos_team_ranks r where r.team_id = v_team and r.season = 3), 0));
  elsif p_kind = 'solo_sample' then
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_out from public.pool_runs_sample(
      p_limit => (p_args->>'p_limit')::int, p_set => p_args->>'p_set', p_seed => p_args->>'p_seed',
      p_strength_cap => (p_args->>'p_strength_cap')::numeric) x;
    return v_out;
  elsif p_kind = 'duo_sample' then
    with rows as (select * from public.duo_runs_sample((p_args->>'p_limit')::int, p_args->>'p_set', p_args->>'p_seed'))
    select jsonb_build_object(
      'rows', coalesce((select jsonb_agg(to_jsonb(r)) from rows r), '[]'::jsonb),
      'names', coalesce((select jsonb_object_agg(r.id, d.name) from rows r join public.duo_runs dr on dr.id = r.id
        join public.duos_teams d on d.id = dr.team_id where d.name is not null), '{}'::jsonb)) into v_out;
    return v_out;
  end if;
  raise exception 'bad_kind';
end;
$$;
revoke all on function public.versus_cf_ranked(text, text, jsonb) from public;
grant execute on function public.versus_cf_ranked(text, text, jsonb) to anon, authenticated;
