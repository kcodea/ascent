-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- DUOS MATCH HISTORY (2026-11-13, feat/duos-match-history; owner 2026-10-29: "we're going to want to start capturing
-- duo's match history as well"; R-DUOS-HISTORY-01). APPLY AFTER 2026-11-07-versus-cf-ranked.sql. Idempotent, additive.
-- No Edge Function. The Cloudflare Worker that SENDS the record ships with the next versioned Worker deploy; until then
-- nothing breaks either way round: an old Worker sends no record, and an old writer ignores one.
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ONE ROW PER FINISHED DUOS GAME (Ranked Duos and Versus Duos): `duos_match_history`, keyed by the match, holding a compact
-- record (`DuosHistoryRecord`, packages/sim/src/versus/duosHistory.ts): every team in table order with its placement and
-- the round it went out, each member's name, hero and the board it last fought with (card-render fields only: no text, no
-- replay, no event logs). A whole table is a few KB.
--
-- WRITTEN AT THE SOURCE: the Cloudflare room builds the record from memory at the end of the game and sends it with its
-- end-of-game job (Versus Duos: the final `group_match` row's `history`; Ranked Duos: `ranked_finish`'s `history`). The
-- key-gated writer `versus_cf_persist` stores it through `duos_history__store`, AFTER the rating settle, stamping the
-- live team's rating change (`duos_rank_results`) on a Ranked Duos row. The same row serves all four players: nobody
-- uploads their own copy. A history failure never fails the result write (it is caught and logged as a warning).
--
-- READ: `players` holds every live player of the game (the match's `versus_group_seats`); RLS lets a signed-in player read
-- exactly the games they were in (`auth.uid() = any(players)`). No client writes.
--
-- BACKFILL: `duos_history_backfill()` (postgres / service role only) builds the same record in SQL from the tables the
-- Supabase-hosted build kept: the live seats' last final submission (`versus_group_submissions`), the recorded teams'
-- recordings (`versus_ranked_duos_served`), placements and knockouts (`versus_group_teams`), team names (`duos_teams`,
-- `versus_group_teams.name`) and the rating change (`duos_rank_results`). It runs once at the end of this file and may be
-- re-run at any time (it only adds games not recorded yet). Rows it writes are marked `source = 'backfill'`.
-- Not recoverable by the backfill: the boards of a Cloudflare-hosted Versus Duos game finished before the new Worker
-- (that Worker never persisted them; such a row lands with its teams and players and no boards), and the runes of a
-- backfilled board whose submission carried no scout.

-- ── 1. The table ─────────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.duos_match_history (
  match_id      uuid primary key,
  mode          text not null check (mode in ('ranked_duos', 'versus_duos')),
  players       uuid[] not null check (cardinality(players) between 1 and 4),
  team_id       uuid,
  set_id        text,
  end_round     int  not null default 0,
  rank          jsonb,
  record        jsonb not null check (jsonb_typeof(record) = 'object' and octet_length(record::text) <= 32768),
  source        text not null default 'live' check (source in ('live', 'backfill')),
  started_at    timestamptz,
  completed_at  timestamptz not null default now()
);
create index if not exists duos_match_history_players on public.duos_match_history using gin (players);
create index if not exists duos_match_history_completed on public.duos_match_history (completed_at desc);
alter table public.duos_match_history enable row level security;
drop policy if exists "duos history read own games" on public.duos_match_history;
create policy "duos history read own games" on public.duos_match_history for select to authenticated
  using ((select auth.uid()) = any(players));
revoke all on public.duos_match_history from public, anon, authenticated;
grant select on public.duos_match_history to authenticated;

-- ── 2. Store one record (internal: the writer and the backfill) ─────────────────────────────────────────────────────
create or replace function public.duos_history__store(p_match uuid, p_mode text, p_record jsonb, p_source text default 'live')
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.versus_group_matches;
  v_players uuid[];
  v_rank jsonb;
begin
  if p_mode not in ('ranked_duos', 'versus_duos') or p_record is null or jsonb_typeof(p_record) <> 'object'
     or (p_record->>'v') is distinct from '1' or jsonb_typeof(p_record->'teams') <> 'array'
     or octet_length(p_record::text) > 32768 then
    return false;
  end if;
  select * into g from public.versus_group_matches where id = p_match;
  if not found then return false; end if;
  select array_agg(user_id order by seat) into v_players from public.versus_group_seats where match_id = p_match;
  if v_players is null then return false; end if;
  if p_mode = 'ranked_duos' and g.ranked_team is not null then
    select jsonb_build_object('divisionBefore', r.division_before, 'pointsBefore', r.points_before,
        'divisionAfter', r.division_after, 'pointsAfter', r.points_after, 'delta', r.applied_delta,
        'promoted', r.promoted, 'demoted', r.demoted)
      into v_rank from public.duos_rank_results r where r.team_id = g.ranked_team and r.match_id = p_match;
  end if;
  insert into public.duos_match_history (match_id, mode, players, team_id, set_id, end_round, rank, record, source, started_at, completed_at)
    values (p_match, p_mode, v_players, case when p_mode = 'ranked_duos' then g.ranked_team end, g.set_id,
      coalesce((p_record->>'endRound')::int, g.round, 0), v_rank, p_record, coalesce(p_source, 'live'), g.created_at,
      coalesce(g.completed_at, now()))
    on conflict (match_id) do nothing;
  return found;
exception when others then
  -- History is a by-product: it must never roll back the result, the rating or the duo run written with it.
  raise warning 'duos_history__store % failed: %', p_match, sqlerrm;
  return false;
end;
$$;
revoke all on function public.duos_history__store(uuid, text, jsonb, text) from public, anon, authenticated;

-- ── 3. The backfill builder (the same record, from the tables) ──────────────────────────────────────────────────────
-- One stored board: the card-render fields of up to 7 minions (`compactDuosMinion`), the tier, up to 12 runes.
create or replace function public.duos_history__board(p_minions jsonb, p_tier jsonb, p_round int, p_runes jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'round', p_round,
    'tier', greatest(1, least(7, coalesce(case when jsonb_typeof(p_tier) = 'number' then round(p_tier::text::numeric)::int end, 1))),
    'minions', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'cardId', m->'cardId', 'attack', m->'attack', 'health', m->'health',
          'golden', case when m->'golden' = 'true'::jsonb then true end,
          'keywords', case when jsonb_typeof(m->'keywords') = 'array' and jsonb_array_length(m->'keywords') > 0 then m->'keywords' end,
          'addedTribes', case when jsonb_typeof(m->'addedTribes') = 'array' and jsonb_array_length(m->'addedTribes') > 0 then m->'addedTribes' end
        )) order by o)
      from jsonb_array_elements(case when jsonb_typeof(p_minions) = 'array' then p_minions else '[]'::jsonb end) with ordinality as x(m, o)
      where o <= 7 and jsonb_typeof(m->'cardId') = 'string' and jsonb_typeof(m->'attack') = 'number' and jsonb_typeof(m->'health') = 'number'),
      '[]'::jsonb))
  || case when jsonb_typeof(p_runes) = 'array' and jsonb_array_length(p_runes) > 0
       then jsonb_build_object('runes', coalesce((select jsonb_agg(r order by o) from jsonb_array_elements(p_runes) with ordinality as y(r, o)
         where jsonb_typeof(r) = 'string' and o <= 12), '[]'::jsonb)) else '{}'::jsonb end;
