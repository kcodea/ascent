-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- THE PEAK CAP: a Bronze, Silver or Gold table never seats a recorded run whose best board ranks above 90
-- (owner 2026-11-16: "90 for all"; docs/superpowers/specs/2026-11-16-strength-v2-design.md, section 6.C)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Apply with `npm run db:apply -- supabase/migrations/2026-11-24-strength-peak-cap.sql --yes`, AFTER
-- 2026-11-23-strength-v2.sql (it replaces functions that file defines, and refuses to run without it). Safe to apply
-- before the client and the hub that send the cap ship: an older client or hub does not send `p_peak_cap`, and a draw
-- without it is unchanged. Idempotent: safe to re-run.
--
-- AFTER THIS FILE, NEVER RE-APPLY 2026-11-08-pool-runs-delta.sql, 2026-11-22-pool-rolling-window.sql or
-- 2026-11-23-strength-v2.sql (or the generated strength-v2-apply.sql) on their own. Each recreates a ten-argument
-- draw function BESIDE the eleven-argument one of this file, and every ten-argument call (older clients, Ranked Duos
-- seating, the keys read) then fails as ambiguous. If one of them has to be re-applied, re-apply THIS file straight
-- after it: the drops below repair it (packages/sim/src/lobby/strengthPeak.db.test.ts).
--
-- WHAT:
--  1. `pool_runs.strength_peak`: a run's PEAK, the highest percentile among its REAL boards from round 3 on (rounds
--     1 and 2 are one or two minions, too coarse to judge; a carried round never counts). Written by
--     `pool_strength_refresh` from the same per-round percentiles as the other ratings; null for an unscored run.
--     The TypeScript definition is `runPeakOf` (packages/sim/src/lobby/strengthV2.ts);
--     packages/sim/src/lobby/strengthPeak.db.test.ts holds the two equal.
--  2. THE DRAW: `pool_runs_sample`, `pool_runs__pick` and `pool_runs_sample_keys` take a last argument
--     `p_peak_cap`: a run whose peak is above it is left out (exactly the cap is inside), and so is a run with no
--     peak (an unscored run, already out of every band). Without it the draw is unchanged. The two samples also
--     return `strength_peak`, so the client can re-check the cap at seat selection.
--     The three older ten-argument signatures are DROPPED (two overloads would make a ten-argument call ambiguous);
--     a call with the ten older arguments resolves to the new function through the default.
--     `pool_runs_sample` and `pool_runs__pick` keep identical picking blocks; the hub Worker's port
--     (workers/versus/src/core/poolPick.ts) changes in the same PR.
--  3. THE HUB MIRROR: `pool_mirror_index` returns `strength_peak`, `pool_mirror_version` hashes it, and
--     `ops.pool_digest` passes `p_peak_cap` to the draw it checks the hub against.
--
-- ROLLBACK: `drop function public.pool_runs_sample(int, text, text, uuid, text, numeric, numeric, text, numeric, numeric, numeric), public.pool_runs_sample_keys(int, text, text, uuid, text, numeric, numeric, text, numeric, numeric, numeric),
-- public.pool_runs__pick(int, text, text, uuid, text, numeric, numeric, text, numeric, numeric, numeric); drop function public.pool_mirror_index(text);`, then re-apply
-- 2026-11-08-pool-runs-delta.sql (the keys function and its grants), 2026-11-22-pool-rolling-window.sql (the mirror,
-- the digest), 2026-11-23-strength-v2.sql (the draw, the refresh) and the function grants of
-- 2026-11-09-security-reads-need-session.sql. The column can stay.

do $$ begin
  if to_regprocedure('public.pool_strength_round_pcts()') is null then
    raise exception 'apply 2026-11-23-strength-v2.sql before 2026-11-24-strength-peak-cap.sql';
  end if;
end $$;

begin;
-- Keep the once-a-minute job out while this runs (it takes the same lock).
select pg_advisory_xact_lock(hashtext('public.pool_refresh_dirty'));
lock table public.pool_runs in access exclusive mode;

-- ── 1. The peak ────────────────────────────────────────────────────────────────────────────────────────────
alter table public.pool_runs add column if not exists strength_peak numeric;

