-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- BOARD STRENGTH: a 1-100 percentile per board and per run, and matchmaking bands by rank  (2026-09-30, R-LOBBY-09)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-09-29-pool-whole-runs.sql (it extends `pool_runs` and
-- replaces `pool_runs_sample`). Idempotent: safe to re-run. The same block is appended to schema.sql; keep the two
-- identical. Owner runbook: docs/devlog/2026-09-30-board-strength.md.
--
-- WHY (owner 2026-09-30: "can we build an algorithm for board strength to get as good of an idea of how strong a
-- snapshot's run is, and assign it a 1-100 value? ... serve for example 0-30 for bronze, 10-40 in silver, 20-65 in
-- gold, and then uncap plat?", and "72 would basically mean like... a 72/100 aka 72nd percentile"):
--
--  - `boards.strength_raw`: the board's win rate against a frozen reference set of real boards at its wave
--    (`strength_ref` names the reference version, `strength_wave` the reference wave it was scored against). The
--    client computes it (packages/sim/src/lobby/boardStrength.ts) and uploads it with the board; the backfill file
--    fills the boards from before. Stored permanently; never recomputed here.
--  - A board's PERCENTILE is derived: the share of the boards at the same reference wave (same version) it is
--    stronger than, ties counted half, a whole number 1..100 (`board_strength_pct`, the SQL twin of the TS
--    `percentileOf`, parity-tested in packages/sim/src/lobby/boardStrength.db.test.ts).
--  - `pool_runs.strength`: the run's strength, the average of its boards' percentiles (null = not scored yet).
--    Refreshed for the uploaded runs on every upload, and for every run at most every 10 minutes, so it follows the
--    pool as it grows.
--  - `pool_runs_sample` gains an optional band (`p_strength_min`, `p_strength_max`): a run is drawn only if its
--    strength is inside, and an UNSCORED run counts as inside every band, so nothing changes before the backfill.
--    Still uniform within the band, whole runs, never the caller's own. `p_pool` is the hook for a second pool
--    later (`pool_runs.pool_id`, 'main' for every run today).
--  - `board_strength_histogram(p_ref)`: per reference wave, how many boards hold each raw score. The client turns
--    its own fresh raw scores into percentiles with it, so the number a game shows is frozen when it ends.
--
-- The population is every board with a score. Only boards with minions are ever scored (client and backfill),
-- and synthetic boards are never scored, so no snapshot has to be read to count it (an index-only scan).

-- ── 1. Columns ─────────────────────────────────────────────────────────────────────────────────────────────
alter table public.boards add column if not exists strength_raw numeric;
alter table public.boards add column if not exists strength_ref text;
alter table public.boards add column if not exists strength_wave smallint;
create index if not exists boards_strength on public.boards (strength_ref, strength_wave, strength_raw) where strength_raw is not null;

alter table public.pool_runs add column if not exists strength numeric;      -- run percentile 1..100; null = unscored
alter table public.pool_runs add column if not exists strength_at timestamptz;
alter table public.pool_runs add column if not exists pool_id text not null default 'main';

-- ── 2. The percentile (mirrors percentileOf in boardStrength.ts) ──────────────────────────────────────────
-- 100 * (below + equal / 2) / n, rounded half up, clamped to 1..100, in exact integer arithmetic so both copies
-- round the same way. `equal` includes the board itself.
create or replace function public.board_strength_pct(p_below bigint, p_equal bigint, p_n bigint) returns int
language sql immutable as $$
  select case when coalesce(p_n, 0) <= 0 then null
              else least(100, greatest(1, ((2 * (200 * p_below + 100 * p_equal) + 2 * p_n) / (4 * p_n))::int)) end
$$;

-- Every scored board's count at its (reference, wave, raw), with the running count below it and the wave total.
create or replace function public.board_strength_cumulative() returns table (strength_ref text, strength_wave smallint, strength_raw numeric, n bigint, below bigint, total bigint)
language sql stable set search_path = public as $$
  with h as (
    select b.strength_ref, b.strength_wave, b.strength_raw, count(*) as n
    from public.boards b
    where b.strength_raw is not null and b.strength_ref is not null and b.strength_wave is not null
    group by 1, 2, 3
  )
  select h.strength_ref, h.strength_wave, h.strength_raw, h.n,
         coalesce(sum(h.n) over (partition by h.strength_ref, h.strength_wave order by h.strength_raw
                                 rows between unbounded preceding and 1 preceding), 0)::bigint,
         sum(h.n) over (partition by h.strength_ref, h.strength_wave)::bigint
  from h
$$;

-- ── 3. Keep pool_runs.strength current ─────────────────────────────────────────────────────────────────────
-- Recompute the strength of these runs (parallel arrays author, hero, seed), or of EVERY run when p_author is
-- null. Returns the number of runs touched.
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
    select k.id as run_id, public.board_strength_pct(c.below, c.n, c.total) as p
    from keys k
    join public.boards x on coalesce(x.author, 'anon') = k.author and x.hero_id = k.hero_id and x.seed = k.seed
    join c on c.strength_ref = x.strength_ref and c.strength_wave = x.strength_wave and c.strength_raw = x.strength_raw
    where x.strength_raw is not null
  ),
  agg as (select run_id, least(100, greatest(1, round(avg(p))))::numeric as s from pct group by run_id)
  update public.pool_runs r set strength = (select a.s from agg a where a.run_id = r.id), strength_at = now()
  from keys k where r.id = k.id;
  get diagnostics v = row_count;
  return v;
