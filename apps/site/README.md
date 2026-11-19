# ASCENT site

The static landing page for ASCENT. Plain HTML, CSS and a little TypeScript, built with Vite. It never imports game
code; art is copied in, not imported.

## Run and build

From the repo root:

- `npm run dev -w apps/site` starts the dev server (copies the art first).
- `npm run build -w apps/site` makes the production build in `apps/site/dist`.
- `npm run sync-art -w apps/site` copies the art from the game's own folders into the site.
- `npm run capture -w apps/site -- <slot>...` (or `all`) re-records captures from the game. See Captures below.

## Deploying

The site deploys to the Cloudflare Pages project `ascent-site`. This is separate from Ship Ascent, which ships the
desktop app.

- `npm run site:preview` builds the site and makes a preview deploy (branch `preview`). It may be run freely.
- `npm run site:deploy` is the production deploy. Run it only after Mike has explicitly said go for that deploy. The
  script refuses unless you also pass `--owner-approved`, which is only for after he has said so:
  `npm run site:deploy -- --owner-approved`.
- Add `--dry-run` to either one (for example `npm run site:preview -- --dry-run`) to print the wrangler command it
  would run. It does not build, does not need credentials, and does not deploy.

Both need two environment variables set: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The token needs the
Account, Cloudflare Pages, Edit permission. If either variable is missing the script stops with exit code 2 and names
it.

Cloudflare Web Analytics needs no code. Turn it on with one toggle on the Pages project in the Cloudflare dashboard.

## Before the first production deploy

None of these are done yet. Tick every one before the first `site:deploy`:

- [x] Real captures are recorded and every placeholder still in `public/captures` (and `public/share.jpg`) is
      replaced. See the Captures section below.
- [ ] `og:image` in `index.html` is an absolute URL on the production address, and an `og:url` meta and a
      `<link rel="canonical">` are added with that same address. Update the share metadata test in
      `src/site.test.ts` to match (it pins `og:image` to `/share.jpg` today).
- [ ] Cloudflare Web Analytics is switched on (the one toggle on the Pages project).
- [ ] The Pages project `ascent-site` exists with `main` as its production branch (create it with
      `--production-branch main`). Without that, `site:deploy` only makes another preview.
- [ ] Mike has explicitly said go for this production deploy.

## Captures

Each capture slot is a still poster (`public/captures/<slot>.jpg`) that shows first. If a clip exists for the slot, the
visitor allows motion, and the clip actually plays, it replaces the poster. Otherwise the poster stays. To add a
clip, drop `<slot>.webm` and `<slot>.mp4` in `public/captures` and add the slot to `CLIPS` in `src/captures.ts`.

The captures are recorded by `scripts/capture.mjs` (one routine per slot in `scripts/captureRoutines.mjs`). It starts
the game's dev server itself with no backend, blocks the browser from everything but this machine, plays a fresh
guest Practice game to each moment, records the screen, and writes the poster, webm and mp4. It also writes
`public/share.jpg` when it records `ancient-select`. It needs Chrome (set `CHROME_PATH` if it is not in the default
place). Watch every re-recorded clip once before committing it.

`career-chart` is the one exception to "a real guest game": a guest has no match history, so its routine
(`scripts/captureCareer.mjs`) fills the Career page with made-up games (invented ratings, dates and placements;
boards and runes from real bot-played games of the live set). It needs a dead local backend address to render:
`CAPTURE_BACKEND=http://127.0.0.1:9 CAPTURE_BACKEND_KEY=capture npm run capture -w apps/site -- career-chart`.
Record it on its own, not with `all`.

Clip rules:

- 4 to 8 seconds, and it loops cleanly.
- Cropped to the subject, not the whole screen.
- Two files: webm (VP9) and mp4 (H.264, faststart).
- No audio.
- At most 1280px wide and 1.5 MB per file.
- The poster is the clip's clearest moment (it is all a visitor with reduced motion sees).

After a UI change, re-record the affected slots from this table.

| Slot | What it must show |
| --- | --- |
| `gold-fuse` | The Gold Fuse filling as Gold is spent, then the timer starting. |
| `runeforge` | A four-rune offer and one being bought. |
| `ancient-select` | The three-of-six Ancient Discover and a pick. |
| `career-chart` | The Career chart with a game pinned, its board and runes showing. |
| `chest-opening` | A chest opening through to the reward. |

Mode stills (one still each, 640x360, no clip):

| Still | What it must show |
| --- | --- |
| `mode-versus` | One representative Versus screen. |
| `mode-duos` | One representative Duos screen. |
| `mode-gauntlet` | One representative Gauntlet screen. |