$$;

-- A recorded member's board at `p_round` (`memberBoard` in workers/versus/src/core/rankedMatch.ts): a solo recording's
-- snapshot for that wave, a duo recording's side for that round, the last one past its end, an empty board in a gap, and
-- nothing before its start.
create or replace function public.duos_history__served_board(p_rec jsonb, p_round int)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_kind text := p_rec->>'kind';
  v_list jsonb;
  v_key text;
  v_lo int; v_hi int; v_at int;
  e jsonb; e_at int;
begin
  if v_kind = 'solo' then v_list := p_rec->'boards'; v_key := 'wave';
  elsif v_kind = 'duo' then v_list := p_rec->'rounds'; v_key := 'round';
  else return null; end if;
  if jsonb_typeof(v_list) is distinct from 'array' or jsonb_array_length(v_list) = 0 then return null; end if;
  select min((x->>v_key)::int), max((x->>v_key)::int) into v_lo, v_hi
    from jsonb_array_elements(v_list) x where (x->>v_key) ~ '^[0-9]+$';
  if v_hi is null or p_round < v_lo then return null; end if;
  v_at := least(p_round, v_hi);
  select x, (x->>v_key)::int into e, e_at from jsonb_array_elements(v_list) x
    where (x->>v_key) ~ '^[0-9]+$' and (x->>v_key)::int <= v_at order by (x->>v_key)::int desc limit 1;
  if e is null then return null; end if;
  if v_kind = 'solo' then
    return public.duos_history__board(case when e_at = v_at then e->'minions' else '[]'::jsonb end, e->'tier', p_round, e->'runes');
  end if;
  if jsonb_typeof(e->'side') is distinct from 'object' then return null; end if;
  return public.duos_history__board(case when e_at = v_at then e->'side'->'board' else '[]'::jsonb end, e->'side'->'state'->'tier', p_round, null);
end;
$$;

