-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ACCOUNT PROGRESSION: the first SKINS (2 hero skins, 2 minion skins), equip_cosmetic, the kill switch  (2026-09-28)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-09-28-progression-crates.sql. Idempotent (safe to
-- re-run). Never re-run the crates file after this one: its seed switches the skin categories back off. The same
-- block is appended to schema.sql; keep the two identical. Owner runbook: docs/devlog/2026-09-28-skins-v1.md.
--
-- WHAT THIS IS (owner 2026-09-28: "let's use these 2 black belt brian skins as our first 2 skin concepts" and
-- "let's use these 2 hero skins as our first 2 hero skin concepts"; handoff §5.3, §5.6, §6.5 to §6.7, §13).
--  - `hero_skin` and `minion_skin` are switched ON and four crate items join the catalog. The crate pool picks
--    them up with no other change (`progression_crate_pool` already reads the catalog + the category flags).
--  - EQUIP goes through `equip_cosmetic` (service role, called by the progression-inventory Edge Function): a
--    skin the caller OWNS, on the target it was made for, live (item active + category enabled), into
--    `cosmetic_loadouts` (slot + target_id). A null cosmetic is "Default" (the row is removed).
--  - The profile JSON now also carries every owned cosmetic (`cosmetics`) and the LIVE loadout (`loadout`).
--
-- THE KILL SWITCH (owner 2026-09-28: "we need to have the ability to remove any rewards from the game if we want
-- to"). One line each; ownership and loadout rows are NEVER deleted, so a restore puts everything back as it was:
--   retire one item:     update public.cosmetic_catalog set active = false where cosmetic_id = 'skin_blackbelt_2';
--   retire a category:   update public.cosmetic_categories set enabled = false, updated_at = now() where category = 'minion_skin';
--   restore an item:     update public.cosmetic_catalog set active = true where cosmetic_id = 'skin_blackbelt_2';
--   restore a category:  update public.cosmetic_categories set enabled = true, updated_at = now() where category = 'minion_skin';
-- A retired item leaves the crate pool, cannot be equipped, drops out of every profile's `loadout`, and clients
-- (which read these two public tables on boot) hide it and render default art wherever it was worn or recorded.
-- Re-running THIS file keeps an item retire (the catalog upsert never touches `active` on an existing row) but
-- re-enables the two skin categories: re-apply a category retire after any re-run.
--
-- THE RULES LIVE IN TWO PLACES that must agree: this file and packages/progression/src/cosmetics.ts. CI parses
-- this file and compares (sqlParity.test.ts) and runs it in an embedded Postgres (crates.db.test.ts).

-- ── 1. Categories: the skins switched on (MUST match COSMETIC_CATEGORY_DEFS in cosmetics.ts) ───────────────
insert into public.cosmetic_categories (category, weight, enabled, target) values
  ('announcer', 10, false, 'global'),
  ('hero_skin', 20, true, 'hero'),
  ('minion_skin', 35, true, 'card'),
  ('title', 10, true, 'global'),
  ('hero_attack', 15, false, 'global'),
  ('board', 5, false, 'global'),
  ('music', 5, false, 'global')
on conflict (category) do update set weight = excluded.weight, enabled = excluded.enabled, target = excluded.target, updated_at = now();

-- ── 2. The catalog, the four skins added (MUST match COSMETICS in cosmetics.ts row for row) ──────────────────
-- On conflict every column is refreshed EXCEPT `active`: a retire made with the one-line switch above survives
-- any re-run of this file. New rows insert with the value below.
insert into public.cosmetic_catalog (cosmetic_id, category, rarity, acquisition_source, milestone_level, target_type, target_id, achievement_id, active) values
  ('alpha_tester', 'title', 'rare', 'level_milestone', 2, null, null, null, true),
  ('title_wanderer', 'title', 'common', 'crate', null, null, null, null, true),
  ('title_rune_reader', 'title', 'common', 'crate', null, null, null, null, true),
  ('title_coin_counter', 'title', 'common', 'crate', null, null, null, null, true),
  ('title_lantern_bearer', 'title', 'common', 'crate', null, null, null, null, true),
  ('title_hearthkeeper', 'title', 'common', 'crate', null, null, null, null, true),
  ('title_warband_captain', 'title', 'common', 'crate', null, null, null, null, true),
  ('title_board_builder', 'title', 'common', 'crate', null, null, null, null, true),
  ('title_stormcaller', 'title', 'rare', 'crate', null, null, null, null, true),
  ('title_star_chaser', 'title', 'rare', 'crate', null, null, null, null, true),
  ('title_grave_whisperer', 'title', 'rare', 'crate', null, null, null, null, true),
  ('title_ironbeard', 'title', 'rare', 'crate', null, null, null, null, true),
  ('title_spiritbound', 'title', 'rare', 'crate', null, null, null, null, true),
  ('title_kingbreaker', 'title', 'epic', 'crate', null, null, null, null, true),
  ('title_voice_of_the_deep', 'title', 'epic', 'crate', null, null, null, null, true),
  ('title_the_unbroken', 'title', 'legendary', 'crate', null, null, null, null, true),
  ('skin_blackbelt_1', 'minion_skin', 'rare', 'crate', null, 'card', 'blackbelt', null, true),
  ('skin_blackbelt_2', 'minion_skin', 'epic', 'crate', null, 'card', 'blackbelt', null, true),
  ('skin_albus_1', 'hero_skin', 'epic', 'crate', null, 'hero', 'albus', null, true),
  ('skin_warden_1', 'hero_skin', 'epic', 'crate', null, 'hero', 'warden', null, true)
on conflict (cosmetic_id) do update set
  category = excluded.category, rarity = excluded.rarity, acquisition_source = excluded.acquisition_source,
  milestone_level = excluded.milestone_level, target_type = excluded.target_type, target_id = excluded.target_id,
  achievement_id = excluded.achievement_id;

-- ── 3. The profile JSON: every owned cosmetic + the LIVE loadout ─────────────────────────────────────────
-- MUST match `ProgressionProfile` in packages/progression/src/rules.ts key for key. `titles` is unchanged (owned
-- titles, oldest first). `cosmetics` lists every owned item of any category (retired ones too: ownership is
-- never deleted; the client hides what is retired). `loadout` lists only equipped items that are still LIVE, so a
-- retired skin disappears from every profile at once and comes back, still equipped, when it is restored.
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
      where l.user_id = p.user_id and c.active and k.enabled
    ), '[]'::jsonb)
  )
  from public.profiles p where p.user_id = p_user;
