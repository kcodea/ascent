-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- EARLY / LATE RUN STRENGTH: two more ratings per run, and rank bands that blend them  (2026-10-06, R-LOBBY-13)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-10-06-weighted-strength-again.sql. Idempotent: safe to
-- re-run. The same block is appended to schema.sql; keep the two identical. Owner runbook:
-- docs/devlog/2026-10-06-early-late-strength-bands.md.
--
-- WHY (owner 2026-10-06: "perhaps we have multiple ratings like the weighted system / and we lean into those different
-- ratings depending on the rank / and then open it up to anything goes after a certain rank / ... early is 1-9 / late
-- is 10+ / for bronze we should have a near 100% focus on making sure that the early board strength stat is 0-20 or
-- w/e / then silver is like 10-30 with an 80% weight / etc / then gold is 10-50 with 60% weight", then "Blend, then
-- band" and "Open from Platinum"):
--
--  - `pool_runs.strength_early_avg` / `strength_late_avg`: the PLAIN mean of the run's board percentiles in rounds 1-9
--    / rounds 10+ (`boards.wave`), rounded half up to 1..100 (`board_strength_mean`, the same body as
--    `board_strength_final`). Null for a side with no scored board (a run that ended before round 10 has no late).
--  - `pool_runs.strength_early` / `strength_late`: each average RANKED among the runs of its set by the same
--    tie-halving rule as a board (`board_strength_pct`), exactly as `strength` ranks `strength_avg`. The SQL twins of
--    the TS `earlyLateStrengthOf` / `rankAmongRuns`, parity-tested in packages/sim/src/lobby/boardStrength.db.test.ts.
--  - `pool_runs.strength` / `strength_avg` are computed EXACTLY as before (2026-10-06-weighted-strength-again.sql):
--    they stay the "Game strength" a player sees, and what a client from before this change filters on.
--  - `pool_match_score(strength, early, late, weight)`: a run's score for a rank, `weight x early + (1 - weight) x
--    late`; early alone when late is null (late alone when only late exists); the weighted strength when neither is
--    known; the weighted strength itself when the weight is null. The SQL twin of the TS `matchScoreOf`.
--  - `pool_runs_sample` gains `p_early_weight` and returns `strength_early` / `strength_late`. With a weight, the band
--    (`p_strength_min` .. `p_strength_max`) filters the blended score; WITHOUT one it filters `strength`, so a client
--    deployed before this change (it never sends a weight) keeps exactly its 2026-09-30 behaviour. An unscored run
--    (null score) is inside every band, as before. Still uniform inside the band, whole runs.
--  - The closing refresh recomputes every run, so the new bands have their numbers the moment this file runs.
--
-- Locks: the board-strength migration deadlocked against live pool reads, so everything runs in one transaction that
-- takes both tables first.

begin;
lock table public.pool_runs in access exclusive mode;
lock table public.boards in access exclusive mode;

-- ── 1. Columns ─────────────────────────────────────────────────────────────────────────────────────────────
alter table public.pool_runs add column if not exists strength_early_avg numeric; -- mean board percentile, rounds 1-9
alter table public.pool_runs add column if not exists strength_late_avg numeric;  -- mean board percentile, rounds 10+
alter table public.pool_runs add column if not exists strength_early numeric;     -- early average ranked among runs 1..100
alter table public.pool_runs add column if not exists strength_late numeric;      -- late average ranked among runs 1..100

-- ── 2. The mean (mirrors meanFromSum in boardStrength.ts) ──────────────────────────────────────────────────
-- The mean of n whole percentiles summing to s, rounded half up as floor((2 s + n) / (2 n)), clamped to 1..100.
create or replace function public.board_strength_mean(p_sum bigint, p_n bigint) returns int
language sql immutable as $$
  select case when coalesce(p_n, 0) <= 0 then null
              else least(100, greatest(1, ((2 * coalesce(p_sum, 0) + p_n) / (2 * p_n))::int)) end
$$;

-- ── 3. A run's score for a rank (mirrors matchScoreOf in boardStrength.ts) ─────────────────────────────────
create or replace function public.pool_match_score(p_strength numeric, p_early numeric, p_late numeric, p_weight numeric) returns numeric
language sql immutable as $$
  select case
    when p_weight is null then p_strength
    when p_early is not null and p_late is not null
      then greatest(0, least(1, p_weight)) * p_early + (1 - greatest(0, least(1, p_weight))) * p_late
    when p_early is not null then p_early
    when p_late is not null then p_late
    else p_strength end
$$;

-- ── 4. pool_strength_refresh: the weighted strength exactly as before, plus early / late (same signature) ────
create or replace function public.pool_strength_refresh(p_author text[] default null, p_hero text[] default null, p_seed bigint[] default null) returns int
language plpgsql set search_path = public as $$
declare v int;
begin
  with keys as (
    select r.id, r.author, r.hero_id, r.seed from public.pool_runs r
    where p_author is null
       or (r.author, r.hero_id, r.seed) in (select k.a, k.h, k.s from unnest(p_author, p_hero, p_seed) as k(a, h, s))
  ),
  c as (select * from public.board_strength_cumulative()),
  pct as (
    select k.id as run_id, x.wave, public.board_strength_pct(c.below, c.n, c.total) as p
    from keys k
    join public.boards x on coalesce(x.author, 'anon') = k.author and x.hero_id = k.hero_id and x.seed = k.seed
    join c on c.strength_ref = x.strength_ref and c.strength_wave = x.strength_wave and c.strength_raw = x.strength_raw
    where x.strength_raw is not null
  ),
  grp as (
    select run_id,
           sum(p) filter (where wave <= 5)::bigint as s1, count(p) filter (where wave <= 5) as n1,
           sum(p) filter (where wave between 6 and 9)::bigint as s2, count(p) filter (where wave between 6 and 9) as n2,
           sum(p) filter (where wave >= 10)::bigint as s3, count(p) filter (where wave >= 10) as n3,
           sum(p) filter (where wave <= 9)::bigint as se, count(p) filter (where wave <= 9) as ne,
           sum(p) filter (where wave >= 10)::bigint as sl, count(p) filter (where wave >= 10) as nl
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
  from keys k left join agg a on a.run_id = k.id
  where r.id = k.id;
  get diagnostics v = row_count;

  -- Every run's rank among the runs of its set: below = runs with a lower average, equal = runs with the same average
  -- (itself included), n = runs with an average. The same `board_strength_pct` rule as a board. One window per rating.
  with ranked as (
    select r.id, public.board_strength_pct(
      (rank() over w - 1)::bigint,
      count(*) over (partition by r.set_id, r.strength_avg),
      count(*) over (partition by r.set_id))::numeric as s
    from public.pool_runs r
    where r.strength_avg is not null
    window w as (partition by r.set_id order by r.strength_avg)
  )
  update public.pool_runs r set strength = x.s
  from (select p.id, rk.s from public.pool_runs p left join ranked rk on rk.id = p.id) x
  where r.id = x.id and r.strength is distinct from x.s;

  with ranked as (
    select r.id, public.board_strength_pct(
      (rank() over w - 1)::bigint,
      count(*) over (partition by r.set_id, r.strength_early_avg),
      count(*) over (partition by r.set_id))::numeric as s
    from public.pool_runs r
    where r.strength_early_avg is not null
    window w as (partition by r.set_id order by r.strength_early_avg)
  )
  update public.pool_runs r set strength_early = x.s
  from (select p.id, rk.s from public.pool_runs p left join ranked rk on rk.id = p.id) x
  where r.id = x.id and r.strength_early is distinct from x.s;

  with ranked as (
    select r.id, public.board_strength_pct(
      (rank() over w - 1)::bigint,
      count(*) over (partition by r.set_id, r.strength_late_avg),
      count(*) over (partition by r.set_id))::numeric as s
    from public.pool_runs r
    where r.strength_late_avg is not null
    window w as (partition by r.set_id order by r.strength_late_avg)
  )
  update public.pool_runs r set strength_late = x.s
  from (select p.id, rk.s from public.pool_runs p left join ranked rk on rk.id = p.id) x
  where r.id = x.id and r.strength_late is distinct from x.s;
  return v;
end $$;

-- ── 5. The sample, with a blended band ─────────────────────────────────────────────────────────────────────
-- Replaces the 2026-09-30 signature (a changed return type cannot be `create or replace`d). Callers that pass only
-- the old arguments keep working: `p_early_weight` defaults to null, and then the band filters `strength` as before.
drop function if exists public.pool_runs_sample(int, text, text, uuid, text, numeric, numeric, text);
create or replace function public.pool_runs_sample(
  p_limit int default 150,
  p_set text default null,
  p_patch_prefix text default null,
  p_exclude_user uuid default null,
  p_seed text default null,
  p_strength_min numeric default null,
  p_strength_max numeric default null,
  p_pool text default null,
  p_early_weight numeric default null
) returns table (run_key text, author text, user_id uuid, wave_count int, strength numeric, strength_early numeric, strength_late numeric, boards jsonb)
language plpgsql volatile set search_path = public as $$
#variable_conflict use_column
declare
  v_limit int := least(greatest(coalesce(p_limit, 150), 0), 300);
  lo bigint; hi bigint; span bigint;
  picked bigint[] := '{}';
  cand bigint; tries int := 0; u double precision;
begin
  select min(r.id), max(r.id) into lo, hi from public.pool_runs r
  where r.eligible and (p_set is null or r.set_id = p_set) and (p_patch_prefix is null or r.patch_prefix = p_patch_prefix);
  if lo is null or v_limit = 0 then return; end if;
  span := hi - lo + 1;

  if span <= 4 * v_limit then
    -- A small pool: every matching run, shuffled whole (bounded by the id span, so this stays small).
    select coalesce(array_agg(t.id order by t.k), '{}') into picked from (
      select r.id, case when p_seed is null then random() else public.pool_hash01(p_seed || ':' || r.id) end as k
      from public.pool_runs r
      where r.id between lo and hi and r.eligible
        and (p_set is null or r.set_id = p_set) and (p_patch_prefix is null or r.patch_prefix = p_patch_prefix)
        and (p_exclude_user is null or r.user_id is distinct from p_exclude_user)
        and (p_pool is null or r.pool_id = p_pool)
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
      where r.id = cand and r.eligible
        and (p_set is null or r.set_id = p_set) and (p_patch_prefix is null or r.patch_prefix = p_patch_prefix)
        and (p_exclude_user is null or r.user_id is distinct from p_exclude_user)
        and (p_pool is null or r.pool_id = p_pool)
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
            and jsonb_typeof(x.snapshot -> 'minions') = 'array' and jsonb_array_length(x.snapshot -> 'minions') > 0
            and coalesce(x.origin, 'self') <> 'synthetic')
  from unnest(picked) with ordinality as p(id, ord)
  join public.pool_runs r on r.id = p.id
  order by p.ord;
end $$;

-- ── 6. Who may call what ───────────────────────────────────────────────────────────────────────────────────
revoke all on function public.pool_strength_refresh(text[], text[], bigint[]) from public, anon, authenticated;
grant execute on function public.pool_runs_sample(int, text, text, uuid, text, numeric, numeric, text, numeric) to anon, authenticated;

-- ── 7. One-time: recompute every run (weighted strength unchanged; early / late filled) ──────────────────────
select public.pool_strength_refresh(null, null, null);

commit;
