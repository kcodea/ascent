-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- WEIGHTED RUN STRENGTH, AGAIN: back to the round-weighted average ranked among runs  (2026-10-06, R-LOBBY-12)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-10-03-final-board-strength.sql (it is safe on a database
-- that never ran that file too). Idempotent: safe to re-run. The same block is appended to schema.sql; keep the two
-- identical. Owner runbook: docs/devlog/2026-10-06-strength-back-to-weighted.md.
--
-- WHY (owner 2026-10-06: "matchmaking algorithm -> backtrack to the weighted version"). Under the final-board formula
-- (2026-10-03) a run's strength correlated only ~0.03-0.19 with its board percentile in rounds 3-7, against 0.26-0.62
-- for the weighted version, and Bronze lobbies were dealing round-7 boards at the 88th percentile labelled
-- "Game strength 2".
--
--  - `pool_strength_refresh` goes back to EXACTLY the 2026-09-30-weighted-strength.sql definition:
--    `pool_runs.strength_avg` = the round-weighted average of the run's board percentiles (rounds 1-5 share 20%,
--    6-9 share 35%, 10+ share 45%; `board_strength_weighted_avg`, unchanged), and `pool_runs.strength` = that average
--    RANKED among the runs of its set by the same tie-halving rule as a board (`board_strength_pct`). The SQL twins of
--    the TS `runWeightedAverageOf` / `runPercentileOf`, parity-tested in packages/sim/src/lobby/boardStrength.db.test.ts.
--  - `board_strength_final` (2026-10-03) is left in place, unused: dropping it buys nothing and a re-run of the
--    2026-10-03 file would need it.
--  - `run_strength_histogram` (unchanged since 2026-09-30) is what the client ranks its own finished game against.
--  - The closing refresh recomputes every run, so the bands flip the moment this file runs.
--
-- Locks: the board-strength migration deadlocked against live pool reads, so everything runs in one transaction that
-- takes both tables first.

begin;
lock table public.pool_runs in access exclusive mode;
lock table public.boards in access exclusive mode;

-- ── 1. pool_strength_refresh: the weighted average, ranked among runs (same signature) ──────────────────────
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

  -- Every run's rank among the runs of its set: below = runs with a lower average, equal = runs with the same average
  -- (itself included), n = runs with an average. The same `board_strength_pct` rule as a board.
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

-- ── 2. Who may call what ───────────────────────────────────────────────────────────────────────────────────
revoke all on function public.pool_strength_refresh(text[], text[], bigint[]) from public, anon, authenticated;

-- ── 3. One-time: recompute every run's average and strength (weighted, ranked among runs) ────────────────────
select public.pool_strength_refresh(null, null, null);

commit;
