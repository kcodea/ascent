-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- THE ROLLING POOL: a new lobby is seated only from the newest 250 eligible recorded runs of its card set
-- (2026-11-15, R-POOL-ROLLING-01)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Apply with `npm run db:apply -- supabase/migrations/2026-11-22-pool-rolling-window.sql --yes`, AFTER
-- 2026-11-20-game-session-cf.sql and 2026-11-21-ops-health-checks.sql (it replaces functions they create).
-- Idempotent: safe to re-run. No client release, no Worker deploy, no Edge Function redeploy: old installed copies and
-- the hub's pool mirror follow on their next fetch / sync (the mirror drops a run that leaves `pool_mirror_index`).
-- Design: docs/superpowers/specs/2026-11-15-pool-rolling-window-design.md.
--
-- WHY (owner 2026-11-15: "its tough facing strong boards that are now weakened due to balancing changes", "lets do
-- newest 250 runs"): the game is rebalanced often, a recorded run keeps the boards it was built with, and every
-- eligible run was drawn with equal chance however old it was. Measured 2026-11-15: 551 eligible runs back to
-- 2026-08-17, 225 of them (41%) more than five weeks old; 50 to 80 new runs a week, so 250 is about four weeks.
--
-- WHAT:
--  1. `pool_runs.live`: true for the newest `pool_live_limit()` (250) ELIGIBLE runs of each `set_id`, by `id`
--     (= upload order: a run keeps its id when its boards are re-uploaded or re-scored, so an old run never comes
--     back). `eligible` keeps its meaning (a whole, servable run); `live` is the window. NOTHING IS DELETED: Career,
--     match details, replays, saved games (`pool_runs_boards` by id) and the balance tools still read every run.
--     To change the number: replace `pool_live_limit()`, then `select public.pool_live_refresh();` and
--     `select public.pool_strength_refresh(null, null, null); select public.pool_strength_hist_refresh();`.
--  2. `pool_live_refresh()` re-marks the flag; `pool_refresh_dirty()` (pg_cron, every minute) calls it right after it
--     adds the new runs, and re-ranks strength in full when the window moved.
--  3. Everything that seats a table reads `eligible and live`: `pool_runs_sample`, `pool_runs__pick` (so
--     `pool_runs_sample_keys`; the two picking blocks stay identical, text-compared in
--     packages/sim/src/lobby/poolRollingWindow.db.test.ts), the hub mirror's `pool_mirror_version` /
--     `pool_mirror_index`, and the ops health check's whole-index digest (`ops.pool_digest`).
--  4. Strength (the 1 to 100 number the rank bands filter on) is ranked among LIVE runs only, so each band keeps its
--     share of the runs that can be seated; a run outside the window keeps its last number. The run histogram the
--     client ranks its own game against (`run_strength_hist`) holds live runs only. The BOARD histogram is unchanged.
--  NOT windowed: `god_board_sample`, and Ranked Duos' recorded duo TEAMS (`duo_runs_sample`, a separate small pool).
--  Solo runs that fill Ranked Duos seats come through `pool_runs_sample` and follow the window.
--
-- Every function below is its current body (the file named above it) with only the marked change. `create or
-- replace` keeps each function's grants (2026-11-09-security-reads-need-session.sql closed the pool RPCs to anon).
--
-- ROLLBACK (the pool serves every eligible run again):
--   re-apply the function definitions of 2026-10-17-pool-empty-boards.sql (pool_runs_sample, then
--   `alter function … set work_mem = '16MB'`), 2026-11-08-pool-runs-delta.sql (pool_runs__pick),
--   2026-10-06-early-late-strength.sql (pool_strength_refresh), 2026-11-07-pool-refresh-off-upload.sql
--   (pool_strength_hist_refresh, pool_refresh_dirty), 2026-11-20-game-session-cf.sql (pool_mirror_version,
--   pool_mirror_index) and 2026-11-21-ops-health-checks.sql (ops.pool_digest); then
--   select public.pool_strength_refresh(null, null, null); select public.pool_strength_hist_refresh();
--   drop function if exists public.pool_live_refresh(); drop function if exists public.pool_live_limit();
--   drop index if exists public.pool_runs_live_idx; alter table public.pool_runs drop column if exists live;
--
-- Locks: as the other pool migrations, both pool tables first (a pool migration once deadlocked against live reads).

begin;
lock table public.pool_runs in access exclusive mode;
lock table public.boards in access exclusive mode;

-- ── 1. The flag, the number, the refresh ───────────────────────────────────────────────────────────────────
alter table public.pool_runs add column if not exists live boolean not null default false;
create index if not exists pool_runs_live_idx on public.pool_runs (set_id, id) where eligible and live;

-- THE number: how many of a set's newest eligible runs a new lobby may be seated from.
create or replace function public.pool_live_limit() returns int
language sql immutable as $$ select 250 $$;

-- Re-mark the window. Only rows whose flag changes are written; returns how many changed (0 = the window stands).
create or replace function public.pool_live_refresh() returns int
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  with newest as (
    select t.id from (
      select r.id, row_number() over (partition by r.set_id order by r.id desc) as rn
      from public.pool_runs r where r.eligible) t
    where t.rn <= public.pool_live_limit()
  )
  update public.pool_runs r set live = x.live
  from (select p.id, (n.id is not null) as live from public.pool_runs p left join newest n on n.id = p.id) x
  where r.id = x.id and r.live is distinct from x.live;
  get diagnostics v = row_count;
  return v;
end $$;
revoke all on function public.pool_live_limit() from public, anon, authenticated;
revoke all on function public.pool_live_refresh() from public, anon, authenticated;

-- ── 2. The draw: live runs only (2026-10-17-pool-empty-boards.sql; the change: `r.eligible` -> `r.eligible and
--       r.live`, three times, and the 16 MB work_mem of 2026-11-07 written into the definition) ─────────────────
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
        and (p_strength_cap is null or r.strength is null or r.strength <= p_strength_cap)
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
        and (p_strength_cap is null or r.strength is null or r.strength <= p_strength_cap)
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

-- 2026-11-08-pool-runs-delta.sql; the same three changes. KEEP IDENTICAL to the block above.
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
        and (p_strength_cap is null or r.strength is null or r.strength <= p_strength_cap)
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
        and (p_strength_cap is null or r.strength is null or r.strength <= p_strength_cap)
        and (public.pool_match_score(r.strength, r.strength_early, r.strength_late, p_early_weight) is null
             or ((p_strength_min is null or public.pool_match_score(r.strength, r.strength_early, r.strength_late, p_early_weight) >= p_strength_min)
             and (p_strength_max is null or public.pool_match_score(r.strength, r.strength_early, r.strength_late, p_early_weight) <= p_strength_max)));
      if found then picked := picked || cand; end if;
    end loop;
  end if;
  return picked;
end $$;

-- ── 3. Strength: ranked among live runs (2026-10-06-early-late-strength.sql; the change: `r.live` in the three
--       `ranked` windows and `where p.live` in the three writes) ───────────────────────────────────────────────
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

  -- THE WINDOW (R-POOL-ROLLING-01): only LIVE runs are ranked, among themselves, and only live rows are written.
  -- A run outside the window keeps its last number.
  -- Every run's rank among the runs of its set: below = runs with a lower average, equal = runs with the same average
  -- (itself included), n = runs with an average. The same `board_strength_pct` rule as a board. One window per rating.
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

-- ── 4. The run histogram: live runs (2026-11-07-pool-refresh-off-upload.sql; the change: `r.live`) ───────────────
create or replace function public.pool_strength_hist_refresh() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.board_strength_hist;
  insert into public.board_strength_hist (strength_ref, strength_wave, strength_raw, n)
  select b.strength_ref, b.strength_wave, b.strength_raw, count(*)
  from public.boards b
  where b.strength_ref is not null and b.strength_raw is not null and b.strength_wave is not null
  group by 1, 2, 3;
  delete from public.run_strength_hist;
  insert into public.run_strength_hist (set_id, strength_avg, n)
  select r.set_id, r.strength_avg, count(*) from public.pool_runs r
  where r.live and r.set_id is not null and r.strength_avg is not null
  group by 1, 2;
end $$;

-- ── 5. The job: re-mark the window after adding runs (2026-11-07-pool-refresh-off-upload.sql; the change: step 2) ──
create or replace function public.pool_refresh_dirty() returns int
language plpgsql security definer set search_path = public as $$
declare
  ka text[]; kh text[]; ks bigint[]; sa text[]; sh text[]; ss bigint[]; stale boolean; n int; changed int;
begin
  if not pg_try_advisory_xact_lock(hashtext('public.pool_refresh_dirty')) then return 0; end if;
  begin
    -- 0. Claim the queue by deleting it (rolled back with everything else on a failure). An upload that re-queues a
    --    claimed key waits for this transaction, then queues a fresh row for the next run: nothing is lost.
    with claimed as (delete from public.pool_dirty returning id, author, hero_id, seed, scored)
    select array_agg(author order by id), array_agg(hero_id order by id), array_agg(seed order by id),
           array_agg(author order by id) filter (where scored), array_agg(hero_id order by id) filter (where scored),
           array_agg(seed order by id) filter (where scored)
      into ka, kh, ks, sa, sh, ss
    from claimed;
    n := coalesce(array_length(ka, 1), 0);
    if n = 0 then return 0; end if;
    -- 1. pool_runs rows, first-queued first (a new run's id order = its upload order, as with the old trigger).
    for i in 1 .. n loop
      perform public.pool_runs_upsert_from(array[ka[i]], array[kh[i]], array[ks[i]]);
    end loop;
    -- 2. Strength, with the old trigger's rule: only when a queued statement carried a score; FULL when any run is
    --    unstamped or stamped more than 10 minutes ago (a new run is unstamped), else just the scored keys.
    --    THE WINDOW (R-POOL-ROLLING-01): first re-mark the live runs. When the window moved (a new run in, the oldest
    --    out), the live runs are re-ranked among themselves: a FULL refresh, once.
    changed := public.pool_live_refresh();
    if changed > 0 then
      perform public.pool_strength_refresh(null, null, null);
    elsif sa is not null then
      select coalesce(min(coalesce(strength_at, '-infinity'::timestamptz)) < now() - interval '10 minutes', false) into stale
      from public.pool_runs;
      if stale then perform public.pool_strength_refresh(null, null, null);
      else perform public.pool_strength_refresh(sa, sh, ss); end if;
    end if;
    -- 3. The histograms the client ranks its own game against.
    perform public.pool_strength_hist_refresh();
  exception when others then
    -- The block rolled back: every claimed key is queued again. Count it and log it where the daily digest reads.
    update public.pool_dirty set attempts = attempts + 1, last_error = sqlerrm;
    insert into ops.events (source, kind, key, detail)
    values ('pool_refresh_dirty', 'error', null,
            jsonb_build_object('error', sqlerrm, 'sqlstate', sqlstate, 'queued', (select count(*) from public.pool_dirty)));
    return -1;
  end;
  return n;
end $$;

-- ── 6. The hub mirror and its health check (2026-11-20-game-session-cf.sql, 2026-11-21-ops-health-checks.sql; the
--       change: `where r.eligible` -> `where r.eligible and r.live`) ───────────────────────────────────────────
create or replace function public.pool_mirror_version(p_key text) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.session_cf__key_ok(p_key) then raise exception 'not_authorized'; end if;
  return (select md5(coalesce(string_agg(concat_ws('|', r.id, r.set_id, r.patch_prefix, r.pool_id, r.user_id, r.wave_count,
            r.strength, r.strength_early, r.strength_late, public.pool_run__rev(r.author, r.hero_id, r.seed)), ',' order by r.id), ''))
          from public.pool_runs r where r.eligible and r.live);
end $$;

create or replace function public.pool_mirror_index(p_key text)
returns table (run_id bigint, run_key text, author text, user_id uuid, wave_count int, set_id text, patch_prefix text,
               pool_id text, strength text, strength_early text, strength_late text, rev text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.session_cf__key_ok(p_key) then raise exception 'not_authorized'; end if;
  return query
  select r.id, r.author || '|' || r.hero_id || '|' || r.seed::text, r.author, r.user_id, r.wave_count, r.set_id,
         r.patch_prefix, r.pool_id, r.strength::text, r.strength_early::text, r.strength_late::text,
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
      p_params ->> 'p_pool', (p_params ->> 'p_early_weight')::numeric, (p_params ->> 'p_strength_cap')::numeric
    ) with ordinality as k(run_id, run_key, author, user_id, wave_count, strength, strength_early, strength_late, rev, ord);
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
revoke all on function public.pool_strength_hist_refresh() from public, anon, authenticated;
revoke all on function public.pool_refresh_dirty() from public, anon, authenticated;
revoke all on function public.pool_mirror_version(text) from public;
revoke all on function public.pool_mirror_index(text) from public;
grant execute on function public.pool_mirror_version(text) to anon, authenticated;
grant execute on function public.pool_mirror_index(text) to anon, authenticated;
revoke all on function ops.pool_digest(jsonb) from public;

-- ── 7. Start: mark the window, re-rank the live runs, rebuild the histograms ──────────────────────────────────
select public.pool_live_refresh();
select public.pool_strength_refresh(null, null, null);
select public.pool_strength_hist_refresh();

commit;

notify pgrst, 'reload schema';
