-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- WEIGHTED RUN STRENGTH: a run's average weighs its rounds by group  (2026-09-30, R-LOBBY-09)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-09-30-board-strength.sql. Idempotent: safe to re-run. The
-- same block is appended to schema.sql; keep the two identical. Owner runbook: docs/devlog/2026-09-30-weighted-strength.md.
--
-- WHY (owner 2026-09-30: "i think we need to weigh the rounds a bit. rounds 1-5 matter much less than 6-9 which matter
-- less than 10+. they are all still important but i wonder if weighing would be better. like 20% ish for 1-5, 35% for
-- 6-9 and 45% for 10+?"):
--
--  - `pool_runs.strength_avg` was the PLAIN average of the run's board percentiles. It becomes a WEIGHTED average:
--    rounds 1-5 share 20% of the weight, rounds 6-9 share 35%, rounds 10+ share 45%; inside a group the share is split
--    evenly across the run's scored boards in it (a round with two boards counts twice, as in the plain average). A
--    group the run has no boards in drops out and the rest are renormalised (a run that ended in round 8: 20/55 and
--    35/55). Rounded half up to 1..100 in exact integer arithmetic (`board_strength_weighted_avg`, the SQL twin of the
--    TS `weightedAvgFromGroups` / `runWeightedAverageOf`, parity-tested in boardStrength.db.test.ts).
--  - `pool_runs.strength` (the average ranked among runs) is unchanged in definition; it is re-ranked on the new
--    averages by the refresh at the end of this file.
--  - The round is the board's own wave (`boards.wave`), not its reference wave.
--
-- Locks: the first board-strength migration deadlocked against live pool reads, so everything runs in one transaction
-- that takes both tables first.

begin;
lock table public.pool_runs in access exclusive mode;
lock table public.boards in access exclusive mode;

-- ── 1. The weighted average of a run's groups (mirrors weightedAvgFromGroups in boardStrength.ts) ─────────────
-- s1/n1 = sum and count of the run's board percentiles in rounds 1-5, s2/n2 rounds 6-9, s3/n3 rounds 10+.
-- value = (20 s1/n1 + 35 s2/n2 + 45 s3/n3) / (sum of the weights of the groups with n > 0), as num / den over the
-- common denominator m1 m2 m3 (m = greatest(n, 1)), rounded half up as floor((2 num + den) / (2 den)).
create or replace function public.board_strength_weighted_avg(s1 bigint, n1 bigint, s2 bigint, n2 bigint, s3 bigint, n3 bigint) returns int
language sql immutable as $$
  with t as (
    select greatest(coalesce(n1, 0), 1) as m1, greatest(coalesce(n2, 0), 1) as m2, greatest(coalesce(n3, 0), 1) as m3,
           case when coalesce(n1, 0) > 0 then coalesce(s1, 0) else 0 end as a1,
           case when coalesce(n2, 0) > 0 then coalesce(s2, 0) else 0 end as a2,
           case when coalesce(n3, 0) > 0 then coalesce(s3, 0) else 0 end as a3,
           (case when coalesce(n1, 0) > 0 then 20 else 0 end
          + case when coalesce(n2, 0) > 0 then 35 else 0 end
          + case when coalesce(n3, 0) > 0 then 45 else 0 end)::bigint as w
  ),
  f as (select 20 * a1 * m2 * m3 + 35 * a2 * m1 * m3 + 45 * a3 * m1 * m2 as num, w * m1 * m2 * m3 as den, w from t)
  select case when w = 0 then null else least(100, greatest(1, ((2 * num + den) / (2 * den))::int)) end from f
$$;

-- ── 2. pool_strength_refresh with the weighted average (same signature, same rank step) ───────────────────
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
           sum(p) filter (where wave >= 10)::bigint as s3, count(p) filter (where wave >= 10) as n3
    from pct where p is not null group by run_id
  ),
  agg as (select run_id, public.board_strength_weighted_avg(s1, n1, s2, n2, s3, n3)::numeric as s from grp)
  update public.pool_runs r set strength_avg = (select a.s from agg a where a.run_id = r.id), strength_at = now()
  from keys k where r.id = k.id;
  get diagnostics v = row_count;

  -- Every run's rank among the runs of its set (unchanged): below = runs with a lower average, equal = runs with the
  -- same average (itself included), n = runs with an average. The same `board_strength_pct` rule as a board.
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
  return v;
end $$;

-- ── 3. Who may call what ───────────────────────────────────────────────────────────────────────────────────
revoke all on function public.pool_strength_refresh(text[], text[], bigint[]) from public, anon, authenticated;

-- ── 4. Recompute every run's average and strength on the new weights ───────────────────────────────────────
select public.pool_strength_refresh(null, null, null);

commit;
