-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- VERSUS ON CLOUDFLARE: the result writer (2026-11-04, feat/versus-cloudflare-live). Run AFTER
-- 2026-11-03-versus-live-armor.sql and 2026-11-02-versus-server-reliability.sql.
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Owner ruling 2026-10-28: Cloudflare rooms write their results through a DEDICATED, LIMITED path, not the service role.
-- The room Worker holds one secret (`VERSUS_WRITER_SECRET`, a Worker secret) and calls ONE function with the project's
-- publishable key. The function can do exactly two things: upsert a Cloudflare 1v1 match row and insert a round row of
-- such a match. It can never touch a Supabase-hosted match, any other table, or a finished Cloudflare match.
--
--   1. versus_matches.backend ('supabase' | 'cloudflare'): which server owns the row. Every existing row is 'supabase'.
--   2. versus_cf_writer_keys: sha256 hashes of the Worker's writer secret. NO rows here: the lead inserts the hash that
--      `workers/versus/scripts/writer-secret.mjs` prints, so the secret itself never touches the repo or SQL history.
--   3. versus_cf_persist(p_key, p_kind, p_row): the only entry point (anon may execute; the key gates it).
--   4. versus__round_scouts keeps scouts the writer supplies (a Cloudflare round has no versus_submissions rows).
--   5. versus_sweep skips Cloudflare matches (the room's own alarm ends them; their rows are records, not live state).
--
-- Readers are unchanged: settle_progression (XP), versus_records and Previous match stats read these rows as today.
-- Idempotent.

create extension if not exists pgcrypto with schema extensions;

-- ── 1. Ownership ───────────────────────────────────────────────────────────────────────────────────────────
alter table public.versus_matches add column if not exists backend text not null default 'supabase';
alter table public.versus_matches drop constraint if exists versus_matches_backend_check;
alter table public.versus_matches add constraint versus_matches_backend_check check (backend in ('supabase', 'cloudflare'));

-- ── 2. The writer's key hashes ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.versus_cf_writer_keys (
  key_hash    text primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  note        text,
  created_at  timestamptz not null default now()
);
alter table public.versus_cf_writer_keys enable row level security; -- no policies: nobody reads it through the API
revoke all on public.versus_cf_writer_keys from anon, authenticated;

-- ── 3. The one write path ──────────────────────────────────────────────────────────────────────────────────
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
  end if;
  raise exception 'bad_kind';
end;
$$;
revoke all on function public.versus_cf_persist(text, text, jsonb) from public;
grant execute on function public.versus_cf_persist(text, text, jsonb) to anon, authenticated;

-- ── 4. Scouts the writer supplies are kept ─────────────────────────────────────────────────────────────────
create or replace function public.versus__round_scouts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s1 public.versus_submissions;
  s2 public.versus_submissions;
begin
  -- A Cloudflare round arrives with its scouts already folded (the room has no versus_submissions rows).
  if new.p1_scout is not null and new.p2_scout is not null then return new; end if;
  select * into s1 from public.versus_submissions where match_id = new.match_id and round = new.round and seat = 'p1';
  select * into s2 from public.versus_submissions where match_id = new.match_id and round = new.round and seat = 'p2';
  -- The tier is the locked side's own (authoritative); the rest is what the seat's client reported with it.
  new.p1_scout := coalesce(s1.scout, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('tier', s1.prepared_side -> 'state' -> 'tier'));
  new.p2_scout := coalesce(s2.scout, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('tier', s2.prepared_side -> 'state' -> 'tier'));
  return new;
end;
$$;
revoke all on function public.versus__round_scouts() from public, anon, authenticated;

-- ── 5. The sweep leaves Cloudflare matches alone (its 1v1 loop gains `backend = 'supabase'`; the rest is verbatim) ──
create or replace function public.versus_sweep()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  m public.versus_matches;
  g public.versus_group_matches;
  v_solo int := 0;
  v_group int := 0;
  v_ranked int;
  v_pruned int;
begin
  for m in select * from public.versus_matches
      where phase <> 'complete' and backend = 'supabase' and updated_at < v_now - interval '10 minutes'
      order by updated_at limit 50
      for update skip locked loop
    continue when exists (select 1 from public.versus_members mm
      where mm.room_id = m.room_id and mm.user_id in (m.p1_user, m.p2_user) and mm.last_seen_at >= v_now - interval '10 minutes');
    perform public.versus__event(m.id, m.round, 'sweep_end', jsonb_build_object('mode', '1v1', 'phase', m.phase));
    perform public.versus__complete(m, null, 'abandoned');
    v_solo := v_solo + 1;
  end loop;

  for g in select * from public.versus_group_matches
      where phase <> 'complete' and updated_at < v_now - interval '10 minutes' and coalesce(options->>'mode', '') <> 'ranked_duos'
      order by updated_at limit 50
      for update skip locked loop
    continue when exists (select 1 from public.versus_group_seats s
      join public.versus_members mm on mm.room_id = g.room_id and mm.user_id = s.user_id
      where s.match_id = g.id and s.eliminated_round is null and mm.last_seen_at >= v_now - interval '10 minutes');
    perform public.versus__event(g.id, g.round, 'sweep_end', jsonb_build_object('mode', coalesce(g.options->>'mode', 'group'), 'phase', g.phase));
    perform public.versus_group__complete(g, null, 'abandoned');
    v_group := v_group + 1;
  end loop;

  v_ranked := public.versus_ranked_duos_sweep_abandoned();

  -- Retention: 14 days of events.
  delete from public.versus_events where at < v_now - interval '14 days';
  get diagnostics v_pruned = row_count;
  return jsonb_build_object('solo', v_solo, 'group', v_group, 'rankedDuos', v_ranked, 'pruned', v_pruned);
end;
$$;

revoke all on function public.versus_sweep() from public, anon, authenticated;
grant execute on function public.versus_sweep() to service_role;
