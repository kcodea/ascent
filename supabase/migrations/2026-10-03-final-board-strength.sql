-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- FINAL-BOARD RUN STRENGTH: a run's strength is its last board's percentile  (2026-10-03, R-LOBBY-09 amended)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-09-30-board-strength.sql and 2026-09-30-weighted-strength.sql.
-- Idempotent: safe to re-run. The same block is appended to schema.sql; keep the two identical. Owner runbook:
-- docs/devlog/2026-10-03-final-board-strength.md.
--
-- WHY (owner 2026-10-03: "i think we basically only care about the final board strength as an indicator for
-- matchmaking. can we try swapping out our algorithm for simply caring about the snapshots final round board
-- strength?"). A run that was dominant in rounds 3-9 and weak at the end (Rooks / Albus, 2026-10-02: a 12th-percentile
-- final board) read as 83 under the round-weighted average ranked among runs.
--
--  - `pool_runs.strength` becomes the percentile of the run's FINAL board: the boards at the run's highest scored
--    `boards.wave`, each board's percentile within its reference wave (`board_strength_pct`, unchanged), averaged and
--    rounded half up when a round has two boards (`board_strength_final`, the SQL twin of the TS `finalFromSum` /
--    `runFinalStrengthOf`, parity-tested in packages/sim/src/lobby/boardStrength.db.test.ts). Used DIRECTLY, not
--    re-ranked among runs: 30 means "the final board beat about 30% of the boards seen at that round".
--  - A run whose last round was never scored falls back to its latest scored round. Unscored runs stay null (inside
--    every band, as before).
--  - `pool_runs.strength_avg` keeps the round-weighted average (2026-09-30) as a diagnostic. `run_strength_histogram`
--    still reads it, so clients deployed before this change keep working (they freeze the old number on their own
--    games until they update); the new client no longer reads it.
--  - The rank-among-runs step is gone: a run's strength now depends only on its own boards and the board population,
--    so a refresh writes the runs it was asked about (and every run on the 10-minute full refresh).
--
-- Locks: the board-strength migration deadlocked against live pool reads, so everything runs in one transaction that
-- takes both tables first.

begin;
lock table public.pool_runs in access exclusive mode;
lock table public.boards in access exclusive mode;

-- ── 1. The final board's value (mirrors finalFromSum in boardStrength.ts) ─────────────────────────────────────
-- The mean of n whole percentiles summing to s, rounded half up as floor((2 s + n) / (2 n)), clamped to 1..100.
create or replace function public.board_strength_final(p_sum bigint, p_n bigint) returns int
language sql immutable as $$
  select case when coalesce(p_n, 0) <= 0 then null
              else least(100, greatest(1, ((2 * coalesce(p_sum, 0) + p_n) / (2 * p_n))::int)) end
$$;

-- ── 2. pool_strength_refresh: strength = the final board's percentile (same signature) ─────────────────────
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
  scored as (select run_id, wave, p, max(wave) over (partition by run_id) as last_wave from pct where p is not null),
  fin as (select run_id, sum(p)::bigint as s, count(*) as n from scored where wave = last_wave group by run_id),
  grp as (
    select run_id,
           sum(p) filter (where wave <= 5)::bigint as s1, count(p) filter (where wave <= 5) as n1,
           sum(p) filter (where wave between 6 and 9)::bigint as s2, count(p) filter (where wave between 6 and 9) as n2,
           sum(p) filter (where wave >= 10)::bigint as s3, count(p) filter (where wave >= 10) as n3
    from scored group by run_id
  ),
  agg as (
    select g.run_id,
           public.board_strength_weighted_avg(g.s1, g.n1, g.s2, g.n2, g.s3, g.n3)::numeric as a,
           public.board_strength_final(f.s, f.n)::numeric as s
    from grp g join fin f on f.run_id = g.run_id
  )
  update public.pool_runs r
     set strength_avg = (select a.a from agg a where a.run_id = r.id),
         strength = (select a.s from agg a where a.run_id = r.id),
         strength_at = now()
  from keys k where r.id = k.id;
  get diagnostics v = row_count;
  return v;
end $$;

-- ── 3. Who may call what ───────────────────────────────────────────────────────────────────────────────────
revoke all on function public.pool_strength_refresh(text[], text[], bigint[]) from public, anon, authenticated;

-- ── 4. One-time: recompute every run's strength as its final board ───────────────────────────────────────────
select public.pool_strength_refresh(null, null, null);

commit;
