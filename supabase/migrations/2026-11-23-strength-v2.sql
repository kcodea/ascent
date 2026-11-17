-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- STRENGTH V2: carry-forward ranking, the 7-round floor, "scored only when complete", unscored runs out of banded
-- draws (owner design 2026-11-16; docs/superpowers/specs/2026-11-16-strength-v2-design.md, sections 6.B, 6.B2,
-- Transition)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Apply with `npm run db:apply -- supabase/migrations/2026-11-23-strength-v2.sql --yes`, AFTER
-- 2026-11-22-pool-rolling-window.sql (it replaces functions that file defines, and refuses to run without it), and
-- BEFORE the client that scores with reference set2-v2 ships: that client uploads `boards.strength_carried`, and an
-- upload naming a column that does not exist fails.
-- DO NOT APPLY THIS FILE ALONE ON THE LIVE DATABASE. On its own it leaves every run unscored (the stored scores are
-- still set2-v1) until a backfill runs, and a hub that has not been redeployed still seats unscored runs in Bronze,
-- Silver and Gold tables (its draw is the old port). Instead run `npm run strength -- backfill`: it writes
-- packages/tools/.cache/strength-v2-apply.sql, which is THIS FILE with every pool board's set2-v2 score (and each
-- run's carried scores) written inside the same transaction, just before step 8 re-rates the pool. Apply that one
-- file, then Ship Ascent straight away (the new hub and client). Until the hub ships, a run uploaded by a client
-- that has not updated is unscored and can still be drawn into a banded table by the old hub.
-- Idempotent: safe to re-run.
--
-- WHAT:
--  1. `boards.strength_carried`: on a run's FINAL board only, `{"ref": "<version>", "rounds": {"<round>": <raw>}}`:
--     that board's raw win rate against every reference round the run never reached, up to the last one (15).
--  2. `strength_ref_current()` / `strength_ref_last_round()`: the ONLY places the SQL names the reference.
--  3. THE 7-ROUND FLOOR (owner: "we should never have any snapshots of boards that are below 7 rounds"; "exclude
--     them"): a run is eligible only when its last recorded round is 7 or later. This replaces "at least 4 rounds".
--     Short runs already stored are marked ineligible. NOTHING IS DELETED.
--  4. THE RANKING. The population of round N (1..15) is every LIVE, COMPLETE run exactly once: its real board at N
--     (an empty board is raw 0), or, when its recording ended before N, its final board's carried score. A board on a
--     round past 15 is ranked AGAINST round 15's population without joining it. A run is COMPLETE when every real
--     board with minions has a score of the current reference and its final board carries every round up to 15;
--     anything else is UNSCORED: `strength`, `strength_early` and `strength_late` are null (never a low number).
--       Game strength (`strength`)   = the round-weighted average of the run's REAL rounds, ranked among live runs.
--       EARLY (`strength_early`)     = the mean of rounds 1-9, real and carried, ranked among live runs.
--       LATE (`strength_late`)       = the mean of rounds 10-15, real and carried, ranked among live runs.
--     The TypeScript definition is `rateRunsV2` (packages/sim/src/lobby/strengthV2.ts);
--     packages/sim/src/lobby/strengthV2.db.test.ts holds the two equal on a 30-run pool.
--  5. `board_strength_hist` (what `board_strength_histogram` serves, and the client ranks its own board against)
--     is that same population.
--  6. THE DRAW: with a band or a cap (`p_strength_min`, `p_strength_max` or `p_strength_cap` given), an unscored
--     run is left out. With none of them the draw is unchanged. (It used to be inside every band, R-LOBBY-09.)
--     `pool_runs_sample` and `pool_runs__pick` keep identical picking blocks; the hub Worker's port
--     (workers/versus/src/core/poolPick.ts) changes in the same PR.
--  7. `pool_live_unscored()`: how many live runs are unscored (a growing number means clients on an old build).
--
-- `pool_refresh_dirty()` is unchanged: it already calls the functions replaced here. `pool_strength_refresh` keeps
-- its signature but always re-rates every live run (250 runs x 15 rounds; cheaper than the per-key path it replaces).
--
-- ROLLBACK: re-apply 2026-10-17-pool-empty-boards.sql (pool_runs_upsert_from), then
-- 2026-11-22-pool-rolling-window.sql (the draw, the refresh, the histograms), then `select public.pool_runs_rebuild();
-- select public.pool_live_refresh(); select public.pool_strength_refresh(null, null, null);
-- select public.pool_strength_hist_refresh();`. The column and the new functions can stay.

do $$ begin
  if to_regprocedure('public.pool_live_refresh()') is null then
    raise exception 'apply 2026-11-22-pool-rolling-window.sql before 2026-11-23-strength-v2.sql';
  end if;
end $$;

begin;
-- Keep the once-a-minute job out while this runs (it takes the same lock, and locks the two tables in the other order).
select pg_advisory_xact_lock(hashtext('public.pool_refresh_dirty'));
lock table public.pool_runs in access exclusive mode;
lock table public.boards in access exclusive mode;

-- ── 1. Carried scores ──────────────────────────────────────────────────────────────────────────────────────
alter table public.boards add column if not exists strength_carried jsonb;

-- ── 2. The reference, named once ───────────────────────────────────────────────────────────────────────────
create or replace function public.strength_ref_current() returns text
language sql immutable as $$ select 'set2-v2'::text $$;
create or replace function public.strength_ref_last_round() returns int
language sql immutable as $$ select 15 $$;

-- ── 3. The 7-round floor ───────────────────────────────────────────────────────────────────────────────────
create or replace function public.pool_min_last_round() returns int
language sql immutable as $$ select 7 $$;

-- The last round at 7 or later, the first at round 1 or 2, never more than one round missing in a row, plausible tiers.
create or replace function public.pool_run_eligible(p_wave_count int, p_first_wave int, p_max_gap int, p_tiers_ok boolean, p_last_wave int) returns boolean
language sql immutable as $$
  select p_last_wave >= public.pool_min_last_round() and p_first_wave <= 2 and p_max_gap <= 1 and p_tiers_ok
$$;

-- 2026-10-17-pool-empty-boards.sql; the change: the eligibility call passes the last round.
create or replace function public.pool_runs_upsert_from(p_author text[], p_hero text[], p_seed bigint[]) returns void
language plpgsql set search_path = public as $$
begin
  with keys as (
    select distinct k.a as author, k.h as hero_id, k.s as seed
    from unnest(p_author, p_hero, p_seed) as k(a, h, s)
    where k.s is not null and k.h is not null
  ),
  b as (
    select k.author, k.hero_id, k.seed, x.wave, x.user_id, x.patch, x.created_at, x.snapshot
    from keys k
    join public.boards x on coalesce(x.author, 'anon') = k.author and x.hero_id = k.hero_id and x.seed = k.seed
    where jsonb_typeof(x.snapshot -> 'minions') = 'array'
      and coalesce(x.origin, 'self') <> 'synthetic'
  ),
  w as (select distinct author, hero_id, seed, wave from b),
  shape as (
    select author, hero_id, seed, count(*)::int as wave_count, min(wave) as first_wave, max(wave) as last_wave,
           coalesce(max(wave - prev - 1), 0)::int as max_gap
    from (select w.*, lag(wave) over (partition by author, hero_id, seed order by wave) as prev from w) t
    group by author, hero_id, seed
  ),
  agg as (
    select author, hero_id, seed, count(*)::int as boards,
           (array_agg(user_id order by created_at) filter (where user_id is not null))[1] as user_id,
           (array_agg(coalesce(snapshot ->> 'setId', 'set1') order by created_at))[1] as set_id,
           (array_agg(split_part(patch, '+', 1) || '+' order by created_at desc))[1] as patch_prefix,
           bool_and(case when jsonb_typeof(snapshot -> 'tier') = 'number'
                         then (snapshot ->> 'tier')::numeric <= public.pool_max_plausible_tier(wave) else true end) as tiers_ok,
           bool_or(jsonb_array_length(snapshot -> 'minions') > 0) as has_minions
    from b group by author, hero_id, seed
  )
  insert into public.pool_runs as r (author, hero_id, seed, user_id, set_id, patch_prefix, boards, wave_count, first_wave,
                                      last_wave, max_gap, tiers_ok, eligible, updated_at)
  select a.author, a.hero_id, a.seed, a.user_id, a.set_id, a.patch_prefix, a.boards, s.wave_count, s.first_wave,
         s.last_wave, s.max_gap, a.tiers_ok, public.pool_run_eligible(s.wave_count, s.first_wave, s.max_gap, a.tiers_ok, s.last_wave) and a.has_minions, now()
  from agg a join shape s using (author, hero_id, seed)
  on conflict (author, hero_id, seed) do update set
    user_id = excluded.user_id, set_id = excluded.set_id, patch_prefix = excluded.patch_prefix, boards = excluded.boards,
    wave_count = excluded.wave_count, first_wave = excluded.first_wave, last_wave = excluded.last_wave,
    max_gap = excluded.max_gap, tiers_ok = excluded.tiers_ok, eligible = excluded.eligible, updated_at = now();

  delete from public.pool_runs r
  using (select distinct k.a as author, k.h as hero_id, k.s as seed from unnest(p_author, p_hero, p_seed) as k(a, h, s)) k
  where r.author = k.author and r.hero_id = k.hero_id and r.seed = k.seed
    and not exists (
      select 1 from public.boards x
      where coalesce(x.author, 'anon') = r.author and x.hero_id = r.hero_id and x.seed = r.seed
        and jsonb_typeof(x.snapshot -> 'minions') = 'array'
        and coalesce(x.origin, 'self') <> 'synthetic');
end $$;

-- ── 4. The ranking ─────────────────────────────────────────────────────────────────────────────────────────
-- Every round every live, complete run fields: `member` = it counts in that round's population (a round past the
-- last reference round does not); `bucket` = the reference round it is ranked in.
create or replace function public.pool_strength_entries()
returns table (run_id bigint, set_id text, round int, carried boolean, bucket int, member boolean, raw numeric)
language sql stable set search_path = public as $$
  with cur as (select public.strength_ref_current() as v, public.strength_ref_last_round() as lr),
  -- One board per run per round: the first uploaded, the order the sample serves them in.
  rb as (
    select distinct on (r.id, x.wave) r.id as run_id, r.set_id, x.wave::int as wave,
           jsonb_array_length(x.snapshot -> 'minions') as minions, x.strength_raw, x.strength_ref, x.strength_carried
    from public.pool_runs r
    join public.boards x on coalesce(x.author, 'anon') = r.author and x.hero_id = r.hero_id and x.seed = r.seed
    where r.eligible and r.live
      and jsonb_typeof(x.snapshot -> 'minions') = 'array'
      and coalesce(x.origin, 'self') <> 'synthetic'
    order by r.id, x.wave, x.created_at, x.id
  ),
  fin as (
    select distinct on (b.run_id) b.run_id, b.set_id, b.wave as last_wave, b.strength_carried
    from rb b order by b.run_id, b.wave desc
  ),
  -- COMPLETE runs only.
  ok as (
    select f.run_id, f.set_id, f.last_wave, f.strength_carried
    from fin f cross join cur
    where not exists (select 1 from rb b where b.run_id = f.run_id and b.minions > 0
                        and (b.strength_raw is null or b.strength_ref is distinct from cur.v))
      and (f.last_wave >= cur.lr
           or (f.strength_carried ->> 'ref' = cur.v
               and jsonb_typeof(f.strength_carried -> 'rounds') = 'object'
               and not exists (select 1 from generate_series(f.last_wave + 1, cur.lr) g
                               where jsonb_typeof(f.strength_carried -> 'rounds' -> g::text) is distinct from 'number')))
  )
  select b.run_id, b.set_id, b.wave, false, least(b.wave, cur.lr), b.wave <= cur.lr,
         case when b.minions > 0 then b.strength_raw else 0::numeric end
  from rb b join ok o on o.run_id = b.run_id cross join cur
  union all
  select o.run_id, o.set_id, g, true, g, true, (o.strength_carried -> 'rounds' ->> g::text)::numeric
  from ok o cross join cur cross join lateral generate_series(o.last_wave + 1, cur.lr) g
