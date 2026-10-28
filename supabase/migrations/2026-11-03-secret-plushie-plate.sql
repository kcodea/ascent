-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ACCOUNT PROGRESSION: THE SECRET RARITY, COLLECTIONS, AND THE PLUSHIE PLATE  (owner 2026-10-27)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, THEN deploy the `progression-inventory` Edge Function. Run the SQL FIRST:
-- the function's catalog sync now sends a Secret item and a collection id, and before this file the rarity check
-- rejects the Secret item. Idempotent: it re-creates one check constraint, adds one column if missing, and REPLACES
-- `sync_cosmetic_catalog` plus four new functions and three triggers, so re-running it is always safe. It writes no
-- rows itself (the first catalog sync after the deploy fills the collection and grants anyone already complete). It
-- SUPERSEDES the `sync_cosmetic_catalog` in 2026-09-28-progression-skins.sql: if that file is ever re-run, run this
-- one again after it. It also SUPERSEDES the rarity check in 2026-10-02-ancient-rarity.sql: re-running that file's
-- section 0 now fails (its five-rarity check rejects the Secret item), so re-run only its pick + open_crate, or run
-- this file's section 0 straight after it.
--
-- WHAT THIS IS (owner 2026-10-27: "i want this to be a secrete unlock that the players are given once they unlock every
-- Plushie Beast cosmetic ... can we create a new achievement and say the reward is a 'Unique Card Plate Only Available
-- From Completing This Achievement'?", then "wont it have its own category as \"Secret\"? we can make it Red, over
-- Ancient. Should ONLY show up once you unlock it").
--  - `cosmetic_catalog.rarity` accepts 'secret', ranked ABOVE 'ancient'. No crate rolls it: a Secret item is an
--    achievement reward, and the crate pool only takes `acquisition_source = 'crate'`.
--  - `cosmetic_catalog.collection_id`: the collection an item belongs to (the 24 Plushie Beast skins share
--    'collection.plushie_beasts'). Written by the catalog sync from code (`CosmeticDef.collection`).
--  - A COLLECTION ACHIEVEMENT has the collection's id as its achievement id. Its progress is how many ACTIVE members the
--    account owns, kept by `progression_refresh_collection` every time an item is granted (any path: crates, the
--    shop, a backfill), and once per changed catalog sync for every owner (so new members raise the count and the
--    first sync after this file credits everyone). Owning every active member completes it (no XP) and grants every
--    active `achievement` item whose `achievement_id` is the collection: the Plushie Plate. A completion is never taken
--    back: a player who already earned it keeps the plate when a new Plushie Beast joins.
--  - Only this file writes those rows: a guard refuses any other insert or update of a `collection.%` achievement's
--    progress or completion, so a client that names `collectionOwned` in a game's metrics moves nothing.
--
-- THE TS COPY is packages/progression/src/cosmetics.ts (PLUSHIE_BEAST_SKIN_IDS, collectionMembers, catalogSyncPayload)
-- and achievements.ts (COLLECTION_METRIC, the `collection.plushie_beasts` def). plushiePlate.db.test.ts runs this file
-- on PGlite.

-- ── 0. The rarity check: every rarity check on cosmetic_catalog is dropped (whatever Postgres named it) and the
-- six-rarity one re-created under the same fixed name. Every existing row is one of the old five, so it validates.
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
  check (rarity in ('common', 'rare', 'epic', 'legendary', 'ancient', 'secret'));

-- ── 1. The collection column ─────────────────────────────────────────────────────────────────────────────
alter table public.cosmetic_catalog add column if not exists collection_id text;
create index if not exists cosmetic_catalog_collection on public.cosmetic_catalog (collection_id) where collection_id is not null;

-- ── 2. One account's collection: recount, record, complete, grant ─────────────────────────────────────────
create or replace function public.progression_refresh_collection(p_user uuid, p_collection text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total   int;
  v_owned   int;
  v_version int;
  r         record;
begin
  if p_user is null or p_collection is null then return; end if;
  -- One recount at a time per account, so two grants racing for the last member can't both count one short.
  perform pg_advisory_xact_lock(hashtextextended('collection:' || p_user::text, 0));
  select count(*) into v_total from public.cosmetic_catalog c where c.collection_id = p_collection and c.active;
  if v_total = 0 then return; end if;
  select count(*) into v_owned
    from public.player_cosmetics pc join public.cosmetic_catalog c on c.cosmetic_id = pc.cosmetic_id
    where pc.user_id = p_user and c.collection_id = p_collection and c.active;
  select coalesce((select a.version from public.achievement_catalog a where a.achievement_id = p_collection), 1) into v_version;

  perform set_config('ascent.collection_write', '1', true);
  insert into public.achievement_progress (user_id, achievement_id, definition_version, progress, completed_at, updated_at)
    values (p_user, p_collection, v_version, v_owned, case when v_owned >= v_total then now() end, now())
    on conflict (user_id, achievement_id) do update set
      definition_version = excluded.definition_version, progress = excluded.progress,
      completed_at = coalesce(public.achievement_progress.completed_at, excluded.completed_at), updated_at = now()
    where public.achievement_progress.progress is distinct from excluded.progress
       or (public.achievement_progress.completed_at is null and excluded.completed_at is not null);
  if v_owned >= v_total then
    insert into public.achievement_completions (user_id, achievement_id, run_id, mode, xp_awarded, title_id)
      values (p_user, p_collection, null, null, 0, null)
      on conflict (user_id, achievement_id) do nothing;
  end if;
  perform set_config('ascent.collection_write', '', true);

  -- The reward: granted to anyone who has completed it (now or before), so a completion recorded before its reward
  -- reached the catalog still pays the moment it does. Keyed, so it never doubles.
  if exists (select 1 from public.achievement_completions ac where ac.user_id = p_user and ac.achievement_id = p_collection) then
    for r in
      select c.cosmetic_id from public.cosmetic_catalog c
        where c.acquisition_source = 'achievement' and c.achievement_id = p_collection and c.active
    loop
      insert into public.player_cosmetics (user_id, cosmetic_id, source, source_id)
        values (p_user, r.cosmetic_id, 'achievement', p_collection)
        on conflict (user_id, cosmetic_id) do nothing;
    end loop;
  end if;
end;
$$;

-- ── 3. Every owner of every collection (after a catalog sync that changed items) ──────────────────────────
create or replace function public.progression_refresh_all_collections()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select distinct pc.user_id, c.collection_id
      from public.player_cosmetics pc join public.cosmetic_catalog c on c.cosmetic_id = pc.cosmetic_id
      where c.collection_id is not null
  loop
    perform public.progression_refresh_collection(r.user_id, r.collection_id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ── 4. A granted collection item recounts its collection ──────────────────────────────────────────────────
create or replace function public.player_cosmetics_collections()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_collection text;
begin
  select c.collection_id into v_collection from public.cosmetic_catalog c where c.cosmetic_id = new.cosmetic_id;
  if v_collection is not null then
    perform public.progression_refresh_collection(new.user_id, v_collection);
  end if;
  return null;
end;
$$;
drop trigger if exists player_cosmetics_collections on public.player_cosmetics;
create trigger player_cosmetics_collections
  after insert on public.player_cosmetics
  for each row execute function public.player_cosmetics_collections();

-- ── 5. The guard: only `progression_refresh_collection` writes a collection achievement ──────────────────
create or replace function public.achievement_collection_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.achievement_id like 'collection.%' and coalesce(current_setting('ascent.collection_write', true), '') <> '1' then
    return null;
  end if;
  return new;
end;
$$;
drop trigger if exists achievement_progress_collection_guard on public.achievement_progress;
create trigger achievement_progress_collection_guard
  before insert or update on public.achievement_progress
  for each row execute function public.achievement_collection_guard();
drop trigger if exists achievement_completions_collection_guard on public.achievement_completions;
create trigger achievement_completions_collection_guard
  before insert or update on public.achievement_completions
  for each row execute function public.achievement_collection_guard();

-- ── 6. The catalog sync, now with `collection_id`, recounting every collection when items changed ──────────
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

  -- Items: every column from code (including `active` and `collection_id`). An item no longer in code is marked
  -- inactive, never deleted.
  insert into public.cosmetic_catalog (cosmetic_id, category, rarity, acquisition_source, milestone_level, target_type, target_id, achievement_id, active, collection_id)
    select x->>'cosmeticId', x->>'category', x->>'rarity', x->>'acquisitionSource', (x->>'milestoneLevel')::int,
           x->>'targetType', x->>'targetId', x->>'achievementId', (x->>'active')::boolean, x->>'collectionId'
    from jsonb_array_elements(p_catalog->'items') as x
    on conflict (cosmetic_id) do update set
      category = excluded.category, rarity = excluded.rarity, acquisition_source = excluded.acquisition_source,
      milestone_level = excluded.milestone_level, target_type = excluded.target_type, target_id = excluded.target_id,
      achievement_id = excluded.achievement_id, active = excluded.active, collection_id = excluded.collection_id
    where (public.cosmetic_catalog.category, public.cosmetic_catalog.rarity, public.cosmetic_catalog.acquisition_source,
           public.cosmetic_catalog.milestone_level, public.cosmetic_catalog.target_type, public.cosmetic_catalog.target_id,
           public.cosmetic_catalog.achievement_id, public.cosmetic_catalog.active, public.cosmetic_catalog.collection_id)
          is distinct from (excluded.category, excluded.rarity, excluded.acquisition_source, excluded.milestone_level,
           excluded.target_type, excluded.target_id, excluded.achievement_id, excluded.active, excluded.collection_id);
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

revoke all on function public.sync_cosmetic_catalog(jsonb, text) from public, anon, authenticated;
grant execute on function public.sync_cosmetic_catalog(jsonb, text) to service_role;
revoke all on function public.progression_refresh_collection(uuid, text) from public, anon, authenticated;
revoke all on function public.progression_refresh_all_collections() from public, anon, authenticated;
revoke all on function public.player_cosmetics_collections() from public, anon, authenticated;
revoke all on function public.achievement_collection_guard() from public, anon, authenticated;

-- A (re-)run of this file forces the next cold start to sync the catalog again (and so recount every collection).
update public.progression_config set catalog_hash = null where id = 1;
