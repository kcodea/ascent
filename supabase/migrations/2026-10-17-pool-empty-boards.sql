-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- EMPTY BOARDS ARE PART OF A RUN: the pool keeps every recorded round, an empty board included  (2026-10-17, R-LOBBY-08)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-10-09-strength-overall-caps.sql. Idempotent: safe to re-run.
-- The same block is appended to schema.sql; keep the two identical. Owner runbook:
-- docs/devlog/2026-10-17-empty-boards-uploaded.md. No Edge Function needs redeploying.
--
-- WHY (owner 2026-10-17: "i just faced this board on round 1 - how is that possible that he is shop tier 2?", then
-- "empty boards are never uploaded is a problem. this has to be fixed"): the client never uploaded an EMPTY board,
-- and both functions below skipped one anyway. A run whose round 1 was empty (every Disco Dan: his turn 1 is a pure
-- Setlist with nothing on board) therefore looked like it started at round 2, and a lobby seat served its round-2
-- board, at Shop tier 2, in round 1. The client now uploads every round (packages/ui/src/boardLibrary.ts), so:
--
--  - `pool_runs_upsert_from` counts an empty board as one of the run's waves (so such a run now has first_wave 1),
--    and a run with no minions in ANY board is never eligible (`has_minions`);
--  - `pool_runs_sample` returns a run's empty boards with the rest, so the run arrives whole.
--
-- `boards` holds no empty board before this change, so the backfill below changes no existing `pool_runs` row; it
-- only re-derives them under the new rule. Board STRENGTH is untouched: an empty board is never scored (client and
-- backfill), and every strength function reads only scored boards. `god_board_sample` keeps skipping empty boards
-- (a God Mode opponent needs something to fight). ORDER: ship the client first. An older client refuses a sampled
-- run that contains an empty board (its whole-run check rejected one), so it would only lose those new runs.
--
-- A replaced function body keeps its grants; the sample's signature is the 2026-10-09 one, unchanged. Locks: the
-- board-strength migration deadlocked against live pool reads, so this takes both pool tables first.

begin;
lock table public.pool_runs in access exclusive mode;
lock table public.boards in access exclusive mode;

-- ── 1. pool_runs keeps empty boards as waves of the run ────────────────────────────────────────────────────
-- Recompute the rows for these run keys from `boards` (parallel arrays: author, hero, seed). Every non-synthetic
-- board with a `minions` array counts, an empty one included; a run with no minions anywhere is not eligible.
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
         s.last_wave, s.max_gap, a.tiers_ok, public.pool_run_eligible(s.wave_count, s.first_wave, s.max_gap, a.tiers_ok) and a.has_minions, now()
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

-- ── 2. The sample returns a run's empty boards with the rest ──────────────────────────────────────────────
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

-- ── 3. Re-derive every row under the new rule (idempotent; a no-op on a pool with no empty boards yet) ──────────
select public.pool_runs_rebuild();

commit;
