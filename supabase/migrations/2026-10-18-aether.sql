-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- AETHER: the earned currency, the wallet + ledger, and the Crate Shop (tiered, focusable crates)  (2026-10-18)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-10-17-versus-open-rooms.sql (the last file before it). THEN
-- deploy the `progression-inventory`, `submit-progression` and `gauntlet-clear` Edge Functions (inventory calls
-- `buy_crate` and the focused `open_crate`; before this file runs those calls fail with "function does not exist", so
-- run the SQL FIRST). THE LAUNCH is a separate, owner-run step: `select public.aether_rollout();` (commented out at the
-- very bottom) backdates the milestone crates and flips the switch. Idempotent: every table and column is `if not
-- exists`, the config seed is `on conflict do nothing` (a retuned economy is never overwritten), every constraint is
-- dropped and re-added, and every function is REPLACED and re-granted, so re-running it is always safe (it never runs
-- the rollout). The same block is appended to schema.sql; keep the two identical. Spec:
-- docs/superpowers/specs/2026-10-18-aether-crate-shop-design.md.
--
-- WHAT SECTIONS 11-14 REPLACE, so this file must come after every file that defines them: `settle_progression`
-- (latest 2026-10-14-versus-progression.sql), `record_gauntlet_clear` (2026-09-29-gauntlet-progress.sql),
-- `progression_result_json` (2026-09-28-achievements.sql) and `progression_profile_json`
-- (2026-09-28-progression-skins.sql). IF ANY OF THOSE FILES IS EVER RE-RUN, RUN THIS FILE AGAIN AFTER IT: each would
-- put back a writer that pays no Aether and grants a crate per level (or a profile without the balance).
--
-- WHAT SECTIONS 1-10 REPLACE. `open_crate` (2026-10-02-ancient-rarity.sql): the 2-argument overload is DROPPED and a
-- 4-argument one with defaults takes its place, so the named 2-argument call an older Edge Function sends
-- (`p_user`, `p_crate_id`) resolves to it. `loot_crates_transition_guard` + `progression_crate_json`
-- (2026-09-29-gauntlet-progress.sql). The 2-argument `progression_crate_pick` and `progression_crate_pool` are left
-- exactly as they are (tests and tools still read them). IF 2026-10-02-ancient-rarity.sql (or the gauntlet, crates,
-- fixed-odds or equal-chance file) IS EVER RE-RUN, RUN THIS FILE AGAIN AFTER IT: the ancient file re-creates the
-- 2-argument `open_crate`, which would make every 2-argument call ambiguous next to the one below.
--
-- WHAT THIS IS (owner decisions 2026-10-18: Aether replaces level-up crates; crates are bought in a shop at a rarity
-- FLOOR, optionally FOCUSED on categories for a fee; "make the narrower focus cost more").
--  - THE SWITCH: `progression_config.aether_enabled`, OFF by default. Until the owner flips it nothing can be bought
--    and nothing about the old crate-per-level behaviour changes.
--  - THE ECONOMY is one server-owned row, `aether_config.economy`, the exact JSON of `DEFAULT_AETHER_ECONOMY`
--    (packages/progression/src/aether.ts). The owner retunes a price with an UPDATE, no client release: the client
--    re-reads it, and a purchase at a price the client showed that no longer holds is refused (`price_changed`), never
--    silently re-priced. Public read.
--  - THE WALLET + LEDGER: `aether_wallets` holds the balance (never below 0); `aether_ledger` records EVERY change with
--    its reason and source, unique per (user, reason, source), so a replayed earn or spend changes nothing and a
--    balance can always be explained. Owner-only read; only security-definer functions write (`aether_apply`).
--  - TIERED CRATES: `loot_crates` gains `floor_rarity` (nothing below it drops), `focus_categories` (null = unfocused)
--    and `price_paid`. A floor-Common, unfocused crate (every crate before the shop) rolls exactly the version-4 roll,
--    draw for draw. Opened crates now record `roll_version = 5`.
--  - `buy_crate`: ONE transaction under the per-user progression lock: the server quotes the price itself, refuses a
--    stale one, charges, creates the crate (`source = 'shop:<request id>'`) and opens it. The request id makes a
--    retried or double-clicked buy return the first result, charged once.
--  - A MILESTONE crate (`source = 'milestone:<level>'`, floor Legendary) may be focused AT OPEN for the Legendary focus
--    fee; no other crate takes a focus at open.
--  - EARNING (sections 11-14, all behind the switch): a Ranked or Versus settlement pays Aether (mirror of
--    aetherForSettlement) and, instead of a crate per level, grants the Welcome Crate on enrollment plus a free
--    floor-Legendary milestone crate at every 10th level; a Gauntlet first clear pays 200 Aether instead of its crate;
--    the result and profile JSON carry the Aether; `aether_rollout()` backdates the milestone crates at launch.
--
-- THE TS COPY is packages/progression/src/crateShop.ts (CRATE_TIER_FLOOR, eligibleForCrate, normalizeFocus,
-- focusFeePercent, quoteCrate, pickTieredCrateReward) and aether.ts (DEFAULT_AETHER_ECONOMY). aether.db.test.ts runs
-- this file on PGlite and checks the SQL pick and quote equal the TS ones draw for draw.

-- ── 1. The Aether switch (off until the owner flips it) ─────────────────────────────────────────────────────
alter table public.progression_config add column if not exists aether_enabled boolean not null default false;

