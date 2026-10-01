-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ACCOUNT PROGRESSION: PORTRAIT FRAMES, equip_cosmetic accepts the account-wide `portrait_frame` slot  (2026-10-01)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-09-30-weighted-strength.sql (the last file before it).
-- Idempotent: it only REPLACES `equip_cosmetic` (and re-grants it), so re-running it is always safe; it writes no rows.
-- The same block is appended to schema.sql; keep the two identical. Owner runbook: docs/devlog/2026-10-01-portrait-frames.md.
-- It SUPERSEDES the equip_cosmetic in 2026-09-28-progression-hero-attack.sql (it keeps that file's hero attack slot):
-- if the skins or hero attack file is ever re-run, run this one again after it.
--
-- WHAT THIS IS (owner 2026-10-01: "we're adding portrait skins ... we want this to replace the default portrait png
-- when a skin is applied").
--  - The `portrait_frame` category and its 31 items arrive through the code-owned catalog sync like every other
--    cosmetic (packages/progression/src/cosmetics.ts, deploy progression-inventory). No catalog SQL: the sync inserts
--    the category row (weight 10, enabled, target global) and the items, so they join the crate pool on that deploy.
--  - A portrait frame is ACCOUNT-WIDE (category target `global`), like the hero attack: one row in
--    `cosmetic_loadouts` with target_id ''. `equip_cosmetic(user, 'portrait_frame', '', id)` wears one the caller
--    OWNS; a null id takes it off (the default ring). The skin and hero attack slots behave exactly as before.

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
  if p_slot is null or p_slot not in ('hero_skin', 'minion_skin', 'hero_attack', 'portrait_frame') then raise exception 'bad_slot'; end if;
  -- A global slot (hero attack, portrait frame) has exactly one target, ''. A skin slot names its hero or card.
  if p_slot in ('hero_attack', 'portrait_frame') then
    if p_target_id is distinct from '' then raise exception 'bad_target'; end if;
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
    if p_slot in ('hero_attack', 'portrait_frame') then
      if v_cat.target_type is not null or v_cat.target_id is not null then raise exception 'wrong_target'; end if;
    elsif v_cat.target_type is distinct from (case p_slot when 'hero_skin' then 'hero' else 'card' end)
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

revoke all on function public.equip_cosmetic(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.equip_cosmetic(uuid, text, text, text) to service_role;
