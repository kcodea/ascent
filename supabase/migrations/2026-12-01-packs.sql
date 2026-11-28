-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- PACKS: the pack economy's tables, config and switch, and the one authoritative pack roll  (2026-12-01)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-10-18-aether.sql (the roll reads its economy through
-- `aether_economy_int`) and AFTER 2026-11-03-secret-plushie-plate.sql (section 3 REPLACES its `sync_cosmetic_catalog`).
-- IF 2026-11-03-secret-plushie-plate.sql (or 2026-09-28-progression-skins.sql) IS EVER RE-RUN, RUN THIS FILE AGAIN AFTER
-- IT: either would put back a catalog sync that never writes `pack_styles`. Idempotent: every table and column is `if
-- not exists`, the config seed is `on conflict do nothing` (a retuned economy is never overwritten), every named
-- constraint is dropped and re-added, every trigger is dropped and re-created, and every function is REPLACED and
-- re-granted, so re-running it is always safe. (`schema.sql` is not updated: it stopped carrying the appended
-- migrations after 2026-10-25-versus-duos-xp.sql, and sqlParity.test.ts pins that file as its last block.)
-- Spec: docs/superpowers/specs/2026-11-27-pack-economy-design.md (sections 6-12).
-- Sections 10-13 REPLACE `settle_progression` (2026-10-25-versus-duos-xp.sql), `buy_crate` (2026-10-18-aether.sql),
-- `open_crate` (2026-10-20-milestone-chests-epic.sql), `aether_quote` (2026-10-20-announcers-not-focusable.sql) and the
-- result / profile JSON (2026-10-18-aether.sql): IF ANY OF THOSE FILES IS EVER RE-RUN, RUN THIS FILE AGAIN AFTER IT.
--
-- WHAT THIS IS (owner rulings 2026-11-27: the Chest Shop becomes a Pack Shop; a pack is 5 cards, the guaranteed one
-- last; duplicates are allowed and pay Aether). EVERYTHING HERE IS DORMANT behind the switch: with it off, the shop
-- read, the purchase, the opening and the reward claim all raise `packs_disabled`.
--  - THE SWITCH: `progression_config.packs_enabled`, OFF by default.
--  - THE ECONOMY is one server-owned row, `pack_config.economy`, the exact JSON of `DEFAULT_PACK_ECONOMY`
--    (packages/progression/src/packEconomy.ts). A retune is an UPDATE, no client release. Public read.
--  - `profiles.pack_level_baseline`: the level an account stood at when packs launched (null until then).
--  - `cosmetic_catalog.pack_styles`: the style packs an item belongs to, written by the catalog sync from code
--    (`CosmeticDef.packStyles`).
--  - `packs`: one row per pack a player holds or opened, unique per (user, source), guarded sealed -> opened once.
--  - `pack_meters`: the paid packs a player bought and the purchase rewards they claimed.
--  - `progression_pack_roll`: THE roll. Given 15 draws in [0, 1) it gives the same five cards as the TS `rollPack`
--    (packages/progression/src/packRoll.ts), card for card. It reads ownership and writes nothing.
--  - THE SHOP WINDOW (`pack_shop_windows`, `pack_window_id`, `pack_shop_window`): every 6 hours Eastern, one shared set
--    of offers (the free pack, four Featured deals, the shelves), drawn once with `random()` (mirror of `windowOffers`).
--  - THE COUNTER (`progression_counter_has_room`, mirror of `counterHasRoom`) and THE WRITERS, each under the per-user
--    progression lock: `buy_pack`, `open_pack`, `claim_pack_reward`; and the shop read `pack_shop_json`.
--  - THE GRANTS (section 10): with the switch on, the settlement makes the nine Welcome packs on enrollment and a
--    Legendary pack every 5 levels above the account's launch level, and no chest.
--  - THE CHEST SHOP RETIRED (section 11): with the switch on, `buy_crate` answers `shop_retired`, `aether_quote` null,
--    and a sealed chest is frozen (`open_crate` answers `chests_frozen`).
--  - THE ROLLOUT (section 13): `pack_rollout()` writes every account's launch level, pays the 3,000 Aether launch gift
--    to every existing account, then flips the switch. The runbook line is at the very bottom, commented out.
--
-- THE TS COPY is packRoll.ts (`rollPack`, `packPool`), packEconomy.ts (`DEFAULT_PACK_ECONOMY`), packs.ts
-- (`STYLE_PACK_IDS`) and cosmetics.ts (`COSMETIC_RARITIES`, `COSMETIC_CATEGORIES`, `crateRarityFallback`).
-- packRoll.db.test.ts runs this file on PGlite and checks the SQL roll equals the TS roll for 2,000 draw sets. The
-- window and the counter mirror packShop.ts (`shopWindowId`, `nextShopRefresh`, `shelfOffers`, `windowOffers`,
-- `dealPrice`, `counterHasRoom`) and packEconomy.ts (`rarityPackOdds`); packs.db.test.ts pins them draw for draw and
-- runs the purchase, the opening and the claim.

-- ── 1. The packs switch (off until the owner flips it) ──────────────────────────────────────────────────────
alter table public.progression_config add column if not exists packs_enabled boolean not null default false;

-- ── 2. pack_config: the pack economy, one row, public read ──────────────────────────────────────────────────
create table if not exists public.pack_config (
  id         int primary key check (id = 1),
  economy    jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.pack_config enable row level security;
drop policy if exists "read pack_config" on public.pack_config;
create policy "read pack_config" on public.pack_config for select using (true);
grant select on public.pack_config to anon, authenticated;
-- The FIRST seed: exactly JSON.stringify(DEFAULT_PACK_ECONOMY). A re-run never overwrites a retuned row. A RETUNE MUST
-- KEEP THIS EXACT SHAPE: `parsePackEconomy` rejects a malformed document WHOLE, and the server's reads
-- (`aether_economy_int`) refuse a bad value per field (`pack_config_missing`).
insert into public.pack_config (id, economy) values (1,
  '{"version":1,"rarityPackPrice":{"common":100,"rare":175,"epic":300,"legendary":500,"ancient":850},"themedPackPrice":200,"duplicateAether":{"common":20,"rare":35,"epic":60,"legendary":100,"ancient":170},"standardOdds":{"common":35,"rare":31,"epic":22,"legendary":9,"ancient":3},"rewardEvery":15,"rewardRarity":"epic","levelPackEvery":5,"levelPackRarity":"legendary","welcomePacks":{"common":5,"rare":2,"epic":1,"legendary":1,"ancient":0},"freePackRarity":"rare","counterTypes":5,"stackMax":8,"refreshHours":6,"refreshZone":"America/New_York","featuredDeals":4,"dealOff":{"min":20,"max":60,"step":5},"dealStock":{"min":2,"max":5}}'::jsonb)
on conflict (id) do nothing;

-- ── 3. New columns: the level baseline, the style packs, and the catalog sync that writes them ──────────────
alter table public.profiles add column if not exists pack_level_baseline int;
alter table public.cosmetic_catalog add column if not exists pack_styles text[] not null default '{}';

-- The 2026-11-03-secret-plushie-plate.sql sync, line for line, plus `pack_styles` (from the payload's `packStyles`,
-- empty when absent or not an array).
create or replace function public.sync_cosmetic_catalog(p_catalog jsonb, p_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
  v_cats    int;
  v_items   int;
  v_off     int;
  v_catoff  int;
  v_coll    int := 0;
begin
  if p_hash is null or length(p_hash) < 8 or length(p_hash) > 128 then raise exception 'bad_catalog'; end if;
  if p_catalog is null or jsonb_typeof(p_catalog->'categories') is distinct from 'array'
     or jsonb_typeof(p_catalog->'items') is distinct from 'array' then
    raise exception 'bad_catalog';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('cosmetic_catalog_sync', 0));

  -- Unchanged since the last sync: nothing to do (the common case, one read).
  select catalog_hash into v_current from public.progression_config where id = 1;
  if v_current is not distinct from p_hash then
    return jsonb_build_object('status', 'unchanged', 'hash', p_hash);
  end if;

  -- Categories: weight, enabled, target from code. A category no longer in code is switched off.
  insert into public.cosmetic_categories (category, weight, enabled, target)
    select x->>'category', (x->>'weight')::int, (x->>'enabled')::boolean, x->>'target'
    from jsonb_array_elements(p_catalog->'categories') as x
    on conflict (category) do update set
      weight = excluded.weight, enabled = excluded.enabled, target = excluded.target, updated_at = now()
    where (public.cosmetic_categories.weight, public.cosmetic_categories.enabled, public.cosmetic_categories.target)
          is distinct from (excluded.weight, excluded.enabled, excluded.target);
  get diagnostics v_cats = row_count;
  update public.cosmetic_categories set enabled = false, updated_at = now()
    where enabled and category not in (select x->>'category' from jsonb_array_elements(p_catalog->'categories') as x);
  get diagnostics v_catoff = row_count;

  -- Items: every column from code (including `active`, `collection_id` and `pack_styles`). An item no longer in code
  -- is marked inactive, never deleted.
  insert into public.cosmetic_catalog (cosmetic_id, category, rarity, acquisition_source, milestone_level, target_type, target_id, achievement_id, active, collection_id, pack_styles)
    select x->>'cosmeticId', x->>'category', x->>'rarity', x->>'acquisitionSource', (x->>'milestoneLevel')::int,
           x->>'targetType', x->>'targetId', x->>'achievementId', (x->>'active')::boolean, x->>'collectionId',
           array(select jsonb_array_elements_text(case when jsonb_typeof(x->'packStyles') = 'array' then x->'packStyles' end))
    from jsonb_array_elements(p_catalog->'items') as x
    on conflict (cosmetic_id) do update set
      category = excluded.category, rarity = excluded.rarity, acquisition_source = excluded.acquisition_source,
      milestone_level = excluded.milestone_level, target_type = excluded.target_type, target_id = excluded.target_id,
      achievement_id = excluded.achievement_id, active = excluded.active, collection_id = excluded.collection_id,
      pack_styles = excluded.pack_styles
    where (public.cosmetic_catalog.category, public.cosmetic_catalog.rarity, public.cosmetic_catalog.acquisition_source,
           public.cosmetic_catalog.milestone_level, public.cosmetic_catalog.target_type, public.cosmetic_catalog.target_id,
           public.cosmetic_catalog.achievement_id, public.cosmetic_catalog.active, public.cosmetic_catalog.collection_id,
           public.cosmetic_catalog.pack_styles)
          is distinct from (excluded.category, excluded.rarity, excluded.acquisition_source, excluded.milestone_level,
           excluded.target_type, excluded.target_id, excluded.achievement_id, excluded.active, excluded.collection_id,
           excluded.pack_styles);
  get diagnostics v_items = row_count;
  update public.cosmetic_catalog set active = false
    where active and cosmetic_id not in (select x->>'cosmeticId' from jsonb_array_elements(p_catalog->'items') as x);
  get diagnostics v_off = row_count;

  -- A changed catalog can change a collection (a new member, a retired one, the first sync after this file): recount.
  if v_items > 0 or v_off > 0 then v_coll := public.progression_refresh_all_collections(); end if;

  update public.progression_config set catalog_hash = p_hash where id = 1;
  return jsonb_build_object('status', 'synced', 'hash', p_hash,
    'categoriesChanged', v_cats, 'categoriesSwitchedOff', v_catoff, 'itemsChanged', v_items, 'itemsDeactivated', v_off,
    'collectionsRecounted', v_coll);
end;
$$;

-- ── 4. packs + pack_meters: what a player holds, and the paid packs they bought; owner-only read ───────────
-- `source` is the replay guard (spec 9.1: `shop:<request id>:<n>`, `free:<window id>`, `reward:<n>`, `level:<L>`,
-- `welcome:<rarity>:<n>`): one pack per (user, source), ever. `price_paid` is 0 for a granted or free pack.
-- `offer_id` is the shop offer a purchase bought (null for a grant): a Featured deal's per-player stock counts it.
create table if not exists public.packs (
  pack_id      uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  look_kind    text not null check (look_kind in ('rarity', 'category', 'themed')),
  look_id      text not null,
  floor_rarity text not null check (floor_rarity in ('common', 'rare', 'epic', 'legendary', 'ancient')),
  source       text not null,
  state        text not null default 'sealed' check (state in ('sealed', 'opened')),
  price_paid   int not null default 0 check (price_paid >= 0),
  offer_id     text,
  created_at   timestamptz not null default now(),
  opened_at    timestamptz,
  roll_version int,
  cards        jsonb,
  unique (user_id, source)
);
-- `request_id` is the client request that made the pack (a purchase or a reward claim; null for every other grant):
-- a repeated request answers with the packs it already made. Several packs may share one (a box).
alter table public.packs add column if not exists request_id uuid;
create index if not exists packs_user_request on public.packs (user_id, request_id) where request_id is not null;
create index if not exists packs_user_offer on public.packs (user_id, offer_id) where offer_id is not null;
create index if not exists packs_user_sealed on public.packs (user_id, created_at, pack_id) where state = 'sealed';
-- A sealed pack has no roll yet; an opened one has all of it (its cards, when, and the roll version that made them).
alter table public.packs drop constraint if exists packs_opened_consistent;
alter table public.packs add constraint packs_opened_consistent check (
  (state = 'sealed' and opened_at is null and roll_version is null and cards is null)
  or (state = 'opened' and opened_at is not null and roll_version is not null and jsonb_typeof(cards) = 'array'));
alter table public.packs enable row level security;
drop policy if exists "read own packs" on public.packs;
create policy "read own packs" on public.packs for select to authenticated using (auth.uid() = user_id);

-- A pack goes sealed -> opened ONCE and is then history (even for the service role). Everything but the roll
-- (`state`, `opened_at`, `roll_version`, `cards`) is identity and never changes.
create or replace function public.packs_transition_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.state = 'opened' then raise exception 'pack_already_opened'; end if;
  if new.pack_id is distinct from old.pack_id or new.user_id is distinct from old.user_id
     or new.look_kind is distinct from old.look_kind or new.look_id is distinct from old.look_id
     or new.floor_rarity is distinct from old.floor_rarity or new.source is distinct from old.source
     or new.price_paid is distinct from old.price_paid or new.offer_id is distinct from old.offer_id
     or new.created_at is distinct from old.created_at or new.request_id is distinct from old.request_id then
    raise exception 'pack_identity_is_immutable';
  end if;
  return new;
end;
$$;
drop trigger if exists packs_transition_guard on public.packs;
create trigger packs_transition_guard before update on public.packs
  for each row execute function public.packs_transition_guard();

-- Purchase rewards ready = floor(purchased / rewardEvery) - claimed.
create table if not exists public.pack_meters (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  purchased int not null default 0 check (purchased >= 0),
  claimed   int not null default 0 check (claimed >= 0)
);
alter table public.pack_meters enable row level security;
drop policy if exists "read own pack_meters" on public.pack_meters;
create policy "read own pack_meters" on public.pack_meters for select to authenticated using (auth.uid() = user_id);

-- ── 5. THE PACK ROLL (mirror of rollPack) ───────────────────────────────────────────────────────────────────
-- ONE CARD (mirror of drawCard): from a pool given as three parallel arrays (id, rarity, category) in id order
-- (`collate "C"`, the JS code-unit order), three draws in [0, 1), the odds (rarity order) and the floor (1-based
-- rarity index). 1) the rarity: the draw scaled by the total weight at or above the floor lands in the first band
-- under it (a band of weight 0 is skipped; past every band, the last weighted one; no weight at all, the floor);
-- 2) the fall-back: the rolled rarity first, then the nearest (ties toward the more common) that the pool holds AT OR
-- ABOVE THE FLOOR, else `pack_pool_empty`; 3) the category: equal odds among the categories, in COSMETIC_CATEGORIES
-- order, holding that rarity; 4) the item: equal odds among them, in id order. Pure.
create or replace function public.progression_pack_draw(
  p_ids text[], p_rars text[], p_cats text[], p_u1 double precision, p_u2 double precision, p_u3 double precision,
  p_odds int[], p_floor int
)
returns text
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  -- mirror of COSMETIC_RARITIES and COSMETIC_CATEGORIES in packages/progression/src/cosmetics.ts (ARRAY ORDER, not
  -- alphabetical: the category draw indexes this order)
  c_rarities   constant text[] := array['common', 'rare', 'epic', 'legendary', 'ancient'];
  c_categories constant text[] := array['announcer', 'hero_skin', 'minion_skin', 'title', 'hero_attack', 'board', 'music', 'portrait_frame', 'emote', 'card_plate'];
  v_total  int := 0;
  v_x      double precision;
  v_hi     int := 0;
  v_rolled int := p_floor;
  v_i      int;
  v_r      int;
  v_cats   text[];
  v_cat    text;
  v_items  text[];
