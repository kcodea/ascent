-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ACCOUNT PROGRESSION: EMOTES, the `starter` acquisition and the four-position `emote` equip slot  (2026-10-13)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-10-11-announcer-slot.sql, and BEFORE the next deploy of
-- `progression-inventory` (that deploy syncs the four starter emotes, whose acquisition `starter` the old check on
-- cosmetic_catalog refuses: deployed first, the catalog sync fails and retries every minute until this runs, so no new
-- cosmetic reaches the database in between). Idempotent: it re-creates one check and REPLACES `equip_cosmetic` (and
-- re-grants it); it writes no rows. The same block is appended to schema.sql; keep the two identical. Owner runbook:
-- docs/devlog/2026-10-13-emotes.md. It SUPERSEDES the equip_cosmetic in 2026-10-11-announcer-slot.sql (it keeps every
-- slot that file has): if that file, or any older equip_cosmetic file, is ever re-run, run this one again after it.
--
-- WHAT THIS IS (owner 2026-10-13: "Emotes are a new COSMETIC type in Collections ... Players equip up to 4 in
-- Collections. Unlock source: crates, plus starter emotes everyone owns").
--  - The `emote` category and its four starter items (Angry Mushy, Flirty Midas, Nervous Jensen, Zen Brian) arrive
--    through the code-owned catalog sync (packages/progression/src/cosmetics.ts, deploy progression-inventory). No
--    catalog SQL. A STARTER item (acquisition_source 'starter') is owned by EVERY player without an ownership row, so
--    it never drops from a crate (the pool only reads 'crate' items) and no backfill is needed. A crate emote, when one
--    is added, drops like any other item: the data path is the existing one.
--  - The `emote` slot holds FOUR emotes, one cosmetic_loadouts row per menu position: target_id '0'..'3'.
--    `equip_cosmetic(user, 'emote', '<position>', id)` puts an owned (or starter) live emote at that position; the same
--    emote leaves any other position it held (a MOVE, so one emote never shows twice). A null id clears the position
--    (the client then shows the starter emote for it). Every other slot behaves exactly as before.
--  - THE RECORDED EMOTES NEED NO SQL. A run's used emotes ride each round's board as `emotes` inside the BoardSnapshot,
--    which `public.boards.snapshot` (jsonb) stores verbatim and `pool_runs_sample` serves verbatim. An older client
--    ignores the key; a board without it has no emotes.

-- ── 1. The starter acquisition ───────────────────────────────────────────────────────────────────────────────
-- The crates file named the check inline, so its name is Postgres's default; drop whichever acquisition check exists
-- and add the widened one under a fixed name (the Ancient rarity file's pattern).
do $$
declare v_name text;
begin
  for v_name in
    select con.conname from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
      where nsp.nspname = 'public' and rel.relname = 'cosmetic_catalog' and con.contype = 'c'
        and pg_get_constraintdef(con.oid) ilike '%acquisition_source = ANY%'
  loop
    execute format('alter table public.cosmetic_catalog drop constraint %I', v_name);
  end loop;
end;
$$;
alter table public.cosmetic_catalog add constraint cosmetic_catalog_acquisition_source_check
  check (acquisition_source in ('crate', 'level_milestone', 'achievement', 'event', 'starter'));

-- ── 2. equip_cosmetic: the emote slot (target = menu position), starters count as owned ─────────────────────
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
  if p_slot is null or p_slot not in ('hero_skin', 'minion_skin', 'hero_attack', 'portrait_frame', 'announcer', 'emote') then raise exception 'bad_slot'; end if;
  -- A global slot (hero attack, portrait frame, announcer) has exactly one target, ''. The emote slot's target is the
  -- menu position '0'..'3'. A skin slot names its hero or card.
  if p_slot in ('hero_attack', 'portrait_frame', 'announcer') then
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
    if p_slot in ('hero_attack', 'portrait_frame', 'announcer') then
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
