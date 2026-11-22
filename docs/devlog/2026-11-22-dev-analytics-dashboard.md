# 2026-11-22: private dev analytics dashboard (apps/dash)

Owner ask: a dashboard outside the game, for Kevin and Mike only, with games played, accounts active, new accounts,
and per-hero / per-tribe stats by mode and medal.

**Shape.** A new Cloudflare Pages project `ascent-dash` (`apps/dash`): a static page plus two Pages Functions. Cloudflare
Access (email allow-list) guards the whole project, and the Functions ALSO verify the Access JWT (team certs, AUD,
issuer, expiry) and an `ALLOWED_EMAILS` secret, failing closed on anything missing. They call two Supabase RPCs with
the service role key (a Cloudflare secret only) and cache answers for 60 s per isolate.

**Data.** `supabase/migrations/2026-11-27-analytics-dashboard.sql`: a private `analytics` schema plus
`public.analytics_overview` / `public.analytics_breakdown`, SECURITY DEFINER, pinned search_path, EXECUTE for
`service_role` only. "Active" = finished at least one game that day (owner definition). A finished game is a
`run_history` row, a `practice_games` row, a completed Versus match (1v1 / group / Duos / Ranked Duos) or a tutorial
settlement. Gauntlet has no per-game record, so it is not counted. Four time indexes were added (tiny at today's sizes).

**Look (owner feedback, same day: "it needs to have that in game feel").** Restyled in the Docked rail / party-home
shell look (its tokens, Outfit, gauntlet cursors, citadel backdrop) with the game's real art copied in at build time by
`apps/dash/scripts/sync-game.mts`: hero portraits in the portrait ring with real names, medal crests, mode art, tribe
glyphs and colours. Fonts come from Google Fonts like the game, so the CSP allows exactly those two hosts.

**Live + any range (owner, same day).** The overview RPC now takes from / to (null = all time) and buckets by hour /
day / week / month; the page follows the range everywhere, keeps it in the URL hash, and polls every 60 s while the
range reaches today (paused while hidden). The 92-day cap is gone; the cost at ~50k games is measured in
apps/dash/README.md (bench script apps/dash/scripts/bench-analytics.mts).

**Not applied, not deployed.** The owner applies the SQL, creates the project, sets secrets and configures Access
(apps/dash/README.md). Local work uses a made-up fixture behind `npm run dash:dev`.

**Limits to remember.** "Build" is the per-merge `0.1.0+<sha>` stamp, not a balance patch; Versus rows carry no build;
names and art come from a build-time copy of the game data, so a hero added later shows once the dashboard is rebuilt.
