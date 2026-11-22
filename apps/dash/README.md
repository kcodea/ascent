# ASCENT Analytics (private dev dashboard)

A private page for Kevin and Mike: games finished, accounts active, new accounts, and per-hero / per-tribe / per-mode
stats. It is its own Cloudflare Pages project (`ascent-dash`), separate from the game and from the site. It never imports
game code.

```
Browser ──(Cloudflare Access login)──> Pages: static page (dist/)
                                       Pages Functions: /api/overview, /api/breakdown
                                         1. all five secrets present, else 500
                                         2. Cf-Access-Jwt-Assertion verified (team certs, AUD, issuer, expiry), else 401
                                         3. email on ALLOWED_EMAILS, else 403
                                         4. 60 s in-memory cache, else POST /rest/v1/rpc/analytics_* with the service key
Supabase: public.analytics_overview / public.analytics_breakdown (service_role only) -> one small JSON each
```

The service role key exists only as a Cloudflare secret, read by the Functions. It is never in the repo and never in
the page's JavaScript.

## Run it locally (made-up data)

- `npm run dash:dev` starts Vite at http://localhost:5190 with a FIXTURE `/api/*` (src/fixture.ts, every number
  invented; the page shows a "Sample data" badge). No database, no Access, no keys.
- `npm run dash:build` builds `apps/dash/dist`. `npm run preview -w apps/dash` serves that build with the same fixture.
- `npm run functions:build -w apps/dash` compiles the Pages Functions (a check only; no deploy, no login).

## Deploying

- `npm run dash:preview` builds and makes a preview deploy (branch `preview`).
- `npm run dash:deploy` is the production deploy. It refuses unless you also pass `--owner-approved`, which is only for
  after the owner has said go: `npm run dash:deploy -- --owner-approved`.
- Add `--dry-run` to either to print the wrangler command without building or deploying.

Both need `CLOUDFLARE_API_TOKEN` (Account, Cloudflare Pages, Edit) and `CLOUDFLARE_ACCOUNT_ID` in the environment.
The script runs wrangler from `apps/dash`, so `functions/` and `wrangler.toml` deploy with `dist/`.

## Owner setup (once, in this order)

1. **Apply the SQL.** Run `supabase/migrations/2026-11-27-analytics-dashboard.sql` (Supabase SQL editor, or
   `supabase db query --linked -f <file>`). It is additive and idempotent: a private `analytics` schema, two
   `public.analytics_*` functions executable by `service_role` only, and four small time indexes. Check it with
   `select public.analytics_overview(30, 'UTC');` as the database admin.
2. **Create the Pages project** with `main` as its production branch:
   `npx wrangler pages project create ascent-dash --production-branch main`.
3. **Cloudflare Access** (Zero Trust dashboard):
   - Access > Applications > Add > Self-hosted. Domain: `ascent-dash.pages.dev` (and any custom domain you add).
     Policy: Allow, Include > Emails: Kevin's and Mike's addresses. Nothing else (not "Everyone", not a domain rule).
   - On the Pages project: Settings > General > Access policy > Enable, so the `*.ascent-dash.pages.dev` preview
     URLs are covered too (it creates a second Access application).
   - Copy each application's **Application Audience (AUD) Tag** (Application > Overview).
   - Note your team domain (Zero Trust > Settings > Custom Pages: `<team>.cloudflareaccess.com`).
4. **Set the secrets** on the Pages project (production. Previews get none unless you add them under Pages > Settings >
   Variables and Secrets > Preview, so a preview deploy shows the page but its data endpoint answers "not configured"):
   ```
   cd apps/dash
   npx wrangler pages secret put SUPABASE_URL --project-name ascent-dash               # https://<ref>.supabase.co
   npx wrangler pages secret put SUPABASE_SERVICE_ROLE_KEY --project-name ascent-dash  # Supabase > Settings > API keys
   npx wrangler pages secret put ACCESS_TEAM_DOMAIN --project-name ascent-dash         # <team>.cloudflareaccess.com
   npx wrangler pages secret put ACCESS_AUD --project-name ascent-dash                 # AUD tag(s), comma separated
   npx wrangler pages secret put ALLOWED_EMAILS --project-name ascent-dash             # kevin@..., mike@...
   ```
   Any missing secret makes the data endpoint answer 500 "not configured" and read nothing.
5. **Deploy**: `npm run dash:deploy -- --owner-approved`, open `https://ascent-dash.pages.dev`, sign in through Access.
6. **Check it fails closed**: `curl -i https://ascent-dash.pages.dev/api/overview` must not return data (Access
   redirects it; with Access off it would be a 401 from the Function).

## What the numbers mean

- **A finished game**: a Career row (`run_history`; mode `lobby` is ranked, or unrated when the entry has `unrated`),
  a `practice_games` row, a completed `versus_matches` (1v1) or `versus_group_matches` (group, Versus Duos, Ranked
  Duos; dev-forced test matches skipped), or a tutorial XP settlement (`progression_results` mode `tutorial`).
  A 1v1 is one game; its two players are two hero picks.
- **Accounts active**: distinct accounts with a finished game that day (viewer's time zone).
- **New accounts**: `auth.users` rows created that day, email vs guest. **First game**: accounts whose first finished
  game ever was that day.
- **Heroes**: pick share = the hero's share of hero picks in the mode (and medal); top half = Top 4 of 8, the win of a
  1v1, Top 2 of 4. "Picked when offered" uses lobby `run_telemetry.hero_offer`.
- **Medal**: the division held going into the game (`rank_results.division_before` by seed, else the rank stamped on
  the Career entry). Ranked lobby only.
- **Tribes**: "in run" = `entry.tribes` (lobby) or `final_board.tribes` (practice); "final board" =
  `entry.dominantTribe` (lobby only).
- **Build** = the client's `0.1.0+<sha>` stamp, a new one per merge. Versus and the tutorial carry none.
- Not counted: Gauntlet games (only first clears are stored), Versus test bots, and the Claudebot test accounts.
