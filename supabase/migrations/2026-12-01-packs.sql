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
-- last; duplicates are allowed and pay Aether). EVERYTHING HERE IS DORMANT behind the switch: nothing below sells,
-- grants or opens a pack. Later sections of this file (the purchase, the opening, the grants) read the switch.
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
--
-- THE TS COPY is packRoll.ts (`rollPack`, `packPool`), packEconomy.ts (`DEFAULT_PACK_ECONOMY`), packs.ts
-- (`STYLE_PACK_IDS`) and cosmetics.ts (`COSMETIC_RARITIES`, `COSMETIC_CATEGORIES`, `crateRarityFallback`).
-- packRoll.db.test.ts runs this file on PGlite and checks the SQL roll equals the TS roll for 2,000 draw sets.

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
     or new.created_at is distinct from old.created_at then
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

-- A (re-)run of this file forces the next cold start to sync the catalog again (and so write every `pack_styles`).
update public.progression_config set catalog_hash = null where id = 1;

-- ── END OF SECTIONS 1-5 (switch, config, columns + the catalog sync, packs + pack_meters, the roll). ─────────
