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
-- Spec: docs/superpowers/specs/2026-11-27-pack-economy-design.md (sections 6, 7, 9.1, 11).
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
-- Every refusal answers `{status 'error', reason, aether}` and writes nothing. Malformed input raises.
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

  -- 1. a replayed request
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
    from jsonb_array_elements(v_cards) as e where jsonb_typeof(e -> 'duplicate') = 'null'
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
         where c.category = 'title' and jsonb_typeof(e.x -> 'duplicate') = 'null' order by e.o limit 1)),
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
