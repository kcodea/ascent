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

## Moderation (the second tab)

`Analytics | Moderation` in the nav (`#view=moderation` in the URL; the tab shows the count of open items). Owner ask
2026-11-22: "build the reporting dash and account name and party name flags" (R-NAME-FILTER-01).

```
GET  /api/moderation/queue   ?reports=open|reviewed|all&names=open|done|all[&fresh=1] -> moderation_queue
GET  /api/moderation/search  ?q=<name, Name#1234 or an id>                          -> moderation_search
POST /api/moderation/action  { action: review | clear | reset, ... }                -> moderation_review_report /
                                                                                       moderation_clear_flag /
                                                                                       moderation_reset_name
```

- Same guard as the analytics routes (secrets, Access JWT, ALLOWED_EMAILS; fail closed). A POST must also be same-origin
  (`Origin`, and `Sec-Fetch-Site` when sent), `application/json`, and carry `x-dash-action: 1`. The actor written to the
  log is always the verified Access email, never anything in the body.
- Reads use the 60 s cache; every action drops the cached moderation reads and the page re-reads with `fresh=1`.
- **DM reports**: newest first, with the reporter, the reported player, how often that player was reported, and the
  messages around the reported one, copied at report time (messages are pruned after a day; reports keep 180 days).
  Mark reviewed (optional note) or Reset sender name.
- **Names**: the flags written by the name filter (`packages/sim/src/nameFilter.ts`, mirrored as
  `moderation.name_verdict`): account names (`profiles.author`), Duos team names (`duos_teams.name`) and Versus room
  names (reported by the room Worker). A search finds any account or team. Looks fine closes a flag; Reset name (with
  a confirm step in the card) sets an account to `Player` (tag kept unless taken) or clears a team name, and the old
  name cannot be taken back. A room cannot be reset (it lives only in the Cloudflare room).
- **Log**: every action, who, when, before and after (`moderation.log`).
- SQL: `supabase/migrations/2026-11-28-moderation.sql` (owner applies it, like the analytics one). Until it is applied
  the Moderation tab answers "The database did not answer".

## The look and the art

The page wears the game's own menu style: the Docked rail / party-home shell tokens (`packages/ui/src/partyHome/shell/shell.css`,
`partyHome/kit/kit.css`, `uiTheme.css`), the Outfit face the menus use, and the gauntlet cursors. The art is the game's,
copied in at build time by `scripts/sync-game.mts` (run by `predev` / `prebuild`, output gitignored), resized but never
re-toned:

| On the page | From |
|---|---|
| Hero portraits + real names | `packages/ui/src/art/heroes/<id>.webp` (128 px), `HEROES` in `@game/sim` |
| Portrait ring | `packages/ui/src/hero-select/heroportrait.png` (the `.portring` recipe) |
| Medal crests | `packages/ui/src/art/ranks/<medal>.webp` (128 px) |
| Mode rows | `packages/ui/src/art/modes/{lobby,practice,versus,learn}.webp` (480 px) |
| Tribe glyphs, names, colours | `Icon.tsx` via `gauntlet/tribeIcon.ts`, `TRIBE_LABEL` (careerData.ts), `--t-<tribe>` (styles.css) |
| Backdrop, plate grain, brand mark | `apps/web/public/backdrops/citadel-blur.webp`, `partyHome/ornaments/vellum.webp`, `ascenticon.png` |
| Live set (fixture ids, set line) | `activeSet()` in `@game/content`, `playableHeroes` in `@game/sim` |

The page has no runtime import of game code; it reads the generated `/game-data.json` and `/game.css`.

## Ranges, live updates and what a range costs

- **Any range.** Presets Today, Yesterday, 7 / 30 / 90 days, All time, or free From / To. Everything on the page (tiles,
  both charts, the detail tables) follows it. The range and build sit in the URL hash (`#range=today`,
  `#from=2026-11-01&to=2026-11-22&build=0.1.0+abc`), so a link opens the same view.
- **Chart buckets** follow the span: one day by HOUR (in the viewer's time zone; today stops at the current hour), up
  to 92 days by day, up to two years by week, longer by month. A chart never has more than ~120 bars.
- **Live.** While the range reaches today the page re-reads every 60 s (the same as the server cache, never faster),
  stops while the tab is hidden, and reads once when it comes back. The nav shows a Live chip and "Updated Xs ago".
  Past-only ranges never poll. A live range is compared with the period before *up to the same point* (today so far vs
  yesterday so far).
- **No span cap (decision).** Every source is read by a time-index range scan (`run_history_created_at` etc.; the plan
  is a Bitmap Index Scan, see the bench output) and only aggregates go back, so a long range costs rows scanned, not
  payload. Measured with `npx tsx apps/dash/scripts/bench-analytics.mts 50000` (PGlite, single-threaded WASM, so an
  upper bound; ~50k finished games over a year, Career rows carrying a ~3 KB entry, run_history 19 MB):

  | Range | overview | breakdown | payload |
  |---|---:|---:|---:|
  | today | 32 ms | 20 ms | 3 + 15 kB |
  | 7 days | 39 ms | 44 ms | 2 + 17 kB |
  | 30 days | 56 ms | 134 ms | 6 + 17 kB |
  | 365 days | 273 ms | 1.5 s | 11 + 17 kB |
  | all time | 286 ms | 1.5 s | 11 + 17 kB |

  The slow part of a year-long breakdown is reading every Career entry (tribes, medal); today's data is a few thousand
  rows, so that is far off. With the 60 s cache, a page left open on "All time" costs at most one such read a minute.
  If the tables ever grow past ~10x this, the next step is a nightly per-day rollup table, not a cap.

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
   `select public.analytics_overview(current_date - 6, null, 'UTC');` as the database admin.
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