-- The whole record of one finished Duos match, from the tables (null when it is not one).
create or replace function public.duos_history__build(p_match uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  m public.versus_group_matches;
  v_mode text;
  v_teams jsonb;
begin
  select * into m from public.versus_group_matches where id = p_match;
  if not found or m.phase <> 'complete' then return null; end if;
  v_mode := case m.options->>'mode' when 'ranked_duos' then 'ranked_duos' when 'duos' then 'versus_duos' end;
  if v_mode is null then return null; end if;
  with t as (
    select x.team, x.placement, x.eliminated_round,
      case when v_mode = 'versus_duos' or x.team = 'a' then 'live' else coalesce(x.served_kind, 'generated') end as kind,
      case when v_mode = 'ranked_duos' and x.team = 'a' then (select d.name from public.duos_teams d where d.id = m.ranked_team) else x.name end as name,
      case when x.eliminated_round is not null and x.eliminated_round < greatest(m.round, 1) then x.eliminated_round else greatest(m.round, 1) end as at
    from public.versus_group_teams x where x.match_id = m.id
  ), members as (
    -- The live seats: their last final submission (the board they last fought with).
    select t.team, s.seat as ord, jsonb_build_object('seat', s.seat, 'userId', s.user_id, 'name', left(coalesce(nullif(s.name, ''), 'Player'), 40),
        'heroId', coalesce(s.hero, ''),
        'board', (select public.duos_history__board(sub.prepared_side->'board', sub.prepared_side->'state'->'tier', sub.round, sub.scout->'runes')
                  from public.versus_group_submissions sub
                  where sub.match_id = m.id and sub.seat = s.seat and sub.final and jsonb_typeof(sub.prepared_side) = 'object'
                  order by sub.round desc limit 1)) as j
    from t join public.versus_group_seats s on s.match_id = m.id
      and coalesce(s.team, case when s.seat in ('p1', 'p2') then 'a' else 'b' end) = t.team
    where t.kind = 'live'
    union all
    -- The recorded members (Ranked Duos): their recording's board at the round their team went out (or the end).
    select t.team, v.member::text, jsonb_build_object('seat', v.team || v.member, 'name', left(coalesce(nullif(v.name, ''), 'Player'), 40),
        'heroId', coalesce(v.hero, ''), 'board', public.duos_history__served_board(v.recording, t.at))
    from t join public.versus_ranked_duos_served v on v.match_id = m.id and v.team = t.team
    where t.kind <> 'live'
  )
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('team', t.team, 'name', t.name, 'kind', t.kind, 'placement', t.placement,
        'outRound', case when t.placement = 1 then null else t.eliminated_round end))
      || jsonb_build_object('members', coalesce((select jsonb_agg(mm.j order by mm.ord) from members mm where mm.team = t.team), '[]'::jsonb))
      order by coalesce(t.placement::numeric, 1.5), t.team), '[]'::jsonb)
    into v_teams from t;
  if jsonb_array_length(v_teams) = 0 then return null; end if;
  return jsonb_strip_nulls(jsonb_build_object('v', 1, 'mode', v_mode, 'endRound', m.round, 'startedAt', m.created_at, 'endedAt', m.completed_at))
    || jsonb_build_object('teams', v_teams);
end;
$$;
revoke all on function public.duos_history__build(uuid) from public, anon, authenticated;

-- Record every finished Duos game not recorded yet (both hosts). Returns how many rows it added. Re-runnable.
create or replace function public.duos_history_backfill()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n int := 0;
  v_rec jsonb;
begin
  for r in
    select m.id, case m.options->>'mode' when 'ranked_duos' then 'ranked_duos' else 'versus_duos' end as mode
    from public.versus_group_matches m
    where m.phase = 'complete' and m.options->>'mode' in ('duos', 'ranked_duos')
      and not exists (select 1 from public.duos_match_history h where h.match_id = m.id)
    order by m.completed_at
  loop
    v_rec := public.duos_history__build(r.id);
    if v_rec is not null and public.duos_history__store(r.id, r.mode, v_rec, 'backfill') then n := n + 1; end if;
  end loop;
  return n;
end;
$$;
revoke all on function public.duos_history_backfill() from public, anon, authenticated;

-- ── 4. The writer: versus_cf_persist (2026-11-07-versus-cf-ranked.sql's body + the two history calls) ────────────────
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
    -- DUOS MATCH HISTORY: the final Versus Duos row carries the game's record (R-DUOS-HISTORY-01).
    if g.phase = 'complete' and coalesce(g.options->>'mode', '') = 'duos' and jsonb_typeof(p_row->'history') = 'object' then
      perform public.duos_history__store(g.id, 'versus_duos', p_row->'history');
    end if;
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
    -- DUOS MATCH HISTORY: after the settle, so the row carries the team's rating change (R-DUOS-HISTORY-01).
    if jsonb_typeof(p_row->'history') = 'object' then
      perform public.duos_history__store(g.id, 'ranked_duos', p_row->'history');
    end if;
    return jsonb_build_object('ok', true);
  end if;
  raise exception 'bad_kind';
end;
$$;
revoke all on function public.versus_cf_persist(text, text, jsonb) from public;
grant execute on function public.versus_cf_persist(text, text, jsonb) to anon, authenticated;

-- ── 5. Backfill what the tables already hold (re-runnable: only adds games not recorded yet) ─────────────────────────
select public.duos_history_backfill();