begin
  for v_i in p_floor..5 loop v_total := v_total + p_odds[v_i]; end loop;
  v_x := p_u1 * v_total;
  for v_i in p_floor..5 loop
    continue when p_odds[v_i] = 0;
    v_rolled := v_i;
    v_hi := v_hi + p_odds[v_i];
    exit when v_x < v_hi;
  end loop;

  select g into v_r from generate_series(p_floor, 5) as g
    where c_rarities[g] = any(p_rars)
    order by abs(g - v_rolled), g
    limit 1;
  if v_r is null then raise exception 'pack_pool_empty'; end if;

  select array_agg(k.cat order by k.o) into v_cats
    from unnest(c_categories) with ordinality as k(cat, o)
    where exists (select 1 from unnest(p_rars, p_cats) as x(r, c) where x.r = c_rarities[v_r] and x.c = k.cat);
  if v_cats is null then raise exception 'pack_pool_empty'; end if;
  v_cat := v_cats[floor(p_u2 * cardinality(v_cats))::int + 1];

  select array_agg(x.i order by x.o) into v_items
    from unnest(p_ids, p_rars, p_cats) with ordinality as x(i, r, c, o)
    where x.r = c_rarities[v_r] and x.c = v_cat;
  return v_items[floor(p_u3 * cardinality(v_items))::int + 1];
end;
$$;