$$;

-- Each entry's percentile in its round: `board_strength_pct` (the one percentile rule) over the round's members,
-- the entry itself counted once (a visitor from a round past the last reference round adds itself).
create or replace function public.pool_strength_round_pcts()
returns table (run_id bigint, set_id text, round int, carried boolean, p int)
language sql stable set search_path = public as $$
  with e as materialized (select * from public.pool_strength_entries()),
  h as (select e.set_id, e.bucket, e.raw, count(*) as n from e where e.member group by 1, 2, 3),
  -- Each value's count below it and its round's total, in one pass (a member reads its own row: no rescan).
  hc as (
    select h.set_id, h.bucket, h.raw, h.n,
           coalesce(sum(h.n) over (partition by h.set_id, h.bucket order by h.raw
                                   rows between unbounded preceding and 1 preceding), 0)::bigint as below,
           sum(h.n) over (partition by h.set_id, h.bucket)::bigint as total
    from h
  )
  select e.run_id, e.set_id, e.round, e.carried, public.board_strength_pct(hc.below, hc.n, hc.total)
  from e join hc on hc.set_id is not distinct from e.set_id and hc.bucket = e.bucket and hc.raw = e.raw
  where e.member
  union all
  -- The few visitors (a real board on a round past the last reference round): ranked against the round, plus itself.
  select e.run_id, e.set_id, e.round, e.carried, public.board_strength_pct(a.below, a.equal + 1, a.total + 1)
  from e cross join lateral (
    select coalesce(sum(h.n) filter (where h.raw < e.raw), 0)::bigint as below,
           coalesce(sum(h.n) filter (where h.raw = e.raw), 0)::bigint as equal,
           coalesce(sum(h.n), 0)::bigint as total
    from h where h.set_id is not distinct from e.set_id and h.bucket = e.bucket) a
  where not e.member
