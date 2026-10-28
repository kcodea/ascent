-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- OPPONENT POOL DELTA: the same sample, and only the runs the client does not already hold
-- (Supabase cleanup P1.5, owner ruling 2026-10-28: "yes, cache them"; additive, idempotent, safe to re-run)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- `pool_runs_sample` returns up to 150 WHOLE runs (every board of each) on every session start and every between-runs
-- refresh: ~3.45 MB a call, ~13.4 GB in 16 days, for a pool of ~411 runs (9.9 MB in total). Every device re-downloads
-- the same runs again and again. This file adds two functions; `pool_runs_sample` itself is NOT changed (older clients
-- keep calling it, and the new client falls back to it when these are missing):
--
--  - `pool_runs_sample_keys(...)`: the SAME parameters and the SAME draw as `pool_runs_sample` (the picking block is
--    `pool_runs__pick`, a verbatim copy of the 2026-10-17 body; the PGlite parity test pins the two texts equal and the
--    two answers equal for a seeded draw), but each row carries the run's id and a content revision `rev` instead of
--    its boards: no snapshot leaves the database.
--  - `pool_runs_boards(p_ids)`: the boards of specific runs, aggregated EXACTLY as `pool_runs_sample` aggregates them
--    (same filter, same order), with the `rev` of that exact set of rows.
--
-- `rev` = md5 of the run's servable board rows as `id:xmin` in serving order. `xmin` changes on every UPDATE of a row,
-- so any insert, delete or update of any of the run's boards changes `rev`; an unchanged `rev` means the same rows at
-- the same row versions, i.e. a byte-identical `boards` answer. The client keeps runs it already has (IndexedDB,
-- keyed by run key + rev) and asks `pool_runs_boards` only for the ones it lacks or whose rev moved, so a session
-- start downloads a few KB of keys plus only NEW runs. The strength columns always come fresh from the keys answer.
--
-- Client: packages/ui/src/opponentPool/poolRunCache.ts. Rule R-EGRESS-05. No Edge Function needs redeploying.
--
-- ROLLBACK (the client falls back to pool_runs_sample on its own when these are gone):
--   drop function if exists public.pool_runs_boards(bigint[]);
--   drop function if exists public.pool_runs_sample_keys(int, text, text, uuid, text, numeric, numeric, text, numeric, numeric);
--   drop function if exists public.pool_runs__pick(int, text, text, uuid, text, numeric, numeric, text, numeric, numeric);
--   drop function if exists public.pool_run__rev(text, text, bigint);

-- ── 1. The draw, shared ─────────────────────────────────────────────────────────────────────────────────────
-- VERBATIM the picking block of pool_runs_sample (2026-10-17-pool-empty-boards.sql), returning the picked ids in order.
-- Keep the two identical: packages/sim/src/lobby/poolRunsDelta.db.test.ts compares the texts.
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
  where r.eligible and (p_set is null or r.set_id = p_set) and (p_patch_prefix is null or r.patch_prefix = p_patch_prefix);
  if lo is null or v_limit = 0 then return '{}'; end if;
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
      where r.id = cand and r.eligible
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

-- ── 2. A run's content revision ──────────────────────────────────────────────────────────────────────────────
-- Exactly the rows pool_runs_sample aggregates for the run, in exactly its order.
create or replace function public.pool_run__rev(p_author text, p_hero text, p_seed bigint) returns text
language sql stable set search_path = public as $$
  select md5(coalesce(string_agg(x.id::text || ':' || x.xmin::text, ',' order by x.wave, x.created_at, x.id), ''))
  from public.boards x
  where coalesce(x.author, 'anon') = p_author and x.hero_id = p_hero and x.seed = p_seed
    and jsonb_typeof(x.snapshot -> 'minions') = 'array'
    and coalesce(x.origin, 'self') <> 'synthetic'
$$;

-- ── 3. The sample, without boards ────────────────────────────────────────────────────────────────────────────
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
  p_strength_cap numeric default null
) returns table (run_id bigint, run_key text, author text, user_id uuid, wave_count int, strength numeric, strength_early numeric, strength_late numeric, rev text)
language plpgsql volatile set search_path = public as $$
#variable_conflict use_column
declare
  picked bigint[] := public.pool_runs__pick(p_limit, p_set, p_patch_prefix, p_exclude_user, p_seed, p_strength_min,
                                             p_strength_max, p_pool, p_early_weight, p_strength_cap);
begin
  return query
  select r.id, r.author || '|' || r.hero_id || '|' || r.seed::text, r.author, r.user_id, r.wave_count, r.strength,
         r.strength_early, r.strength_late, public.pool_run__rev(r.author, r.hero_id, r.seed)
  from unnest(picked) with ordinality as p(id, ord)
  join public.pool_runs r on r.id = p.id
  order by p.ord;
end $$;

-- ── 4. The boards of runs the client lacks ───────────────────────────────────────────────────────────────────
-- Same aggregation as pool_runs_sample (filter + order); `rev` over the same rows in the same statement. At most 300
-- ids a call (the sample's own cap). The sort fits in memory (the sample spills with the default 2 MB work_mem).
create or replace function public.pool_runs_boards(p_ids bigint[])
returns table (run_id bigint, run_key text, rev text, boards jsonb)
language plpgsql stable set search_path = public set work_mem = '16MB' as $$
#variable_conflict use_column
begin
  if coalesce(array_length(p_ids, 1), 0) > 300 then raise exception 'too_many_runs'; end if;
  return query
  select r.id, r.author || '|' || r.hero_id || '|' || r.seed::text, b.rev, b.boards
  from (select distinct unnest(p_ids) as id) k
  join public.pool_runs r on r.id = k.id
  cross join lateral (
    select coalesce(jsonb_agg(x.snapshot order by x.wave, x.created_at, x.id), '[]'::jsonb) as boards,
           md5(coalesce(string_agg(x.id::text || ':' || x.xmin::text, ',' order by x.wave, x.created_at, x.id), '')) as rev
    from public.boards x
    where coalesce(x.author, 'anon') = r.author and x.hero_id = r.hero_id and x.seed = r.seed
      and jsonb_typeof(x.snapshot -> 'minions') = 'array'
      and coalesce(x.origin, 'self') <> 'synthetic'
  ) b
  order by r.id;
end $$;

-- Grants: all four run as the caller (SECURITY INVOKER, like pool_runs_sample), so the two helpers must stay executable
-- by the client roles that call the two reads. They only read what pool_runs_sample already returns.
grant execute on function public.pool_runs__pick(int, text, text, uuid, text, numeric, numeric, text, numeric, numeric) to anon, authenticated;
grant execute on function public.pool_run__rev(text, text, bigint) to anon, authenticated;
grant execute on function public.pool_runs_sample_keys(int, text, text, uuid, text, numeric, numeric, text, numeric, numeric) to anon, authenticated;
grant execute on function public.pool_runs_boards(bigint[]) to anon, authenticated;

notify pgrst, 'reload schema';