-- THE ROLL: five cards, the guaranteed one last, as a JSON array of `PackCard`s ({rewardId, rarity, guaranteed,
-- duplicate: {aether} | null}). THE POOL is the chest pool's filter without "not owned" (active, not admin_off,
-- crate-sourced, a crate rarity, in an enabled category that is not admin_off; the TS cannot know admin_off), in id
-- order. Cards 1-4 draw the whole pool at the Standard odds. Card 5: a rarity pack draws the whole pool at the odds
-- restricted to `p_floor` and above; a category / style pack draws its own pool minus everything owned so far (cards
-- 1-4 included), or, when that is empty, its own pool again as a duplicate. A card is a duplicate if it was owned
-- before the pack (`player_cosmetics`) or an earlier card gave it; it pays `duplicateAether[its rarity]`. The odds
-- and payouts are `pack_config`'s. Reads ownership, writes nothing. Raises `bad_draws` (not exactly 15 finite draws in
-- [0, 1)), `unknown_pack` (a look kind, category or style pack that does not exist), `bad_floor`, `pack_config_missing`
-- and `pack_pool_empty` (exactly where `rollPack` throws).
create or replace function public.progression_pack_roll(p_user uuid, p_look_kind text, p_look_id text, p_floor text, p_draws double precision[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  -- mirror of COSMETIC_RARITIES / COSMETIC_CATEGORIES (cosmetics.ts) and STYLE_PACK_IDS (packs.ts), in array order
  c_rarities   constant text[] := array['common', 'rare', 'epic', 'legendary', 'ancient'];
  c_categories constant text[] := array['announcer', 'hero_skin', 'minion_skin', 'title', 'hero_attack', 'board', 'music', 'portrait_frame', 'emote', 'card_plate'];
  c_styles     constant text[] := array['themed-scribble', 'themed-plushie', 'themed-8bit', 'themed-voxel', 'themed-low-poly', 'themed-sketchbook', 'themed-encore', 'themed-crayon', 'themed-sports', 'themed-stained-glass', 'themed-scifi'];
  c_cards      constant int := 5;   -- PACK_CARD_COUNT; three draws per card
  v_d       double precision[];
  v_floor   int;
  v_cat     text := null;
  v_style   text := null;
  v_eco     jsonb;
  v_odds    int[] := '{}';
  v_dup     int[] := '{}';
  v_n       int;
  v_g       int;
  v_all_ids text[]; v_all_rar text[]; v_all_cat text[];
  v_own_ids text[]; v_own_rar text[]; v_own_cat text[];
  v_new_ids text[]; v_new_rar text[]; v_new_cat text[];
  v_have    text[];
  v_i       int;
  v_pick    text;
  v_rar     text;
  v_cards   jsonb := '[]'::jsonb;
begin
  -- the draws: exactly 15, each finite and in [0, 1) (NaN sorts above every number in Postgres, so `< 1` refuses it)
  if p_draws is null or array_ndims(p_draws) is distinct from 1 or cardinality(p_draws) <> c_cards * 3
     or exists (select 1 from unnest(p_draws) as u where u is null or not (u >= 0 and u < 1)) then
    raise exception 'bad_draws';
  end if;
  v_d := array(select u from unnest(p_draws) with ordinality as t(u, o) order by o);

  v_floor := array_position(c_rarities, p_floor);
  if v_floor is null then raise exception 'bad_floor'; end if;
  if p_look_kind = 'category' then
    if p_look_id is null or left(p_look_id, 9) <> 'category-' or not (substr(p_look_id, 10) = any(c_categories)) then
      raise exception 'unknown_pack';
    end if;
    v_cat := substr(p_look_id, 10);
  elsif p_look_kind = 'themed' then
    if p_look_id is null or not (p_look_id = any(c_styles)) then raise exception 'unknown_pack'; end if;
    v_style := p_look_id;
  elsif p_look_kind is distinct from 'rarity' then
    raise exception 'unknown_pack';
  end if;

  -- the odds and the payouts, through the defensive read (a missing or garbled value is a refusal, never a guess)
  select economy into v_eco from public.pack_config where id = 1;
  foreach v_rar in array c_rarities loop
    v_n := public.aether_economy_int(v_eco, array['standardOdds', v_rar]);
    v_g := public.aether_economy_int(v_eco, array['duplicateAether', v_rar]);
    if v_n is null or v_g is null then raise exception 'pack_config_missing'; end if;
    v_odds := v_odds || v_n;
    v_dup := v_dup || v_g;
  end loop;
  -- the Standard odds are percent and must sum to exactly 100 (`parsePackEconomy`'s rule; it also keeps every band
  -- total inside an int)
  if (select sum(x) from unnest(v_odds) as x) <> 100 then raise exception 'pack_config_missing'; end if;

  -- the whole pool, then the pack's own pool (the same filter narrowed to its category or style), both in id order
  select coalesce(array_agg(c.cosmetic_id order by c.cosmetic_id collate "C"), '{}'),
         coalesce(array_agg(c.rarity order by c.cosmetic_id collate "C"), '{}'),
         coalesce(array_agg(c.category order by c.cosmetic_id collate "C"), '{}')
    into v_all_ids, v_all_rar, v_all_cat
    from public.cosmetic_catalog c
    join public.cosmetic_categories k on k.category = c.category
    where c.active and not c.admin_off and k.enabled and not k.admin_off
      and c.acquisition_source = 'crate' and c.rarity = any(c_rarities) and c.category = any(c_categories);
  select coalesce(array_agg(x.i order by x.o), '{}'), coalesce(array_agg(x.r order by x.o), '{}'), coalesce(array_agg(x.c order by x.o), '{}')
    into v_own_ids, v_own_rar, v_own_cat
    from unnest(v_all_ids, v_all_rar, v_all_cat) with ordinality as x(i, r, c, o)
    where (v_cat is null or x.c = v_cat)
      and (v_style is null or exists (select 1 from public.cosmetic_catalog s where s.cosmetic_id = x.i and v_style = any(s.pack_styles)));

  v_have := array(select o.cosmetic_id from public.player_cosmetics o where o.user_id = p_user);

  for v_i in 1..c_cards loop
    if v_i < c_cards then
      v_pick := public.progression_pack_draw(v_all_ids, v_all_rar, v_all_cat, v_d[v_i * 3 - 2], v_d[v_i * 3 - 1], v_d[v_i * 3], v_odds, 1);
    elsif p_look_kind = 'rarity' then
      v_pick := public.progression_pack_draw(v_all_ids, v_all_rar, v_all_cat, v_d[v_i * 3 - 2], v_d[v_i * 3 - 1], v_d[v_i * 3], v_odds, v_floor);
    else
      select coalesce(array_agg(x.i order by x.o), '{}'), coalesce(array_agg(x.r order by x.o), '{}'), coalesce(array_agg(x.c order by x.o), '{}')
        into v_new_ids, v_new_rar, v_new_cat
        from unnest(v_own_ids, v_own_rar, v_own_cat) with ordinality as x(i, r, c, o)
        where not (x.i = any(v_have));
      if cardinality(v_new_ids) > 0 then
        v_pick := public.progression_pack_draw(v_new_ids, v_new_rar, v_new_cat, v_d[v_i * 3 - 2], v_d[v_i * 3 - 1], v_d[v_i * 3], v_odds, 1);
      else
        v_pick := public.progression_pack_draw(v_own_ids, v_own_rar, v_own_cat, v_d[v_i * 3 - 2], v_d[v_i * 3 - 1], v_d[v_i * 3], v_odds, 1);
      end if;
    end if;
    if v_pick is null then raise exception 'pack_pool_empty'; end if;
    v_rar := v_all_rar[array_position(v_all_ids, v_pick)];
    v_cards := v_cards || jsonb_build_array(jsonb_build_object(
      'rewardId', v_pick, 'rarity', v_rar, 'guaranteed', v_i = c_cards,
      'duplicate', case when v_pick = any(v_have) then jsonb_build_object('aether', v_dup[array_position(c_rarities, v_rar)]) end));
    v_have := array_append(v_have, v_pick);
  end loop;
  return v_cards;
end;
$$;

-- ── Grants ───────────────────────────────────────────────────────────────────────────────────────────────
-- The catalog sync stays the service role's (the Edge Function calls it). The roll, its one-card helper and the guard
-- are INTERNAL, revoked from the service role too (Supabase's default privileges grant EXECUTE on each new function
-- to anon, authenticated AND service_role; precedent: 2026-10-18-aether.sql). The pack writers that follow in this
-- file are security definer and reach the roll as the owner.
revoke all on function public.sync_cosmetic_catalog(jsonb, text) from public, anon, authenticated;
grant execute on function public.sync_cosmetic_catalog(jsonb, text) to service_role;
revoke all on function public.progression_pack_draw(text[], text[], text[], double precision, double precision, double precision, int[], int) from public, anon, authenticated, service_role;
revoke all on function public.progression_pack_roll(uuid, text, text, text, double precision[]) from public, anon, authenticated, service_role;
revoke all on function public.packs_transition_guard() from public, anon, authenticated, service_role;

-- ── 6. THE SHOP WINDOW (mirror of shopWindowId, nextShopRefresh, shelfOffers, windowOffers) ─────────────────
-- Every `refreshHours` (6) hours at 12am / 6am / 12pm / 6pm `refreshZone` (Eastern) wall-clock time the shop turns over.
-- The window id is that wall-clock date and block, `YYYY-MM-DDTHH`. A window's offers are made ONCE, by the first
-- request in it, from 12 `random()` draws, and stored: every player and every read sees the same free pack and the same
-- four Featured deals at the same prices. A retune of `pack_config` reaches the shelves at the next window (the odds a
-- Rarity offer shows are re-read live by `pack_shop_json`, so the tag always shows what the roll uses).
create table if not exists public.pack_shop_windows (
  window_id  text primary key,
  offers     jsonb not null check (jsonb_typeof(offers) = 'array'),
  created_at timestamptz not null default now()
);
-- No policy: only the security-definer functions below read or write it (`pack_shop_json` is the read).
alter table public.pack_shop_windows enable row level security;

-- An integer of the economy document, or `pack_config_missing` (the defensive `aether_economy_int` read, refused).
create or replace function public.progression_pack_config_int(p_eco jsonb, p_path text[])
returns int
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v int := public.aether_economy_int(p_eco, p_path);
begin
  if v is null then raise exception 'pack_config_missing'; end if;
  return v;
end;
$$;

-- A rarity named by the economy document (`freePackRarity`, `rewardRarity`, ...), or `pack_config_missing`.
create or replace function public.progression_pack_config_rarity(p_eco jsonb, p_key text)
returns text
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  c_rarities constant text[] := array['common', 'rare', 'epic', 'legendary', 'ancient'];
begin
  if jsonb_typeof(p_eco -> p_key) is distinct from 'string' or not ((p_eco ->> p_key) = any(c_rarities)) then
    raise exception 'pack_config_missing';
  end if;
  return p_eco ->> p_key;
end;
$$;

-- The wall-clock time in the refresh zone at `p_at`, and the window length in hours (it must tile the day).
create or replace function public.progression_pack_clock(p_at timestamptz, out o_local timestamp, out o_hours int, out o_zone text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_eco jsonb;
begin
  if p_at is null then raise exception 'bad_time'; end if;
  select economy into v_eco from public.pack_config where id = 1;
  o_hours := public.progression_pack_config_int(v_eco, array['refreshHours']);
  if o_hours < 1 or 24 % o_hours <> 0 then raise exception 'pack_config_missing'; end if;
  if jsonb_typeof(v_eco -> 'refreshZone') is distinct from 'string' or (v_eco ->> 'refreshZone') = '' then
    raise exception 'pack_config_missing';
  end if;
  o_zone := v_eco ->> 'refreshZone';
  o_local := p_at at time zone o_zone;
end;
$$;

-- THE WINDOW ID at `p_at` (mirror of shopWindowId): "YYYY-MM-DDTHH", HH the block's first hour, Eastern, DST included.
create or replace function public.pack_window_id(p_at timestamptz)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c record;
begin
  select * into c from public.progression_pack_clock(p_at);
  return to_char(c.o_local, 'YYYY-MM-DD') || 'T'
    || lpad(((extract(hour from c.o_local)::int / c.o_hours) * c.o_hours)::text, 2, '0');
end;
$$;

-- THE NEXT REFRESH after `p_at`, in epoch ms (mirror of nextShopRefresh): the next block boundary in wall-clock time,
-- read back through the zone (a window that spans a clock change is 5 or 7 hours long).
create or replace function public.pack_next_refresh_at(p_at timestamptz)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c      record;
  v_next timestamp;
begin
  select * into c from public.progression_pack_clock(p_at);
  v_next := date_trunc('day', c.o_local)
    + make_interval(hours => (extract(hour from c.o_local)::int / c.o_hours + 1) * c.o_hours);
  return (extract(epoch from (v_next at time zone c.o_zone)) * 1000)::bigint;
end;
$$;

-- THE ODDS A RARITY PACK SHOWS (mirror of rarityPackOdds), percent to one decimal: `cards`, every card's Standard
-- roll; `last`, the guaranteed card's, each rarity at or above the floor renormalized, 0 below it. The rounding is
-- JS `Math.round(x * 10) / 10` exactly (half up, in float8), never Postgres's round() on a float (half even).
create or replace function public.progression_pack_odds(p_eco jsonb, p_floor text)
returns jsonb
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  c_rarities constant text[] := array['common', 'rare', 'epic', 'legendary', 'ancient'];
  v_at    int := array_position(c_rarities, p_floor);
  v_odds  int[] := '{}';
  v_sum   int := 0;
  v_all   int := 0;
  v_i     int;
  v_cards jsonb := '{}'::jsonb;
  v_last  jsonb := '{}'::jsonb;
begin
  if v_at is null then raise exception 'bad_floor'; end if;
  for v_i in 1..5 loop
    v_odds := v_odds || public.progression_pack_config_int(p_eco, array['standardOdds', c_rarities[v_i]]);
    v_all := v_all + v_odds[v_i];
    if v_i >= v_at then v_sum := v_sum + v_odds[v_i]; end if;
  end loop;
  if v_all <> 100 then raise exception 'pack_config_missing'; end if;
  for v_i in 1..5 loop
    v_cards := v_cards || jsonb_build_object(c_rarities[v_i], public.progression_pack_round1(v_odds[v_i]::double precision));
    v_last := v_last || jsonb_build_object(c_rarities[v_i], case when v_i >= v_at and v_sum > 0
      then public.progression_pack_round1((v_odds[v_i]::double precision / v_sum) * 100) else 0 end);
  end loop;
  return jsonb_build_object('cards', v_cards, 'last', v_last);
end;
$$;

-- `Math.round(x * 10) / 10` for x >= 0, in float8: the nearest tenth, a tie going up.
create or replace function public.progression_pack_round1(p_x double precision)
returns double precision
language sql
immutable
as $$
  select (case when p_x * 10 - floor(p_x * 10) >= 0.5 then floor(p_x * 10) + 1 else floor(p_x * 10) end) / 10;
$$;

-- THE PACK POOL (the roll's filter, `packPool` plus admin_off): active, not admin_off, crate-sourced, a crate rarity, in
-- an enabled category that is not admin_off. Every shelf offer exists only while its pool is not empty (spec 5).
create or replace function public.progression_pack_pool()
returns table (cosmetic_id text, rarity text, category text, pack_styles text[])
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c_rarities   constant text[] := array['common', 'rare', 'epic', 'legendary', 'ancient'];
  c_categories constant text[] := array['announcer', 'hero_skin', 'minion_skin', 'title', 'hero_attack', 'board', 'music', 'portrait_frame', 'emote', 'card_plate'];
begin
  return query
    select c.cosmetic_id, c.rarity, c.category, c.pack_styles
    from public.cosmetic_catalog c
    join public.cosmetic_categories k on k.category = c.category
    where c.active and not c.admin_off and k.enabled and not k.admin_off
      and c.acquisition_source = 'crate' and c.rarity = any(c_rarities) and c.category = any(c_categories);
end;
$$;

-- What a pack looks like (`PackLook`), from a pack's kind, look id and floor: the names are the TS ones (rarity
-- `RARITY_LABELS` + " Pack", a category title-cased + " Pack", a style `STYLE_PACK_NAMES`).
create or replace function public.progression_pack_look_json(p_kind text, p_id text, p_floor text)
returns jsonb
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  -- mirror of STYLE_PACK_IDS / STYLE_PACK_NAMES (packs.ts), in array order
  c_styles      constant text[] := array['themed-scribble', 'themed-plushie', 'themed-8bit', 'themed-voxel', 'themed-low-poly', 'themed-sketchbook', 'themed-encore', 'themed-crayon', 'themed-sports', 'themed-stained-glass', 'themed-scifi'];
  c_style_names constant text[] := array['Scribble Pack', 'Plushie Pack', '8 Bit Pack', 'Voxel Pack', 'Low Poly Pack', 'Sketchbook Pack', 'Encore Pack', 'Crayon Pack', 'Sports Pack', 'Stained Glass Pack', 'Sci-Fi Pack'];
begin
  return jsonb_build_object('kind', p_kind, 'id', p_id, 'guaranteedFloor', p_floor, 'name', case p_kind
    when 'rarity' then initcap(p_floor) || ' Pack'
    when 'category' then initcap(replace(substr(p_id, 10), '_', ' ')) || ' Pack'
    else coalesce(c_style_names[array_position(c_styles, p_id)], p_id) end);
end;
$$;

-- THE SHELVES (mirror of shelfOffers): the Rarity Packs (common to ancient, shelf 'rarity', with their `odds`), then a
-- pack per category in COSMETIC_CATEGORIES order, then a pack per style in STYLE_PACK_IDS order (both shelf
-- 'category'), each only while its pool is not empty, at its price, offerId `<window>:<look id>`.
create or replace function public.progression_pack_shelf(p_window text, p_eco jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c_rarities   constant text[] := array['common', 'rare', 'epic', 'legendary', 'ancient'];
  c_categories constant text[] := array['announcer', 'hero_skin', 'minion_skin', 'title', 'hero_attack', 'board', 'music', 'portrait_frame', 'emote', 'card_plate'];
  c_styles     constant text[] := array['themed-scribble', 'themed-plushie', 'themed-8bit', 'themed-voxel', 'themed-low-poly', 'themed-sketchbook', 'themed-encore', 'themed-crayon', 'themed-sports', 'themed-stained-glass', 'themed-scifi'];
  v_out    jsonb := '[]'::jsonb;
  v_themed int := public.progression_pack_config_int(p_eco, array['themedPackPrice']);
  v_x      text;
begin
  if exists (select 1 from public.progression_pack_pool()) then
    foreach v_x in array c_rarities loop
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'offerId', p_window || ':rarity-' || v_x, 'look', public.progression_pack_look_json('rarity', 'rarity-' || v_x, v_x),
        'price', public.progression_pack_config_int(p_eco, array['rarityPackPrice', v_x]), 'shelf', 'rarity', 'contains', 1,
        'odds', public.progression_pack_odds(p_eco, v_x)));
    end loop;
  end if;
  foreach v_x in array c_categories loop
    continue when not exists (select 1 from public.progression_pack_pool() p where p.category = v_x);
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'offerId', p_window || ':category-' || v_x, 'look', public.progression_pack_look_json('category', 'category-' || v_x, 'common'),
      'price', v_themed, 'shelf', 'category', 'contains', 1));
  end loop;
  foreach v_x in array c_styles loop
    continue when not exists (select 1 from public.progression_pack_pool() p where v_x = any(p.pack_styles));
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'offerId', p_window || ':' || v_x, 'look', public.progression_pack_look_json('themed', v_x, 'common'),
      'price', v_themed, 'shelf', 'category', 'contains', 1));
  end loop;
  return v_out;
