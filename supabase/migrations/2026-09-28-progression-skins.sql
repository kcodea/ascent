-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ACCOUNT PROGRESSION: SKINS, the code-owned CATALOG SYNC, equip_cosmetic, the emergency switch  (2026-09-28)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-09-28-progression-crates.sql. Idempotent: re-running it
-- is always safe (it writes no catalog rows and no flags). The same block is appended to schema.sql; keep the two
-- identical. Owner runbook: docs/devlog/2026-09-28-skins-v1.md. This must be the LAST progression file run: if the
-- crates file is ever re-run, run this one again after it (the crates file redefines the pool and profile
-- functions without the switch below).
--
-- WHAT THIS IS (owner 2026-09-28: "let's use these 2 black belt brian skins as our first 2 skin concepts", "let's use
-- these 2 hero skins as our first 2 hero skin concepts", and "yeah let's do option 2 then to make it automated when i
-- add skins"; handoff §5.3, §5.6, §6.5 to §6.7, §13).
--  - CODE IS THE SOURCE OF TRUTH FOR THE CATALOG. `sync_cosmetic_catalog(catalog, hash)` upserts the categories and
--    items from packages/progression/src/cosmetics.ts (`catalogSyncPayload`); the `progression-inventory` Edge
--    Function calls it on the first request of every cold start. An item no longer in code is marked
--    `active = false`, never deleted (ownership references it). An unchanged catalog (same hash) is one read.
--    So adding a cosmetic is: art + a cosmetics.ts entry, `npm run progression:shared`, merge, deploy
--    progression-inventory. No SQL. (The skins arrive the same way: this file seeds none.)
--  - THE EMERGENCY SWITCH is a separate column, `admin_off`, on both tables. The sync NEVER writes it, so the
--    owner's one-line retire always wins over the next deploy. Effective state everywhere (crate pool, equip, the
--    loadout, the catalog clients read): item `active AND NOT admin_off`, category `enabled AND NOT admin_off`.
--  - EQUIP goes through `equip_cosmetic` (service role, called by progression-inventory): a skin the caller OWNS,
--    for the target it was made for, effectively live, into `cosmetic_loadouts` (slot + target_id). Null = Default.
--  - The profile JSON also carries every owned cosmetic (`cosmetics`) and the LIVE loadout (`loadout`).
--
-- THE ONE-LINERS (paste one; ownership and loadout rows are never deleted, so a restore puts everything back):
--   retire one item:     update public.cosmetic_catalog set admin_off = true where cosmetic_id = 'skin_blackbelt_2';
--   retire a category:   update public.cosmetic_categories set admin_off = true, updated_at = now() where category = 'minion_skin';
--   restore an item:     update public.cosmetic_catalog set admin_off = false where cosmetic_id = 'skin_blackbelt_2';
--   restore a category:  update public.cosmetic_categories set admin_off = false, updated_at = now() where category = 'minion_skin';
-- (A PERMANENT retire is `active: false` in cosmetics.ts + a deploy; the one-liners are for right now.)
--
-- THE RULES LIVE IN TWO PLACES that must agree: this file and packages/progression/src/cosmetics.ts. CI parses
-- this file (sqlParity.test.ts) and runs it, with the sync, in an embedded Postgres (skins.db.test.ts).

-- ── 1. The emergency switch + the last synced catalog ──────────────────────────────────────────────────────
alter table public.cosmetic_catalog    add column if not exists admin_off boolean not null default false;
alter table public.cosmetic_categories add column if not exists admin_off boolean not null default false;
alter table public.progression_config  add column if not exists catalog_hash text;
-- A (re-)run of this file forces the next cold start to sync again, whatever an earlier file left behind.
update public.progression_config set catalog_hash = null where id = 1;

