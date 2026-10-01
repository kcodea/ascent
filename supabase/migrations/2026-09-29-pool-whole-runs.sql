-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- THE OPPONENT POOL IS MADE OF WHOLE RUNS, drawn uniformly at random  (2026-09-29, R-LOBBY-08)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run. Independent of every other migration (it only needs `boards`).
-- Idempotent: safe to re-run; each run rebuilds `pool_runs` from `boards`. The same block is appended to
-- schema.sql; keep the two identical. Owner runbook: docs/devlog/2026-09-29-pool-whole-runs.md.
--
-- WHY (owner 2026-09-29: "isnt it just replaying snapshots from the player's game?", then "make sure this is firmly
-- fixed and will be scalable and a non issue moving forward", then "i want opponent snapshots to be completely
-- random but i want them to be accurate ... i want them random from all snapshots in the pool"):
-- the client used to download the newest 120 boards PER WAVE and glue them back into runs. Early waves hold far
-- more boards than late ones, so an older run kept its late waves and lost its early ones, and a lobby seat
-- served a wave-10 board on round 5. The pool is now selected here, BY RUN:
--
--  - `pool_runs`: one row per run (author, hero, seed), kept current by statement triggers on `boards`. It holds
--    the run's shape (waves, first/last wave, biggest hole, a plausible-tier check) and whether it may take a
--    seat (`eligible`, the same rule as the client's `runCoversItsRounds` + `runTiersPlausible` + 4-wave minimum).
--  - `pool_runs_sample(...)`: a UNIFORM random sample of eligible runs (every run equally likely, no recency, no
--    weighting), returned ONE ROW PER RUN with ALL of that run's boards in one jsonb array. A run is therefore
--    present whole or absent; it can never arrive cut. At most 300 rows, so PostgREST's max-rows cap never
--    truncates it either.
--
-- HOW THE SAMPLE SCALES. `pool_runs.id` is a dense bigserial. A draw picks a uniform integer in [min id, max id]
-- of the eligible runs for the set + build version (two index probes), looks it up by primary key and keeps it
-- if it is eligible, matches, is not the caller's own run and was not already picked; otherwise it draws again.
-- Every accepted id is uniform over the remaining eligible runs (plain rejection sampling), so the sample is
-- exactly uniform without replacement, and each draw costs O(log n) index work whatever the pool size. It never
-- scans or sorts the table (`order by random()` would). A pool smaller than 4x the request is simply shuffled
-- whole. Rejections only cost time, bounded at 64 draws per requested run; ids stay dense because runs are only
-- ever inserted (a whole run in one upload), so real density is close to 1.
--
-- THE RULES LIVE IN TWO PLACES that must agree: this file and packages/sim/src/lobby/snapshotSeats.ts
-- (`runWavesCover`, `maxPlausibleTier`, `MIN_RUN_WAVES`). CI runs this file in an embedded Postgres
-- (packages/sim/src/lobby/poolRuns.db.test.ts) and checks the eligibility and tier bound against the TS.

-- ── 1. Look up a run's boards by its identity ──────────────────────────────────────────────────────────────
create index if not exists boards_run_key on public.boards ((coalesce(author, 'anon')), hero_id, seed, wave);

-- ── 2. One row per run ─────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.pool_runs (
  id           bigserial primary key,
  author       text    not null,           -- coalesce(boards.author, 'anon'): the client's run key uses the same
  hero_id      text    not null,
  seed         bigint  not null,
  user_id      uuid,                        -- the uploading account (seat cap + "not your own runs")
  set_id       text    not null,            -- snapshot.setId, 'set1' for boards from before sets
  patch_prefix text    not null,            -- '<version>+' of the run's boards: what the client filters by
  boards       int     not null,            -- servable board rows (duplicates included)
  wave_count   int     not null,            -- distinct waves: the client checks the run arrived with all of them
  first_wave   int     not null,
  last_wave    int     not null,
  max_gap      int     not null,            -- most waves missing in a row
  tiers_ok     boolean not null,            -- every board within the plausible tier for its wave
  eligible     boolean not null,            -- may take a lobby seat (see pool_run_eligible)
  updated_at   timestamptz not null default now(),
  unique (author, hero_id, seed)
);
create index if not exists pool_runs_sample_idx on public.pool_runs (set_id, patch_prefix, id) where eligible;

alter table public.pool_runs enable row level security;
drop policy if exists "read pool_runs" on public.pool_runs;
create policy "read pool_runs" on public.pool_runs for select using (true);
grant select on public.pool_runs to anon, authenticated;

-- ── 3. The eligibility rule (mirrors snapshotSeats.ts; parity-tested) ─────────────────────────────────────
-- maxPlausibleTier(wave): the all-in tavern-up curve (1,2,2,3,4,4,5,6 from wave 1) + 2 tiers of slack.
create or replace function public.pool_max_plausible_tier(p_wave int) returns int
language sql immutable as $$
  select case when p_wave <= 1 then 3 when p_wave <= 3 then 4 when p_wave = 4 then 5
              when p_wave <= 6 then 6 when p_wave = 7 then 7 else 8 end
$$;
-- At least 4 waves, the first at wave 1 or 2, never more than one wave missing in a row, plausible tiers.
create or replace function public.pool_run_eligible(p_wave_count int, p_first_wave int, p_max_gap int, p_tiers_ok boolean) returns boolean
language sql immutable as $$
  select p_wave_count >= 4 and p_first_wave <= 2 and p_max_gap <= 1 and p_tiers_ok
$$;

-- ── 4. Keep pool_runs current ──────────────────────────────────────────────────────────────────────────────
-- Recompute the rows for these run keys from `boards` (parallel arrays: author, hero, seed). A run whose
-- servable boards are all gone loses its row. Only servable boards count: non-empty minions, not synthetic,
-- which is exactly what the sample returns and the client keeps.
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
    where jsonb_typeof(x.snapshot -> 'minions') = 'array' and jsonb_array_length(x.snapshot -> 'minions') > 0
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
                         then (snapshot ->> 'tier')::numeric <= public.pool_max_plausible_tier(wave) else true end) as tiers_ok
    from b group by author, hero_id, seed
  )
  insert into public.pool_runs as r (author, hero_id, seed, user_id, set_id, patch_prefix, boards, wave_count, first_wave,
                                      last_wave, max_gap, tiers_ok, eligible, updated_at)
  select a.author, a.hero_id, a.seed, a.user_id, a.set_id, a.patch_prefix, a.boards, s.wave_count, s.first_wave,
         s.last_wave, s.max_gap, a.tiers_ok, public.pool_run_eligible(s.wave_count, s.first_wave, s.max_gap, a.tiers_ok), now()
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
        and jsonb_typeof(x.snapshot -> 'minions') = 'array' and jsonb_array_length(x.snapshot -> 'minions') > 0
        and coalesce(x.origin, 'self') <> 'synthetic');