end;
$$;

-- THE WINDOW'S OFFERS from its draws (mirror of windowOffers): the free pack (`freePackRarity`'s Rarity offer, offerId
-- `<window>:free`, shelf 'featured', price 0, badge 'free'), then `featuredDeals` deals, then the shelves. The deals come
-- from the shelf offers except the free pack's look, each picked without repeats while any are left; deal k (from 0)
-- reads draw 3k (the pick: floor(u * left), in shelf order), 3k + 1 (the discount: min + step * floor(u * steps)) and
-- 3k + 2 (the stock: min + floor(u * (max - min + 1))), and costs floor((full * (100 - off) + 250) / 500) * 5, at least
-- 5 (`dealPrice`). Exactly 3 * featuredDeals finite draws in [0, 1), else `bad_draws`.
create or replace function public.progression_pack_window_offers(p_window text, p_draws double precision[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_eco   jsonb;
  v_deals int;
  v_omin  int; v_omax int; v_ostep int; v_smin int; v_smax int; v_steps int;
  v_free  text;
  v_d     double precision[];
  v_shelf jsonb;
  v_pool  jsonb[];
  v_src   jsonb;
  v_out   jsonb := '[]'::jsonb;
  v_k     int;
  v_idx   int;
  v_off   int;
  v_full  bigint;
begin
  select economy into v_eco from public.pack_config where id = 1;
  v_deals := public.progression_pack_config_int(v_eco, array['featuredDeals']);
  v_omin := public.progression_pack_config_int(v_eco, array['dealOff', 'min']);
  v_omax := public.progression_pack_config_int(v_eco, array['dealOff', 'max']);
  v_ostep := public.progression_pack_config_int(v_eco, array['dealOff', 'step']);
  v_smin := public.progression_pack_config_int(v_eco, array['dealStock', 'min']);
  v_smax := public.progression_pack_config_int(v_eco, array['dealStock', 'max']);
  if v_ostep < 1 or v_omax < v_omin or v_omax > 100 or (v_omax - v_omin) % v_ostep <> 0 or v_smax < v_smin or v_deals > 1000 then
    raise exception 'pack_config_missing';
  end if;
  v_free := 'rarity-' || public.progression_pack_config_rarity(v_eco, 'freePackRarity');

  if p_draws is null or cardinality(p_draws) <> 3 * v_deals
     or (cardinality(p_draws) > 0 and array_ndims(p_draws) <> 1)
     or exists (select 1 from unnest(p_draws) as u where u is null or not (u >= 0 and u < 1)) then
    raise exception 'bad_draws';
  end if;
  v_d := array(select u from unnest(p_draws) with ordinality as t(u, o) order by o);

  v_shelf := public.progression_pack_shelf(p_window, v_eco);
  select e into v_src from jsonb_array_elements(v_shelf) with ordinality as t(e, o) where e -> 'look' ->> 'id' = v_free order by o limit 1;
  if v_src is not null then
    v_out := v_out || jsonb_build_array(v_src || jsonb_build_object('offerId', p_window || ':free', 'shelf', 'featured', 'price', 0, 'badge', 'free'));
  end if;

  v_pool := array(select e from jsonb_array_elements(v_shelf) with ordinality as t(e, o) where e -> 'look' ->> 'id' <> v_free order by o);
  v_steps := (v_omax - v_omin) / v_ostep + 1;
  for v_k in 0..v_deals - 1 loop
    exit when coalesce(cardinality(v_pool), 0) = 0;
    v_idx := floor(v_d[3 * v_k + 1] * cardinality(v_pool))::int + 1;
    v_src := v_pool[v_idx];
    v_pool := v_pool[1:v_idx - 1] || v_pool[v_idx + 1:cardinality(v_pool)];
    v_off := v_omin + v_ostep * floor(v_d[3 * v_k + 2] * v_steps)::int;
    v_full := (v_src ->> 'price')::bigint;
    v_out := v_out || jsonb_build_array(v_src || jsonb_build_object(
      'offerId', p_window || ':deal:' || v_k, 'shelf', 'featured',
      'price', greatest(5, ((v_full * (100 - v_off) + 250) / 500) * 5), 'fullPrice', v_full,
      'stock', v_smin + floor(v_d[3 * v_k + 3] * (v_smax - v_smin + 1))::int));
  end loop;
  return v_out || v_shelf;
end;
$$;

-- THE WINDOW'S OFFERS, made once: the stored row, or a new one from `3 * featuredDeals` fresh `random()` draws. Two
-- first requests racing both draw, one insert wins (`on conflict do nothing`), and both answer the stored row.
create or replace function public.pack_shop_window(p_window text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offers jsonb;
  v_eco    jsonb;
  v_n      int;
begin
  if p_window is null or p_window !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}$' then raise exception 'bad_window'; end if;
  select offers into v_offers from public.pack_shop_windows where window_id = p_window;
  if found then return v_offers; end if;
  select economy into v_eco from public.pack_config where id = 1;
  v_n := 3 * public.progression_pack_config_int(v_eco, array['featuredDeals']);
  insert into public.pack_shop_windows (window_id, offers)
    values (p_window, public.progression_pack_window_offers(p_window, array(select random() from generate_series(1, v_n))))
    on conflict (window_id) do nothing;
  select offers into v_offers from public.pack_shop_windows where window_id = p_window;
  return v_offers;
end;
$$;

-- ── 7. THE COUNTER (mirror of counterHasRoom) ───────────────────────────────────────────────────────────────
-- The counter is a view of the sealed packs oldest first (`created_at`, then `pack_id`): the first `counterTypes` types
-- in that order are on it, every pack of those types counted. A pack of this type has room when its stack there holds
-- fewer than `stackMax`, or, when its type is not on the counter, a place is free.
create or replace function public.progression_counter_has_room(p_user uuid, p_look_kind text, p_look_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_eco   jsonb;
  v_types int;
  v_max   int;
  v_size  int;
  v_n     int;
begin
  select economy into v_eco from public.pack_config where id = 1;
  v_types := public.progression_pack_config_int(v_eco, array['counterTypes']);
  v_max := public.progression_pack_config_int(v_eco, array['stackMax']);
  if v_types < 1 or v_max < 1 then raise exception 'pack_config_missing'; end if;
  with s as (
    select p.look_kind || ':' || p.look_id as k, row_number() over (order by p.created_at, p.pack_id) as rn
    from public.packs p where p.user_id = p_user and p.state = 'sealed'
  ), t as (
    select s.k, count(*)::int as n, min(s.rn) as f from s group by s.k
  ), c as (
    select t.k, t.n from t order by t.f limit v_types
  )
  select count(*)::int, max(c.n) filter (where c.k = p_look_kind || ':' || p_look_id) into v_size, v_n from c;
  return case when v_n is null then v_size < v_types else v_n < v_max end;
end;
$$;

-- ── 8. buy_pack: THE purchase. Service role only. ──────────────────────────────────────────────────────────
-- The ledger learns the two pack reasons: a purchase (`pack_purchase`, source = the request id) and an opening's
-- duplicates (`pack_duplicate`, source = the pack id), each once per source, ever.
alter table public.aether_ledger drop constraint if exists aether_ledger_reason_check;
alter table public.aether_ledger add constraint aether_ledger_reason_check
  check (reason in ('ranked', 'versus', 'gauntlet', 'crate_purchase', 'crate_focus', 'grant', 'pack_purchase', 'pack_duplicate'));

-- An owned pack (`OwnedPack`): its id and its look.
create or replace function public.progression_owned_pack_json(p public.packs)
returns jsonb
language sql
immutable
security definer
set search_path = public
as $$
  select jsonb_build_object('packId', p.pack_id, 'look', public.progression_pack_look_json(p.look_kind, p.look_id, p.floor_rarity));
$$;

-- The player's sealed packs in counter order (oldest first), as `OwnedPack`s: what the client draws, what the server
-- enforces.
create or replace function public.progression_pack_hand_json(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(public.progression_owned_pack_json(p) order by p.created_at, p.pack_id), '[]'::jsonb)
  from public.packs p where p.user_id = p_user and p.state = 'sealed';
$$;

-- The purchase reward meter: `progress` = paid packs toward the next reward, `ready` = rewards earned, not claimed.
create or replace function public.progression_pack_meter_json(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_eco     jsonb;
  v_every   int;
  v_bought  int := 0;
  v_claimed int := 0;
begin
  select economy into v_eco from public.pack_config where id = 1;
  v_every := public.progression_pack_config_int(v_eco, array['rewardEvery']);
  if v_every < 1 then raise exception 'pack_config_missing'; end if;
  select m.purchased, m.claimed into v_bought, v_claimed from public.pack_meters m where m.user_id = p_user;
  return jsonb_build_object('progress', coalesce(v_bought, 0) % v_every,
    'ready', greatest(0, coalesce(v_bought, 0) / v_every - coalesce(v_claimed, 0)));
end;
$$;

-- A guest (an anonymous account): earns, never spends (R-PROG-AETHER-02) and never opens (R-PROG-CRATE-04).
create or replace function public.progression_is_guest(p_user uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return exists (select 1 from auth.users a where a.id = p_user and coalesce(a.is_anonymous, false));
end;
$$;

create or replace function public.progression_aether_balance(p_user uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select w.balance from public.aether_wallets w where w.user_id = p_user), 0);
$$;

-- buy_pack (spec 9.3), one transaction under the per-user progression lock, in this order:
--  1. a request id already used for a purchase answers with the packs it made (charged once, never again);
--  2. the switch off raises `packs_disabled`; a guest answers `guest`;
--  3. the offer is looked up in the CURRENT window: not there (a past window, an unknown id) answers `expired` with the
--     current offers; the free pack already taken this window answers with that pack; a price other than
--     `p_expected_price` answers `price_changed`; a deal this player bought up to its stock answers `sold_out`;
--  4. no place on the counter answers `no_room`; a balance short of the price answers `insufficient`;
--  5. the charge (`aether_apply(-price, 'pack_purchase', request id)`, skipped at price 0), the pack(s) (`shop:<request
--     id>:<n>`, or `free:<window id>`), `contains` added to the meter when the price is above 0, and `ok`.
-- Every refusal answers `{status 'error', reason, aether}` and writes nothing. Malformed input raises. A REPLAYED
-- request answers with the pack(s) it first made but the CURRENT `aether` and `meter` (not the numbers of the first
-- answer). An offer whose pack can no longer give anything (its category switched off or admin_off mid-window) is
-- `expired`, never sold. Only single packs are sold: an offer with `contains` other than 1 raises `unsupported_offer`
-- until booster boxes are designed (spec 13.3: how a box fits the counter is decided with it).
create or replace function public.buy_pack(p_user uuid, p_offer_id text, p_expected_price int, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled  boolean;
  v_balance  int;
  v_window   text;
  v_offers   jsonb;
  v_offer    jsonb;
  v_free     boolean;
  v_price    int;
  v_contains int;
  v_look     jsonb;
  v_packs    jsonb;
  v_i        int;
  v_ok       jsonb;
begin
  if p_user is null then raise exception 'unauthenticated'; end if;
  if p_request_id is null then raise exception 'bad_request_id'; end if;
  if p_offer_id is null or length(p_offer_id) > 200 then raise exception 'bad_offer_id'; end if;
  if p_expected_price is null or p_expected_price < 0 then raise exception 'bad_price'; end if;
  perform pg_advisory_xact_lock(hashtextextended('progression:' || p_user::text, 0));

  -- 1. a replayed request: its pack(s), with today's balance and meter
  select jsonb_agg(public.progression_owned_pack_json(p) order by length(p.source), p.source) into v_packs
    from public.packs p where p.user_id = p_user and p.request_id = p_request_id and (p.source like 'shop:%' or p.source like 'free:%');
  if v_packs is not null then
    return jsonb_build_object('status', 'ok', 'packs', v_packs, 'aether', public.progression_aether_balance(p_user),
      'meter', public.progression_pack_meter_json(p_user));
  end if;

  -- 2. the switch, then a guest
  select packs_enabled into v_enabled from public.progression_config where id = 1;
  if not coalesce(v_enabled, false) then raise exception 'packs_disabled'; end if;
  v_balance := public.progression_aether_balance(p_user);
  if public.progression_is_guest(p_user) then
    return jsonb_build_object('status', 'error', 'reason', 'guest', 'aether', v_balance);
  end if;

  -- 3. the offer, in the current window
  v_window := public.pack_window_id(now());
  v_offers := public.pack_shop_window(v_window);
  select e into v_offer from jsonb_array_elements(v_offers) as e where e ->> 'offerId' = p_offer_id limit 1;
  if v_offer is null then
    return jsonb_build_object('status', 'error', 'reason', 'expired', 'aether', v_balance,
      'offers', public.pack_shop_json(p_user) -> 'offers');
  end if;
  -- an offer whose pool emptied mid-window (a category switched off or admin_off) is gone, never sold
  if not exists (select 1 from public.progression_pack_pool() p
      where v_offer -> 'look' ->> 'kind' = 'rarity'
         or (v_offer -> 'look' ->> 'kind' = 'category' and p.category = substr(v_offer -> 'look' ->> 'id', 10))
         or (v_offer -> 'look' ->> 'kind' = 'themed' and (v_offer -> 'look' ->> 'id') = any(p.pack_styles))) then
    return jsonb_build_object('status', 'error', 'reason', 'expired', 'aether', v_balance,
      'offers', public.pack_shop_json(p_user) -> 'offers');
  end if;
  v_free := p_offer_id = v_window || ':free';
  if v_free then
    select jsonb_build_array(public.progression_owned_pack_json(p)) into v_packs
      from public.packs p where p.user_id = p_user and p.source = 'free:' || v_window;
    if v_packs is not null then
      return jsonb_build_object('status', 'ok', 'packs', v_packs, 'aether', v_balance, 'meter', public.progression_pack_meter_json(p_user));
    end if;
  end if;
  v_price := (v_offer ->> 'price')::int;
  v_contains := (v_offer ->> 'contains')::int;
  -- booster boxes are not designed yet (spec 13.3): only single packs are sold
  if v_contains is distinct from 1 then raise exception 'unsupported_offer'; end if;
  v_look := v_offer -> 'look';
  if v_price <> p_expected_price then
    return jsonb_build_object('status', 'error', 'reason', 'price_changed', 'aether', v_balance);
  end if;
  if v_offer ? 'stock' and (select count(*) from public.packs p where p.user_id = p_user and p.offer_id = p_offer_id)
       + v_contains > (v_offer ->> 'stock')::int then
    return jsonb_build_object('status', 'error', 'reason', 'sold_out', 'aether', v_balance);
  end if;

  -- 4. the counter, then the wallet
  if not public.progression_counter_has_room(p_user, v_look ->> 'kind', v_look ->> 'id') then
    return jsonb_build_object('status', 'error', 'reason', 'no_room', 'aether', v_balance);
  end if;
  if v_balance < v_price then
    return jsonb_build_object('status', 'error', 'reason', 'insufficient', 'aether', v_balance);
  end if;

  -- 5. charge, make the pack(s), count them toward the purchase reward
  if v_price > 0 then v_balance := public.aether_apply(p_user, -v_price, 'pack_purchase', p_request_id::text); end if;
  for v_i in 1..v_contains loop
    insert into public.packs (user_id, look_kind, look_id, floor_rarity, source, price_paid, offer_id, request_id)
      values (p_user, v_look ->> 'kind', v_look ->> 'id', v_look ->> 'guaranteedFloor',
        case when v_free then 'free:' || v_window else 'shop:' || p_request_id::text || ':' || v_i end,
        case when v_i = 1 then v_price else 0 end, p_offer_id, p_request_id);
  end loop;
  if v_price > 0 then
    insert into public.pack_meters (user_id, purchased) values (p_user, v_contains)
      on conflict (user_id) do update set purchased = public.pack_meters.purchased + excluded.purchased;
  end if;
  update public.profiles set progression_revision = progression_revision + 1, updated_at = now() where user_id = p_user;

  select jsonb_agg(public.progression_owned_pack_json(p) order by length(p.source), p.source) into v_packs
    from public.packs p where p.user_id = p_user and p.request_id = p_request_id and (p.source like 'shop:%' or p.source like 'free:%');
  v_ok := jsonb_build_object('status', 'ok', 'packs', v_packs, 'aether', v_balance, 'meter', public.progression_pack_meter_json(p_user));
  return v_ok;
end;
$$;

-- ── 9. open_pack, claim_pack_reward and the shop read ──────────────────────────────────────────────────────
-- What an opened pack answers (`PackOpenResult` plus `status`): its id, its look, its five cards, and the balance.
create or replace function public.progression_pack_open_json(p public.packs, p_status text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('status', p_status, 'packId', p.pack_id,
    'pack', public.progression_pack_look_json(p.look_kind, p.look_id, p.floor_rarity), 'cards', p.cards,
    'aether', public.progression_aether_balance(p.user_id));
$$;

-- open_pack (spec 9.4), one transaction under the lock: not the player's pack raises `pack_not_found`; the switch off
-- raises `packs_disabled`; a guest answers `guest`; an opened pack answers its stored result (`already_opened`), nothing
-- paid again. Otherwise THE roll with 15 fresh `random()` draws, always from the PACK ROW's look and floor (never the
-- caller's), every new card into `player_cosmetics`, all the duplicates paid once (`pack_duplicate`, source = the pack
-- id), the pack marked opened with its cards and roll version, and `opened`. A new title is worn at once only when the
-- player wears none (as a crate's).
create or replace function public.open_pack(p_user uuid, p_pack_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_roll_version constant int := 1;   -- PACK_ROLL_VERSION (packEconomy.ts)
  v_pack    public.packs%rowtype;
  v_enabled boolean;
  v_cards   jsonb;
  v_dup     int;
begin
  if p_user is null then raise exception 'unauthenticated'; end if;
  if p_pack_id is null then raise exception 'bad_pack_id'; end if;
  perform pg_advisory_xact_lock(hashtextextended('progression:' || p_user::text, 0));

  select * into v_pack from public.packs where pack_id = p_pack_id and user_id = p_user for update;
  if not found then raise exception 'pack_not_found'; end if;
  select packs_enabled into v_enabled from public.progression_config where id = 1;
  if not coalesce(v_enabled, false) then raise exception 'packs_disabled'; end if;
  if public.progression_is_guest(p_user) then
    return jsonb_build_object('status', 'error', 'reason', 'guest', 'aether', public.progression_aether_balance(p_user));
  end if;
  if v_pack.state = 'opened' then return public.progression_pack_open_json(v_pack, 'already_opened'); end if;

  v_cards := public.progression_pack_roll(p_user, v_pack.look_kind, v_pack.look_id, v_pack.floor_rarity,
    array(select random() from generate_series(1, 15)));

  insert into public.player_cosmetics (user_id, cosmetic_id, source, source_id)
    select p_user, e ->> 'rewardId', 'pack', p_pack_id::text
    from jsonb_array_elements(v_cards) as e where coalesce(jsonb_typeof(e -> 'duplicate'), 'null') = 'null'
    on conflict (user_id, cosmetic_id) do nothing;
  select coalesce(sum((e -> 'duplicate' ->> 'aether')::int), 0) into v_dup
    from jsonb_array_elements(v_cards) as e where jsonb_typeof(e -> 'duplicate') = 'object';
  if v_dup > 0 then perform public.aether_apply(p_user, v_dup, 'pack_duplicate', p_pack_id::text); end if;

  update public.packs set state = 'opened', opened_at = now(), roll_version = c_roll_version, cards = v_cards
    where pack_id = p_pack_id and state = 'sealed'
    returning * into v_pack;
  if not found then raise exception 'pack_not_found'; end if;

  update public.profiles set
    equipped_title_id = coalesce(equipped_title_id,
      (select c.cosmetic_id from jsonb_array_elements(v_cards) with ordinality as e(x, o)
         join public.cosmetic_catalog c on c.cosmetic_id = e.x ->> 'rewardId'
         where c.category = 'title' and coalesce(jsonb_typeof(e.x -> 'duplicate'), 'null') = 'null' order by e.o limit 1)),
    progression_revision = progression_revision + 1,
    updated_at = now()
  where user_id = p_user;

  return public.progression_pack_open_json(v_pack, 'opened');
end;
$$;

-- claim_pack_reward (spec 9.5), under the lock: a request id already used for a claim answers with its pack; the
-- switch off raises `packs_disabled`; a guest answers `guest`; no reward ready answers `none`; otherwise one
-- `rewardRarity` Rarity pack (`reward:<claimed + 1>`), `claimed` + 1, and `ok`. A grant: never refused for room (it
-- waits beside a full counter).
create or replace function public.claim_pack_reward(p_user uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean;
  v_eco     jsonb;
  v_every   int;
  v_rarity  text;
  v_meter   public.pack_meters%rowtype;
  v_pack    public.packs%rowtype;
begin
  if p_user is null then raise exception 'unauthenticated'; end if;
  if p_request_id is null then raise exception 'bad_request_id'; end if;
  perform pg_advisory_xact_lock(hashtextextended('progression:' || p_user::text, 0));

  select * into v_pack from public.packs p where p.user_id = p_user and p.request_id = p_request_id and p.source like 'reward:%';
  if found then
    return jsonb_build_object('status', 'ok', 'packs', jsonb_build_array(public.progression_owned_pack_json(v_pack)),
      'meter', public.progression_pack_meter_json(p_user));
  end if;

  select packs_enabled into v_enabled from public.progression_config where id = 1;
  if not coalesce(v_enabled, false) then raise exception 'packs_disabled'; end if;
  if public.progression_is_guest(p_user) then return jsonb_build_object('status', 'error', 'reason', 'guest'); end if;

  select economy into v_eco from public.pack_config where id = 1;
  v_every := public.progression_pack_config_int(v_eco, array['rewardEvery']);
  if v_every < 1 then raise exception 'pack_config_missing'; end if;
  v_rarity := public.progression_pack_config_rarity(v_eco, 'rewardRarity');
  select * into v_meter from public.pack_meters where user_id = p_user for update;
  if not found or v_meter.purchased / v_every - v_meter.claimed < 1 then
    return jsonb_build_object('status', 'error', 'reason', 'none');
  end if;

  insert into public.packs (user_id, look_kind, look_id, floor_rarity, source, price_paid, offer_id, request_id)
    values (p_user, 'rarity', 'rarity-' || v_rarity, v_rarity, 'reward:' || (v_meter.claimed + 1), 0, null, p_request_id)
    returning * into v_pack;
  update public.pack_meters set claimed = claimed + 1 where user_id = p_user;
  update public.profiles set progression_revision = progression_revision + 1, updated_at = now() where user_id = p_user;
  return jsonb_build_object('status', 'ok', 'packs', jsonb_build_array(public.progression_owned_pack_json(v_pack)),
    'meter', public.progression_pack_meter_json(p_user));
end;
$$;

-- THE SHOP READ (spec 9.6): `{windowId, nextRefreshAt, shelves, offers, packs, packMeter, aether}`. The window's offers
-- plus this player's numbers: `newToYou` (of the items the pack can give, a Rarity pack the whole pool and a Category or
-- style pack its own, how many the player does not own), a deal's `stock` LEFT for this player (and `soldOut` at 0),
-- and a Rarity offer's `odds` re-read from `pack_config` (the numbers the roll uses). The sealed packs in counter order.
create or replace function public.pack_shop_json(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean;
  v_eco     jsonb;
  v_window  text;
  v_offers  jsonb := '[]'::jsonb;
  v_o       jsonb;
  v_look    jsonb;
  v_total   int;
  v_unowned int;
  v_left    int;
begin
  if p_user is null then raise exception 'unauthenticated'; end if;
  select packs_enabled into v_enabled from public.progression_config where id = 1;
  if not coalesce(v_enabled, false) then raise exception 'packs_disabled'; end if;
  select economy into v_eco from public.pack_config where id = 1;
  v_window := public.pack_window_id(now());

  for v_o in select e from jsonb_array_elements(public.pack_shop_window(v_window)) with ordinality as t(e, o) order by o loop
    v_look := v_o -> 'look';
    select count(*)::int, count(*) filter (where not exists (
        select 1 from public.player_cosmetics pc where pc.user_id = p_user and pc.cosmetic_id = p.cosmetic_id))::int
      into v_total, v_unowned
      from public.progression_pack_pool() p
      where v_look ->> 'kind' = 'rarity'
         or (v_look ->> 'kind' = 'category' and p.category = substr(v_look ->> 'id', 10))
         or (v_look ->> 'kind' = 'themed' and (v_look ->> 'id') = any(p.pack_styles));
    v_o := v_o || jsonb_build_object('newToYou', jsonb_build_object('unowned', v_unowned, 'total', v_total));
    if v_o ? 'stock' then
      v_left := greatest(0, (v_o ->> 'stock')::int
        - (select count(*) from public.packs p where p.user_id = p_user and p.offer_id = v_o ->> 'offerId')::int);
      v_o := v_o || jsonb_build_object('stock', v_left) || case when v_left = 0 then jsonb_build_object('soldOut', true) else '{}'::jsonb end;
    end if;
    if v_look ->> 'kind' = 'rarity' then
      v_o := v_o || jsonb_build_object('odds', public.progression_pack_odds(v_eco, v_look ->> 'guaranteedFloor'));
    end if;
    v_offers := v_offers || jsonb_build_array(v_o);
  end loop;

  return jsonb_build_object(
    'windowId', v_window,
    'nextRefreshAt', public.pack_next_refresh_at(now()),
    -- the shop's tabs, in order (the names the Pack Shop shows, owner 2026-11-27)
    'shelves', jsonb_build_array(
      jsonb_build_object('id', 'featured', 'name', 'Daily Featured'),
      jsonb_build_object('id', 'category', 'name', 'Themed Packs'),
      jsonb_build_object('id', 'rarity', 'name', 'Rarity Packs')),
    'offers', v_offers,
    'packs', public.progression_pack_hand_json(p_user),
    'packMeter', public.progression_pack_meter_json(p_user),
    'aether', public.progression_aether_balance(p_user));
end;
$$;

-- ── Grants (sections 6-9) ─────────────────────────────────────────────────────────────────────────────────
-- The service role (the Edge Function) calls the window id, the window, the counter check, the shop read and the three
-- writers; every helper is INTERNAL, revoked from the service role too (Supabase's default EXECUTE grants, see above).
revoke all on function public.progression_pack_config_int(jsonb, text[]) from public, anon, authenticated, service_role;
revoke all on function public.progression_pack_config_rarity(jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.progression_pack_clock(timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.pack_next_refresh_at(timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.progression_pack_odds(jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.progression_pack_round1(double precision) from public, anon, authenticated, service_role;
revoke all on function public.progression_pack_pool() from public, anon, authenticated, service_role;
revoke all on function public.progression_pack_look_json(text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.progression_pack_shelf(text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.progression_pack_window_offers(text, double precision[]) from public, anon, authenticated, service_role;
revoke all on function public.progression_owned_pack_json(public.packs) from public, anon, authenticated, service_role;
revoke all on function public.progression_pack_hand_json(uuid) from public, anon, authenticated, service_role;
revoke all on function public.progression_pack_meter_json(uuid) from public, anon, authenticated, service_role;
revoke all on function public.progression_is_guest(uuid) from public, anon, authenticated, service_role;
revoke all on function public.progression_aether_balance(uuid) from public, anon, authenticated, service_role;
revoke all on function public.progression_pack_open_json(public.packs, text) from public, anon, authenticated, service_role;
revoke all on function public.pack_window_id(timestamptz) from public, anon, authenticated;
grant execute on function public.pack_window_id(timestamptz) to service_role;
revoke all on function public.pack_shop_window(text) from public, anon, authenticated;
grant execute on function public.pack_shop_window(text) to service_role;
revoke all on function public.progression_counter_has_room(uuid, text, text) from public, anon, authenticated;
grant execute on function public.progression_counter_has_room(uuid, text, text) to service_role;
revoke all on function public.buy_pack(uuid, text, int, uuid) from public, anon, authenticated;
grant execute on function public.buy_pack(uuid, text, int, uuid) to service_role;
revoke all on function public.open_pack(uuid, uuid) from public, anon, authenticated;
grant execute on function public.open_pack(uuid, uuid) to service_role;
revoke all on function public.claim_pack_reward(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_pack_reward(uuid, uuid) to service_role;
revoke all on function public.pack_shop_json(uuid) from public, anon, authenticated;
grant execute on function public.pack_shop_json(uuid) to service_role;

-- A (re-)run of this file forces the next cold start to sync the catalog again (and so write every `pack_styles`).
update public.progression_config set catalog_hash = null where id = 1;

-- ── END OF SECTIONS 1-9 (switch, config, columns + the catalog sync, packs + pack_meters, the roll, the shop window,
--    the counter, buy_pack, open_pack + claim_pack_reward + the shop read). ──────────────────────────────────────

-- ── 10. THE GRANTS: Welcome packs and Level packs in the settlement (spec section 10) ────────────────────────
-- `progression_results` remembers the packs a settlement made (the result JSON's `packsAwarded` / `packIds`, section
-- 12). `crates_awarded` stays (0 with packs on).
alter table public.progression_results add column if not exists packs_awarded int not null default 0;
alter table public.progression_results add column if not exists pack_ids uuid[] not null default '{}';

-- THE FULL 2026-10-25-versus-duos-xp.sql WRITER, RE-CREATED. Every line is byte-for-byte that writer (its comments
-- included, so `sqlParity.test.ts` reads the same constants out of it) EXCEPT these additions, all gated on
-- `progression_config.packs_enabled`; with the switch OFF the function behaves exactly as before, crate for crate:
--  - the `-- packs` declarations (one constant, the rarity order; every number is the server-owned `pack_config`
--    economy, read once into `v_pk_eco`, each value through `aether_economy_int`);
--  - step 9b: with packs ON, the Welcome packs on enrollment and the Level packs above the launch level, and NO crate;
--    the two crate branches (Aether on, Aether off) are untouched below it;
--  - step 10: the result row writes `packs_awarded` and `pack_ids`.
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
  -- VERSUS (owner 2026-10-14: "versus can complete achievements and grant XP but no rank progress"; 2026-10-24: "versus
  -- modes should grant account xp. just make it 50% of a 'normal' game for now")
  c_versus_percent    constant int := 50;
  c_versus_min_rounds constant int := 1;
  c_lobby_seats       constant int := 8;
  -- SPECTATE (owner 2026-10-24: "watching a player's game rewards 50% of the xp at the end of the match"). The watch
  -- record (`spectate_sessions`, written by `spectate_beat`) must show the spectator watching at the end and for at
  -- least half the game, capped at 5 minutes; a lobby game whose rank row has not landed yet is retried for 2 hours.
  c_spectate_percent  constant int := 50;
  c_spectate_cap_ms   constant bigint := 300000;
  c_spectate_end_gap  constant interval := interval '45 seconds';
  c_spectate_wait     constant interval := interval '2 hours';

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
  v_base int := 0; v_top int := 0; v_first int := 0; v_come int := 0; v_total int; v_pct int;
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
  v_seats      int := 2;
  v_g_id uuid; v_g_phase text; v_g_done timestamptz; v_g_count int; v_g_seat text; v_g_hero text; v_g_place int; v_g_out_round int; v_g_out text;
  -- spectate
  v_spec       public.spectate_sessions%rowtype;
  v_game_start timestamptz;
  v_game_end   timestamptz;
  v_need_ms    bigint;
  -- aether (2026-10-18): no constants; the numbers are the aether_config economy, read once
  v_aether     boolean := false;
  v_eco        jsonb;
  v_ae_base    int := 0;
  v_ae_place   int := 0;
  v_ae_every   int;
  -- packs (2026-12-01): one constant, the rarity order; the numbers are the pack_config economy, read once
  c_pk_rarities constant text[] := array['common', 'rare', 'epic', 'legendary', 'ancient'];   -- COSMETIC_RARITIES
  v_packs      boolean := false;
  v_pk_eco     jsonb;
  v_pk_every   int;
  v_pk_rarity  text;
  v_pk_welcome int := 0;
  v_pk_ok      boolean := true;
  v_pk_r       text;
  v_pk_n       int;
  v_pack_ids   uuid[] := '{}';
begin
  -- 1. validate
  if p_mode is null or p_mode not in ('ranked', 'practice', 'tutorial', 'versus', 'spectate') then raise exception 'bad_mode'; end if;
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
    -- VERSUS: the source is the server-owned match row, a 1v1 `versus_matches` row or (2026-10-24) a Versus Group
    -- `versus_group_matches` row (the ids are uuids, so one never names the other). The caller must have held a PLAYER
    -- seat and fought at least one round. 1v1: the match must be over; winner = 1st, loser = 2nd, nobody = null. Group: the
    -- seat's own placement once it is final (knocked out, or the match over), so a player knocked out early settles then.
    -- The Versus place is then put on the lobby's scale (`versusLobbyPlacement`: the same share of the table, winner 1st)
    -- and that is what the ledger stores. XP only: rank_results, rating and MMR are never read or written here.
    if p_run_id !~ '^versus:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'bad_run_id'; end if;
    select * into v_match from public.versus_matches m where m.id = substring(p_run_id from 8)::uuid;
    if found then
      v_vs_seat := case when v_match.p1_user = p_user then 'p1' when v_match.p2_user = p_user then 'p2' end;
      if v_vs_seat is null then raise exception 'source_not_found'; end if;
      if v_match.phase <> 'complete' or v_match.completed_at is null then raise exception 'not_terminal'; end if;
      if not exists (select 1 from public.versus_rounds vr where vr.match_id = v_match.id and vr.round >= c_versus_min_rounds) then raise exception 'not_terminal'; end if;
      v_source_at := v_match.completed_at;
      v_source := v_match.id::text;
      v_placement := case when v_match.winner_seat is null then null when v_match.winner_seat = v_vs_seat then 1 else 2 end;
      v_seats := 2;
      v_hero := case when v_vs_seat = 'p1' then v_match.p1_hero else v_match.p2_hero end;
    else
      select g.id, g.phase, g.completed_at, g.seat_count into v_g_id, v_g_phase, v_g_done, v_g_count
        from public.versus_group_matches g where g.id = substring(p_run_id from 8)::uuid;
      if not found then raise exception 'source_not_found'; end if;
      select s.seat, s.hero, s.placement, s.eliminated_round, s.out_reason into v_g_seat, v_g_hero, v_g_place, v_g_out_round, v_g_out
        from public.versus_group_seats s where s.match_id = v_g_id and s.user_id = p_user;
      if not found then raise exception 'source_not_found'; end if;
      if v_g_place is null and (v_g_phase <> 'complete' or v_g_done is null) then raise exception 'not_terminal'; end if;
      -- The seat FOUGHT a round: one committed before it went out, or the round that knocked it out of hearts.
      if not exists (select 1 from public.versus_group_rounds gr where gr.match_id = v_g_id and gr.round >= c_versus_min_rounds
          and (v_g_out_round is null or gr.round < v_g_out_round or (gr.round = v_g_out_round and v_g_out = 'hearts'))) then
        raise exception 'not_terminal';
      end if;
      v_source_at := coalesce(v_g_done, now());
      v_source := v_g_id::text;
      v_placement := case when v_g_place between 1 and 4 then v_g_place end;
      -- VERSUS DUOS (owner 2026-10-25: "In duos you only place 1 and 2 in a 2v2"): placement is by TEAM, on the scale
      -- of the number of TEAMS (2 teams: 1st = 125, 2nd = 50; 4 teams: 125 / 80 / 50 / 50).
      if exists (select 1 from public.versus_group_matches g2 where g2.id = v_g_id and g2.options->>'mode' = 'duos') then
        v_seats := greatest(2, (select count(*)::int from public.versus_group_teams t where t.match_id = v_g_id));
      else
        v_seats := greatest(2, coalesce(v_g_count, 4));
      end if;
      v_hero := v_g_hero;
    end if;
    if v_source_at < v_epoch then raise exception 'before_epoch'; end if;
    -- On the lobby's scale: the winner 1st, any other place p of n seats ceil(p * 8 / n).
    v_placement := case when v_placement is null then null when v_placement = 1 then 1
      else least(c_lobby_seats, (v_placement * c_lobby_seats + v_seats - 1) / v_seats) end;
    v_comeback := false;
  elsif p_mode = 'spectate' then
    -- SPECTATE: the source is the server's own watch record for this spectator and game (`spectate_beat` wrote it while
    -- they watched; the request names only which game). No XP for watching your own game; the game must be over, the
    -- spectator present at its end and watching for at least half of it (at most 5 minutes needed). Never a placement,
    -- a comeback, a hero or an achievement: half a game's completion XP.
    if p_run_id !~ '^watch:(lobby:[!-~]{1,80}|(versus|group):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$' then raise exception 'bad_run_id'; end if;
    select * into v_spec from public.spectate_sessions ss where ss.user_id = p_user and ss.run_id = p_run_id;
    if not found then raise exception 'source_not_found'; end if;
    if v_spec.kind = 'lobby' then
      if v_spec.watched_user is null or v_spec.watched_user = p_user then raise exception 'own_game'; end if;
      -- The game's end, seen while watching (a beat landed while its listing showed the end).
      if v_spec.saw_end_at is null then raise exception 'not_terminal'; end if;
      -- A real, accepted ranked game: the player's own rank row for it. It can land a little after the end.
      if not exists (select 1 from public.rank_results rr where rr.user_id = v_spec.watched_user and rr.run_id = v_spec.target) then
        if v_spec.saw_end_at > now() - c_spectate_wait then raise exception 'not_yet'; end if;
        raise exception 'source_not_found';
      end if;
      v_game_start := coalesce(v_spec.game_started_at, v_spec.first_seen_at);
      v_game_end := v_spec.saw_end_at;
    elsif v_spec.kind = 'versus' then
      select * into v_match from public.versus_matches m where m.id = v_spec.target::uuid;
      if not found then raise exception 'source_not_found'; end if;
      if p_user in (v_match.p1_user, v_match.p2_user) then raise exception 'own_game'; end if;
      if v_match.phase <> 'complete' or v_match.completed_at is null then raise exception 'not_terminal'; end if;
      if not exists (select 1 from public.versus_rounds vr where vr.match_id = v_match.id and vr.round >= c_versus_min_rounds) then raise exception 'not_terminal'; end if;
      v_game_start := v_match.created_at;
      v_game_end := v_match.completed_at;
    else
      select g.id, g.phase, g.completed_at, g.created_at into v_g_id, v_g_phase, v_g_done, v_game_start
        from public.versus_group_matches g where g.id = v_spec.target::uuid;
      if not found then raise exception 'source_not_found'; end if;
      if exists (select 1 from public.versus_group_seats s where s.match_id = v_g_id and s.user_id = p_user) then raise exception 'own_game'; end if;
      if v_g_phase <> 'complete' or v_g_done is null then raise exception 'not_terminal'; end if;
      if not exists (select 1 from public.versus_group_rounds gr where gr.match_id = v_g_id and gr.round >= c_versus_min_rounds) then raise exception 'not_terminal'; end if;
      v_game_end := v_g_done;
    end if;
    -- Present at the end, and watched enough of it (beats only accrue time for the ONE game a spectator is watching).
    if v_spec.last_seen_at < v_game_end - c_spectate_end_gap then raise exception 'not_enough'; end if;
    v_need_ms := least(c_spectate_cap_ms, greatest(0, floor(extract(epoch from (v_game_end - v_game_start)) * 1000 / 2))::bigint);
    if v_spec.watched_ms < v_need_ms then raise exception 'not_enough'; end if;
    v_source_at := v_game_end;
    if v_source_at < v_epoch then raise exception 'before_epoch'; end if;
    v_source := p_run_id;
    v_placement := null;
    v_comeback := false;
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
  elsif p_mode = 'spectate' then
    v_base := (c_complete * c_spectate_percent + 50) / 100;
  elsif p_mode = 'versus' and v_placement is null then
    -- VERSUS with no winner (abandoned): half the completion XP.
    v_base := (c_complete * c_versus_percent + 50) / 100;
  elsif p_mode = 'practice' and v_placement is null then
    v_base := c_practice_flat;
  else
    r_top   := case when v_placement <= 4 then c_top_four else 0 end;
    r_first := case when v_placement = 1 then c_first_place else 0 end;
    r_come  := case when v_comeback then c_comeback else 0 end;
    if p_mode = 'ranked' then
      v_base := c_complete; v_top := r_top; v_first := r_first; v_come := r_come;
    else
      -- Practice: 60% of the equivalent ranked XP; Versus (2026-10-24): 50%, its placement already on the lobby's scale
      -- and never a comeback. Summed then rounded; the remainder lands on the base.
      v_pct   := case when p_mode = 'versus' then c_versus_percent else c_practice_percent end;
      v_ranked_total := c_complete + r_top + r_first + r_come;
      v_top   := (r_top   * v_pct + 50) / 100;
      v_first := (r_first * v_pct + 50) / 100;
      v_come  := (r_come  * v_pct + 50) / 100;
      v_base  := (v_ranked_total * v_pct + 50) / 100 - v_top - v_first - v_come;
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
  -- SPECTATE (2026-10-24) never touches achievements: watching is not playing.
  if p_mode <> 'spectate' and v_ach_epoch is not null and coalesce(v_source_at, now()) >= v_ach_epoch then
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
  -- before, and one floor-EPIC crate per milestone level at or below the new level (mirror of
  -- milestoneLevelsThrough), `source = 'milestone:<L>'`, so the one-crate-per-source index makes it once per
  -- milestone and a missing one self-heals. `v_crate_ids` holds only the rows actually created, Welcome first.
  -- AETHER OFF: the unchanged per-level insert below the `else` (kept byte-for-byte, hence its indentation).
  -- PACKS ON (2026-12-01, spec section 10; `progression_config.packs_enabled`, which `pack_rollout` flips): PACKS, NO
  -- CRATE AT ALL (no Welcome Crate, no milestone crate), whatever the Aether switch says. On enrollment the Welcome
  -- packs of `pack_config.welcomePacks` (5 Common, 2 Rare, 1 Epic, 1 Legendary Rarity packs), sources
  -- `welcome:<rarity>:<n>`, made in that order (each a microsecond after the last, so the counter shows them Common
  -- first). Then one `levelPackRarity` (Legendary) Rarity pack per multiple of `levelPackEvery` (5) ABOVE the account's
  -- launch level (`pack_level_baseline`, null = 0: an account made after the launch) and at or below the new level
  -- (mirror of levelPacksBetween), `source = 'level:<L>'`. The one-pack-per-source key makes each once, so a retry makes
  -- nothing and a missing one self-heals. Grants never wait on the counter: they are made even beside a full one.
  -- `v_pack_ids` holds only the packs actually created, Welcome first. An UNREADABLE pack economy (no row, a Welcome
  -- count or `levelPackEvery` not a valid integer, `levelPackEvery` below 1, `levelPackRarity` not a rarity) grants no
  -- pack THIS settlement and never raises (a bad retune must never block a game; the level packs self-heal later).
  select packs_enabled into v_packs from public.progression_config where id = 1;
  v_packs := coalesce(v_packs, false);
  v_enrolling := prof.progression_enrolled_at is null;
  if v_packs then
    select economy into v_pk_eco from public.pack_config where id = 1;
    v_pk_every := public.aether_economy_int(v_pk_eco, array['levelPackEvery']);
    v_pk_rarity := v_pk_eco ->> 'levelPackRarity';
    if v_pk_every is null or v_pk_every < 1 or jsonb_typeof(v_pk_eco -> 'levelPackRarity') is distinct from 'string'
       or not (v_pk_rarity = any(c_pk_rarities)) then
      v_pk_ok := false;
    end if;
    foreach v_pk_r in array c_pk_rarities loop
      v_pk_n := public.aether_economy_int(v_pk_eco, array['welcomePacks', v_pk_r]);
      if v_pk_n is null then v_pk_ok := false; else v_pk_welcome := v_pk_welcome + v_pk_n; end if;
    end loop;
    if v_pk_ok then
      if v_enrolling then
        with w as (
          select r.r, r.o, g.n
          from unnest(c_pk_rarities) with ordinality as r(r, o)
          cross join lateral generate_series(1, public.aether_economy_int(v_pk_eco, array['welcomePacks', r.r])) as g(n)
        ), ins as (
          insert into public.packs (user_id, look_kind, look_id, floor_rarity, source, created_at)
            select p_user, 'rarity', 'rarity-' || w.r, w.r, 'welcome:' || w.r || ':' || w.n,
                   now() + (row_number() over (order by w.o, w.n))::int * interval '1 microsecond'
            from w
            on conflict (user_id, source) do nothing
            returning pack_id, created_at
        )
        select coalesce(array_agg(ins.pack_id order by ins.created_at), '{}') into v_pack_ids from ins;
      end if;
      with ins as (
        insert into public.packs (user_id, look_kind, look_id, floor_rarity, source, created_at)
          select p_user, 'rarity', 'rarity-' || v_pk_rarity, v_pk_rarity, 'level:' || g.lvl,
                 now() + (v_pk_welcome + g.lvl) * interval '1 microsecond'
          from generate_series((coalesce(prof.pack_level_baseline, 0) / v_pk_every + 1) * v_pk_every, v_l1, v_pk_every) as g(lvl)
          on conflict (user_id, source) do nothing
          returning pack_id, created_at
      )
      select v_pack_ids || coalesce(array_agg(ins.pack_id order by ins.created_at), '{}') into v_pack_ids from ins;
    end if;
  elsif v_aether then
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
          select p_user, null, 'milestone:' || g.lvl, p_mode || ':' || p_run_id, 'epic'
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
    aether_base, aether_placement, aether_total, aether_on,
    packs_awarded, pack_ids
  ) values (
    p_user, p_run_id, p_mode, v_source, c_rules, c_curve, v_facts_ver, case when v_facts_ver is null then null else p_facts end,
    v_placement, v_comeback, v_base, v_top, v_first, v_come, v_ach_xp, v_total,
    v_xp0, v_xp1, v_l0, v_l1, prof.progression_revision, prof.progression_revision + 1,
    coalesce(array_length(v_crate_ids, 1), 0), v_crate_ids, v_ach_ids, v_unlocked,
    v_ae_base, v_ae_place, v_ae_base + v_ae_place, v_aether,
    coalesce(array_length(v_pack_ids, 1), 0), v_pack_ids
  ) returning * into prev;

  return jsonb_build_object('status', 'ok', 'result', public.progression_result_json(prev), 'profile', public.progression_profile_json(p_user));
end;
$$;
revoke all on function public.settle_progression(uuid, text, text, bigint, boolean, int, jsonb) from public, anon, authenticated;
grant execute on function public.settle_progression(uuid, text, text, bigint, boolean, int, jsonb) to service_role;

-- ── 11. RETIRING THE CHEST SHOP and FREEZING SEALED CHESTS (spec section 11) ───────────────────────────────
-- With packs ON: `buy_crate` refuses with `shop_retired` before the quote or any charge; `aether_quote` answers null
-- (there is no chest to price); `open_crate` refuses a SEALED chest with `chests_frozen` before anything is rolled,
-- charged or written (owner 2026-11-27, "Freeze them": it stays sealed and counted for the later exchange), while an
-- already OPENED chest still answers `already_opened` with its committed reward. With packs OFF each is exactly the
-- function it replaces (buy_crate: 2026-10-18-aether.sql; open_crate: 2026-10-20-milestone-chests-epic.sql;
-- aether_quote: 2026-10-20-announcers-not-focusable.sql), line for line, plus the switch read.

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
  v_pct       int := 0;
  v_fee       int := 0;
  v_crate     int;
begin
  -- PACKS ON (spec section 11): no chest is sold, so there is nothing to price (and no focus).
  if coalesce((select c.packs_enabled from public.progression_config c where c.id = 1), false) then return null; end if;
  v_tier := case when v_milestone then 'legendary' else p_tier end;
  if v_tier is null or v_tier not in ('standard', 'rare', 'epic', 'legendary', 'ancient') then raise exception 'bad_tier'; end if;
  v_floor := case v_tier when 'standard' then 'common' else v_tier end;   -- mirror of CRATE_TIER_FLOOR

  select economy into v_eco from public.aether_config where id = 1;
  -- every economy number through the defensive read (section 11): a missing, fractional or garbled price is a refusal,
  -- never a cast error and never a guess (final review 2026-10-19)
  v_price := public.aether_economy_int(v_eco, array['cratePrice', v_tier]);
  if v_price is null then raise exception 'aether_config_missing'; end if;

  -- the categories a player may focus at this floor: those with something still eligible, never an Announcer
  -- (NON_FOCUSABLE_CATEGORIES in crateShop.ts). The POOL still holds them, so an unfocused chest, and one whose ticks
  -- cover every focusable category (v_focus := null below), can give one.
  select coalesce(array_agg(distinct c.category), '{}') into v_available
    from public.progression_tiered_crate_pool(p_user, v_floor, null) p
    join public.cosmetic_catalog c on c.cosmetic_id = p.pool_cosmetic_id
    where c.category <> 'announcer';

  -- normalizeFocus
  if p_focus is not null and cardinality(p_focus) > 0 then
    if exists (select 1 from unnest(p_focus) f where f is null or not (f = any(v_available))) then raise exception 'bad_focus'; end if;
    select array_agg(f order by f collate "C") into v_focus from (select distinct f from unnest(p_focus) f) d;
    if cardinality(v_focus) >= cardinality(v_available) then v_focus := null; end if;
  end if;

  select count(*) into v_remaining from public.progression_tiered_crate_pool(p_user, v_floor, v_focus);
  if v_remaining = 0 then raise exception 'sold_out'; end if;

  -- focusFeePercent: 1..7 ticked read the ladder, 8 or more (but fewer than all available) the last rung
  -- (an unreadable ladder or rung is `aether_config_missing`: a focused crate is never sold at a guessed fee)
  if v_focus is not null then
    if jsonb_typeof(v_eco -> 'focusFeePercent') is distinct from 'array' or jsonb_array_length(v_eco -> 'focusFeePercent') = 0 then
      raise exception 'aether_config_missing';
    end if;
    v_pct := public.aether_economy_int(v_eco,
      array['focusFeePercent', (least(cardinality(v_focus), jsonb_array_length(v_eco -> 'focusFeePercent')) - 1)::text]);
    if v_pct is null then raise exception 'aether_config_missing'; end if;
    v_fee := (v_price * v_pct) / 100;   -- integer division: Math.floor in the TS
  end if;
  v_crate := case when v_milestone then 0 else v_price end;
  return jsonb_build_object('tier', v_tier, 'floor', v_floor, 'focus', to_jsonb(v_focus), 'crate', v_crate,
    'fee', v_fee, 'total', v_crate + v_fee, 'remaining', v_remaining);
end;
$$;
revoke all on function public.aether_quote(uuid, text, text[], boolean) from public, anon, authenticated, service_role;

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
  v_packs   boolean;
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

  select crates_enabled, aether_enabled, packs_enabled into v_enabled, v_aether, v_packs from public.progression_config where id = 1;
  -- PACKS ON (owner 2026-11-27, "Freeze them"): a SEALED chest stays sealed, counted for the later exchange. Refused
  -- before anything is rolled, charged or written (an opened chest answered above, unchanged).
  if coalesce(v_packs, false) then raise exception 'chests_frozen'; end if;
  if not coalesce(v_enabled, false) then raise exception 'crates_disabled'; end if;

  -- NO crate takes a focus at open (owner 2026-10-20: milestone chests "you cannot focus those ones specifically"); a
  -- focus is bought WITH a crate, in buy_crate. The two parameters stay so an older client's focused call is refused
  -- (`focus_not_allowed`, nothing charged, the crate left sealed), never an unknown-function error.
  if p_focus is not null then raise exception 'focus_not_allowed'; end if;

  if not exists (select 1 from public.progression_tiered_crate_pool(p_user, v_crate.floor_rarity, v_crate.focus_categories)) then
    select count(*) into v_sealed from public.loot_crates where user_id = p_user and state = 'sealed';
    return jsonb_build_object('status', 'pool_exhausted', 'crate', public.progression_crate_json(v_crate),
      'rewardId', null, 'sealedRemaining', v_sealed, 'profile', public.progression_profile_json(p_user),
      'aether', coalesce((select w.balance from public.aether_wallets w where w.user_id = p_user), 0));
  end if;

  v_focus := v_crate.focus_categories;

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
revoke all on function public.open_crate(uuid, uuid, text[], int) from public, anon, authenticated;
grant execute on function public.open_crate(uuid, uuid, text[], int) to service_role;

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
  v_packs   boolean;
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

  select crates_enabled, aether_enabled, packs_enabled into v_enabled, v_aether, v_packs from public.progression_config where id = 1;
  -- PACKS ON (spec section 11): the Chest Shop is retired. Refused before the quote and before any charge.
  if coalesce(v_packs, false) then raise exception 'shop_retired'; end if;
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
revoke all on function public.buy_crate(uuid, text, text[], int, uuid) from public, anon, authenticated;
grant execute on function public.buy_crate(uuid, text, text[], int, uuid) to service_role;

-- ── 12. The result and profile JSON carry the packs ──────────────────────────────────────────────────────
-- MUST match `ProgressionResult` in packages/progression/src/rules.ts key for key. The 2026-10-18-aether.sql body plus
-- `packsAwarded` and `packIds` (the packs this settlement made, Welcome first; 0 / empty with packs off).
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
    'packsAwarded', r.packs_awarded,
    'packIds', to_jsonb(r.pack_ids),
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

-- MUST match `ProgressionProfile` in packages/progression/src/rules.ts key for key. The 2026-10-18-aether.sql body plus
-- `packs` (the sealed packs in counter order, as `OwnedPack`s; empty with packs off) and `packMeter` (`{progress,
-- ready}` of the purchase reward; null while `pack_config.rewardEvery` is unreadable, never an error: every settlement
-- answers with this profile). SECURITY DEFINER now (it was invoker): it reaches the internal pack helpers, which are
-- revoked from every API role; it stays callable by the service role alone.
create or replace function public.progression_profile_json(p_user uuid)
returns jsonb
language sql
stable
security definer
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
    'aether', coalesce((select w.balance from public.aether_wallets w where w.user_id = p.user_id), 0),
    'packs', public.progression_pack_hand_json(p.user_id),
    'packMeter', (
      select case when e.every >= 1 then jsonb_build_object(
          'progress', coalesce(m.purchased, 0) % e.every,
          'ready', greatest(0, coalesce(m.purchased, 0) / e.every - coalesce(m.claimed, 0))) end
      from (select public.aether_economy_int((select c.economy from public.pack_config c where c.id = 1), array['rewardEvery']) as every) e
      left join public.pack_meters m on m.user_id = p.user_id)
  )
  from public.profiles p where p.user_id = p_user;
$$;
revoke all on function public.progression_profile_json(uuid) from public, anon, authenticated;
grant execute on function public.progression_profile_json(uuid) to service_role;

-- ── 13. THE ROLLOUT and THE 3,000 AETHER LAUNCH GIFT (spec sections 12 and 12.1) ──────────────────────────────
-- The launch level is the server's: a client must never write it (a lower one would mint Level packs below it). The
-- 2026-09-27 progression guard predates the column, so it gets its own guard, the same shape: the API roles may neither
-- insert a profile with a launch level nor change one.
create or replace function public.profiles_pack_baseline_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if (tg_op = 'INSERT' and new.pack_level_baseline is not null)
     or (tg_op = 'UPDATE' and new.pack_level_baseline is distinct from old.pack_level_baseline) then
    raise exception 'progression_columns_are_server_owned';
  end if;
  return new;
end;
$$;
revoke all on function public.profiles_pack_baseline_guard() from public, anon, authenticated, service_role;
drop trigger if exists profiles_pack_baseline_guard on public.profiles;
create trigger profiles_pack_baseline_guard before insert or update on public.profiles
  for each row execute function public.profiles_pack_baseline_guard();

-- When `pack_rollout` ran (null until it has): a re-run after that changes nothing.
alter table public.progression_config add column if not exists packs_rolled_out_at timestamptz;

-- ONE ACCOUNT'S GIFT (internal): `PACK_LAUNCH_GRANT` (packEconomy.ts; packGrants.db.test.ts pins the two equal) through
-- the one balance writer. The ledger's unique (user, reason, source) key makes it once per account, ever.
create or replace function public.pack_launch_grant(p_user uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  c_grant constant int := 3000;
begin
  return public.aether_apply(p_user, c_grant, 'grant', 'pack_launch');
end;
$$;
revoke all on function public.pack_launch_grant(uuid) from public, anon, authenticated, service_role;

-- pack_rollout(): THE OWNER'S ONE-SHOT (run once from the SQL Editor, after the Edge Functions and Ship Ascent, spec
-- 12 step 4), one transaction, in this order:
--  1. every existing profile's launch level: `pack_level_baseline = account_level`, only where it is still null (a
--     written one never moves);
--  2. the 3,000 Aether launch gift to every existing profile (guests too), once per account through the ledger key
--     (`grant` / `pack_launch`), each paid account's progression revision moved so its mirrors adopt the balance;
--  3. the switch: `packs_enabled = true`, and `packs_rolled_out_at` stamped.
-- It grants NO pack (Level packs start above the launch level; Welcome packs are for accounts enrolled after it).
-- LAUNCH-DAY ACCOUNTS ONLY (owner 2026-11-27): there is no trigger on new profiles, and once it has run a re-run
-- changes nothing at all (`already_rolled_out`), so an account made after the launch is never paid and its launch
-- level stays null (read as 0). Refuses, changing nothing, while Aether is off (`aether_disabled`: packs are bought
-- and refunded in Aether) or while the pack economy's grant numbers are unreadable (`pack_config_missing`). The
-- payment takes no per-user lock (one per account would fill the shared lock table on a large table); `aether_apply`
-- locks each wallet row, so a game settling meanwhile still lands on the right balance.
-- Answers {status: 'rolled_out' | 'already_rolled_out', baselines: launch levels written, granted: accounts paid}.
create or replace function public.pack_rollout()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_rarities  constant text[] := array['common', 'rare', 'epic', 'legendary', 'ancient'];
  v_done      timestamptz;
  v_aether    boolean;
  v_eco       jsonb;
  v_r         text;
  v_baselines int := 0;
  v_user      uuid;
  v_paid      uuid[] := '{}';
begin
  perform pg_advisory_xact_lock(hashtextextended('pack_rollout', 0));
  select packs_rolled_out_at, aether_enabled into v_done, v_aether from public.progression_config where id = 1 for update;
  if v_done is not null then
    return jsonb_build_object('status', 'already_rolled_out', 'baselines', 0, 'granted', 0);
  end if;
  if not coalesce(v_aether, false) then raise exception 'aether_disabled'; end if;
  -- the numbers the settlement's grants read (it would silently grant nothing on a bad one)
  select economy into v_eco from public.pack_config where id = 1;
  if public.progression_pack_config_int(v_eco, array['levelPackEvery']) < 1 then raise exception 'pack_config_missing'; end if;
  perform public.progression_pack_config_rarity(v_eco, 'levelPackRarity');
  foreach v_r in array c_rarities loop perform public.progression_pack_config_int(v_eco, array['welcomePacks', v_r]); end loop;

  update public.profiles set pack_level_baseline = account_level where pack_level_baseline is null;
  get diagnostics v_baselines = row_count;

  for v_user in
    select p.user_id from public.profiles p
    where not exists (select 1 from public.aether_ledger l where l.user_id = p.user_id and l.reason = 'grant' and l.source_id = 'pack_launch')
    order by p.user_id
  loop
    perform public.pack_launch_grant(v_user);
    v_paid := v_paid || v_user;
  end loop;
  update public.profiles set progression_revision = progression_revision + 1, updated_at = now() where user_id = any(v_paid);

  update public.progression_config set packs_enabled = true, packs_rolled_out_at = now() where id = 1;
  return jsonb_build_object('status', 'rolled_out', 'baselines', v_baselines, 'granted', coalesce(array_length(v_paid, 1), 0));
end;
$$;
revoke all on function public.pack_rollout() from public, anon, authenticated;
grant execute on function public.pack_rollout() to service_role;

-- PostgREST caches the schema: reload it so the new functions and columns are callable at once.
notify pgrst, 'reload schema';

-- ── END OF SECTIONS 10-13 (the settlement's grants, the retired Chest Shop + frozen chests, the result and profile
--    JSON, the rollout). ──────────────────────────────────────────────────────────────────────────────────────────

-- THE OWNER'S LAUNCH RUNBOOK (spec 12 step 4; run once, AFTER this file, the Edge Functions and Ship Ascent): write
-- every account's launch level, pay the 3,000 Aether launch gift, then turn packs on.
-- select public.pack_rollout();