-- ── 2. sync_cosmetic_catalog: write the code's catalog. Service role only. ───────────────────────────────
-- p_catalog = catalogSyncPayload() (camelCase keys, see cosmetics.ts); p_hash = catalogHash(p_catalog). One
-- transaction under one global lock. Never touches `admin_off`, never deletes a row.
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

  -- Items: every column from code (including `active`). An item no longer in code is marked inactive, never deleted.
  insert into public.cosmetic_catalog (cosmetic_id, category, rarity, acquisition_source, milestone_level, target_type, target_id, achievement_id, active)
    select x->>'cosmeticId', x->>'category', x->>'rarity', x->>'acquisitionSource', (x->>'milestoneLevel')::int,
           x->>'targetType', x->>'targetId', x->>'achievementId', (x->>'active')::boolean
    from jsonb_array_elements(p_catalog->'items') as x
    on conflict (cosmetic_id) do update set
      category = excluded.category, rarity = excluded.rarity, acquisition_source = excluded.acquisition_source,
      milestone_level = excluded.milestone_level, target_type = excluded.target_type, target_id = excluded.target_id,
      achievement_id = excluded.achievement_id, active = excluded.active
    where (public.cosmetic_catalog.category, public.cosmetic_catalog.rarity, public.cosmetic_catalog.acquisition_source,
           public.cosmetic_catalog.milestone_level, public.cosmetic_catalog.target_type, public.cosmetic_catalog.target_id,
           public.cosmetic_catalog.achievement_id, public.cosmetic_catalog.active)
          is distinct from (excluded.category, excluded.rarity, excluded.acquisition_source, excluded.milestone_level,
           excluded.target_type, excluded.target_id, excluded.achievement_id, excluded.active);
  get diagnostics v_items = row_count;
  update public.cosmetic_catalog set active = false
    where active and cosmetic_id not in (select x->>'cosmeticId' from jsonb_array_elements(p_catalog->'items') as x);
  get diagnostics v_off = row_count;

  update public.progression_config set catalog_hash = p_hash where id = 1;
  return jsonb_build_object('status', 'synced', 'hash', p_hash,
    'categoriesChanged', v_cats, 'categoriesSwitchedOff', v_catoff, 'itemsChanged', v_items, 'itemsDeactivated', v_off);
end;
$$;

-- ── 3. The crate pool honours the switch (mirror of eligibleCrateCosmetics + the server state) ────────────
create or replace function public.progression_crate_pool(p_user uuid)
returns table (pool_cosmetic_id text, pool_weight int)
language plpgsql
stable
set search_path = public
as $$
declare
  -- THE WEIGHTS (mirror of RARITY_WEIGHTS in packages/progression/src/cosmetics.ts; handoff §5.4)
  c_w_common    constant int := 55;
  c_w_rare      constant int := 30;
  c_w_epic      constant int := 12;
  c_w_legendary constant int := 3;
begin
  return query
    select c.cosmetic_id,
      (case c.rarity when 'common' then c_w_common when 'rare' then c_w_rare when 'epic' then c_w_epic when 'legendary' then c_w_legendary else 0 end) * k.weight
    from public.cosmetic_catalog c
    join public.cosmetic_categories k on k.category = c.category
    where c.active and not c.admin_off and k.enabled and not k.admin_off
      and c.acquisition_source = 'crate' and k.weight > 0
      and not exists (select 1 from public.player_cosmetics o where o.user_id = p_user and o.cosmetic_id = c.cosmetic_id)
    order by c.cosmetic_id collate "C";
end;
$$;

-- ── 4. The profile JSON: every owned cosmetic + the LIVE loadout ─────────────────────────────────────────
-- MUST match `ProgressionProfile` in packages/progression/src/rules.ts key for key. `titles` is unchanged (owned
-- titles, oldest first). `cosmetics` lists every owned item of any category (retired ones too: ownership is
-- never deleted; the client hides what is retired). `loadout` lists only equipped items that are effectively LIVE,
-- so a retired skin disappears from every profile at once and comes back, still equipped, when it is restored.
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
    ), '[]'::jsonb)
  )
  from public.profiles p where p.user_id = p_user;