$$;

-- ── 4. equip_cosmetic: wear a skin you OWN on its own target, or Default. Service role only. ─────────────
-- Checks, in order: the slot is a skin slot, the target id is well formed, the item exists in THIS slot's
-- category, is made for THIS target, is live (item active + category enabled), and is owned. A null cosmetic
-- removes the row (Default). Same per-user advisory lock as every other progression writer.
create or replace function public.equip_cosmetic(p_user uuid, p_slot text, p_target_id text, p_cosmetic_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cat public.cosmetic_catalog%rowtype;
  v_enabled boolean;
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
    select k.enabled into v_enabled from public.cosmetic_categories k where k.category = v_cat.category;
    if not v_cat.active or not coalesce(v_enabled, false) then raise exception 'not_equippable'; end if;
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

-- ── 5. Grants: every writer is service role ONLY (the Edge Function calls it) ─────────────────────────────
revoke all on function public.equip_cosmetic(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.equip_cosmetic(uuid, text, text, text) to service_role;
revoke all on function public.progression_profile_json(uuid) from public, anon, authenticated;
grant execute on function public.progression_profile_json(uuid) to service_role;

-- ── 6. Snapshot side: nothing to migrate ────────────────────────────────────────────────────────────────
-- The skins a run wore travel INSIDE the payloads the client already writes (the board snapshot jsonb, the run
-- history entry, the practice record), as an additive `cosmetics` field. Older rows have none and render default
-- art. No table, column or policy changes here.
