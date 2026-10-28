# 2026-10-28 · Empty anonymous user purge tools (cleanup Phase 4.3)

Owner ruling 2026-10-28: "yes, purge empty ones". `supabase/migrations/2026-11-07-anon-user-purge.sql` adds a closed
`maint` schema with `anon_purge_report()` (dry run), `anon_purge_candidates()` and `anon_purge_batch(phrase, idle,
limit)`, plus `maint.anon_purge_log`. Applying it deletes nothing.

A candidate is anonymous (no email, no pending email change, no phone, no identity), owns nothing (its id is in no
uuid / uuid[] column of any `public` or `storage` table, found from the catalog at run time, and in no uuid-shaped text
inside the jsonb/text columns of public tables under 32 MB, e.g. `duo_runs.members`), and idle (sign-in, update,
session refresh and refresh-token use all older than 30 days by default, minimum 7). A false match can only keep a user.

Production dry run 2026-10-28 (read-only, the same scan as a static SELECT): 2,534 auth users; 5 email accounts; 2,529
anonymous; 236 anonymous owning data (kept); 2,293 owning nothing, of which 1,292 were active in the last 30 days
(kept) and **1,001 are candidates** (2,087 at a 7-day window, 0 at 90 days).
