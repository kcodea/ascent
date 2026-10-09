-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- OVERALL STRENGTH CAPS: Bronze 40, Silver 60, Gold 75 on top of the early / late bands  (2026-10-09, R-LOBBY-15)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-10-06-early-late-strength.sql. Idempotent: safe to re-run.
-- The same block is appended to schema.sql; keep the two identical. Owner runbook:
-- docs/devlog/2026-10-09-strength-overall-caps.md.
--
-- WHY (owner 2026-10-09: "we want to add overall board strength caps on TOP of the existing early rating strength
-- matching. if a boards overall strength is over 40, it should n ever be in bronze. if a boards overall stength is over
-- 60 it should never be in silver. if a boards overall strength is over 75 it should never be in gold. from there,
-- theres no additional cap"):
--
--  - `pool_runs_sample` gains `p_strength_cap numeric default null`. With it, a run whose WEIGHTED `strength` (the
--    "Game strength" number, not the early / late blend) is ABOVE the cap is never drawn; exactly the cap is allowed.
--    A run with no `strength` yet (unscored) is still drawn. The early / late band (`p_strength_min` /
--    `p_strength_max` / `p_early_weight`) is checked exactly as before; a run must pass both. Without a cap (null, or a
--    client from before this change that never sends one) the sample is exactly the 2026-10-06 one.
--  - The client sends Bronze 40, Silver 60, Gold 75 and nothing from Platinum up. The cap never widens: the client's
--    widening steps move only min / max and send the same cap every time (packages/sim/src/lobby/strengthBands.ts).
--  - No column, no recompute: the cap reads `pool_runs.strength`, which 2026-10-06-early-late-strength.sql already
--    keeps current.
--
-- A changed parameter list cannot be `create or replace`d over the old one, so the old signatures are dropped and the
-- new one created inside ONE transaction (a caller never sees the function missing). Locks: the board-strength
-- migration deadlocked against live pool reads, so this takes both pool tables first, like the 2026-10-06 files.

begin;
lock table public.pool_runs in access exclusive mode;
lock table public.boards in access exclusive mode;

-- ── 1. The sample, with an overall cap ─────────────────────────────────────────────────────────────────────
-- Replaces the 2026-10-06 nine-argument signature (and the 2026-09-30 eight-argument one, should it still exist).
-- Callers that pass only the old arguments keep working: `p_strength_cap` defaults to null = no cap.
drop function if exists public.pool_runs_sample(int, text, text, uuid, text, numeric, numeric, text);
drop function if exists public.pool_runs_sample(int, text, text, uuid, text, numeric, numeric, text, numeric);
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
            and jsonb_typeof(x.snapshot -> 'minions') = 'array' and jsonb_array_length(x.snapshot -> 'minions') > 0
            and coalesce(x.origin, 'self') <> 'synthetic')
  from unnest(picked) with ordinality as p(id, ord)
  join public.pool_runs r on r.id = p.id
  order by p.ord;
end $$;

-- ── 2. Who may call it ─────────────────────────────────────────────────────────────────────────────────────
grant execute on function public.pool_runs_sample(int, text, text, uuid, text, numeric, numeric, text, numeric, numeric) to anon, authenticated;

commit;
