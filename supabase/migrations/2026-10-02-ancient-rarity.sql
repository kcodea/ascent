-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ACCOUNT PROGRESSION: THE ANCIENT RARITY, and the crate odds 35 / 31 / 22 / 9 / 3  (2026-10-02)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-10-01-portrait-frames.sql (the last file before it). THEN
-- deploy the `progression-inventory` Edge Function (its catalog sync writes the Ancient items; before this file runs
-- the rarity check below rejects them, so run the SQL FIRST). Idempotent: it re-creates one check constraint and
-- REPLACES `progression_crate_pick` + `open_crate` (re-granted), so re-running it is always safe; it writes no rows
-- and touches neither `boards` nor `pool_runs`. The same block is appended to schema.sql; keep the two identical.
-- Owner runbook: docs/devlog/2026-10-02-ancient-rarity.md. It SUPERSEDES the pick and open_crate in
-- 2026-09-29-crate-uniform-within-rarity.sql: if that file (or the fixed-odds, crates or skins file) is ever re-run,
-- run this one again after it.
--
-- WHAT THIS IS (owner 2026-10-02: "i added a new rarity -> Ancient. can you wire that up so we can have skins that are
-- of ancient rarity? these will be a 3% drop rate").
--  - `cosmetic_catalog.rarity` accepts 'ancient', ranked ABOVE 'legendary'.
--  - The fixed rarity odds move from 50 / 30 / 15 / 5 to Common 35 / Rare 31 / Epic 22 / Legendary 9 / Ancient 3.
--  - Everything else in the roll is unchanged: one `random()` per opening, an equal chance for every eligible item of
--    the rolled rarity (id order), the nearest-rarity fallback with ties toward the more common one (so an empty
--    Ancient falls to Legendary), `pool_exhausted` when nothing is left. Opened crates now record `roll_version = 4`.
--  - Ownership is per id (`player_cosmetics`), with no rarity in it: an item whose rarity moves (four Legendary items
--    became Ancient today) stays owned by everyone who has it.
--
-- THE TS COPY is packages/progression/src/cosmetics.ts (COSMETIC_RARITIES, CRATE_RARITY_ODDS, CRATE_ROLL_VERSION,
-- pickCrateReward). sqlParity.test.ts parses the constants below; crateOdds.db.test.ts runs this file on PGlite and
-- checks the SQL pick equals the TS pick draw for draw.

-- ── 0. The rarity check: every rarity check on cosmetic_catalog is dropped (whatever Postgres named the inline one)
-- and the five-rarity one re-created under a fixed name. Every existing row is one of the old four, so it validates.
do $$
declare v_name text;
begin
  for v_name in
    select con.conname from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
      where nsp.nspname = 'public' and rel.relname = 'cosmetic_catalog' and con.contype = 'c'
        and pg_get_constraintdef(con.oid) ilike '%rarity%'
  loop
    execute format('alter table public.cosmetic_catalog drop constraint %I', v_name);
  end loop;
end;
$$;
alter table public.cosmetic_catalog add constraint cosmetic_catalog_rarity_check
  check (rarity in ('common', 'rare', 'epic', 'legendary', 'ancient'));

-- ── 1. The pick: one draw in [0, 1) → a rarity at the fixed odds → an EQUAL-chance item of it ────────────
-- Mirror of pickCrateReward. Null only when nothing is eligible anywhere. Pure given (pool, draw).
create or replace function public.progression_crate_pick(p_user uuid, p_draw double precision)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  -- THE PUBLISHED ODDS, percent (mirror of CRATE_RARITY_ODDS in packages/progression/src/cosmetics.ts)
  c_odds_common    constant int := 35;
  c_odds_rare      constant int := 31;
  c_odds_epic      constant int := 22;
  c_odds_legendary constant int := 9;
  c_odds_ancient   constant int := 3;
  v_rarities text[] := array['common', 'rare', 'epic', 'legendary', 'ancient'];
  v_odds     int[];
  v_x        double precision;
  v_lo       int := 0;
  v_i        int;
  v_rolled   int := 5;
  v_frac     double precision := 1;
  v_r        text;
  v_n        bigint;
  v_idx      bigint;
  v_pick     text;
begin
  v_odds := array[c_odds_common, c_odds_rare, c_odds_epic, c_odds_legendary, c_odds_ancient];
  -- the rarity: the first band (in rarity order) the draw falls under; where it fell inside that band is v_frac
  v_x := least(greatest(coalesce(p_draw, 0), 0), 1) * 100;
  for v_i in 1..5 loop
    if v_x < v_lo + v_odds[v_i] then
      v_rolled := v_i;
      v_frac := (v_x - v_lo) / v_odds[v_i];
      exit;
    end if;
    v_lo := v_lo + v_odds[v_i];
  end loop;
  -- the rolled rarity first, then the nearest rarity with something left (ties toward the more common one)
  for v_r in select v_rarities[g] from generate_series(1, 5) as g order by abs(g - v_rolled), g loop
    select count(*) into v_n
      from public.progression_crate_pool(p_user) p
      join public.cosmetic_catalog c on c.cosmetic_id = p.pool_cosmetic_id
      where c.rarity = v_r;
    if v_n > 0 then
      -- every item of the rarity equally likely: the draw's place in the band indexes the items in id order
      v_idx := least(v_n - 1, greatest(0, floor(v_frac * v_n)::bigint));
      select p.pool_cosmetic_id into v_pick
        from public.progression_crate_pool(p_user) p
        join public.cosmetic_catalog c on c.cosmetic_id = p.pool_cosmetic_id
        where c.rarity = v_r
        order by p.pool_cosmetic_id collate "C"
        offset v_idx limit 1;
      return v_pick;
    end if;
  end loop;
  return null;
end;
$$;

-- ── 2. open_crate: THE opening transaction. Service role only. ──────────────────────────────────────────
-- Per-user advisory lock (the same one the settlement takes, so two openings of DIFFERENT crates serialize and
-- can never pick the same item) → the crate row FOR UPDATE (an opened crate returns its committed reward as
-- `already_opened`) → an empty pool answers `pool_exhausted` and writes nothing → ONE draw through
-- progression_crate_pick → ownership insert (unique key = the final guard) + the crate marked opened, together.
create or replace function public.open_crate(p_user uuid, p_crate_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_roll_version constant int := 4;
  v_crate   public.loot_crates%rowtype;
  v_enabled boolean;
  v_pick    text;
  v_rows    int;
  v_sealed  int;
begin
  if p_user is null or p_crate_id is null then raise exception 'bad_crate_id'; end if;
  perform pg_advisory_xact_lock(hashtextextended('progression:' || p_user::text, 0));

  select * into v_crate from public.loot_crates where crate_id = p_crate_id and user_id = p_user for update;
  if not found then raise exception 'crate_not_found'; end if;

  if v_crate.state = 'opened' then
    select count(*) into v_sealed from public.loot_crates where user_id = p_user and state = 'sealed';
    return jsonb_build_object('status', 'already_opened', 'crate', public.progression_crate_json(v_crate),
      'rewardId', v_crate.reward_cosmetic_id, 'sealedRemaining', v_sealed, 'profile', public.progression_profile_json(p_user));
  end if;

  select crates_enabled into v_enabled from public.progression_config where id = 1;
  if not coalesce(v_enabled, false) then raise exception 'crates_disabled'; end if;

  if not exists (select 1 from public.progression_crate_pool(p_user)) then
    select count(*) into v_sealed from public.loot_crates where user_id = p_user and state = 'sealed';
    return jsonb_build_object('status', 'pool_exhausted', 'crate', public.progression_crate_json(v_crate),
      'rewardId', null, 'sealedRemaining', v_sealed, 'profile', public.progression_profile_json(p_user));
  end if;

  -- ONE draw: the rarity at the fixed odds, then an item of it (mirror of pickCrateReward).
  v_pick := public.progression_crate_pick(p_user, random());
  if v_pick is null then raise exception 'duplicate_reward'; end if;

  insert into public.player_cosmetics (user_id, cosmetic_id, source, source_id)
    values (p_user, v_pick, 'crate', p_crate_id::text)
    on conflict (user_id, cosmetic_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise exception 'duplicate_reward'; end if;

  update public.loot_crates set state = 'opened', reward_cosmetic_id = v_pick, roll_version = c_roll_version, opened_at = now()
    where crate_id = p_crate_id and state = 'sealed'
    returning * into v_crate;
  if not found then raise exception 'crate_not_found'; end if;

  -- A new title is worn at once only when the player wears none; the revision moves so mirrors adopt the change.
  update public.profiles set
    equipped_title_id = coalesce(equipped_title_id,
      (select c.cosmetic_id from public.cosmetic_catalog c where c.cosmetic_id = v_pick and c.category = 'title')),
    progression_revision = progression_revision + 1,
    updated_at = now()
  where user_id = p_user;

  select count(*) into v_sealed from public.loot_crates where user_id = p_user and state = 'sealed';
  return jsonb_build_object('status', 'opened', 'crate', public.progression_crate_json(v_crate),
    'rewardId', v_pick, 'sealedRemaining', v_sealed, 'profile', public.progression_profile_json(p_user));
end;
$$;

-- ── 3. Grants: service role only ─────────────────────────────────────────────────────────────────────────
revoke all on function public.progression_crate_pick(uuid, double precision) from public, anon, authenticated;
grant execute on function public.progression_crate_pick(uuid, double precision) to service_role;
revoke all on function public.open_crate(uuid, uuid) from public, anon, authenticated;
grant execute on function public.open_crate(uuid, uuid) to service_role;
