# Desktop app that updates itself — design

Date: 2026-11-04 · Owner: Mike · Status: draft for owner approval

## Why

Today a new build reaches friends as a zip (`npm run release:desktop` → itch zip) or a Netlify upload
(`npm run release:web`). Every update means someone downloads, unzips and replaces files by hand. The owner wants
friends to **install Ascent once and never touch a zip again**: when we ship, their copy updates itself and tells
them what changed. Netlify goes away entirely. Steam is the long-term home, but we start on **GitHub Releases**
(owner decision 2026-11-04) because it needs no Valve signup and most of the work carries over to Steam later.

## Goals

1. **Install once.** Friends get a normal Windows installer (Start-menu + desktop shortcut, uninstaller). After that
   they never download Ascent by hand again.
2. **Updates install themselves** (owner, 2026-11-04: *"i want it to install on its own, but it should signal to
   the player that its installing a new update when doing so"*). No "do you want to update?" prompt.
3. **The player always knows.** While an update installs, the player sees a clear "Installing update vX…" screen.
   On the first launch of a new version, the title screen shows "Updated to vX" and that version's patch notes.
4. **Ships only on "Ship Ascent".** Merges to `main` never reach friends on their own. A release happens only when
   Mike or Kevin tells Claude the exact phrase **"Ship Ascent"** (owner, 2026-11-04).
5. **Online play works in the desktop app.** Versus, the friends hub (DMs, presence, Live Games) and accounts all
   work from the installed app, so Netlify is no longer needed by anyone.

## Non-goals

- Steam (later, its own project; see "Moving to Steam later").
- Code signing (later). Friends click through one SmartScreen "unknown publisher" warning on first install only.
- macOS / Linux builds. Windows only.
- Deleting the web BUILD. `npm run build:web` stays (CI gate, dev server, tools, the Electron app bundles it).
  We only stop *publishing* it to Netlify.
- A separate launcher window. The launcher's jobs (update, patch notes) live in the game's own boot + title screen.

## Anti-goals (would make this a failure even if it technically works)

- An update that interrupts a match. Installs happen only at launch, never mid-game.
- A broken release that strands friends (a bad build that won't boot and can't update itself out).
- A release that is not exactly `origin/main` at a known commit, or a Versus Worker that doesn't match the build.
- Desktop gameplay changes. The game inside the shell must look and play exactly as it does now.

## How it works (player side)

1. **First install:** a friend downloads `ASCENT-Setup-<version>.exe` from the GitHub Release page link we send,
   clicks through SmartScreen once, and installs. Settings live in `%APPDATA%\ASCENT` (unchanged from today's exe),
   so anyone moving from the zip build keeps their local settings.
2. **While playing:** shortly after launch the shell checks GitHub Releases for a newer version and, if there is
   one, downloads it quietly in the background. *(My call:)* when the download finishes, a small non-blocking
   notice says "Update vX downloaded, it will install next time you start Ascent". No button is required. A
   "Restart now" button on it is optional, and the builder may include it if it's cheap.
3. **Next launch:** if a downloaded update is waiting, the shell shows a full-window **"Installing update vX…"**
   screen (game logo, version, progress/spinner) *before* the game loads, installs silently, and relaunches into
   the new version. This is the signal the owner asked for.
4. **First boot of the new version:** the title screen shows an "Updated to vX" panel with the patch notes for
   everything shipped since the version they had before. Dismissing it marks it seen.
5. **Offline or GitHub unreachable:** the game starts normally; the check is silent and retried next launch.

*(My call:)* the install happens at launch rather than the moment the download finishes, so an update can never
land mid-lobby. Downloads are full-size (~100–200 MB) unless differential updates work (see Builder notes).

## How it works (our side): "Ship Ascent"

When a developer says **"Ship Ascent"**, Claude runs one command (proposed name `npm run ship`) that:

1. Fetches `origin/main` and **refuses** unless that commit's required `verify` CI check is green.
2. Picks the next version: last release tag `vX.Y.Z` → `vX.Y.(Z+1)` by default (minor/major only when asked).
   The version comes from the **git tag**, not a commit to `package.json`, so shipping never needs a PR or a push
   to `main`. *(My call.)*
3. Deploys the friends hub (if changed) and the **Versus Worker for that exact commit**, checks `/health`, and gets
   its URL, reusing the logic `release:web` already has (R-VERSUS-CF-ONLY-01). This step runs locally, where the
   Cloudflare credentials already are.
4. Pushes the tag and starts a GitHub Actions workflow (Windows runner) with the commit, version and Worker URL.
   The workflow: `npm ci` → `build:web` with the Worker/hub URLs baked in → package the Electron app → **smoke test
   the packaged exe** (the existing `ASCENT_SMOKE` mode) → build the installer + update metadata → publish a
   GitHub Release named `vX.Y.Z` with the installer, update files and that release's patch notes as the body.
5. Reports back: version, commit, Worker URL / content revision, release link.

The repo's `CLAUDE.md` gets a short "Releasing" section: **only "Ship Ascent" ships**, nothing else publishes a
release, and Netlify is retired. `release:web` and its Netlify instructions are removed or marked retired.

*(My call, why CI instead of this PC:)* the standard installer/updater toolchain (`electron-builder` +
`electron-updater`) can't run on this machine. Windows Defender quarantines its `app-builder.exe` (documented in
`scripts/package-desktop.mjs`), which is why the current exe is hand-packaged. A clean GitHub Windows runner avoids
that. The repo is public, so GitHub Actions minutes are free and players' copies can read releases without a token.

### Ship details settled after review (my calls unless marked)

- **Versus result-writer key.** A new Worker's writer key needs its one SQL line run in Supabase (printed by
  `workers/versus/scripts/writer-secret.mjs`), or match results are refused. Since every friend auto-installs,
  `npm run ship` **pauses** after deploying a new Worker, prints the line, and waits until the developer confirms it
  ran. Only then does it start the build. A Worker that already existed (same content revision) skips the pause.