-- 2026-11-23-strength-v2.sql; the change: `strength_peak` = the best real board percentile from round 3 on.
create or replace function public.pool_strength_refresh(p_author text[] default null, p_hero text[] default null, p_seed bigint[] default null) returns int
language plpgsql set search_path = public as $$
declare v int;
begin
  with pct as materialized (select * from public.pool_strength_round_pcts()),
  grp as (
    select run_id,
           sum(p) filter (where not carried and round <= 5)::bigint as s1, count(p) filter (where not carried and round <= 5) as n1,
           sum(p) filter (where not carried and round between 6 and 9)::bigint as s2, count(p) filter (where not carried and round between 6 and 9) as n2,
           sum(p) filter (where not carried and round >= 10)::bigint as s3, count(p) filter (where not carried and round >= 10) as n3,
           sum(p) filter (where round <= 9)::bigint as se, count(p) filter (where round <= 9) as ne,
           sum(p) filter (where round between 10 and 15)::bigint as sl, count(p) filter (where round between 10 and 15) as nl,
           max(p) filter (where not carried and round >= 3) as pk
    from pct where p is not null group by run_id
  ),
  agg as (
    select run_id,
           public.board_strength_weighted_avg(s1, n1, s2, n2, s3, n3)::numeric as s,
           public.board_strength_mean(se, ne)::numeric as e,
           public.board_strength_mean(sl, nl)::numeric as l,
           pk::numeric as pk
    from grp
  )
  update public.pool_runs r
     set strength_avg = a.s, strength_early_avg = a.e, strength_late_avg = a.l, strength_peak = a.pk, strength_at = now()
  from public.pool_runs k left join agg a on a.run_id = k.id
  where r.id = k.id and k.live;
  get diagnostics v = row_count;

  -- THE WINDOW (R-POOL-ROLLING-01): only LIVE runs are ranked, among themselves, and only live rows are written.
  -- A run outside the window keeps its last number.
  with ranked as (
    select r.id, public.board_strength_pct(
      (rank() over w - 1)::bigint,
      count(*) over (partition by r.set_id, r.strength_avg),
      count(*) over (partition by r.set_id))::numeric as s
    from public.pool_runs r
    where r.live and r.strength_avg is not null
    window w as (partition by r.set_id order by r.strength_avg)
  )
  update public.pool_runs r set strength = x.s
  from (select p.id, rk.s from public.pool_runs p left join ranked rk on rk.id = p.id where p.live) x
  where r.id = x.id and r.strength is distinct from x.s;

  with ranked as (
    select r.id, public.board_strength_pct(
      (rank() over w - 1)::bigint,
      count(*) over (partition by r.set_id, r.strength_early_avg),
      count(*) over (partition by r.set_id))::numeric as s
    from public.pool_runs r
    where r.live and r.strength_early_avg is not null
    window w as (partition by r.set_id order by r.strength_early_avg)
  )
  update public.pool_runs r set strength_early = x.s
  from (select p.id, rk.s from public.pool_runs p left join ranked rk on rk.id = p.id where p.live) x
  where r.id = x.id and r.strength_early is distinct from x.s;

  with ranked as (
    select r.id, public.board_strength_pct(
      (rank() over w - 1)::bigint,
      count(*) over (partition by r.set_id, r.strength_late_avg),
      count(*) over (partition by r.set_id))::numeric as s
    from public.pool_runs r
    where r.live and r.strength_late_avg is not null
    window w as (partition by r.set_id order by r.strength_late_avg)
  )
  update public.pool_runs r set strength_late = x.s
  from (select p.id, rk.s from public.pool_runs p left join ranked rk on rk.id = p.id where p.live) x
  where r.id = x.id and r.strength_late is distinct from x.s;
  return v;
end $$;

-- ── 2. The draw (2026-11-23-strength-v2.sql; the change, twice in each: `p_peak_cap`). KEEP THE TWO PICKING
--       BLOCKS IDENTICAL. ──
drop function if exists public.pool_runs_sample(int, text, text, uuid, text, numeric, numeric, text, numeric, numeric);
drop function if exists public.pool_runs_sample_keys(int, text, text, uuid, text, numeric, numeric, text, numeric, numeric);
drop function if exists public.pool_runs__pick(int, text, text, uuid, text, numeric, numeric, text, numeric, numeric);

