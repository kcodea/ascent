-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- VERSUS ON CLOUDFLARE: the result writer, DUOS (2026-11-06, feat/versus-cf-duos). Run AFTER
-- 2026-11-05-versus-cf-writer-group.sql.
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- A Versus Duos match is a group-table match with two teams: the writer's 'group_match' now also upserts the seats'
-- team letters and the match's two `versus_group_teams` rows (shared pool, knockout, placement), which XP's
-- settle_progression counts for a Duos placement. Passes are not persisted (they are live state, and every pass is
-- already folded into the receiving run's own boards and recordings). Same key gate and rules as before. Idempotent.
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
  end if;
  raise exception 'bad_kind';
end;
$$;
revoke all on function public.versus_cf_persist(text, text, jsonb) from public;
grant execute on function public.versus_cf_persist(text, text, jsonb) to anon, authenticated;