end $$;

-- Statement-level triggers: one recompute per upload (a run's boards arrive in ONE insert), not per row.
-- SECURITY DEFINER because the uploading player may insert `boards` but never write `pool_runs`. A failure here
-- is caught and logged, never raised: the upload must not be lost because the index could not be refreshed.
create or replace function public.pool_runs_after_boards_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare a text[]; h text[]; s bigint[];
begin
  select array_agg(coalesce(n.author, 'anon')), array_agg(n.hero_id), array_agg(n.seed) into a, h, s from new_rows n;
  if a is not null then perform public.pool_runs_upsert_from(a, h, s); end if;
  return null;
exception when others then
  -- Never lose an upload over the pool index: the boards are kept, and pool_runs_rebuild() repairs the row.
  raise warning 'pool_runs refresh failed: %', sqlerrm;
  return null;
end $$;
create or replace function public.pool_runs_after_boards_delete() returns trigger
language plpgsql security definer set search_path = public as $$
declare a text[]; h text[]; s bigint[];
begin
  select array_agg(coalesce(o.author, 'anon')), array_agg(o.hero_id), array_agg(o.seed) into a, h, s from old_rows o;
  if a is not null then perform public.pool_runs_upsert_from(a, h, s); end if;
  return null;
exception when others then
  -- Never lose an upload over the pool index: the boards are kept, and pool_runs_rebuild() repairs the row.
  raise warning 'pool_runs refresh failed: %', sqlerrm;
  return null;
end $$;
create or replace function public.pool_runs_after_boards_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare a text[]; h text[]; s bigint[];
begin
  select array_agg(k.author), array_agg(k.hero_id), array_agg(k.seed) into a, h, s from (
    select coalesce(o.author, 'anon') as author, o.hero_id, o.seed from old_rows o
    union select coalesce(n.author, 'anon'), n.hero_id, n.seed from new_rows n) k;
  if a is not null then perform public.pool_runs_upsert_from(a, h, s); end if;
  return null;
exception when others then
  -- Never lose an upload over the pool index: the boards are kept, and pool_runs_rebuild() repairs the row.
  raise warning 'pool_runs refresh failed: %', sqlerrm;
  return null;
end $$;

drop trigger if exists pool_runs_boards_insert on public.boards;
drop trigger if exists pool_runs_boards_delete on public.boards;
drop trigger if exists pool_runs_boards_update on public.boards;
create trigger pool_runs_boards_insert after insert on public.boards
  referencing new table as new_rows for each statement execute function public.pool_runs_after_boards_insert();
create trigger pool_runs_boards_delete after delete on public.boards
  referencing old table as old_rows for each statement execute function public.pool_runs_after_boards_delete();
create trigger pool_runs_boards_update after update on public.boards
  referencing old table as old_rows new table as new_rows for each statement execute function public.pool_runs_after_boards_update();

-- Rebuild everything from `boards` (the backfill below; also the repair tool if pool_runs is ever in doubt).
create or replace function public.pool_runs_rebuild() returns int
language plpgsql set search_path = public as $$
declare a text[]; h text[]; s bigint[];
begin
  select array_agg(k.author), array_agg(k.hero_id), array_agg(k.seed) into a, h, s from (
    select distinct coalesce(author, 'anon') as author, hero_id, seed from public.boards where seed is not null
    union select author, hero_id, seed from public.pool_runs) k;
  if a is not null then perform public.pool_runs_upsert_from(a, h, s); end if;
  return (select count(*)::int from public.pool_runs);
end $$;

-- ── 5. The sample ──────────────────────────────────────────────────────────────────────────────────────────
-- A uniform [0, 1) from text, for a reproducible sample when the caller passes p_seed (tests, audits).
create or replace function public.pool_hash01(p text) returns double precision
language sql immutable as $$
  select (('x' || substr(md5(p), 1, 13))::bit(52)::bigint)::double precision / 4503599627370496.0
$$;

create or replace function public.pool_runs_sample(
  p_limit int default 150,
  p_set text default null,
  p_patch_prefix text default null,
  p_exclude_user uuid default null,
  p_seed text default null
) returns table (run_key text, author text, user_id uuid, wave_count int, boards jsonb)
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
    -- A small pool: every eligible run, shuffled whole (bounded by the id span, so this stays small).
    select coalesce(array_agg(t.id order by t.k), '{}') into picked from (
      select r.id, case when p_seed is null then random() else public.pool_hash01(p_seed || ':' || r.id) end as k
      from public.pool_runs r
      where r.id between lo and hi and r.eligible
        and (p_set is null or r.set_id = p_set) and (p_patch_prefix is null or r.patch_prefix = p_patch_prefix)
        and (p_exclude_user is null or r.user_id is distinct from p_exclude_user)
      order by 2 limit v_limit) t;
  else
    -- Rejection sampling over the dense id range: exactly uniform, O(log n) per draw, never a scan.
    while coalesce(array_length(picked, 1), 0) < v_limit and tries < v_limit * 64 loop
      tries := tries + 1;
      u := case when p_seed is null then random() else public.pool_hash01(p_seed || ':' || tries) end;
      cand := lo + least(floor(u * span)::bigint, span - 1);
      continue when cand = any(picked);
      perform 1 from public.pool_runs r
      where r.id = cand and r.eligible
        and (p_set is null or r.set_id = p_set) and (p_patch_prefix is null or r.patch_prefix = p_patch_prefix)
        and (p_exclude_user is null or r.user_id is distinct from p_exclude_user);
      if found then picked := picked || cand; end if;
    end loop;
  end if;

  return query
  select r.author || '|' || r.hero_id || '|' || r.seed::text, r.author, r.user_id, r.wave_count,
         (select coalesce(jsonb_agg(x.snapshot order by x.wave, x.created_at, x.id), '[]'::jsonb) from public.boards x
          where coalesce(x.author, 'anon') = r.author and x.hero_id = r.hero_id and x.seed = r.seed
            and jsonb_typeof(x.snapshot -> 'minions') = 'array' and jsonb_array_length(x.snapshot -> 'minions') > 0
            and coalesce(x.origin, 'self') <> 'synthetic')
  from unnest(picked) with ordinality as p(id, ord)
  join public.pool_runs r on r.id = p.id
  order by p.ord;
end $$;

-- ── 6. Who may call what ───────────────────────────────────────────────────────────────────────────────────
-- Supabase grants EXECUTE on new public functions to anon/authenticated by default: take it back from every
-- internal function, then grant only the sample.
revoke all on function public.pool_runs_upsert_from(text[], text[], bigint[]) from public, anon, authenticated;
revoke all on function public.pool_runs_rebuild() from public, anon, authenticated;
revoke all on function public.pool_runs_after_boards_insert() from public, anon, authenticated;
revoke all on function public.pool_runs_after_boards_delete() from public, anon, authenticated;
revoke all on function public.pool_runs_after_boards_update() from public, anon, authenticated;
grant execute on function public.pool_runs_sample(int, text, text, uuid, text) to anon, authenticated;

-- ── 7. Backfill (idempotent) ───────────────────────────────────────────────────────────────────────────────
select public.pool_runs_rebuild();