$$;

-- ── 5. equip_cosmetic: wear a skin you OWN on its own target, or Default. Service role only. ─────────────
-- Checks, in order: the slot is a skin slot, the target id is well formed, the item exists in THIS slot's
-- category, is made for THIS target, is effectively live, and is owned. A null cosmetic removes the row
-- (Default; always allowed, even for a retired item). Same per-user advisory lock as every progression writer.
create or replace function public.equip_cosmetic(p_user uuid, p_slot text, p_target_id text, p_cosmetic_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cat public.cosmetic_catalog%rowtype;
  v_live boolean;
begin
  if p_user is null then raise exception 'not_owned'; end if;
  if p_slot is null or p_slot not in ('hero_skin', 'minion_skin') then raise exception 'bad_slot'; end if;
  if p_target_id is null or p_target_id !~ '^[A-Za-z0-9_.:-]{1,64}$' then raise exception 'bad_target'; end if;
  if p_cosmetic_id is not null and p_cosmetic_id !~ '^[a-z0-9_]{1,64}$' then raise exception 'bad_cosmetic_id'; end if;
  perform pg_advisory_xact_lock(hashtextextended('progression:' || p_user::text, 0));

  if p_cosmetic_id is null then
    delete from public.cosmetic_loadouts where user_id = p_user and slot = p_slot and target_id = p_target_id;
  else
    select * into v_cat from public.cosmetic_catalog where cosmetic_id = p_cosmetic_id;
    if not found then raise exception 'bad_cosmetic_id'; end if;
    if v_cat.category <> p_slot
       or v_cat.target_type is distinct from (case p_slot when 'hero_skin' then 'hero' else 'card' end)
       or v_cat.target_id is distinct from p_target_id then
      raise exception 'wrong_target';
    end if;
    select k.enabled and not k.admin_off into v_live from public.cosmetic_categories k where k.category = v_cat.category;
    if not v_cat.active or v_cat.admin_off or not coalesce(v_live, false) then raise exception 'not_equippable'; end if;
    if not exists (select 1 from public.player_cosmetics o where o.user_id = p_user and o.cosmetic_id = p_cosmetic_id) then
      raise exception 'not_owned';
    end if;
    insert into public.cosmetic_loadouts (user_id, slot, target_id, cosmetic_id, updated_at)
      values (p_user, p_slot, p_target_id, p_cosmetic_id, now())
      on conflict (user_id, slot, target_id) do update set cosmetic_id = excluded.cosmetic_id, updated_at = now();
  end if;

  update public.profiles set progression_revision = progression_revision + 1, updated_at = now() where user_id = p_user;
  if not found then raise exception 'not_owned'; end if;
  return jsonb_build_object('status', 'equipped', 'profile', public.progression_profile_json(p_user));
end;
$$;

-- ── 6. Grants: every writer is service role ONLY (the Edge Function calls them) ──────────────────────────
revoke all on function public.sync_cosmetic_catalog(jsonb, text) from public, anon, authenticated;
grant execute on function public.sync_cosmetic_catalog(jsonb, text) to service_role;
revoke all on function public.equip_cosmetic(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.equip_cosmetic(uuid, text, text, text) to service_role;
revoke all on function public.progression_profile_json(uuid) from public, anon, authenticated;
grant execute on function public.progression_profile_json(uuid) to service_role;
revoke all on function public.progression_crate_pool(uuid) from public, anon, authenticated;
grant execute on function public.progression_crate_pool(uuid) to service_role;

-- ── 7. Snapshot side: nothing to migrate ────────────────────────────────────────────────────────────────
-- The skins a run wore travel INSIDE the payloads the client already writes (the board snapshot jsonb, the run
-- history entry, the practice record), as an additive `cosmetics` field. Older rows have none and render default
-- art. No table, column or policy changes here.