create or replace function public.pool_runs_sample(
  p_limit int default 150,
  p_set text default null,
  p_patch_prefix text default null,
  p_exclude_user uuid default null,
  p_seed text default null,
  p_strength_min numeric default null,
  p_strength_max numeric default null,
  p_pool text default null,
  p_early_weight numeric default null,
  p_strength_cap numeric default null,
  p_peak_cap numeric default null
) returns table (run_key text, author text, user_id uuid, wave_count int, strength numeric, strength_early numeric, strength_late numeric, strength_peak numeric, boards jsonb)
language plpgsql volatile set search_path = public set work_mem = '16MB' as $$
#variable_conflict use_column
declare
  v_limit int := least(greatest(coalesce(p_limit, 150), 0), 300);
  lo bigint; hi bigint; span bigint;
  picked bigint[] := '{}';
  cand bigint; tries int := 0; u double precision;
begin
  select min(r.id), max(r.id) into lo, hi from public.pool_runs r
  where r.eligible and r.live and (p_set is null or r.set_id = p_set) and (p_patch_prefix is null or r.patch_prefix = p_patch_prefix);
  if lo is null or v_limit = 0 then return; end if;
  span := hi - lo + 1;

  if span <= 4 * v_limit then
    -- A small pool: every matching run, shuffled whole (bounded by the id span, so this stays small).
    select coalesce(array_agg(t.id order by t.k), '{}') into picked from (
      select r.id, case when p_seed is null then random() else public.pool_hash01(p_seed || ':' || r.id) end as k
      from public.pool_runs r
      where r.id between lo and hi and r.eligible and r.live
        and (p_set is null or r.set_id = p_set) and (p_patch_prefix is null or r.patch_prefix = p_patch_prefix)
        and (p_exclude_user is null or r.user_id is distinct from p_exclude_user)
        and (p_pool is null or r.pool_id = p_pool)
        and ((p_strength_min is null and p_strength_max is null and p_strength_cap is null and p_peak_cap is null) or r.strength is not null)
        and (p_strength_cap is null or r.strength <= p_strength_cap)
        and (p_peak_cap is null or r.strength_peak <= p_peak_cap)
        and (public.pool_match_score(r.strength, r.strength_early, r.strength_late, p_early_weight) is null
             or ((p_strength_min is null or public.pool_match_score(r.strength, r.strength_early, r.strength_late, p_early_weight) >= p_strength_min)
             and (p_strength_max is null or public.pool_match_score(r.strength, r.strength_early, r.strength_late, p_early_weight) <= p_strength_max)))
      order by 2 limit v_limit) t;
  else
    -- Rejection sampling over the dense id range: exactly uniform over the matching runs, O(log n) per draw.
    -- A narrow band rejects more draws; the cap (64 per requested run) bounds the time either way.
    while coalesce(array_length(picked, 1), 0) < v_limit and tries < v_limit * 64 loop
      tries := tries + 1;
      u := case when p_seed is null then random() else public.pool_hash01(p_seed || ':' || tries) end;
      cand := lo + least(floor(u * span)::bigint, span - 1);
      continue when cand = any(picked);
      perform 1 from public.pool_runs r
      where r.id = cand and r.eligible and r.live
        and (p_set is null or r.set_id = p_set) and (p_patch_prefix is null or r.patch_prefix = p_patch_prefix)
        and (p_exclude_user is null or r.user_id is distinct from p_exclude_user)
        and (p_pool is null or r.pool_id = p_pool)
        and ((p_strength_min is null and p_strength_max is null and p_strength_cap is null and p_peak_cap is null) or r.strength is not null)
        and (p_strength_cap is null or r.strength <= p_strength_cap)
        and (p_peak_cap is null or r.strength_peak <= p_peak_cap)
        and (public.pool_match_score(r.strength, r.strength_early, r.strength_late, p_early_weight) is null
             or ((p_strength_min is null or public.pool_match_score(r.strength, r.strength_early, r.strength_late, p_early_weight) >= p_strength_min)
             and (p_strength_max is null or public.pool_match_score(r.strength, r.strength_early, r.strength_late, p_early_weight) <= p_strength_max)));
      if found then picked := picked || cand; end if;
    end loop;
  end if;

  return query
  select r.author || '|' || r.hero_id || '|' || r.seed::text, r.author, r.user_id, r.wave_count, r.strength,
         r.strength_early, r.strength_late, r.strength_peak,
         (select coalesce(jsonb_agg(x.snapshot order by x.wave, x.created_at, x.id), '[]'::jsonb) from public.boards x
          where coalesce(x.author, 'anon') = r.author and x.hero_id = r.hero_id and x.seed = r.seed
            and jsonb_typeof(x.snapshot -> 'minions') = 'array'
            and coalesce(x.origin, 'self') <> 'synthetic')
  from unnest(picked) with ordinality as p(id, ord)
  join public.pool_runs r on r.id = p.id
  order by p.ord;
