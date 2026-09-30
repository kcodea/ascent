-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- HIDE profiles.email FROM THE CLIENT ROLES  (2026-09-29, run by the owner the same day)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- `profiles.email` is a denormalised copy of the auth email (accounts C2). The public "read profiles" policy made
-- every column readable to `anon`, so the anon key could read any player's email (found while investigating
-- the opponent pool). No client query reads it back: the client only WRITES it (uploadPlayerProfile). So the
-- table-wide SELECT becomes a column list without `email`. Writes are unaffected (UPDATE/INSERT grants are
-- untouched, and the RLS update check reads only rating / rank_* columns). The service role (Edge Functions)
-- is unaffected.
--
-- ⚠️ A NEW column added to public.profiles is NOT readable by the client until it is added to this grant.
revoke select on public.profiles from anon, authenticated;
grant select (
  user_id, author, discriminator, rating, season2_rating, games_played, favorite_hero, patch, updated_at,
  account_level, account_xp, equipped_title_id, progression_curve_version, progression_enrolled_at,
  progression_revision, rank_demotion_ready, rank_division, rank_highest_division, rank_highest_points,
  rank_points, rank_revision, rank_rules_version, rank_season
) on public.profiles to anon, authenticated;