$$;

-- 2026-11-22-pool-rolling-window.sql; the change: the averages come from `pool_strength_round_pcts` (every live run,
-- always; the key arguments are kept for the callers and ignored), Game strength over REAL rounds, EARLY and LATE
-- over real and carried rounds, LATE stopping at round 15. The three rankings are unchanged.
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
           sum(p) filter (where round between 10 and 15)::bigint as sl, count(p) filter (where round between 10 and 15) as nl
    from pct where p is not null group by run_id
  ),
  agg as (
    select run_id,
           public.board_strength_weighted_avg(s1, n1, s2, n2, s3, n3)::numeric as s,
           public.board_strength_mean(se, ne)::numeric as e,
           public.board_strength_mean(sl, nl)::numeric as l
    from grp
  )
  update public.pool_runs r
     set strength_avg = a.s, strength_early_avg = a.e, strength_late_avg = a.l, strength_at = now()
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

-- ── 5. The histograms (2026-11-22-pool-rolling-window.sql; the change: the board histogram is the v2 population) ──
create or replace function public.pool_strength_hist_refresh() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.board_strength_hist;
  insert into public.board_strength_hist (strength_ref, strength_wave, strength_raw, n)
  select public.strength_ref_current(), e.bucket::smallint, e.raw, count(*)
  from public.pool_strength_entries() e
  where e.member and e.raw is not null
  group by 1, 2, 3;
  delete from public.run_strength_hist;
  insert into public.run_strength_hist (set_id, strength_avg, n)
  select r.set_id, r.strength_avg, count(*) from public.pool_runs r
  where r.live and r.set_id is not null and r.strength_avg is not null
  group by 1, 2;