end $$;

create or replace function public.pool_runs__pick(
  p_limit int,
  p_set text,
  p_patch_prefix text,
  p_exclude_user uuid,
  p_seed text,
  p_strength_min numeric,
  p_strength_max numeric,
  p_pool text,
  p_early_weight numeric,
  p_strength_cap numeric,
  p_peak_cap numeric
) returns bigint[]
language plpgsql volatile set search_path = public as $$
#variable_conflict use_column
declare
  v_limit int := least(greatest(coalesce(p_limit, 150), 0), 300);
  lo bigint; hi bigint; span bigint;
  picked bigint[] := '{}';
  cand bigint; tries int := 0; u double precision;
begin
  select min(r.id), max(r.id) into lo, hi from public.pool_runs r
  where r.eligible and r.live and (p_set is null or r.set_id = p_set) and (p_patch_prefix is null or r.patch_prefix = p_patch_prefix);
  if lo is null or v_limit = 0 then return '{}'; end if;
  span := hi - lo + 1;

  if span <= 4 * v_limit then
    -- A small pool: every matching run, shuffled whole (bounded by the id span, so this stays small).
    select coalesce(array_agg(t.id order by t.k), '{}') into picked from (
      select r.id, case when p_seed is null then random() else public.pool_hash01(p_seed || ':' || r.id) end as k
      from public.pool_runs r
      where r.id between lo and hi and r.eligible and r.live
        and (p_set is null or r.set_id = p_set) and (p_patch_prefix is null or r.patch_prefix = p_patch_prefix)
        and (p_exclude_user is null or r.user_id is distinct from p_exclude_user)
        and (p_pool is null or r.pool_id = p_pool)
        and ((p_strength_min is null and p_strength_max is null and p_strength_cap is null and p_peak_cap is null) or r.strength is not null)
        and (p_strength_cap is null or r.strength <= p_strength_cap)
        and (p_peak_cap is null or r.strength_peak <= p_peak_cap)
        and (public.pool_match_score(r.strength, r.strength_early, r.strength_late, p_early_weight) is null
             or ((p_strength_min is null or public.pool_match_score(r.strength, r.strength_early, r.strength_late, p_early_weight) >= p_strength_min)
             and (p_strength_max is null or public.pool_match_score(r.strength, r.strength_early, r.strength_late, p_early_weight) <= p_strength_max)))
      order by 2 limit v_limit) t;
  else
    -- Rejection sampling over the dense id range: exactly uniform over the matching runs, O(log n) per draw.
    -- A narrow band rejects more draws; the cap (64 per requested run) bounds the time either way.
    while coalesce(array_length(picked, 1), 0) < v_limit and tries < v_limit * 64 loop
      tries := tries + 1;
      u := case when p_seed is null then random() else public.pool_hash01(p_seed || ':' || tries) end;
      cand := lo + least(floor(u * span)::bigint, span - 1);
      continue when cand = any(picked);
      perform 1 from public.pool_runs r
      where r.id = cand and r.eligible and r.live
        and (p_set is null or r.set_id = p_set) and (p_patch_prefix is null or r.patch_prefix = p_patch_prefix)
        and (p_exclude_user is null or r.user_id is distinct from p_exclude_user)
        and (p_pool is null or r.pool_id = p_pool)
        and ((p_strength_min is null and p_strength_max is null and p_strength_cap is null and p_peak_cap is null) or r.strength is not null)
        and (p_strength_cap is null or r.strength <= p_strength_cap)
        and (p_peak_cap is null or r.strength_peak <= p_peak_cap)
        and (public.pool_match_score(r.strength, r.strength_early, r.strength_late, p_early_weight) is null
             or ((p_strength_min is null or public.pool_match_score(r.strength, r.strength_early, r.strength_late, p_early_weight) >= p_strength_min)
             and (p_strength_max is null or public.pool_match_score(r.strength, r.strength_early, r.strength_late, p_early_weight) <= p_strength_max)));
      if found then picked := picked || cand; end if;
    end loop;
  end if;
  return picked;