end $$;

-- After an upload (insert) or an update of boards (the backfill): refresh the runs those boards belong to, and every
-- run when the last full refresh is older than 10 minutes. Fires after the `pool_runs_boards_*` triggers (trigger
-- names sort), so the run row already exists. SECURITY DEFINER for the same reason as those: the uploading player
-- may insert boards but never write pool_runs. A failure is caught and logged: an upload is never lost to it.
create or replace function public.pool_strength_after_boards() returns trigger
language plpgsql security definer set search_path = public as $$
declare a text[]; h text[]; s bigint[]; stale boolean;
begin
  select array_agg(coalesce(n.author, 'anon')), array_agg(n.hero_id), array_agg(n.seed) into a, h, s
  from new_rows n where n.strength_raw is not null and n.seed is not null;
  if a is null then return null; end if; -- nothing scored in this statement
  -- A full refresh stamps every run, so the oldest stamp is the last full refresh.
  select coalesce(min(coalesce(strength_at, '-infinity'::timestamptz)) < now() - interval '10 minutes', false) into stale from public.pool_runs;
  if stale then perform public.pool_strength_refresh(null, null, null);
  else perform public.pool_strength_refresh(a, h, s); end if;
  return null;
exception when others then
  raise warning 'pool strength refresh failed: %', sqlerrm;
  return null;
end $$;

drop trigger if exists pool_strength_boards_insert on public.boards;
drop trigger if exists pool_strength_boards_update on public.boards;
create trigger pool_strength_boards_insert after insert on public.boards
  referencing new table as new_rows for each statement execute function public.pool_strength_after_boards();
create trigger pool_strength_boards_update after update on public.boards
  referencing new table as new_rows for each statement execute function public.pool_strength_after_boards();

-- ── 4. The client's histogram ──────────────────────────────────────────────────────────────────────────────
create or replace function public.board_strength_histogram(p_ref text) returns table (wave int, raw numeric, n bigint)
language sql stable set search_path = public as $$
  select b.strength_wave::int, b.strength_raw, count(*)
  from public.boards b
  where b.strength_ref = p_ref and b.strength_raw is not null and b.strength_wave is not null
  group by 1, 2 order by 1, 2
$$;

-- ── 5. The sample, with a strength band and a pool id ──────────────────────────────────────────────────────
-- Replaces the 2026-09-29 signature (a changed return type cannot be `create or replace`d). Callers that pass only
-- the old arguments keep working: every new one defaults to null.
drop function if exists public.pool_runs_sample(int, text, text, uuid, text);
create or replace function public.pool_runs_sample(
  p_limit int default 150,
  p_set text default null,
  p_patch_prefix text default null,
  p_exclude_user uuid default null,
  p_seed text default null,
  p_strength_min numeric default null,
  p_strength_max numeric default null,
  p_pool text default null
) returns table (run_key text, author text, user_id uuid, wave_count int, strength numeric, boards jsonb)
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
        and (r.strength is null or ((p_strength_min is null or r.strength >= p_strength_min) and (p_strength_max is null or r.strength <= p_strength_max)))
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
        and (r.strength is null or ((p_strength_min is null or r.strength >= p_strength_min) and (p_strength_max is null or r.strength <= p_strength_max)));
      if found then picked := picked || cand; end if;
    end loop;
  end if;

  return query
  select r.author || '|' || r.hero_id || '|' || r.seed::text, r.author, r.user_id, r.wave_count, r.strength,
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
revoke all on function public.pool_strength_after_boards() from public, anon, authenticated;
revoke all on function public.board_strength_cumulative() from public, anon, authenticated;
grant execute on function public.board_strength_histogram(text) to anon, authenticated;
grant execute on function public.pool_runs_sample(int, text, text, uuid, text, numeric, numeric, text) to anon, authenticated;

-- ── 7. Refresh (idempotent; every run is unscored until the backfill file is run) ─────────────────────────
select public.pool_strength_refresh(null, null, null);
