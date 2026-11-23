-- Dev dashboard: leave nameless guest accounts out of every analytics count (owner report 2026-11-23).
--
-- "New players 15" and "50 ranked players this season" were wrong: 44 of those accounts were anonymous sign-ins that
-- never picked a handle, made by our own headless Versus / ranked test runs (created 2026-09-03 .. 2026-11-17). They are
-- not real players, but they are not Claudebots (no handle) and not registered Versus test bots, so the old filter kept
-- them. Every real player in the window has a handle; a guest who names themselves (any handle) is still counted.
--
-- Only analytics.excluded_users() changes. Every analytics read already filters through it, so the tiles, the ladder,
-- retention, social, progression, health and balance reads all drop these accounts at once. Nothing in the game reads
-- this schema. Reversible: re-apply the definition from 2026-11-27-analytics-dashboard.sql.

create or replace function analytics.excluded_users()
returns table (user_id uuid) language sql stable set search_path = public, pg_temp as $$
  select b.bot_user from public.versus_test_bots b
  union
  select p.user_id from public.profiles p where p.user_id is not null and p.author ilike 'claudebot%'
  union
  select u.id from auth.users u
  where u.is_anonymous
    and not exists (select 1 from public.profiles p where p.user_id = u.id and p.author is not null)
$$;

revoke all on function analytics.excluded_users() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on function analytics.excluded_users() from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on function analytics.excluded_users() from authenticated'; end if;
end $$;