end $$;

-- 2026-11-08-pool-runs-delta.sql; the change: `p_peak_cap` passed on, `strength_peak` returned.
create or replace function public.pool_runs_sample_keys(
  p_limit int default 150,
  p_set text default null,
  p_patch_prefix text default null,
  p_exclude_user uuid default null,
  p_seed text default null,
  p_strength_min numeric default null,
  p_strength_max numeric default null,
  p_pool text default null,
  p_early_weight numeric default null,
  p_strength_cap numeric default null,
  p_peak_cap numeric default null
) returns table (run_id bigint, run_key text, author text, user_id uuid, wave_count int, strength numeric, strength_early numeric, strength_late numeric, strength_peak numeric, rev text)
language plpgsql volatile set search_path = public as $$
#variable_conflict use_column
declare
  picked bigint[] := public.pool_runs__pick(p_limit, p_set, p_patch_prefix, p_exclude_user, p_seed, p_strength_min,
                                             p_strength_max, p_pool, p_early_weight, p_strength_cap, p_peak_cap);
begin
  return query
  select r.id, r.author || '|' || r.hero_id || '|' || r.seed::text, r.author, r.user_id, r.wave_count, r.strength,
         r.strength_early, r.strength_late, r.strength_peak, public.pool_run__rev(r.author, r.hero_id, r.seed)
  from unnest(picked) with ordinality as p(id, ord)
  join public.pool_runs r on r.id = p.id
  order by p.ord;
end $$;

-- The grants of 2026-11-08-pool-runs-delta.sql as narrowed by 2026-11-09-security-reads-need-session.sql: these are
-- new signatures, so they start with the default (anyone may call) and must be narrowed again. A session only.
revoke execute on function public.pool_runs_sample(int, text, text, uuid, text, numeric, numeric, text, numeric, numeric, numeric) from public, anon;
revoke execute on function public.pool_runs_sample_keys(int, text, text, uuid, text, numeric, numeric, text, numeric, numeric, numeric) from public, anon;
revoke execute on function public.pool_runs__pick(int, text, text, uuid, text, numeric, numeric, text, numeric, numeric, numeric) from public, anon;
grant execute on function public.pool_runs_sample(int, text, text, uuid, text, numeric, numeric, text, numeric, numeric, numeric) to authenticated, service_role;
grant execute on function public.pool_runs_sample_keys(int, text, text, uuid, text, numeric, numeric, text, numeric, numeric, numeric) to authenticated, service_role;
grant execute on function public.pool_runs__pick(int, text, text, uuid, text, numeric, numeric, text, numeric, numeric, numeric) to authenticated, service_role;

-- ── 3. The hub mirror and its health check (2026-11-22-pool-rolling-window.sql; the change: the peak) ─────────
create or replace function public.pool_mirror_version(p_key text) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.session_cf__key_ok(p_key) then raise exception 'not_authorized'; end if;
  return (select md5(coalesce(string_agg(concat_ws('|', r.id, r.set_id, r.patch_prefix, r.pool_id, r.user_id, r.wave_count,
            r.strength, r.strength_early, r.strength_late, r.strength_peak, public.pool_run__rev(r.author, r.hero_id, r.seed)), ',' order by r.id), ''))
          from public.pool_runs r where r.eligible and r.live);
