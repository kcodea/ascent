-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- THE PEAK COUNTS FROM ROUND 4 (owner 2026-11-17: "best board should not include win rates for boards on rounds 1, 2,
-- or 3"; R-LOBBY-21 amended)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Apply with `npm run db:apply -- supabase/migrations/2026-11-25-strength-peak-from-round-4.sql --yes`, AFTER
-- 2026-11-24-strength-peak-cap.sql (it replaces the refresh that file defines, and refuses to run without its column).
--
-- A run's PEAK (`pool_runs.strength_peak`) was the highest percentile among its real boards from round 3 on. It is now
-- from round 4 on: a strong round-3 board no longer keeps a run out of Bronze, Silver or Gold. The TypeScript
-- definition is `runPeakOf` / `PEAK_FROM_ROUND` (packages/sim/src/lobby/strengthV2.ts);
-- packages/sim/src/lobby/strengthPeak.db.test.ts holds the two equal.
--
-- The ONLY change is one number in `pool_strength_refresh` (`round >= 3` -> `round >= 4`); the rest of the function is
-- a copy of 2026-11-24-strength-peak-cap.sql. No signature changes, so no draw function, grant or client is touched,
-- and it can go in before or after the client that carries the same change ships (the client re-checks the cap on the
-- peak the server delivers, never on one it computes). Idempotent: safe to re-run.
--
-- IF 2026-11-24-strength-peak-cap.sql IS EVER RE-APPLIED, RE-APPLY THIS FILE straight after it: that file puts the
-- round-3 refresh back.

begin;

do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pool_runs' and column_name = 'strength_peak') then
    raise exception 'apply 2026-11-24-strength-peak-cap.sql first: pool_runs.strength_peak does not exist';
  end if;
end $$;

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
           max(p) filter (where not carried and round >= 4) as pk
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

revoke all on function public.pool_strength_refresh(text[], text[], bigint[]) from public, anon, authenticated;

-- Start: rewrite every live run's peak under the new rule.
select public.pool_strength_refresh(null, null, null);

commit;
