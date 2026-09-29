-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ACCOUNT PROGRESSION: CRATES ROLL AT FIXED RARITY ODDS  (2026-09-29)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-09-28-progression-hero-attack.sql (the last file before
-- it). Idempotent: it only REPLACES `progression_crate_pool` + `open_crate`, adds `progression_crate_pick`, and
-- re-grants all three, so re-running it is always safe; it writes no rows. The same block is appended to
-- schema.sql; keep the two identical. Owner runbook: docs/devlog/2026-09-29-crate-fixed-rarity-odds.md.
-- If the crates or skins file is ever re-run, run this one again after it (both redefine the pool / open_crate
-- with the old roll).
--
-- WHAT THIS IS (owner 2026-09-29: "go to C", then "make it 50/30/15/5 though").
--  - A crate first rolls a RARITY at fixed odds, Common 50 / Rare 30 / Epic 15 / Legendary 5 (percent), then picks
--    an item of that rarity the player does not own, weighted by its CATEGORY weight (so skins vs titles still
--    balance inside a rarity). The odds never move as items are added, so they can be published to players.
--  - A rolled rarity with nothing eligible falls to the NEAREST rarity with something left, ties toward the MORE
--    COMMON one (Epic empty goes to Rare before Legendary). Nothing eligible anywhere is `pool_exhausted`, as before:
--    the crate stays sealed.
--  - Still ONE server-side draw per opening: `random()` picks the rarity, and where it landed inside that rarity's
--    band picks the item. Everything else in `open_crate` is unchanged: the per-user lock, the crate row FOR
--    UPDATE, `already_opened`, `crates_disabled`, the unique ownership key, and the `admin_off` kill switch (the
--    pool's filter). Opened crates now record `roll_version = 2`.
--
-- THE TS COPY is packages/progression/src/cosmetics.ts (CRATE_RARITY_ODDS, CRATE_ROLL_VERSION, crateRarityFallback,
-- pickCrateReward). sqlParity.test.ts parses the constants below and fails CI on drift; crateOdds.db.test.ts runs
-- this file on PGlite and checks the SQL pick equals the TS pick draw for draw.

-- ── 1. The pool: what a crate can still give this player, with each item's WITHIN-RARITY weight ──────────
-- Active, crate-sourced items in a live category that the player does not own. Weight = the category weight
-- (mirror of crateWeightOf). The rarity odds are NOT in here any more; they live in progression_crate_pick.
create or replace function public.progression_crate_pool(p_user uuid)
returns table (pool_cosmetic_id text, pool_weight int)
language plpgsql
stable
set search_path = public
as $$
begin
  return query
    select c.cosmetic_id, k.weight
    from public.cosmetic_catalog c
    join public.cosmetic_categories k on k.category = c.category
    where c.active and not c.admin_off and k.enabled and not k.admin_off
      and c.acquisition_source = 'crate' and k.weight > 0
      and not exists (select 1 from public.player_cosmetics o where o.user_id = p_user and o.cosmetic_id = c.cosmetic_id)
    order by c.cosmetic_id collate "C";
end;
$$;

-- ── 2. The pick: one draw in [0, 1) → a rarity at the fixed odds → an item of it (mirror of pickCrateReward) ─
-- Null only when nothing is eligible anywhere. Pure given (pool, draw), so tests can drive it draw by draw.
create or replace function public.progression_crate_pick(p_user uuid, p_draw double precision)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  -- THE PUBLISHED ODDS, percent (mirror of CRATE_RARITY_ODDS in packages/progression/src/cosmetics.ts)
  c_odds_common    constant int := 50;
  c_odds_rare      constant int := 30;
  c_odds_epic      constant int := 15;
  c_odds_legendary constant int := 5;
  v_rarities text[] := array['common', 'rare', 'epic', 'legendary'];
  v_odds     int[];
  v_x        double precision;
  v_lo       int := 0;
  v_i        int;
  v_rolled   int := 4;
  v_frac     double precision := 1;
  v_r        text;
  v_total    bigint;
  v_roll     bigint;
  v_pick     text;
begin
  v_odds := array[c_odds_common, c_odds_rare, c_odds_epic, c_odds_legendary];
  -- the rarity: the first band (in rarity order) the draw falls under; where it fell inside that band is v_frac
  v_x := least(greatest(coalesce(p_draw, 0), 0), 1) * 100;
  for v_i in 1..4 loop
    if v_x < v_lo + v_odds[v_i] then
      v_rolled := v_i;
      v_frac := (v_x - v_lo) / v_odds[v_i];
      exit;
    end if;
    v_lo := v_lo + v_odds[v_i];
  end loop;
  -- the rolled rarity first, then the nearest rarity with something left (ties toward the more common one)
  for v_r in select v_rarities[g] from generate_series(1, 4) as g order by abs(g - v_rolled), g loop
    select coalesce(sum(p.pool_weight), 0) into v_total
      from public.progression_crate_pool(p_user) p
      join public.cosmetic_catalog c on c.cosmetic_id = p.pool_cosmetic_id
      where c.rarity = v_r;
    if v_total > 0 then
      -- one walk over that rarity's items in id order by cumulative category weight
      v_roll := least(v_total - 1, greatest(0, floor(v_frac * v_total)::bigint));
      select q.id into v_pick from (
        select p.pool_cosmetic_id as id,
          sum(p.pool_weight) over (order by p.pool_cosmetic_id collate "C" rows unbounded preceding) as acc
        from public.progression_crate_pool(p_user) p
        join public.cosmetic_catalog c on c.cosmetic_id = p.pool_cosmetic_id
        where c.rarity = v_r
      ) q where q.acc > v_roll order by q.acc limit 1;
      return v_pick;
    end if;
  end loop;
  return null;
end;
$$;

-- ── 3. open_crate: THE opening transaction. Service role only. ──────────────────────────────────────────
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
  c_roll_version constant int := 2;
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

-- ── 4. Grants: service role only ─────────────────────────────────────────────────────────────────────────
revoke all on function public.progression_crate_pool(uuid) from public, anon, authenticated;
grant execute on function public.progression_crate_pool(uuid) to service_role;
revoke all on function public.progression_crate_pick(uuid, double precision) from public, anon, authenticated;
grant execute on function public.progression_crate_pick(uuid, double precision) to service_role;
revoke all on function public.open_crate(uuid, uuid) from public, anon, authenticated;
grant execute on function public.open_crate(uuid, uuid) to service_role;