end $$;

-- The return type changes, so the function is dropped first (its grants are restored below).
drop function if exists public.pool_mirror_index(text);
create or replace function public.pool_mirror_index(p_key text)
returns table (run_id bigint, run_key text, author text, user_id uuid, wave_count int, set_id text, patch_prefix text,
               pool_id text, strength text, strength_early text, strength_late text, strength_peak text, rev text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.session_cf__key_ok(p_key) then raise exception 'not_authorized'; end if;
  return query
  select r.id, r.author || '|' || r.hero_id || '|' || r.seed::text, r.author, r.user_id, r.wave_count, r.set_id,
         r.patch_prefix, r.pool_id, r.strength::text, r.strength_early::text, r.strength_late::text, r.strength_peak::text,
         public.pool_run__rev(r.author, r.hero_id, r.seed)
  from public.pool_runs r where r.eligible and r.live order by r.id;
end $$;

create or replace function ops.pool_digest(p_params jsonb) returns jsonb
language plpgsql volatile set search_path = public set work_mem = '16MB' as $$
declare
  ids bigint[];
  m jsonb := '{}'::jsonb;
  e jsonb;
  lines text[] := '{}';
  out_rows jsonb := '[]'::jsonb;
  i int;
  n int;
begin
  if p_params is null or jsonb_typeof(p_params) = 'null' then
    select coalesce(array_agg(r.id order by r.id), '{}') into ids from public.pool_runs r where r.eligible and r.live;
  else
    if jsonb_typeof(p_params) <> 'object' or coalesce(p_params ->> 'p_seed', '') = '' then raise exception 'bad_params'; end if;
    select coalesce(array_agg(k.run_id order by k.ord), '{}') into ids
    from public.pool_runs_sample_keys(
      least(greatest(coalesce((p_params ->> 'p_limit')::int, 150), 0), 300), p_params ->> 'p_set', p_params ->> 'p_patch_prefix', null::uuid,
      p_params ->> 'p_seed', (p_params ->> 'p_strength_min')::numeric, (p_params ->> 'p_strength_max')::numeric,
      p_params ->> 'p_pool', (p_params ->> 'p_early_weight')::numeric, (p_params ->> 'p_strength_cap')::numeric,
      (p_params ->> 'p_peak_cap')::numeric
    ) with ordinality as k(run_id, run_key, author, user_id, wave_count, strength, strength_early, strength_late, strength_peak, rev, ord);
  end if;
  n := coalesce(array_length(ids, 1), 0);

  i := 1;
  while i <= n loop
    select m || coalesce(jsonb_object_agg(b.run_id::text, jsonb_build_array(b.run_key, b.rev,
             encode(extensions.digest(b.boards::text, 'sha256'), 'hex'))), '{}'::jsonb)
      into m from public.pool_runs_boards(ids[i:least(i + 299, n)]) b;
    i := i + 300;
  end loop;

  for i in 1..n loop
    e := m -> (ids[i]::text);
    continue when e is null;  -- the run left the pool between the draw and the boards read
    lines := lines || format('%s|%s|%s|%s', ids[i], e ->> 0, e ->> 1, e ->> 2);
    out_rows := out_rows || jsonb_build_object('run_id', ids[i], 'rev', e ->> 1, 'h', left(e ->> 2, 16));
  end loop;

  return jsonb_build_object('count', coalesce(array_length(lines, 1), 0),
    'digest', encode(extensions.digest(array_to_string(lines, E'\n'), 'sha256'), 'hex'), 'rows', out_rows);
end $$;

revoke all on function public.pool_strength_refresh(text[], text[], bigint[]) from public, anon, authenticated;
revoke all on function public.pool_mirror_version(text) from public;
revoke all on function public.pool_mirror_index(text) from public;
grant execute on function public.pool_mirror_version(text) to anon, authenticated;
grant execute on function public.pool_mirror_index(text) to anon, authenticated;
revoke all on function ops.pool_digest(jsonb) from public;

-- ── 4. Start: write every live run's peak ──────────────────────────────────────────────────────────────────
select public.pool_strength_refresh(null, null, null);

commit;

notify pgrst, 'reload schema';
