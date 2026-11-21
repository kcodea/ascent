-- RELEVANT STRENGTH, step 1: every board the pool serves carries its stored v2 score.
-- Spec: docs/superpowers/specs/2026-11-20-strength-while-you-faced-them-design.md
--
-- WHAT: `pool_board__json(boards)` is the board's snapshot plus, when present, `poolScore {ref, raw, wave}` (the row's
-- `strength_raw` / `strength_wave`, only when `strength_ref` is `strength_ref_current()`) and `poolCarried {ref, rounds}`
-- (the final board's `strength_carried`, only when its `ref` is current). Keys are absent otherwise.
-- `pool_runs_sample` and `pool_runs_boards` aggregate it instead of the bare snapshot (so the hub mirror's opaque
-- `boards` text carries it too, via pool_runs_boards). `pool_run__rev` and the inline rev in `pool_runs_boards` both
-- become md5('scores1|' || <old string>), so every cached run and the mirror re-download once. The two stay equal.
-- WHY: the recap ranks each opponent by its strength over the rounds you shared; it needs the score the server holds.
-- ORDER: apply BEFORE the client ships; an old client ignores the extra keys.
-- ROLLBACK: re-apply the definitions of pool_runs_sample (2026-11-24-strength-peak-cap.sql), pool_runs_boards and
-- pool_run__rev (2026-11-08-pool-runs-delta.sql), then `drop function public.pool_board__json(public.boards);`.

create or replace function public.pool_board__json(x public.boards) returns jsonb
language sql stable set search_path = public as $$
  select x.snapshot || jsonb_strip_nulls(jsonb_build_object(
    'poolScore', case when x.strength_raw is not null and x.strength_ref = public.strength_ref_current()
                      then jsonb_build_object('ref', x.strength_ref, 'raw', x.strength_raw, 'wave', x.strength_wave) end,
    'poolCarried', case when x.strength_carried ->> 'ref' = public.strength_ref_current()
                             and jsonb_typeof(x.strength_carried -> 'rounds') = 'object'
                        then jsonb_build_object('ref', x.strength_carried ->> 'ref', 'rounds', x.strength_carried -> 'rounds') end))
$$;
revoke execute on function public.pool_board__json(public.boards) from public, anon;
grant execute on function public.pool_board__json(public.boards) to authenticated, service_role;

-- The ONE run-rev definition (2026-11-08-pool-runs-delta.sql; the change: the 'scores1|' salt). pool_runs_boards below
-- repeats the same string inline; pool_mirror_index and the sample keys call this function.
create or replace function public.pool_run__rev(p_author text, p_hero text, p_seed bigint) returns text
language sql stable set search_path = public as $$
  select md5('scores1|' || coalesce(string_agg(x.id::text || ':' || x.xmin::text, ',' order by x.wave, x.created_at, x.id), ''))
  from public.boards x
  where coalesce(x.author, 'anon') = p_author and x.hero_id = p_hero and x.seed = p_seed
    and jsonb_typeof(x.snapshot -> 'minions') = 'array'
    and coalesce(x.origin, 'self') <> 'synthetic'
$$;

-- pool_runs_sample (2026-11-24-strength-peak-cap.sql; the change: boards via pool_board__json).
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
         (select coalesce(jsonb_agg(public.pool_board__json(x) order by x.wave, x.created_at, x.id), '[]'::jsonb) from public.boards x
          where coalesce(x.author, 'anon') = r.author and x.hero_id = r.hero_id and x.seed = r.seed
            and jsonb_typeof(x.snapshot -> 'minions') = 'array'
            and coalesce(x.origin, 'self') <> 'synthetic')
  from unnest(picked) with ordinality as p(id, ord)
  join public.pool_runs r on r.id = p.id
  order by p.ord;
end $$;


-- pool_runs_boards (2026-11-08-pool-runs-delta.sql; the change: pool_board__json + the salt).
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
    select coalesce(jsonb_agg(public.pool_board__json(x) order by x.wave, x.created_at, x.id), '[]'::jsonb) as boards,
           md5('scores1|' || coalesce(string_agg(x.id::text || ':' || x.xmin::text, ',' order by x.wave, x.created_at, x.id), '')) as rev
    from public.boards x
    where coalesce(x.author, 'anon') = r.author and x.hero_id = r.hero_id and x.seed = r.seed
      and jsonb_typeof(x.snapshot -> 'minions') = 'array'
      and coalesce(x.origin, 'self') <> 'synthetic'
  ) b
  order by r.id;
end $$;


-- Same signatures, so create or replace keeps the grants (session only, 2026-11-09); nothing is re-granted here.

notify pgrst, 'reload schema';