- **Publishing gate.** CI publishes as a **draft**. `npm run ship` waits for the workflow, and if the CI smoke test
  passed it publishes the draft itself. A failed smoke test leaves the draft unpublished and reports why, so no
  friend ever sees it. There's no second human step: "Ship Ascent" means ship.
- **Who can ship.** Whichever machine has `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` and push rights for tags.
  The command checks for both up front and fails with a clear message if either is missing. The builder verifies
  that no org ruleset blocks tag pushes.
- **First version: `v0.2.0`.** Later ships bump the patch number. Root `package.json` stays the human-facing base,
  and the tag is the source of truth.
- **Settings survive.** The installer must keep the app name `ASCENT` (so userData stays `%APPDATA%\ASCENT`) and
  the `app://ascent` origin, or localStorage (settings, local run data) is lost.
- **Moving from the zip build.** It has no updater, so friends on it install once by hand from the link. The friend
  group is small, so there's no final zip release with a notice.
- **"Which build is live" for the hub health check.** `workers/versus/src/health/healthProtocol.ts` reads
  `release.json` from the Netlify site. The release workflow attaches the same `release.json` to each GitHub
  Release, and the health check reads it from the latest release instead (via `HEALTH_SITE_URL` or a small change).

## Online play from the desktop app (required fix)

The desktop app loads from the origin `app://ascent`. Today both Cloudflare Workers only accept
`https://ascent-game-web.netlify.app` and localhost (`ALLOWED_ORIGINS` in `workers/versus/wrangler.toml` and
`workers/versus/hub.wrangler.toml`), and the client's copy `HUB_PAGE_ORIGINS` in
`packages/ui/src/friends/dm/hubUrl.ts` explicitly gives `app://` no hub. So Versus and the friends hub are likely
refused in the exe today. This project adds `app://ascent` to those allowlists (and to whatever origin-pattern
parser they use), and verifies from the packaged exe that Versus matchmaking, a match, DMs and presence work.
Once friends have moved over, the Netlify origin is removed from the lists.

Accounts: email sign-in sends `emailRedirectTo` only for http(s) origins (`packages/ui/src/remoteBoards.ts`).
The builder confirms sign-in works end-to-end in the exe (code entry rather than a link), and fixes it if not.

## Patch notes

`packages/ui/src/patchNotes.ts` stays the single source (date-keyed entries, newest first). The release body on
GitHub and the in-game "Updated to vX" panel both come from it. *(My call:)* each release records its ship date
in its build info; the panel shows every entry dated after the **previously installed** version's ship date
(stored locally on first boot of each version), falling back to the newest entry if that's unknown.

## Moving to Steam later

Carries over: the "Ship Ascent" command, version tags, the Worker step, the "Updated to vX" panel, the origin
fixes. Replaced: the installer and the GitHub updater (Steam installs and updates instead; the final GitHub
update shows "Ascent has moved to Steam"). Keep the updater code isolated in the shell so it can be switched off
for a Steam build with one flag.

## Constraints

- The shell stays tiny and secure: `contextIsolation`, no `nodeIntegration`, a frozen preload API
  (`apps/desktop/preload.cjs`). New bridge calls (update status, "restart now") take no untrusted input.
- Game UI follows the repo's UI rules (custom cursor, no `title=`, stage scaling, `stageHost()` portals).
- Performance: the update check and download must never cause a frame hitch (background, main process only).
- Every bug fixed along the way adds an approved oracle rule (CLAUDE.md "Bug fixes become rules").
- `main` only changes through PRs; the release flow pushes a **tag**, never `main`.

## Left to the builder

- Exact packaging route: `electron-builder` (NSIS target) in CI, or another installer tool if it fights the
  existing hand-packaged layout (`resources/app` + `resources/dist`, `app://` handler). Must keep that runtime layout
  or update `main.cjs` to match.
- Whether differential (blockmap) downloads work with our layout. Nice to have, not required.
- The visual design of the installing screen and the "Updated to vX" panel. It should match the title screen's
  existing style (Gem-plate buttons), and Mike reviews the look.
- CI must not need any secret besides the default `GITHUB_TOKEN`. The Worker step stays local.
- Whether the itch zip path (`package-itch-desktop.mjs`) is kept as a fallback or removed.

## Risks

- **Defender may flag an unsigned installer on friends' PCs** (beyond SmartScreen). Mitigation: test on a clean PC
  before the first friend install; signing is the real fix.
- **Smoke test on a CI runner** may behave differently from a desktop (GPU, display). If it can't run there, the
  fallback is to run the smoke test locally on the CI-built exe before the release is marked public (draft → publish).
- **A bad release:** publish as a draft first, smoke-test, then publish. The updater only sees published releases.
  A broken release is fixed by shipping a newer one, so the updater must run before the game boots far enough to
  crash.
