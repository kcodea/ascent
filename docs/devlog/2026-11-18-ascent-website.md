# 2026-11-18 - ASCENT landing page (`apps/site`)

## What shipped

A new static landing page for ASCENT, in its own workspace at `apps/site`. Plain HTML, CSS and a little TypeScript,
built with Vite. It never imports game code; art is copied in from the game's own folders by `npm run sync-art`
(it runs before dev and build), so the page only ever shows things a player can already see in the live game.

- **Structure and look.** One page that walks through the game in a set order, using Outfit for titles and Nunito Sans
  for body text, the design tokens plus the title-screen night palette, and the gauntlet cursor on desktop.
- **Platform-aware download.** The download button picks the right label for the visitor's platform and points at the
  latest installer (`releases/latest/download/ASCENT-Setup.exe`). Visitors who cannot run the Windows build see an
  honest note instead. The copy-link fallback covers a missing clipboard.
- **Capture slots.** Each feature has a slot with a still poster that shows first. A clip replaces the poster only when
  one exists, the visitor allows motion, and it actually plays. Today every slot holds a generated placeholder still.
- **CI gate.** The site is covered by `typecheck:site`, lint and the vitest suites under `apps/site`, including a
  boundary test that scans every script, style, HTML and SVG file to prove the site imports nothing from `packages/**`.
- **Deploy script.** `npm run site:preview` and `npm run site:deploy` run `scripts/site-deploy.mjs`, which builds the
  site and pushes `apps/site/dist` to the Cloudflare Pages project `ascent-site`. The plan (branch and wrangler
  arguments) is a pure function in `apps/site/scripts/deployPlan.mjs`, tested in `apps/site/src/deployPlan.test.ts`.
  `--dry-run` prints the command without building or deploying.

## Owner decisions

- **Story order:** the async pitch first, then Runeforge, Ancients, tracking, cosmetics, and the other modes last.
- **Captures over live components.** The page shows recorded captures rather than embedding live game components.
- **The site stays separate from Ship Ascent.** Desktop releases still go only through `npm run ship`; the site has its
  own deploy script and its own Cloudflare Pages project.
- **Production deploys only on Mike's explicit go.** `site:deploy` refuses without `--owner-approved`, and that flag is
  for after he has said go for that specific deploy. Preview deploys are free to run.
- **Cosmetics promise:** the page says cosmetics are "free to earn and unlock, always".

## Not done

- **Real captures.** Every slot still shows a placeholder still. Recording the real clips (see the table in
  `apps/site/README.md`) is a follow-up.
- **No domain yet.** `og:image` is still a relative path, so share cards will not show an image until an address is
  chosen and the tag can point at an absolute URL.
- **Web Analytics.** Needs the one dashboard toggle on the Pages project; nothing in the repo does it.
