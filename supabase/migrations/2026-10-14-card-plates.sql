-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ACCOUNT PROGRESSION: CARD PLATES, equip_cosmetic accepts the account-wide `card_plate` slot  (2026-10-14)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-10-13-emotes.sql. Then deploy `progression-inventory`.
-- Idempotent: it only REPLACES `equip_cosmetic` (and re-grants it), so re-running it is always safe; it writes no rows.
-- The same block is appended to schema.sql; keep the two identical. Owner runbook: docs/devlog/2026-10-14-card-plates.md.
-- It SUPERSEDES the equip_cosmetic in 2026-10-13-emotes.sql (it keeps every slot that file has, the emote positions and
-- the starter rule included): if that file, or any older equip_cosmetic file, is ever re-run, run this one again after it.
--
-- WHAT THIS IS (owner 2026-10-14: "Turn Aquarium Rocks into a real equippable card plate cosmetic, with its own
-- darkening settings, and leave the standard plates untouched"; a crate drop; "replace all plates, but we ALWAYS will
-- have the gilded cards be the existing original card plate hued gold"; "Others see it too").
--  - The `card_plate` category and its first item, `plate_aquarium_rocks` (Legendary), arrive through the code-owned
--    catalog sync (packages/progression/src/cosmetics.ts, deploy progression-inventory); the item joins the crate pool
--    on that deploy. No catalog SQL.
--  - A card plate is ACCOUNT-WIDE (category target `global`), like the portrait frame: one row in
--    `cosmetic_loadouts` with target_id ''. `equip_cosmetic(user, 'card_plate', '', id)` wears one the caller OWNS;
--    a null id takes it off (the standard plates). Every other slot behaves exactly as before.
--  - THE RECORDED PLATE NEEDS NO SQL. It rides the run's cosmetic snapshot (`cardPlate`) inside the BoardSnapshot,
--    stored and served verbatim like the portrait frame. An older client ignores the key.

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
  if p_slot is null or p_slot not in ('hero_skin', 'minion_skin', 'hero_attack', 'portrait_frame', 'announcer', 'emote', 'card_plate') then raise exception 'bad_slot'; end if;
  -- A global slot (hero attack, portrait frame, announcer, card plate) has exactly one target, ''. The emote slot's target is the
  -- menu position '0'..'3'. A skin slot names its hero or card.
  if p_slot in ('hero_attack', 'portrait_frame', 'announcer', 'card_plate') then
    if p_target_id is distinct from '' then raise exception 'bad_target'; end if;
  elsif p_slot = 'emote' then
    if p_target_id is null or p_target_id !~ '^[0-3]$' then raise exception 'bad_target'; end if;
  elsif p_target_id is null or p_target_id !~ '^[A-Za-z0-9_.:-]{1,64}$' then
    raise exception 'bad_target';
  end if;
  if p_cosmetic_id is not null and p_cosmetic_id !~ '^[a-z0-9_]{1,64}$' then raise exception 'bad_cosmetic_id'; end if;
  perform pg_advisory_xact_lock(hashtextextended('progression:' || p_user::text, 0));

  if p_cosmetic_id is null then
    delete from public.cosmetic_loadouts where user_id = p_user and slot = p_slot and target_id = p_target_id;
  else
    select * into v_cat from public.cosmetic_catalog where cosmetic_id = p_cosmetic_id;
    if not found then raise exception 'bad_cosmetic_id'; end if;
    if v_cat.category <> p_slot then raise exception 'wrong_target'; end if;
    if p_slot in ('hero_attack', 'portrait_frame', 'announcer', 'card_plate') then
      if v_cat.target_type is not null or v_cat.target_id is not null then raise exception 'wrong_target'; end if;
    elsif p_slot = 'emote' then
      if v_cat.target_type is not null or v_cat.target_id is not null then raise exception 'wrong_target'; end if;
    elsif v_cat.target_type is distinct from (case p_slot when 'hero_skin' then 'hero' else 'card' end)
       or v_cat.target_id is distinct from p_target_id then
      raise exception 'wrong_target';
    end if;
    select k.enabled and not k.admin_off into v_live from public.cosmetic_categories k where k.category = v_cat.category;
    if not v_cat.active or v_cat.admin_off or not coalesce(v_live, false) then raise exception 'not_equippable'; end if;
    -- A starter item is everyone's: no ownership row is needed (or ever written).
    if v_cat.acquisition_source <> 'starter'
       and not exists (select 1 from public.player_cosmetics o where o.user_id = p_user and o.cosmetic_id = p_cosmetic_id) then
      raise exception 'not_owned';
    end if;
    -- An emote MOVES: it leaves any other menu position it held, so the menu never shows one emote twice.
    if p_slot = 'emote' then
      delete from public.cosmetic_loadouts
        where user_id = p_user and slot = 'emote' and cosmetic_id = p_cosmetic_id and target_id <> p_target_id;
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

revoke all on function public.equip_cosmetic(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.equip_cosmetic(uuid, text, text, text) to service_role;
