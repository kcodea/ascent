-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- CATALOG STATE HASH  (Supabase cleanup P1.2, 2026-10-28; additive, safe to re-run)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Every client used to read the whole `cosmetic_catalog` (458 rows, 33.8 KB) plus `cosmetic_categories` on every
-- auth event, to learn which items / categories are switched off (the kill switch). The answer changes a few
-- times a month. This adds `progression_config.catalog_state_hash`: the md5 of exactly the kill-switch columns,
-- kept current by statement-level triggers on both tables (the code sync `sync_cosmetic_catalog` AND the owner's
-- manual `admin_off` updates both go through them). The client reads it with the one `progression_config` row it
-- already reads, and fetches the catalog only when the hash differs from the one its cached answer was read under.
--
-- `catalog_hash` (the code catalog's content hash, written by `sync_cosmetic_catalog`) is NOT reused: it does not
-- move when the owner flips `admin_off` by hand.
--
-- A client from before this file ignores the column; a client after it, against a server without it, reads the
-- catalog as before (no hash = no skip).
--
-- ROLLBACK:
--   drop trigger if exists cosmetic_catalog_state_hash on public.cosmetic_catalog;
--   drop trigger if exists cosmetic_categories_state_hash on public.cosmetic_categories;
--   drop function if exists public.cosmetic_catalog_state_hash_refresh();
--   alter table public.progression_config drop column if exists catalog_state_hash;

alter table public.progression_config add column if not exists catalog_state_hash text;

create or replace function public.cosmetic_catalog_state_hash_refresh()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.progression_config
     set catalog_state_hash = md5(
           coalesce((select string_agg(cosmetic_id || ':' || active::text || ':' || admin_off::text, ',' order by cosmetic_id)
                       from public.cosmetic_catalog), '')
           || '|' ||
           coalesce((select string_agg(category || ':' || enabled::text || ':' || admin_off::text, ',' order by category)
                       from public.cosmetic_categories), ''))
   where id = 1;
  return null;
end;
$$;

revoke all on function public.cosmetic_catalog_state_hash_refresh() from public, anon, authenticated;

drop trigger if exists cosmetic_catalog_state_hash on public.cosmetic_catalog;
create trigger cosmetic_catalog_state_hash
  after insert or update or delete or truncate on public.cosmetic_catalog
  for each statement execute function public.cosmetic_catalog_state_hash_refresh();

drop trigger if exists cosmetic_categories_state_hash on public.cosmetic_categories;
create trigger cosmetic_categories_state_hash
  after insert or update or delete or truncate on public.cosmetic_categories
  for each statement execute function public.cosmetic_catalog_state_hash_refresh();

-- Backfill: compute the hash for the current rows (a no-op update fires the statement trigger once).
update public.cosmetic_categories set category = category where false;