-- ── 2. aether_config: the economy, one row, public read ───────────────────────────────────────────────────
create table if not exists public.aether_config (
  id         int primary key check (id = 1),
  economy    jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.aether_config enable row level security;
drop policy if exists "read aether_config" on public.aether_config;
create policy "read aether_config" on public.aether_config for select using (true);
grant select on public.aether_config to anon, authenticated;
-- The FIRST seed: exactly JSON.stringify(DEFAULT_AETHER_ECONOMY). A re-run never overwrites a retuned row.
insert into public.aether_config (id, economy) values (1,
  '{"version":1,"rankedBase":50,"rankedPlacementBonus":[140,80,45,35,25,15,10,0],"versusComplete":25,"versusWin":45,"gauntletFirstClear":200,"cratePrice":{"standard":100,"rare":200,"epic":400,"legendary":600,"ancient":900},"focusFeePercent":[100,60,40,25,15,10,5],"milestoneEvery":10}'::jsonb)
on conflict (id) do nothing;

-- ── 3. aether_wallets: one balance per account, never negative; owner-only read ───────────────────────────
create table if not exists public.aether_wallets (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  balance    int not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);
alter table public.aether_wallets enable row level security;
drop policy if exists "read own aether_wallets" on public.aether_wallets;
create policy "read own aether_wallets" on public.aether_wallets for select to authenticated using (auth.uid() = user_id);

-- ── 4. aether_ledger: every change, with its reason and source; owner-only read ───────────────────────────
-- UNIQUE (user, reason, source) is the replay guard: a settlement run id, a shop request id or a crate id can move a
-- balance once per reason, ever.
create table if not exists public.aether_ledger (
  id            bigserial primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  delta         int not null,
  balance_after int not null check (balance_after >= 0),
  reason        text not null check (reason in ('ranked', 'versus', 'gauntlet', 'crate_purchase', 'crate_focus', 'grant')),
  source_id     text not null,
  created_at    timestamptz not null default now(),
  unique (user_id, reason, source_id)
);
alter table public.aether_ledger enable row level security;
drop policy if exists "read own aether_ledger" on public.aether_ledger;
create policy "read own aether_ledger" on public.aether_ledger for select to authenticated using (auth.uid() = user_id);

-- ── 5. aether_apply: THE one writer of a balance. Internal (revoked from every API role, service role too). ─
-- Called only from security-definer functions that ALREADY hold the per-user progression lock. A replayed (user,
-- reason, source) changes nothing and returns the current balance; otherwise the ledger row and the wallet move
-- together. A result below 0 raises `insufficient_aether` and writes nothing (the caller's transaction rolls back).
create or replace function public.aether_apply(p_user uuid, p_delta int, p_reason text, p_source text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance int;
  v_rows    int;
begin
  if p_user is null or p_delta is null or p_reason is null or p_source is null then raise exception 'bad_aether_change'; end if;
  insert into public.aether_wallets (user_id) values (p_user) on conflict (user_id) do nothing;
  select balance into v_balance from public.aether_wallets where user_id = p_user for update;
  -- a replay: the source already moved this balance for this reason
  if exists (select 1 from public.aether_ledger where user_id = p_user and reason = p_reason and source_id = p_source) then
    return v_balance;
  end if;
  if v_balance + p_delta < 0 then raise exception 'insufficient_aether'; end if;
  insert into public.aether_ledger (user_id, delta, balance_after, reason, source_id)
    values (p_user, p_delta, v_balance + p_delta, p_reason, p_source)
    on conflict (user_id, reason, source_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return v_balance; end if;
  update public.aether_wallets set balance = v_balance + p_delta, updated_at = now() where user_id = p_user;
  return v_balance + p_delta;
end;
$$;

-- ── 6. loot_crates: a rarity floor, an optional focus, the price paid ─────────────────────────────────────
-- Every existing crate becomes floor Common, unfocused, price null: exactly how it already rolls.
alter table public.loot_crates add column if not exists floor_rarity text not null default 'common';
alter table public.loot_crates drop constraint if exists loot_crates_floor_rarity_check;
alter table public.loot_crates add constraint loot_crates_floor_rarity_check
  check (floor_rarity in ('common', 'rare', 'epic', 'legendary', 'ancient'));
alter table public.loot_crates add column if not exists focus_categories text[];
alter table public.loot_crates add column if not exists price_paid int;
alter table public.loot_crates drop constraint if exists loot_crates_price_paid_check;
alter table public.loot_crates add constraint loot_crates_price_paid_check check (price_paid is null or price_paid >= 0);

-- A crate goes sealed -> opened ONCE and is then history (even for the service role). `source`, the FLOOR and the
-- PRICE PAID are identity too. The FOCUS may change only in the sealed -> opened update (a milestone crate is focused
-- as it opens).
create or replace function public.loot_crates_transition_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.state = 'opened' then raise exception 'crate_already_opened'; end if;
  if new.crate_id is distinct from old.crate_id or new.user_id is distinct from old.user_id
     or new.earned_level is distinct from old.earned_level or new.earned_at is distinct from old.earned_at
     or new.source is distinct from old.source or new.floor_rarity is distinct from old.floor_rarity
     or new.price_paid is distinct from old.price_paid then
    raise exception 'crate_identity_is_immutable';
  end if;
  if new.focus_categories is distinct from old.focus_categories and new.state is distinct from 'opened' then
    raise exception 'crate_identity_is_immutable';
  end if;
  return new;
end;
$$;

-- MUST match `CrateRow` in packages/progression/src/cosmetics.ts key for key (`source` is null for a level crate;
-- `focus` is null for an unfocused crate; `parseCrate` drops a null focus and a Common floor reads as Standard).
create or replace function public.progression_crate_json(c public.loot_crates)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'crateId', c.crate_id, 'earnedLevel', c.earned_level, 'state', c.state,
    'rewardId', c.reward_cosmetic_id, 'earnedAt', c.earned_at, 'openedAt', c.opened_at,
    'source', c.source, 'floor', c.floor_rarity, 'focus', to_jsonb(c.focus_categories)
  );
$$;

-- ── 7. The tiered pool: what a crate of this floor (and focus) can still give ─────────────────────────────
-- Today's pool filter (active, not admin_off, live category with weight, crate-sourced, unowned) kept to rarities AT
-- OR ABOVE the floor and, when a focus is named, to those categories. Mirror of eligibleForCrate. A null floor is
-- Common; an unknown floor matches nothing. A null or empty focus is no focus.
create or replace function public.progression_tiered_crate_pool(p_user uuid, p_floor text, p_focus text[])
returns table (pool_cosmetic_id text, pool_rarity text)
language plpgsql
stable
set search_path = public
as $$
declare
  v_rarities constant text[] := array['common', 'rare', 'epic', 'legendary', 'ancient'];
begin
  return query
    select c.cosmetic_id, c.rarity
    from public.cosmetic_catalog c
    join public.cosmetic_categories k on k.category = c.category
    where c.active and not c.admin_off and k.enabled and not k.admin_off
      and c.acquisition_source = 'crate' and k.weight > 0
      and not exists (select 1 from public.player_cosmetics o where o.user_id = p_user and o.cosmetic_id = c.cosmetic_id)
      and array_position(v_rarities, c.rarity) >= array_position(v_rarities, coalesce(p_floor, 'common'))
      and (p_focus is null or cardinality(p_focus) = 0 or c.category = any(p_focus))
    order by c.cosmetic_id collate "C";
end;
$$;

-- ── 8. The tiered pick: one draw in [0, 1] → a rarity at or above the floor → an EQUAL-chance item of it ──
-- Mirror of pickTieredCrateReward. The draw is scaled by the floor's odds total (the published odds restricted to the
-- rarities at or above the floor, renormalized); a rarity with nothing left falls to the nearest one AT OR ABOVE THE
-- FLOOR (ties toward the more common), never below it. Null only when nothing at or above the floor is eligible. With
-- floor Common and no focus it is `progression_crate_pick` draw for draw. Pure given (pool, draw).
create or replace function public.progression_tiered_crate_pick(p_user uuid, p_draw double precision, p_floor text, p_focus text[])
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
  v_floor    int;
  v_sum      int := 0;
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
  v_floor := array_position(v_rarities, coalesce(p_floor, 'common'));
  if v_floor is null then return null; end if;
  for v_i in v_floor..5 loop v_sum := v_sum + v_odds[v_i]; end loop;
  -- the rarity: the first band (in rarity order, from the floor up) the scaled draw falls under; where inside it, v_frac
  v_x := least(greatest(coalesce(p_draw, 0), 0), 1) * v_sum;
  for v_i in v_floor..5 loop
    if v_x < v_lo + v_odds[v_i] then
      v_rolled := v_i;
      v_frac := (v_x - v_lo) / v_odds[v_i];
      exit;
    end if;
    v_lo := v_lo + v_odds[v_i];
  end loop;
  -- the rolled rarity first, then the nearest rarity at or above the floor with something left (ties toward the more common)
  for v_r in select v_rarities[g] from generate_series(v_floor, 5) as g order by abs(g - v_rolled), g loop
    select count(*) into v_n from public.progression_tiered_crate_pool(p_user, p_floor, p_focus) p where p.pool_rarity = v_r;
    if v_n > 0 then
      -- every item of the rarity equally likely: the draw's place in the band indexes the items in id order
      v_idx := least(v_n - 1, greatest(0, floor(v_frac * v_n)::bigint));
      select p.pool_cosmetic_id into v_pick
        from public.progression_tiered_crate_pool(p_user, p_floor, p_focus) p
        where p.pool_rarity = v_r
        order by p.pool_cosmetic_id collate "C"
        offset v_idx limit 1;
      return v_pick;
    end if;
  end loop;
  return null;
end;
$$;

-- ── 9. aether_quote: what a crate costs this player right now (mirror of quoteCrate) ──────────────────────
-- {tier, floor, focus, crate, fee, total, remaining}, priced from `aether_config`. A milestone crate is free, its floor
-- Legendary whatever tier is passed, and only the focus fee is charged, at the Legendary price. The focus is made
-- canonical (normalizeFocus): de-duplicated, sorted `collate "C"`, null when it covers every AVAILABLE category (that is
-- no focus, and costs nothing). Raises `bad_tier`, `bad_focus` (it names a category with nothing left at this floor,
-- or an unknown one) or `sold_out` (nothing left to give).
create or replace function public.aether_quote(p_user uuid, p_tier text, p_focus text[], p_milestone boolean)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_milestone boolean := coalesce(p_milestone, false);
  v_tier      text;
  v_floor     text;
  v_eco       jsonb;
  v_price     int;
  v_available text[];
  v_focus     text[];
  v_remaining int;
  v_ladder    jsonb;
  v_pct       int := 0;
  v_fee       int := 0;
  v_crate     int;
begin
  v_tier := case when v_milestone then 'legendary' else p_tier end;
  if v_tier is null or v_tier not in ('standard', 'rare', 'epic', 'legendary', 'ancient') then raise exception 'bad_tier'; end if;
  v_floor := case v_tier when 'standard' then 'common' else v_tier end;   -- mirror of CRATE_TIER_FLOOR

  select economy into v_eco from public.aether_config where id = 1;
  v_price := (v_eco #>> array['cratePrice', v_tier])::int;
  if v_price is null or v_price < 0 then raise exception 'aether_config_missing'; end if;

  -- the categories a player may focus at this floor: those with something still eligible
  select coalesce(array_agg(distinct c.category), '{}') into v_available
    from public.progression_tiered_crate_pool(p_user, v_floor, null) p
    join public.cosmetic_catalog c on c.cosmetic_id = p.pool_cosmetic_id;

  -- normalizeFocus
  if p_focus is not null and cardinality(p_focus) > 0 then
    if exists (select 1 from unnest(p_focus) f where f is null or not (f = any(v_available))) then raise exception 'bad_focus'; end if;
    select array_agg(f order by f collate "C") into v_focus from (select distinct f from unnest(p_focus) f) d;
    if cardinality(v_focus) >= cardinality(v_available) then v_focus := null; end if;
  end if;

  select count(*) into v_remaining from public.progression_tiered_crate_pool(p_user, v_floor, v_focus);
  if v_remaining = 0 then raise exception 'sold_out'; end if;

  -- focusFeePercent: 1..7 ticked read the ladder, 8 or more (but fewer than all available) the last rung
  if v_focus is not null then
    v_ladder := v_eco -> 'focusFeePercent';
    v_pct := coalesce((v_ladder ->> (least(cardinality(v_focus), jsonb_array_length(v_ladder)) - 1))::int, 0);
    v_fee := (v_price * v_pct) / 100;   -- integer division: Math.floor in the TS
  end if;
  v_crate := case when v_milestone then 0 else v_price end;
  return jsonb_build_object('tier', v_tier, 'floor', v_floor, 'focus', to_jsonb(v_focus), 'crate', v_crate,
    'fee', v_fee, 'total', v_crate + v_fee, 'remaining', v_remaining);
end;
$$;

-- ── 10. open_crate + buy_crate: THE opening and THE purchase. Service role only. ───────────────────────────
-- open_crate is today's transaction (2026-10-02-ancient-rarity.sql) with three additions: the roll uses the crate's
-- floor and focus through the tiered pick (`roll_version = 5`); a MILESTONE crate may be focused at open, charged the
-- Legendary focus fee as `crate_focus` (source = the crate id) after a `price_changed` check against the fee the client
-- showed; and the result carries the Aether balance. Per-user advisory lock (the same one the settlement and buy_crate
-- take, so two openings never pick the same item and a charge never races a credit) → the crate row FOR UPDATE (an
-- opened crate returns its committed reward as `already_opened`, never charged twice) → the floor's pool empty answers
-- `pool_exhausted`, sealed and UNCHARGED → the focus fee → ONE draw → ownership insert (unique key = the final guard)
-- + the crate marked opened, together.
drop function if exists public.open_crate(uuid, uuid);
create or replace function public.open_crate(p_user uuid, p_crate_id uuid, p_focus text[] default null, p_expected_fee int default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_roll_version constant int := 5;
  v_crate   public.loot_crates%rowtype;
  v_enabled boolean;
  v_aether  boolean;
  v_quote   jsonb;
  v_focus   text[];
  v_fee     int;
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
      'rewardId', v_crate.reward_cosmetic_id, 'sealedRemaining', v_sealed, 'profile', public.progression_profile_json(p_user),
      'aether', coalesce((select w.balance from public.aether_wallets w where w.user_id = p_user), 0));
  end if;

  select crates_enabled, aether_enabled into v_enabled, v_aether from public.progression_config where id = 1;
  if not coalesce(v_enabled, false) then raise exception 'crates_disabled'; end if;

  -- a focus at open is a milestone crate's alone, and it spends Aether, so it needs the Aether switch too
  if p_focus is not null then
    if v_crate.source is null or v_crate.source not like 'milestone:%' then raise exception 'focus_not_allowed'; end if;
    if not coalesce(v_aether, false) then raise exception 'aether_disabled'; end if;
    if p_expected_fee is null or p_expected_fee < 0 then raise exception 'bad_price'; end if;
  end if;

  if not exists (select 1 from public.progression_tiered_crate_pool(p_user, v_crate.floor_rarity, v_crate.focus_categories)) then
    select count(*) into v_sealed from public.loot_crates where user_id = p_user and state = 'sealed';
    return jsonb_build_object('status', 'pool_exhausted', 'crate', public.progression_crate_json(v_crate),
      'rewardId', null, 'sealedRemaining', v_sealed, 'profile', public.progression_profile_json(p_user),
      'aether', coalesce((select w.balance from public.aether_wallets w where w.user_id = p_user), 0));
  end if;

  v_focus := v_crate.focus_categories;
  if p_focus is not null then
    v_quote := public.aether_quote(p_user, 'legendary', p_focus, true);
    v_fee := (v_quote ->> 'total')::int;
    if v_fee <> p_expected_fee then raise exception 'price_changed'; end if;
    v_focus := case when jsonb_typeof(v_quote -> 'focus') = 'array'
      then array(select jsonb_array_elements_text(v_quote -> 'focus')) end;
    if v_fee > 0 then perform public.aether_apply(p_user, -v_fee, 'crate_focus', p_crate_id::text); end if;
  end if;

  -- ONE draw: a rarity at or above the floor at the renormalized odds, then an item of it (mirror of pickTieredCrateReward).
  v_pick := public.progression_tiered_crate_pick(p_user, random(), v_crate.floor_rarity, v_focus);
  if v_pick is null then raise exception 'duplicate_reward'; end if;

  insert into public.player_cosmetics (user_id, cosmetic_id, source, source_id)
    values (p_user, v_pick, 'crate', p_crate_id::text)
    on conflict (user_id, cosmetic_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise exception 'duplicate_reward'; end if;

  update public.loot_crates set state = 'opened', reward_cosmetic_id = v_pick, roll_version = c_roll_version, opened_at = now(),
      focus_categories = v_focus
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
    'rewardId', v_pick, 'sealedRemaining', v_sealed, 'profile', public.progression_profile_json(p_user),
    'aether', coalesce((select w.balance from public.aether_wallets w where w.user_id = p_user), 0));
end;
$$;

-- buy_crate: validate → the per-user lock → a crate already bought with this request id answers `already_opened` (no
-- charge; `quote` null, the price it was bought at is the crate's `price_paid`) → the switches → the server's own quote,
-- refused as `price_changed` when it is not the total the client showed → the charge (`crate_purchase`, source = the
-- request id) → the crate (no level, `source = 'shop:<request id>'`, its floor, canonical focus and price) → opened
-- through open_crate above (the same lock, re-entrant; the same one draw). All one transaction: a refusal anywhere
-- writes nothing.
create or replace function public.buy_crate(p_user uuid, p_tier text, p_focus text[], p_expected_total int, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source  text;
  v_crate   public.loot_crates%rowtype;
  v_enabled boolean;
  v_aether  boolean;
  v_quote   jsonb;
  v_total   int;
  v_focus   text[];
  v_open    jsonb;
begin
  if p_user is null then raise exception 'unauthenticated'; end if;
  if p_request_id is null then raise exception 'bad_request_id'; end if;
  if p_tier is null or p_tier not in ('standard', 'rare', 'epic', 'legendary', 'ancient') then raise exception 'bad_tier'; end if;
  if p_expected_total is null or p_expected_total < 0 then raise exception 'bad_price'; end if;
  perform pg_advisory_xact_lock(hashtextextended('progression:' || p_user::text, 0));

  v_source := 'shop:' || p_request_id::text;
  select * into v_crate from public.loot_crates where user_id = p_user and source = v_source;
  if found then
    return public.open_crate(p_user, v_crate.crate_id) || jsonb_build_object('status', 'already_opened', 'quote', null);
  end if;

  select crates_enabled, aether_enabled into v_enabled, v_aether from public.progression_config where id = 1;
  if not coalesce(v_enabled, false) then raise exception 'crates_disabled'; end if;
  if not coalesce(v_aether, false) then raise exception 'aether_disabled'; end if;

  v_quote := public.aether_quote(p_user, p_tier, p_focus, false);
  v_total := (v_quote ->> 'total')::int;
  if v_total <> p_expected_total then raise exception 'price_changed'; end if;
  v_focus := case when jsonb_typeof(v_quote -> 'focus') = 'array'
    then array(select jsonb_array_elements_text(v_quote -> 'focus')) end;

  perform public.aether_apply(p_user, -v_total, 'crate_purchase', p_request_id::text);

  insert into public.loot_crates (user_id, earned_level, source, source_id, floor_rarity, focus_categories, price_paid)
    values (p_user, null, v_source, v_source, v_quote ->> 'floor', v_focus, v_total)
    returning * into v_crate;

  v_open := public.open_crate(p_user, v_crate.crate_id);
  -- the quote promised something to give and we hold the lock, so anything but `opened` is a broken invariant: refuse it all
  if v_open ->> 'status' is distinct from 'opened' then raise exception 'duplicate_reward'; end if;
  return v_open || jsonb_build_object('quote', v_quote);
end;
$$;

-- ── Grants ───────────────────────────────────────────────────────────────────────────────────────────────
-- The two WRITERS (`buy_crate`, `open_crate`) are the service role's alone: the Edge Function calls only them. Every
-- helper is INTERNAL, revoked from the service role too: Supabase's default privileges grant EXECUTE on each new
-- function in `public` to anon, authenticated AND service_role, so a revoke that leaves service_role out leaves it
-- callable with the service key (precedent: guide_bookmark_counted in 2026-10-13-guides-community.sql). The writers are
-- security definer and reach the helpers as the owner. `aether_apply` above all: callable, it would mint Aether.
-- (The quote is internal too: the client prices from the TS `quoteCrate` and the server re-quotes inside `buy_crate`.)
revoke all on function public.aether_apply(uuid, int, text, text) from public, anon, authenticated, service_role;
revoke all on function public.progression_tiered_crate_pool(uuid, text, text[]) from public, anon, authenticated, service_role;
revoke all on function public.progression_tiered_crate_pick(uuid, double precision, text, text[]) from public, anon, authenticated, service_role;
revoke all on function public.aether_quote(uuid, text, text[], boolean) from public, anon, authenticated, service_role;
revoke all on function public.progression_crate_json(public.loot_crates) from public, anon, authenticated;
grant execute on function public.progression_crate_json(public.loot_crates) to service_role;
revoke all on function public.open_crate(uuid, uuid, text[], int) from public, anon, authenticated;
grant execute on function public.open_crate(uuid, uuid, text[], int) to service_role;
revoke all on function public.buy_crate(uuid, text, text[], int, uuid) from public, anon, authenticated;
grant execute on function public.buy_crate(uuid, text, text[], int, uuid) to service_role;

-- ── END OF SECTIONS 1-10 (switch, config, wallet, ledger, aether_apply, crate columns, tiered pool + pick, quote,
--    open_crate + buy_crate). Sections 11-14 (the settlement's Aether, Gauntlet Aether, milestone crates, the profile
--    JSON and the rollout) follow below. ──────────────────────────────────────────────────────────────────────────

-- ── 11. progression_results remembers the Aether a settlement paid; the result JSON carries it ────────────
-- Four columns, written by `settle_progression` below. `aether_on` records whether the switch was ON when the game
-- settled: OFF (every row before this file, and every row while the switch is off) the result's `aether` is null and the
-- crate-per-level rules applied; ON it is the breakdown (0/0/0 for Practice and Tutorial) and the crates are the
-- Welcome Crate and the milestone crates only.
alter table public.progression_results add column if not exists aether_base      int not null default 0;
alter table public.progression_results add column if not exists aether_placement int not null default 0;
alter table public.progression_results add column if not exists aether_total     int not null default 0;
alter table public.progression_results add column if not exists aether_on        boolean not null default false;

-- MUST match `ProgressionResult` in packages/progression/src/rules.ts key for key. The 2026-09-28-achievements.sql body
-- plus `aether` (null when the switch was off) and `aetherBalance` (the account's balance as this answer is built; null
-- exactly when `aether` is). Reading the wallet makes it STABLE (it was IMMUTABLE): a deduped replay shows today's
-- balance beside today's profile, the same way it already shows today's profile.
create or replace function public.progression_result_json(r public.progression_results)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'runId', r.run_id, 'mode', r.mode, 'rulesVersion', r.rules_version,
    'placement', r.placement, 'comeback', r.comeback,
    'xp', jsonb_build_object('base', r.base_xp, 'topFour', r.top_four_xp, 'firstPlace', r.first_place_xp, 'comeback', r.comeback_xp, 'total', r.total_xp),
    'before', jsonb_build_object('lifetimeXp', r.xp_before, 'level', r.level_before),
    'after',  jsonb_build_object('lifetimeXp', r.xp_after,  'level', r.level_after),
    'unlockedTitles', to_jsonb(r.unlocked_title_ids),
    'cratesAwarded', r.crates_awarded,
    'crateIds', to_jsonb(r.crate_ids),
    'achievements', to_jsonb(r.achievement_ids),
    'achievementXp', r.achievement_xp,
    'aether', case when r.aether_on then jsonb_build_object('base', r.aether_base, 'placement', r.aether_placement, 'total', r.aether_total) end,
    'aetherBalance', case when r.aether_on then coalesce((select w.balance from public.aether_wallets w where w.user_id = r.user_id), 0) end,
    'revisionAfter', r.revision_after,
    'settledAt', r.settled_at
  );
$$;
revoke all on function public.progression_result_json(public.progression_results) from public, anon, authenticated;
grant execute on function public.progression_result_json(public.progression_results) to service_role;

-- THE DEFENSIVE ECONOMY READ, used by every writer below: the integer at `p_path` in the economy document, or NULL when
-- it is unreadable (no row, a missing key, not a JSON number, fractional, below 0 or absurdly large), never an error.
-- `parseAetherEconomy` accepts exactly the same values (non-negative integers). A bad retune must never block a game:
-- the settlement and the Gauntlet treat NULL as "Aether off for this one" (XP and today's crates intact); only the
-- hand-run `aether_rollout` refuses it (`aether_config_invalid`). The nested CASE fixes the evaluation order, so a
-- string is never cast. Internal: revoked from every API role, the service role too (precedent: section 10).
create or replace function public.aether_economy_int(p_eco jsonb, p_path text[])
returns int
language sql
immutable
as $$
  select case when jsonb_typeof(p_eco #> p_path) = 'number' then
    case when (p_eco #>> p_path)::numeric between 0 and 1000000000 and (p_eco #>> p_path)::numeric = trunc((p_eco #>> p_path)::numeric)
      then (p_eco #>> p_path)::numeric::int end
  end;
$$;
revoke all on function public.aether_economy_int(jsonb, text[]) from public, anon, authenticated, service_role;

-- ── 12. settle_progression: Aether for Ranked and Versus; milestone crates replace level crates ──────────────
-- THE FULL 2026-10-14-versus-progression.sql WRITER, RE-CREATED. Every line is byte-for-byte that writer (its comments
-- included, so `sqlParity.test.ts` reads the same constants out of it) EXCEPT these additions, all gated on
-- `progression_config.aether_enabled`; with the switch OFF the function behaves exactly as before, crate for crate:
--  - the `-- aether` declarations (no new constants: every number is the server-owned `aether_config` economy, read
--    once into `v_eco`, each value through `aether_economy_int`);
--  - step 7a: the Aether this game pays (mirror of aetherForSettlement), credited through `aether_apply` with reason
--    = the mode and source = the run id, so the ledger's unique key backs the result-ledger dedupe. An UNREADABLE
--    economy (the row missing, a value this game needs not a valid integer, `milestoneEvery` below 1) settles THIS game
--    exactly as with the switch off (today's level crates, `aether` null, XP intact) and never raises;
--  - step 9b: the Welcome Crate on enrollment (kept, owner 2026-10-18) plus ONE crate per milestone level at or below
--    the new level (`milestoneLevelsThrough`; every one, not just the newly crossed, so a missing one self-heals), and
--    no other level crate. The switch-off branch is the unchanged per-level insert;
--  - step 10: the result row writes the four Aether columns.
-- A MILESTONE CRATE IS ALWAYS FLOOR LEGENDARY: `open_crate` quotes a focus at open at the Legendary fee and rolls the
-- crate's own floor, so a milestone crate on any other floor would be priced and rolled inconsistently. The constraint
-- pins it for every writer (this one, `aether_rollout` below, and anything later).
alter table public.loot_crates drop constraint if exists loot_crates_milestone_is_legendary;
alter table public.loot_crates add constraint loot_crates_milestone_is_legendary
  check (source is null or source not like 'milestone:%' or floor_rarity = 'legendary');
create or replace function public.settle_progression(
  p_user uuid, p_mode text, p_run_id text, p_source_id bigint default null, p_comeback boolean default false,
  p_rules_version int default null, p_facts jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- THE RULES (mirror of XP_RULES / CURVE in packages/progression/src/rules.ts — change all copies together)
  c_rules             constant int := 1;
  c_curve             constant int := 1;
  c_complete          constant int := 100;
  c_top_four          constant int := 60;
  c_first_place       constant int := 90;
  c_comeback          constant int := 25;
  c_comeback_streak   constant int := 4;
  c_practice_percent  constant int := 60;
  c_practice_flat     constant int := 60;
  c_tutorial          constant int := 250;
  c_tutorial_course   constant text := 'learn-ascent';
  c_tutorial_version  constant int := 1;
  c_alpha_title       constant text := 'alpha_tester';
  c_alpha_level       constant int := 2;
  c_rate_max          constant int := 30;
  c_rate_window       constant interval := interval '10 minutes';
  -- ACHIEVEMENTS (mirror of packages/progression/src/achievements.ts)
  c_meta_metric       constant text := 'achievementsCompleted';
  c_brutal_strength   constant int := 70;
  c_ascendant_div     constant int := 15;
  c_metric_max        constant bigint := 1000000000;
  -- HERO TITLES (mirror of heroTitleId / heroMasterTitleId in packages/progression/src/cosmetics.ts)
  c_hero_title_prefix constant text := 'title_hero_';
  c_master_suffix     constant text := '_master';
  -- VERSUS (owner 2026-10-14: "versus can complete achievements and grant XP but no rank progress")
  c_versus_win        constant int := 60;
  c_versus_min_rounds constant int := 1;

  prof        public.profiles%rowtype;
  prev        public.progression_results%rowtype;
  v_epoch     timestamptz;
  v_recent    int;
  v_source_at timestamptz;
  v_source    text := null;
  v_placement int := null;
  v_comeback  boolean := false;
  v_seed      bigint;
  v_cfg       jsonb;
  v_record    jsonb;
  v_wins      int;
  v_losses    int;
  r_top int := 0; r_first int := 0; r_come int := 0; v_ranked_total int;
  v_base int := 0; v_top int := 0; v_first int := 0; v_come int := 0; v_total int;
  v_xp0 bigint; v_xp1 bigint; v_l0 int; v_l1 int;
  v_unlocked  text[] := '{}';
  v_equipped  text;
  v_rows      int;
  v_facts_ver int := null;
  v_enrolling boolean;
  v_crate_ids uuid[] := '{}';
  -- achievements
  v_ach_epoch  timestamptz;
  v_promoted   boolean := false;
  v_div_before int := null;
  v_demo_game  boolean := false;
  v_demoted    boolean := false;
  v_strength   int := null;
  v_hero       text := null;
  v_set        text := null;
  v_run_ok     boolean := false;
  v_metrics    jsonb := '{}';
  v_first_streak int := 0;
  v_top_streak int := 0;
  v_heroes_played int := 0;
  v_heroes_won int := 0;
  v_done_count int := 0;
  d            public.achievement_catalog%rowtype;
  v_val        bigint;
  v_old        bigint;
  v_done       boolean;
  v_new        bigint;
  v_ach_ids    text[] := '{}';
  v_ach_xp     int := 0;
  v_hero_title text := null;
  -- versus
  v_match      public.versus_matches%rowtype;
  v_vs_seat    text := null;
  v_ach_place  int := null;
  -- aether (2026-10-18): no constants; the numbers are the aether_config economy, read once
  v_aether     boolean := false;
  v_eco        jsonb;
  v_ae_base    int := 0;
  v_ae_place   int := 0;
  v_ae_every   int;
begin
  -- 1. validate
  if p_mode is null or p_mode not in ('ranked', 'practice', 'tutorial', 'versus') then raise exception 'bad_mode'; end if;
  if p_run_id is null or length(p_run_id) < 1 or length(p_run_id) > 128 then raise exception 'bad_run_id'; end if;
  if p_rules_version is distinct from c_rules then raise exception 'unsupported_rules'; end if;

  -- 2. serialize per user (every progression entry point takes the advisory lock first), then lock the row
  perform pg_advisory_xact_lock(hashtextextended('progression:' || p_user::text, 0));
  insert into public.profiles (user_id, rating) values (p_user, 0) on conflict (user_id) do nothing;
  select * into prof from public.profiles where user_id = p_user for update;

  -- 3. ledger check UNDER the lock: a duplicate returns the ORIGINAL result + today's profile, awards nothing
  select * into prev from public.progression_results where user_id = p_user and run_id = p_run_id and mode = p_mode;
  if found then
    return jsonb_build_object('status', 'deduped', 'result', public.progression_result_json(prev), 'profile', public.progression_profile_json(p_user));
  end if;

  -- 4. the switch: nothing is awarded before the owner sets the epoch
  select epoch, achievements_epoch into v_epoch, v_ach_epoch from public.progression_config where id = 1;
  if v_epoch is null then raise exception 'progression_disabled'; end if;

  -- 5. rate limit (technical only: a refused request is retried later and keeps its XP)
  select count(*) into v_recent from public.progression_results
    where user_id = p_user and settled_at >= now() - c_rate_window;
  if v_recent >= c_rate_max then raise exception 'rate_limited'; end if;

  -- 6. the SOURCE row: the placement comes from here, never from the request
  if p_mode = 'ranked' then
    select rr.placement, rr.seed, rr.created_at, rr.promoted, rr.division_before, rr.was_demotion_game, rr.demoted, rr.lobby_strength
      into v_placement, v_seed, v_source_at, v_promoted, v_div_before, v_demo_game, v_demoted, v_strength
      from public.rank_results rr where rr.user_id = p_user and rr.run_id = p_run_id;
    if not found then raise exception 'source_not_found'; end if;
    if v_source_at < v_epoch then raise exception 'before_epoch'; end if;
    v_source := p_run_id;
    v_comeback := coalesce(p_comeback, false);
    if v_comeback and v_seed is not null then
      select h.wins, case when (h.entry->>'losses') ~ '^[0-9]+$' then (h.entry->>'losses')::int end
        into v_wins, v_losses
        from public.run_history h
        where h.user_id = p_user and h.mode = 'lobby' and h.entry->>'seed' = v_seed::text
        order by h.created_at desc limit 1;
      if found and (coalesce(v_losses, 0) < c_comeback_streak or coalesce(v_wins, 0) < 1) then v_comeback := false; end if;
    end if;
  elsif p_mode = 'practice' then
    if p_source_id is null or p_source_id < 1 then raise exception 'bad_source'; end if;
    if p_run_id is distinct from ('practice:' || p_source_id::text) then raise exception 'bad_run_id'; end if;
    select pg.placement, pg.config, pg.record, pg.created_at, pg.hero_id into v_placement, v_cfg, v_record, v_source_at, v_hero
      from public.practice_games pg where pg.id = p_source_id and pg.user_id = p_user;
    if not found then raise exception 'source_not_found'; end if;
    if v_source_at < v_epoch then raise exception 'before_epoch'; end if;
    v_source := p_source_id::text;
    -- No meaningful placement: an Unlimited Health game plays to the curtain and is never eliminated (and a row
    -- with no options recorded is treated the same way). It earns the flat XP, no placement or comeback bonus.
    if v_cfg is null or coalesce(v_cfg->>'health', 'unlimited') <> 'normal'
       or v_placement is null or v_placement < 1 or v_placement > 8 then
      v_placement := null;
    end if;
    v_comeback := coalesce(p_comeback, false) and v_placement is not null;
    if v_comeback and v_record is not null then
      v_wins := case when (v_record->>'wins') ~ '^[0-9]+$' then (v_record->>'wins')::int end;
      v_losses := case when (v_record->>'losses') ~ '^[0-9]+$' then (v_record->>'losses')::int end;
      if coalesce(v_losses, 0) < c_comeback_streak or coalesce(v_wins, 0) < 1 then v_comeback := false; end if;
    end if;
  elsif p_mode = 'versus' then
    -- VERSUS: the source is the server-owned match row. The caller must have held a PLAYER seat, the match must be
    -- over and must have fought at least one round. Placement = 1 for the winner, 2 for the loser, null when nobody
    -- won (abandoned). It drives XP only: rank_results, rating and MMR are never read or written here.
    if p_run_id !~ '^versus:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'bad_run_id'; end if;
    select * into v_match from public.versus_matches m where m.id = substring(p_run_id from 8)::uuid;
    if not found then raise exception 'source_not_found'; end if;
    v_vs_seat := case when v_match.p1_user = p_user then 'p1' when v_match.p2_user = p_user then 'p2' end;
    if v_vs_seat is null then raise exception 'source_not_found'; end if;
    if v_match.phase <> 'complete' or v_match.completed_at is null then raise exception 'not_terminal'; end if;
    if not exists (select 1 from public.versus_rounds vr where vr.match_id = v_match.id and vr.round >= c_versus_min_rounds) then raise exception 'not_terminal'; end if;
    v_source_at := v_match.completed_at;
    if v_source_at < v_epoch then raise exception 'before_epoch'; end if;
    v_source := v_match.id::text;
    v_placement := case when v_match.winner_seat is null then null when v_match.winner_seat = v_vs_seat then 1 else 2 end;
    v_comeback := false;
    v_hero := case when v_vs_seat = 'p1' then v_match.p1_hero else v_match.p2_hero end;
  else
    -- tutorial: one claim per account per course version (the ledger check above already caught a repeat)
    if p_run_id is distinct from (c_tutorial_course || ':v' || c_tutorial_version::text) then raise exception 'bad_run_id'; end if;
    insert into public.tutorial_progression_claims (user_id, course_id, course_version, xp_awarded)
      values (p_user, c_tutorial_course, c_tutorial_version, c_tutorial)
      on conflict (user_id, course_id, course_version) do nothing;
    v_source := c_tutorial_course || ':' || c_tutorial_version::text;
  end if;

  -- 7. XP (mirror of xpForSettlement)
  if p_mode = 'tutorial' then
    v_base := c_tutorial;
  elsif p_mode = 'versus' then
    -- VERSUS: the completion XP, plus the win bonus for the winner (stored in the first-place column).
    v_base := c_complete;
    v_first := case when v_placement = 1 then c_versus_win else 0 end;
  elsif p_mode = 'practice' and v_placement is null then
    v_base := c_practice_flat;
  else
    r_top   := case when v_placement <= 4 then c_top_four else 0 end;
    r_first := case when v_placement = 1 then c_first_place else 0 end;
    r_come  := case when v_comeback then c_comeback else 0 end;
    if p_mode = 'ranked' then
      v_base := c_complete; v_top := r_top; v_first := r_first; v_come := r_come;
    else
      -- Practice: 60% of the equivalent ranked XP, summed then rounded; the remainder lands on the base.
      v_ranked_total := c_complete + r_top + r_first + r_come;
      v_top   := (r_top   * c_practice_percent + 50) / 100;
      v_first := (r_first * c_practice_percent + 50) / 100;
      v_come  := (r_come  * c_practice_percent + 50) / 100;
      v_base  := (v_ranked_total * c_practice_percent + 50) / 100 - v_top - v_first - v_come;
    end if;
  end if;
  v_total := v_base + v_top + v_first + v_come;

  -- 7a. AETHER (owner 2026-10-18: Aether replaces level-up crates; mirror of aetherForSettlement in
  -- packages/progression/src/aether.ts). Only with the switch on. Ranked: the base + the placement bonus, win or lose,
  -- for a VALID placement (none = the ladder never accepted the game: 0). Versus: the completion pay for ANY finished
  -- match (won, lost or abandoned with no winner) + the win bonus at placement 1. Practice and Tutorial: 0; no
  -- comeback bonus. Credited with reason = the mode, source = the run id, only when the total is above 0. An
  -- UNREADABLE economy (no row; a value this game needs, or `milestoneEvery`, not a valid integer; `milestoneEvery`
  -- below 1) turns Aether off FOR THIS SETTLEMENT: today's level crates, `aether` null, the XP untouched. A bad retune
  -- must never block a game (a raise here would fail every settlement until the config is fixed).
  select aether_enabled into v_aether from public.progression_config where id = 1;
  v_aether := coalesce(v_aether, false);
  if v_aether then
    select economy into v_eco from public.aether_config where id = 1;
    v_ae_every := public.aether_economy_int(v_eco, array['milestoneEvery']);
    if p_mode = 'ranked' and v_placement between 1 and 8 then
      v_ae_base  := public.aether_economy_int(v_eco, array['rankedBase']);
      v_ae_place := public.aether_economy_int(v_eco, array['rankedPlacementBonus', (v_placement - 1)::text]);
    elsif p_mode = 'versus' then
      v_ae_base  := public.aether_economy_int(v_eco, array['versusComplete']);
      -- read (and so checked) for both players, paid to the winner only
      v_ae_place := public.aether_economy_int(v_eco, array['versusWin']);
      if v_ae_place is not null and v_placement is distinct from 1 then v_ae_place := 0; end if;
    end if;
    if v_ae_every is null or v_ae_every < 1 or v_ae_base is null or v_ae_place is null then
      v_aether := false; v_ae_base := 0; v_ae_place := 0;
    elsif v_ae_base + v_ae_place > 0 then
      perform public.aether_apply(p_user, v_ae_base + v_ae_place, p_mode, p_run_id);
    end if;
  end if;

  if p_facts is not null and jsonb_typeof(p_facts) = 'object' and (p_facts->>'version') ~ '^[0-9]+$' then
    v_facts_ver := (p_facts->>'version')::int;
  end if;

  -- 7b. ACHIEVEMENTS (mirror of evaluateAchievements in packages/progression/src/achievements.ts). Only once the
  -- owner has set the achievements epoch, and only for a game whose source row is not older than it.
  if v_ach_epoch is not null and coalesce(v_source_at, now()) >= v_ach_epoch then
    -- The `any` gate: Ranked, or a standard Practice (Normal Health, so a real placement, AND a turn timer).
    v_run_ok := p_mode = 'ranked' or p_mode = 'versus'
      or (p_mode = 'practice' and v_placement is not null and coalesce(v_cfg->>'timeMult', '') ~ '^[1-9][0-9]*$');
    if p_mode = 'ranked' then v_hero := p_facts->>'heroId'; end if;
    -- VERSUS: a 1v1 "1st" is not a lobby finish, so placement-gated achievements (Top 4, 1st) never count it.
    v_ach_place := case when p_mode = 'versus' then null else v_placement end;
    if v_hero is not null and v_hero !~ '^[A-Za-z0-9_.-]{1,64}$' then v_hero := null; end if;
    v_set := p_facts->>'setId';
    if v_set is not null and v_set !~ '^[A-Za-z0-9_.-]{1,32}$' then v_set := null; end if;

    -- Distinct heroes: this game counts toward its hero when it is an eligible game.
    if v_run_ok and v_hero is not null then
      insert into public.achievement_hero_stats (user_id, hero_id, games, firsts)
        values (p_user, v_hero, 1, case when p_mode = 'ranked' and v_placement = 1 then 1 else 0 end)
        on conflict (user_id, hero_id) do update set
          games = public.achievement_hero_stats.games + 1,
          firsts = public.achievement_hero_stats.firsts + excluded.firsts,
          updated_at = now();
    end if;
    select count(*) filter (where s.games > 0), count(*) filter (where s.firsts > 0) into v_heroes_played, v_heroes_won
      from public.achievement_hero_stats s where s.user_id = p_user;

    -- Ranked streaks, over Ranked games since the achievements epoch, ending with this one.
    if p_mode = 'ranked' then
      with r as (
        select rr.placement, row_number() over (order by rr.created_at desc, rr.run_id desc) as rn
        from public.rank_results rr
        where rr.user_id = p_user and rr.created_at >= v_ach_epoch and rr.created_at <= v_source_at
      )
      select coalesce((select min(rn) from r where placement <> 1) - 1, (select count(*) from r)),
             coalesce((select min(rn) from r where placement > 4) - 1, (select count(*) from r))
        into v_first_streak, v_top_streak;
    end if;

    -- The metrics: the client's run metrics (V2), overwritten by every server metric (a client can never name one).
    if coalesce(v_facts_ver, 0) >= 2 and jsonb_typeof(p_facts->'metrics') = 'object' then v_metrics := p_facts->'metrics'; end if;
    v_metrics := v_metrics || jsonb_build_object(
      'game', 1,
      'comeback', case when v_comeback then 1 else 0 end,
      'highestDivision', coalesce(prof.rank_highest_division, 0),
      'promoted', case when p_mode = 'ranked' and v_promoted then 1 else 0 end,
      'ascendantFirst', case when p_mode = 'ranked' and v_placement = 1 and coalesce(v_div_before, 0) >= c_ascendant_div then 1 else 0 end,
      'demotionEscape', case when p_mode = 'ranked' and v_demo_game and not v_demoted and v_placement <= 4 then 1 else 0 end,
      'brutalFirst', case when p_mode = 'ranked' and v_placement = 1 and coalesce(v_strength, 0) >= c_brutal_strength then 1 else 0 end,
      'firstStreak', v_first_streak,
      'topFourStreak', v_top_streak,
      'heroesPlayed', v_heroes_played,
      'heroesWon', v_heroes_won,
      c_meta_metric, 0
    );

    -- Pass 1: every live, non-prestige, non-meta definition, in id order. Pass 2: the meta family, by target.
    select count(*) into v_done_count from public.achievement_completions c where c.user_id = p_user;
    for d in
      select * from public.achievement_catalog c
      where c.active and not c.admin_off and c.trust <> 'P'
      order by (c.metric = c_meta_metric), case when c.metric = c_meta_metric then c.target else 0 end, c.achievement_id collate "C"
    loop
      continue when d.mode = 'ranked' and p_mode <> 'ranked';
      continue when d.mode = 'tutorial' and p_mode <> 'tutorial';
      continue when d.mode = 'any' and not v_run_ok;
      continue when d.set_id is not null and v_set is distinct from d.set_id;
      continue when d.hero_id is not null and v_hero is distinct from d.hero_id;
      continue when d.placement_max is not null and (v_ach_place is null or v_ach_place > d.placement_max);
      if d.metric = c_meta_metric then
        v_val := v_done_count;
      elsif jsonb_typeof(v_metrics->d.metric) = 'number' then
        v_val := least(c_metric_max, greatest(0, floor((v_metrics->>d.metric)::numeric)))::bigint;
      else
        v_val := 0;
      end if;
      continue when v_val <= 0;
      select ap.progress, ap.completed_at is not null into v_old, v_done
        from public.achievement_progress ap where ap.user_id = p_user and ap.achievement_id = d.achievement_id;
      if not found then v_old := 0; v_done := false; end if;
      continue when v_done;
      v_new := case when d.agg = 'sum' then v_old + v_val else greatest(v_old, v_val) end;
      continue when v_new = v_old and v_new < d.target;
      insert into public.achievement_progress (user_id, achievement_id, definition_version, progress, completed_at, completion_run_id, updated_at)
        values (p_user, d.achievement_id, d.version, v_new,
                case when v_new >= d.target then now() end, case when v_new >= d.target then p_run_id end, now())
        on conflict (user_id, achievement_id) do update set
          definition_version = excluded.definition_version, progress = excluded.progress,
          completed_at = excluded.completed_at, completion_run_id = excluded.completion_run_id, updated_at = now();
      if v_new >= d.target then
        insert into public.achievement_completions (user_id, achievement_id, run_id, mode, xp_awarded, title_id)
          values (p_user, d.achievement_id, p_run_id, p_mode, d.xp, d.title_id)
          on conflict (user_id, achievement_id) do nothing;
        get diagnostics v_rows = row_count;
        if v_rows > 0 then
          v_ach_ids := array_append(v_ach_ids, d.achievement_id);
          v_ach_xp := v_ach_xp + d.xp;
          v_done_count := v_done_count + 1;
          -- 7c. A TITLE reward (hero titles, owner 2026-09-29) is granted in the same transaction. Only a title the
          -- catalog knows (the ownership FK); the grant is keyed, so a retry or the backfill never doubles it.
          if d.title_id is not null and exists (select 1 from public.cosmetic_catalog c where c.cosmetic_id = d.title_id and c.category = 'title') then
            insert into public.player_cosmetics (user_id, cosmetic_id, source, source_id)
              values (p_user, d.title_id, 'achievement', d.achievement_id)
              on conflict (user_id, cosmetic_id) do nothing;
            get diagnostics v_rows = row_count;
            if v_rows > 0 then
              v_unlocked := array_append(v_unlocked, d.title_id);
              if d.title_id like c_hero_title_prefix || '%' then v_hero_title := d.title_id; end if;
            end if;
          end if;
        end if;
      end if;
    end loop;
  end if;

  -- 8. levels (lifetime XP; the level is derived). Achievement XP counts toward the level and its crates.
  v_xp0 := coalesce(prof.account_xp, 0);
  v_xp1 := v_xp0 + v_total + v_ach_xp;
  v_l0 := public.progression_level_of(v_xp0);
  v_l1 := public.progression_level_of(v_xp1);

  -- 9. titles: Alpha Tester for EVERY account at Level 2 (owner 2026-09-27); equipped when nothing else is
  if v_l1 >= c_alpha_level then
    insert into public.player_cosmetics (user_id, cosmetic_id, source, source_id)
      values (p_user, c_alpha_title, 'level', p_mode || ':' || p_run_id)
      on conflict (user_id, cosmetic_id) do nothing;
    get diagnostics v_rows = row_count;
    if v_rows > 0 then v_unlocked := array_append(v_unlocked, c_alpha_title); end if;
  end if;
  v_equipped := prof.equipped_title_id;
  -- 9a. HERO TITLES (owner 2026-09-29). The master UPGRADES the title in place: a newly earned master replaces its own
  -- base title when that is the one worn. A new hero title is worn when nothing is (like Alpha Tester).
  if v_equipped is not null and v_equipped like c_hero_title_prefix || '%' and (v_equipped || c_master_suffix) = any(v_unlocked) then
    v_equipped := v_equipped || c_master_suffix;
  end if;
  if v_equipped is null and v_hero_title is not null then
    v_equipped := v_hero_title;
  end if;
  if v_equipped is null and exists (select 1 from public.player_cosmetics o where o.user_id = p_user and o.cosmetic_id = c_alpha_title) then
    v_equipped := c_alpha_title;
  end if;

  -- 9b. crates: one sealed crate per newly reached level; enrollment (the first settlement) also grants the
  -- Level 1 Welcome Crate. The unique (user, level) key makes this safe against the backfill and any retry.
  -- AETHER ON (owner 2026-10-18): no crate per level. The Welcome Crate (Level 1, floor Common) on enrollment, as
  -- before, and one floor-LEGENDARY crate per milestone level at or below the new level (mirror of
  -- milestoneLevelsThrough), `source = 'milestone:<L>'`, so the one-crate-per-source index makes it once per
  -- milestone and a missing one self-heals. `v_crate_ids` holds only the rows actually created, Welcome first.
  -- AETHER OFF: the unchanged per-level insert below the `else` (kept byte-for-byte, hence its indentation).
  v_enrolling := prof.progression_enrolled_at is null;
  if v_aether then
    with ins as (
      insert into public.loot_crates (user_id, earned_level, source_id)
        select p_user, 1, p_mode || ':' || p_run_id where v_enrolling
        on conflict (user_id, earned_level) do nothing
        returning crate_id
    )
    select coalesce(array_agg(ins.crate_id), '{}') into v_crate_ids from ins;
    if v_ae_every >= 1 then
      with ins as (
        insert into public.loot_crates (user_id, earned_level, source, source_id, floor_rarity)
          select p_user, null, 'milestone:' || g.lvl, p_mode || ':' || p_run_id, 'legendary'
          from generate_series(v_ae_every, v_l1, v_ae_every) as g(lvl)
          on conflict (user_id, source) where source is not null do nothing
          returning crate_id, source
      )
      select v_crate_ids || coalesce(array_agg(ins.crate_id order by split_part(ins.source, ':', 2)::int), '{}')
        into v_crate_ids from ins;
    end if;
  else
  with ins as (
    insert into public.loot_crates (user_id, earned_level, source_id)
      select p_user, g.lvl, p_mode || ':' || p_run_id
      from generate_series(case when v_enrolling then 1 else v_l0 + 1 end, v_l1) as g(lvl)
      on conflict (user_id, earned_level) do nothing
      returning crate_id, earned_level
  )
  select coalesce(array_agg(ins.crate_id order by ins.earned_level), '{}') into v_crate_ids from ins;
  end if;

  -- 10. write profile + revision + the immutable result in this same transaction
  update public.profiles set
    account_xp = v_xp1, account_level = v_l1,
    progression_revision = prof.progression_revision + 1,
    progression_enrolled_at = coalesce(prof.progression_enrolled_at, now()),
    progression_curve_version = c_curve,
    equipped_title_id = v_equipped,
    updated_at = now()
  where user_id = p_user;

  insert into public.progression_results (
    user_id, run_id, mode, source_id, rules_version, curve_version, facts_version, facts,
    placement, comeback, base_xp, top_four_xp, first_place_xp, comeback_xp, achievement_xp, total_xp,
    xp_before, xp_after, level_before, level_after, revision_before, revision_after,
    crates_awarded, crate_ids, achievement_ids, unlocked_title_ids,
    aether_base, aether_placement, aether_total, aether_on
  ) values (
    p_user, p_run_id, p_mode, v_source, c_rules, c_curve, v_facts_ver, case when v_facts_ver is null then null else p_facts end,
    v_placement, v_comeback, v_base, v_top, v_first, v_come, v_ach_xp, v_total,
    v_xp0, v_xp1, v_l0, v_l1, prof.progression_revision, prof.progression_revision + 1,
    coalesce(array_length(v_crate_ids, 1), 0), v_crate_ids, v_ach_ids, v_unlocked,
    v_ae_base, v_ae_place, v_ae_base + v_ae_place, v_aether
  ) returning * into prev;

  return jsonb_build_object('status', 'ok', 'result', public.progression_result_json(prev), 'profile', public.progression_profile_json(p_user));
end;
$$;
revoke all on function public.settle_progression(uuid, text, text, bigint, boolean, int, jsonb) from public, anon, authenticated;
grant execute on function public.settle_progression(uuid, text, text, bigint, boolean, int, jsonb) to service_role;

-- ── 13. record_gauntlet_clear: a first clear pays Aether instead of a crate (switch on) ────────────────────
-- The 2026-09-29-gauntlet-progress.sql transaction (validate → the per-user lock → the keyed progress row, a replay
-- answering `already_cleared`) with one change: once the progress row is new, the Aether switch decides the reward.
--  - ON: `gauntletFirstClear` Aether (200), reason 'gauntlet', source 'gauntlet:<stage>' (so once per stage, ever), and
--    NO crate (`crate_granted` stays false, `crate_id` null). Answers {status 'first_clear', crate null, aether}.
--    Stages cleared before the switch already have their row, so they replay as `already_cleared` and pay nothing
--    (spec 2026-10-18: stages already cleared before rollout "keep the crate they gave and pay no Aether").
--  - OFF, OR AN UNUSABLE AMOUNT (the economy row missing, `gauntletFirstClear` not a valid integer, or retuned to 0):
--    exactly today's sealed crate, plus `aether: 0`. A first clear happens once, so it must always give something.
-- Every answer carries `aether` (0 on a replay). Trust is unchanged: the client's clear is believed (owner 2026-09-29;
-- the Aether is the same accepted risk, spec 2026-10-18).
create or replace function public.record_gauntlet_clear(p_user uuid, p_stage int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows    int;
  v_crate   public.loot_crates%rowtype;
  v_aether  boolean;
  v_amount  int;
begin
  if p_user is null then raise exception 'unauthenticated'; end if;
  if p_stage is null or p_stage < 1 or p_stage > 10 then raise exception 'bad_stage'; end if;
  perform pg_advisory_xact_lock(hashtextextended('progression:' || p_user::text, 0));

  insert into public.gauntlet_progress (user_id, stage) values (p_user, p_stage)
    on conflict (user_id, stage) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return jsonb_build_object('status', 'already_cleared', 'crate', null, 'aether', 0);
  end if;

  select aether_enabled into v_aether from public.progression_config where id = 1;
  if coalesce(v_aether, false) then
    v_amount := public.aether_economy_int((select c.economy from public.aether_config c where c.id = 1), array['gauntletFirstClear']);
    if v_amount > 0 then
      perform public.aether_apply(p_user, v_amount, 'gauntlet', 'gauntlet:' || p_stage);
      return jsonb_build_object('status', 'first_clear', 'crate', null, 'aether', v_amount);
    end if;
    -- unreadable or not above 0: the crate below, exactly as with the switch off (a first clear only happens once, so
    -- answering "nothing" here would strand the stage with neither a crate nor Aether, forever)
  end if;

  insert into public.loot_crates (user_id, earned_level, source, source_id)
    values (p_user, null, 'gauntlet:' || p_stage, 'gauntlet:' || p_stage)
    returning * into v_crate;
  update public.gauntlet_progress set crate_granted = true, crate_id = v_crate.crate_id
    where user_id = p_user and stage = p_stage;

  return jsonb_build_object('status', 'first_clear', 'crate', public.progression_crate_json(v_crate), 'aether', 0);
end;
$$;
revoke all on function public.record_gauntlet_clear(uuid, int) from public, anon, authenticated;
grant execute on function public.record_gauntlet_clear(uuid, int) to service_role;

-- ── 13b. The profile JSON carries the Aether balance ─────────────────────────────────────────────────────
-- MUST match `ProgressionProfile` in packages/progression/src/rules.ts key for key. The 2026-09-28-progression-skins.sql
-- body plus `aether`: the wallet balance, 0 for an account that never earned (no wallet row yet). Always present, the
-- switch on or off (a balance cannot move while it is off, so showing it is harmless; the client decides visibility).
create or replace function public.progression_profile_json(p_user uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'accountXp', p.account_xp, 'accountLevel', p.account_level, 'revision', p.progression_revision,
    'equippedTitleId', p.equipped_title_id,
    'titles', coalesce((
      select jsonb_agg(o.cosmetic_id order by o.unlocked_at, o.cosmetic_id)
      from public.player_cosmetics o join public.cosmetic_catalog c on c.cosmetic_id = o.cosmetic_id
      where o.user_id = p.user_id and c.category = 'title'
    ), '[]'::jsonb),
    'cosmetics', coalesce((
      select jsonb_agg(o.cosmetic_id order by o.unlocked_at, o.cosmetic_id)
      from public.player_cosmetics o where o.user_id = p.user_id
    ), '[]'::jsonb),
    'loadout', coalesce((
      select jsonb_agg(jsonb_build_object('slot', l.slot, 'targetId', l.target_id, 'cosmeticId', l.cosmetic_id) order by l.slot, l.target_id)
      from public.cosmetic_loadouts l
      join public.cosmetic_catalog c on c.cosmetic_id = l.cosmetic_id
      join public.cosmetic_categories k on k.category = c.category
      where l.user_id = p.user_id and c.active and not c.admin_off and k.enabled and not k.admin_off
    ), '[]'::jsonb),
    'aether', coalesce((select w.balance from public.aether_wallets w where w.user_id = p.user_id), 0)
  )
  from public.profiles p where p.user_id = p_user;
$$;
revoke all on function public.progression_profile_json(uuid) from public, anon, authenticated;
grant execute on function public.progression_profile_json(uuid) to service_role;

-- ── 14. aether_rollout: backdate the milestone crates, then flip the switch. Service role only. ─────────────
-- THE OWNER'S ONE-SHOT (run it once from the SQL Editor when Aether launches; the runbook line is at the very bottom
-- of this file, commented out). For every profile at or above the first milestone level (Level 10), one free
-- floor-Legendary, unfocused crate per milestone level at or below its CURRENT level (spec 2026-10-18: "one per multiple
-- of 10 at or below their current level"), `source = 'milestone:<L>'`; each account given a
-- crate gets its progression revision moved so its mirrors adopt the new crates. Then `aether_enabled = true`.
-- Returns {accounts: accounts given at least one NEW crate, crates: crates created}. IDEMPOTENT: the one-crate-per-
-- source index makes a re-run (or a settlement that already granted a milestone) create nothing, so a second run
-- answers {accounts 0, crates 0}. Earned Aether is NOT backdated (accounts start at 0; spec 2026-10-18). Because the
-- owner runs it by hand, an unreadable `milestoneEvery` (or one below 1) REFUSES (`aether_config_invalid`) and changes
-- nothing, rather than flipping the switch with no crates granted.
create or replace function public.aether_rollout()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_every    int;
  v_crates   int := 0;
  v_accounts int := 0;
begin
  v_every := public.aether_economy_int((select c.economy from public.aether_config c where c.id = 1), array['milestoneEvery']);
  if v_every is null or v_every < 1 then raise exception 'aether_config_invalid'; end if;

  with ins as (
    insert into public.loot_crates (user_id, earned_level, source, source_id, floor_rarity)
      select p.user_id, null, 'milestone:' || g.lvl, 'aether_rollout', 'legendary'
      from public.profiles p
      cross join lateral generate_series(v_every, p.account_level, v_every) as g(lvl)
      where p.account_level >= v_every
      on conflict (user_id, source) where source is not null do nothing
      returning user_id
  ), touched as (
    update public.profiles p set progression_revision = p.progression_revision + 1, updated_at = now()
      where p.user_id in (select distinct ins.user_id from ins)
      returning p.user_id
  )
  select (select count(*) from ins), (select count(*) from touched) into v_crates, v_accounts;

  update public.progression_config set aether_enabled = true where id = 1;
  return jsonb_build_object('accounts', v_accounts, 'crates', v_crates);
end;
$$;
revoke all on function public.aether_rollout() from public, anon, authenticated;
grant execute on function public.aether_rollout() to service_role;

-- ── END OF SECTIONS 11-14. ─────────────────────────────────────────────────────────────────────────────────

-- THE OWNER'S LAUNCH RUNBOOK (run once, AFTER this file and the Edge Functions are deployed): backdate the milestone
-- crates and turn Aether on.
-- select public.aether_rollout();
