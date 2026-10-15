-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- EMOTES: keep the three former starters for every EXISTING account  (2026-10-15, OPTIONAL, data only)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Owner 2026-10-15: "remove all emotes as 'given' and put them in various loot tiers between rare and legendary".
-- From the progression-inventory deploy on, Flirty Midas, Nervous Jensen and Zen Brian are CRATE items: a player needs
-- an ownership row to see or equip them. Until now every player had them (starters were owned with no row), so without
-- this file every existing player loses all three at once.
--
-- THIS FILE KEEPS THEM ("grandfathered"): every account that exists when it runs gets an ownership row for each of the
-- three (source 'starter_grandfather'), already marked SEEN (they are not new to anyone), and its progression revision
-- moves so a signed-in client re-reads its profile. Angry Mushy is NOT granted (retired the same day).
-- Accounts created after this runs own nothing until a crate gives it. Skipping the file is the other option: everyone
-- starts with no emotes and finds them in crates like a new player.
--
-- WHEN: paste into the Supabase SQL Editor and Run BEFORE the web client from this PR goes live (that client only shows
-- OWNED emotes in the menu), and before or right after the progression-inventory deploy. Not part of schema.sql (a
-- one-off backfill, like 2026-10-12-games-played-backfill.sql). Writes no schema.
--
-- IDEMPOTENT: `on conflict do nothing`, and the revision moves only for accounts that actually gained a row, so a
-- re-run changes nothing.
--
-- A NARROWER variant (only accounts that had placed an emote in their menu) is the commented `where` below; the
-- default keeps them for every account, since every account had all three in its menu by default.

with granted as (
  insert into public.player_cosmetics (user_id, cosmetic_id, source, seen_at)
    select p.user_id, e.cosmetic_id, 'starter_grandfather', now()
    from public.profiles p
    cross join (values ('emote_flirty_midas'), ('emote_nervous_jensen'), ('emote_zen_brian')) as e(cosmetic_id)
    where exists (select 1 from public.cosmetic_catalog c where c.cosmetic_id = e.cosmetic_id)
    -- and exists (select 1 from public.cosmetic_loadouts l where l.user_id = p.user_id and l.slot = 'emote')
  on conflict (user_id, cosmetic_id) do nothing
  returning user_id
)
update public.profiles set progression_revision = progression_revision + 1, updated_at = now()
  where user_id in (select distinct user_id from granted);
