-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- profiles.avatar READABLE BY THE CLIENT ROLES (2026-10-26, DRAFT from perf/supabase-egress-audit; NOT APPLIED)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 2026-09-29-hide-profile-email.sql replaced the table-wide SELECT on profiles with a column list and warned that a
-- NEW column is unreadable until it joins the grant. 2026-10-16-profile-avatar.sql then added `avatar` without a
-- grant, so every client read that names it fails with 42501 "permission denied for table profiles" (the live
-- Postgres log, 2026-10-25), and the client silently falls back to a second read without it:
--   - versusSeatCard.fetchProfiles   (every Versus room seat-card refresh: 2 reads instead of 1, plus the error)
--   - remoteBoards leaderboard read  (every Leaderboard open: up to 2 extra reads)
--   - remoteBoards.backfillProfileAvatar (once per session)
-- So other players' chosen avatars have never shown from the server, and each of those paths costs an error and an
-- extra round trip. `avatar` is a public portrait id (<= 64 chars, CHECK profiles_avatar_len), meant for every viewer.
-- `email` stays hidden. Idempotent.

grant select (avatar) on public.profiles to anon, authenticated;