end $$;

-- ── 6. The draw (2026-11-22-pool-rolling-window.sql; the change, twice in each: with a band or a cap, a run with no
--       strength is out, so the cap line no longer lets a null through). KEEP THE TWO PICKING BLOCKS IDENTICAL. ──
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
  p_strength_cap numeric default null
) returns table (run_key text, author text, user_id uuid, wave_count int, strength numeric, strength_early numeric, strength_late numeric, boards jsonb)
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
        and ((p_strength_min is null and p_strength_max is null and p_strength_cap is null) or r.strength is not null)
        and (p_strength_cap is null or r.strength <= p_strength_cap)
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
        and ((p_strength_min is null and p_strength_max is null and p_strength_cap is null) or r.strength is not null)
        and (p_strength_cap is null or r.strength <= p_strength_cap)
        and (public.pool_match_score(r.strength, r.strength_early, r.strength_late, p_early_weight) is null
             or ((p_strength_min is null or public.pool_match_score(r.strength, r.strength_early, r.strength_late, p_early_weight) >= p_strength_min)
             and (p_strength_max is null or public.pool_match_score(r.strength, r.strength_early, r.strength_late, p_early_weight) <= p_strength_max)));
      if found then picked := picked || cand; end if;
    end loop;
  end if;

  return query
  select r.author || '|' || r.hero_id || '|' || r.seed::text, r.author, r.user_id, r.wave_count, r.strength,
         r.strength_early, r.strength_late,
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
  p_strength_cap numeric
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
        and ((p_strength_min is null and p_strength_max is null and p_strength_cap is null) or r.strength is not null)
        and (p_strength_cap is null or r.strength <= p_strength_cap)
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
        and ((p_strength_min is null and p_strength_max is null and p_strength_cap is null) or r.strength is not null)
        and (p_strength_cap is null or r.strength <= p_strength_cap)
        and (public.pool_match_score(r.strength, r.strength_early, r.strength_late, p_early_weight) is null
             or ((p_strength_min is null or public.pool_match_score(r.strength, r.strength_early, r.strength_late, p_early_weight) >= p_strength_min)
             and (p_strength_max is null or public.pool_match_score(r.strength, r.strength_early, r.strength_late, p_early_weight) <= p_strength_max)));
      if found then picked := picked || cand; end if;
    end loop;
  end if;
  return picked;
end $$;

-- ── 7. How many live runs are unscored ─────────────────────────────────────────────────────────────────────
create or replace function public.pool_live_unscored() returns int
language sql stable set search_path = public as $$
  select count(*)::int from public.pool_runs r where r.eligible and r.live and r.strength is null
$$;

revoke all on function public.pool_strength_entries() from public, anon, authenticated;
revoke all on function public.pool_strength_round_pcts() from public, anon, authenticated;
revoke all on function public.pool_live_unscored() from public, anon, authenticated;
revoke all on function public.pool_strength_refresh(text[], text[], bigint[]) from public, anon, authenticated;
revoke all on function public.pool_strength_hist_refresh() from public, anon, authenticated;

-- ── 8. Start: apply the floor to the stored runs, re-mark the window, re-rate, rebuild the histograms ─────────
update public.pool_runs r
   set eligible = false, updated_at = now()
 where r.eligible and coalesce(r.last_wave, 0) < public.pool_min_last_round();
select public.pool_live_refresh();
select public.pool_strength_refresh(null, null, null);
select public.pool_strength_hist_refresh();

commit;

notify pgrst, 'reload schema';
