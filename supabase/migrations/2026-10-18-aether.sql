-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- AETHER: the earned currency, the wallet + ledger, and the Crate Shop (tiered, focusable crates)  (2026-10-18)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-10-17-versus-open-rooms.sql (the last file before it; the
-- settlement sections appended to this file replace `settle_progression` from 2026-10-14-versus-progression.sql, so it
-- must come after every file that defines it). THEN deploy the `progression-inventory` Edge Function (it calls
-- `buy_crate` and the focused `open_crate`; before this file runs those calls fail with "function does not exist",
-- so run the SQL FIRST). Idempotent: every table and column is `if not exists`, the config seed is `on conflict do
-- nothing` (a retuned economy is never overwritten), and every function is REPLACED and re-granted, so re-running it is
-- always safe. The same block is appended to schema.sql; keep the two identical. Spec:
-- docs/superpowers/specs/2026-10-18-aether-crate-shop-design.md.
--
-- WHAT THIS REPLACES. `open_crate` (2026-10-02-ancient-rarity.sql): the 2-argument overload is DROPPED and a
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

-- ── 5. aether_apply: THE one writer of a balance. Internal (no grant at all). ─────────────────────────────
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

-- ── Grants: service role only (aether_apply: nobody; it is called from the security-definer functions) ──────
revoke all on function public.aether_apply(uuid, int, text, text) from public, anon, authenticated;
revoke all on function public.progression_crate_json(public.loot_crates) from public, anon, authenticated;
grant execute on function public.progression_crate_json(public.loot_crates) to service_role;
revoke all on function public.progression_tiered_crate_pool(uuid, text, text[]) from public, anon, authenticated;
grant execute on function public.progression_tiered_crate_pool(uuid, text, text[]) to service_role;
revoke all on function public.progression_tiered_crate_pick(uuid, double precision, text, text[]) from public, anon, authenticated;
grant execute on function public.progression_tiered_crate_pick(uuid, double precision, text, text[]) to service_role;
revoke all on function public.aether_quote(uuid, text, text[], boolean) from public, anon, authenticated;
grant execute on function public.aether_quote(uuid, text, text[], boolean) to service_role;
revoke all on function public.open_crate(uuid, uuid, text[], int) from public, anon, authenticated;
grant execute on function public.open_crate(uuid, uuid, text[], int) to service_role;
revoke all on function public.buy_crate(uuid, text, text[], int, uuid) from public, anon, authenticated;
grant execute on function public.buy_crate(uuid, text, text[], int, uuid) to service_role;

-- ── END OF SECTIONS 1-10 (switch, config, wallet, ledger, aether_apply, crate columns, tiered pool + pick, quote,
--    open_crate + buy_crate). Sections 11-14 (the settlement's Aether, Gauntlet Aether, milestone crates, the profile
--    JSON and the rollout) follow below. ──────────────────────────────────────────────────────────────────────────
