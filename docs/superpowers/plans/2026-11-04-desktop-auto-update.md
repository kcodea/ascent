# Self-updating desktop app — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Friends install Ascent once from a permanent GitHub link. Every "Ship Ascent" then publishes a release that
their copy downloads in the background and installs at next launch behind an "Installing update vX…" screen, followed
by "Updated to vX" patch notes. Netlify is retired.

**Architecture:** The Electron shell (`apps/desktop`) gets `electron-updater` (generic provider pointed at
`https://github.com/kcodea/ascent/releases/latest/download`), bundled into one `main.cjs` with esbuild so no
`node_modules` ships. A GitHub Actions Windows workflow builds the NSIS installer with `electron-builder` (CI only:
Defender quarantines its `app-builder.exe` on dev PCs) and smoke-tests it, then uploads it to a **draft** release. A local
`npm run ship` deploys the hub + Versus Worker (Cloudflare credentials stay local), dispatches that workflow, then
publishes the draft. The game UI reads the update state through the existing `window.ascentDesktop` bridge.

**Tech Stack:** Electron 44, electron-builder (CI only, NSIS), electron-updater, esbuild, GitHub Actions
`windows-latest`, `gh` CLI, Vitest, React (UI panels).

**Spec:** `docs/superpowers/specs/2026-11-04-desktop-auto-update-design.md`. Read it first; this plan argues from it.

## Global Constraints

- Installer asset name is exactly `ASCENT-Setup.exe` on every release (unversioned). Permanent link:
  `https://github.com/kcodea/ascent/releases/latest/download/ASCENT-Setup.exe`.
- `productName` stays `ASCENT` (userData `%APPDATA%\ASCENT`). The page origin stays `app://ascent`. Changing either
  wipes players' localStorage.
- First version `v0.2.0`; each ship bumps patch unless `--minor` / `--major`. The version lives in the release tag. CI
  sets it with `npm pkg set version=<X>` before building (no commit), so `__APP_VERSION__`, the exe metadata and
  `latest.yml` all agree.
- Updates install **only at launch**, never mid-session. `autoInstallOnAppQuit = false`.
- The updater is off when `!app.isPackaged`, in `ASCENT_SMOKE=1`, or when `ASCENT_NO_UPDATE=1`, and behind one constant
  `UPDATES_ENABLED` in `apps/desktop/updater.cjs` (a Steam build flips it).
- CI needs no secret beyond `GITHUB_TOKEN`. Cloudflare deploys run only in `scripts/ship.mjs`, locally.
- Nothing pushes to `main`. Releases create their tag through `gh release create --target <sha>`.
- `electron-builder` is **never** added to any `package.json`. CI installs it with `npm i --no-save electron-builder@<exact>`.
  `electron-updater` and `esbuild` are exact-pinned devDependencies of `@game/desktop` (bundled, never shipped as modules).
- Repo UI rules apply to new UI: no `title=`, no bare `cursor: pointer`, portal into `stageHost()`, no raw `vw`/`vh`,
  Gem-plate buttons. Every bug fix adds an approved oracle rule (CLAUDE.md "Bug fixes become rules").
- Gate before each PR: `npm run typecheck && npm run lint && npm test && npm run build:web`.

## Review Focus

1. **Offline launch with an update pending** → the installing screen must give up (60 s) and boot the game, never hang.
   (Task 3 test `launchPlan_timesOutToBoot`.)
2. **Pending marker for a version ≤ the running one** (already installed by hand) → ignore it, clear it, boot normally.
   (Task 3 test `decideLaunch_ignoresStaleMarker`.)
3. **`origin/main` moves while a ship is paused for the SQL step** → `--resume` must build the saved SHA/Worker, not
   re-fetch. (Task 5 test `resumeUsesSavedState`.)
4. **Patch notes when the previous build and new notes share a date** → include same-date entries (`>=`) rather than
   drop them. First boot with nothing stored shows only the newest entry. (Task 4 tests in `updateNotes.test.ts`.)
5. **Zip-build player installs the new app** → keeps settings. (Task 1 config test asserts `productName`; Task 1 step 7
   manual check.)

---

### Task 1: CI-built installer (no updates yet), proven on a real PC

**Files:**
- Create: `apps/desktop/electron-builder.json`, `scripts/bundle-shell.mjs`, `.github/workflows/desktop-release.yml`,
  `apps/desktop/electronBuilderConfig.test.ts`
- Modify: `apps/desktop/package.json` (devDep `esbuild` exact-pinned to the lockfile's `0.28.2`), `scripts/package-desktop.mjs` (copy `apps/desktop/build/main.cjs` instead of the
  raw `main.cjs`), `.gitignore` (`apps/desktop/build/`)

**Interfaces:**
- Produces: `node scripts/bundle-shell.mjs` → writes `apps/desktop/build/main.cjs` + `build/preload.cjs` + `build/icon.png`
  (esbuild, `platform: 'node'`, `format: 'cjs'`, `external: ['electron']`). Both packagers consume `apps/desktop/build/`.
- Produces: workflow `desktop-release.yml`, `workflow_dispatch` inputs `sha`, `version`, `versusUrl`, `hubUrl`,
  `contentRevision` (all strings, required), plus `publish` (boolean, default false). With `publish=false` it uploads
  the installer as a workflow artifact only. Task 5 turns on the draft-release upload.

- [ ] **Step 1: Write the failing config test** `apps/desktop/electronBuilderConfig.test.ts`: `JSON.parse` the config and assert `productName === 'ASCENT'`, `appId === 'com.kcodea.ascent'`,
  `win.target` includes `nsis`, `nsis.artifactName === 'ASCENT-Setup.${ext}'`, `nsis.oneClick === true`,
  `nsis.perMachine === false`, `publish` is `{ provider: 'generic', url: 'https://github.com/kcodea/ascent/releases/latest/download' }`,
  `extraResources` maps `../web/dist` → `dist`, `directories.app === 'build'`, `asar === true`.
- [ ] **Step 2:** `npx vitest run apps/desktop/electronBuilderConfig.test.ts`. Expected: FAIL (file missing).
- [ ] **Step 3:** Write `electron-builder.json` to satisfy it (`directories.output: release-ci`, icon `icon.ico`,
  `electronVersion` read from the installed electron) and `scripts/bundle-shell.mjs`. `main.cjs` keeps resolving the
  game at `process.resourcesPath/dist`, which `extraResources` satisfies.
- [ ] **Step 4:** Test passes. `npm run release:desktop` still produces a booting exe from the bundled shell (smoke passes).
- [ ] **Step 5:** Write `desktop-release.yml`: `windows-latest`, checkout `inputs.sha`, Node 20, `npm ci`,
  `npm pkg set version=${{inputs.version}}` (root + `apps/desktop`), `build:web` with `VITE_VERSUS_CF_URL` / `VITE_FRIENDS_HUB_URL`
  from inputs, write `apps/web/dist/release.json` in the exact shape `release-web.mjs` writes
  (`{ sha, contentRevision, versusWorker, hub, builtAt }`), `node scripts/bundle-shell.mjs`,
  `npm i --no-save electron-builder@<exact latest 26.x>`, `npx electron-builder --win nsis --publish never --projectDir apps/desktop`,
  then smoke: run `release-ci/win-unpacked/ASCENT.exe` with `ASCENT_SMOKE=1 ASCENT_SMOKE_OUT=smoke.json`, fail the job
  unless `smoke.json` has `ok: true`. Upload `ASCENT-Setup.exe`, `ASCENT-Setup.exe.blockmap`, `latest.yml`, `release.json`.
- [ ] **Step 6:** Push the branch and run it: `gh workflow run desktop-release.yml --ref <branch> -f sha=<origin/main sha> -f version=0.2.0-test.1 -f versusUrl=<current live worker> -f hubUrl=https://ascent-hub.team-ascent.workers.dev -f contentRevision=<rev>`.
  Expected: green, artifact present. **If the smoke can't render on the runner**, stop and report. Don't weaken the smoke.
  The spec's fallback (smoke locally before publishing) then moves into Task 5.
- [ ] **Step 7 (Mike, manual):** On Mike's PC, install the artifact's `ASCENT-Setup.exe`. Confirm it boots, has a
  Start-menu entry and the ASCENT icon, and that existing settings from the zip build are still there. Then uninstall.
- [ ] **Step 8:** Commit, open the PR, `verify` green, merge.

### Task 2: Online play accepts the desktop origin

**Files:**
- Modify: `workers/versus/wrangler.toml`, `workers/versus/hub.wrangler.toml` (`ALLOWED_ORIGINS` += `app://ascent`),
  `workers/versus/src/origins.ts` (`validOrigin` also accepts exactly `app://ascent`), `packages/ui/src/friends/dm/hubUrl.ts`
  (`HUB_PAGE_ORIGINS` += `'app://ascent'`, and fix the file's comment that says `app://` gets no hub)
- Test: `workers/versus/src/origins.test.ts`, `packages/ui/src/friends/dm/hubUrl.test.ts`, plus the test that keeps
  `HUB_PAGE_ORIGINS` in sync with the toml
- Modify: `packages/rules/src/registry/approved/<domain>.ts`: new rule `R-DESKTOP-ORIGIN-01` (grep for the right domain
  and the next free number). Statement: "Every online service (Versus, friends hub) accepts the desktop app's
  `app://ascent` origin." Owner evidence: "The goal is to remove the need for Netlify altogether" (2026-11-04).

- [ ] **Step 1:** Failing tests: `originAllowed('app://ascent', <toml list>) === true`, `originAllowed('app://evil', list) === false`,
  `validOrigin('app://ascent') === true`, `validOrigin('app://other') === false`, `defaultHubUrl('app://ascent') === FRIENDS_HUB_LIVE_URL`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement the list and `validOrigin` changes.
- [ ] **Step 4:** Tests pass. `npx vitest run packages/rules` and `npm run docbot:report -- --check` both pass.
- [ ] **Step 5:** Commit, PR, merge. The hub picks up its toml change on the next `hub:deploy` (code-hash gated; confirm
  the toml is part of the hash, otherwise note that the hub needs a forced deploy at first ship).

### Task 3: The shell updates itself at launch

**Files:**
- Create: `apps/desktop/updater.cjs`, `apps/desktop/updating.html`, `apps/desktop/updater.test.ts`
- Modify: `apps/desktop/main.cjs` (call `startUpdater` before `createWindow`), `apps/desktop/preload.cjs`,
  `apps/desktop/package.json` (`electron-updater` exact-pinned devDep), `scripts/bundle-shell.mjs` (also copy `updating.html`)

**Interfaces:**
- Produces (pure, exported for tests): `isNewer(a: string, b: string): boolean` (semver, `a > b`; pre-release < release);
  `decideLaunch(marker: { version: string } | null, current: string): 'install' | 'boot'` (`'install'` only when the marker
  exists and `isNewer(marker.version, current)`).
- Produces: `startUpdater({ app, BrowserWindow, createGameWindow }): Promise<void>`.
  - Marker: `path.join(app.getPath('userData'), 'pending-update.json')`, holding `{ version }`.
  - `decideLaunch === 'install'` → open a window on `updating.html?v=<version>` (same window options as the game),
    `checkForUpdates()`. On `download-progress`, send `ascent:update-progress` `{ percent }` to that window. On
    `update-downloaded`, call `quitAndInstall(true, true)` (silent, relaunch). On error or after **60 s** with no
    `update-downloaded`, delete the marker, close the window and `createGameWindow()`.
  - `'boot'` → delete any stale marker, `createGameWindow()`, then 10 s later `checkForUpdates()` (autoDownload on). On
    `update-downloaded`, write the marker and send `ascent:update-ready` `{ version }` to the game window.
  - Feed URL: `process.env.ASCENT_UPDATE_URL` when set (testing only), else the generic `latest/download` URL.
  - Errors are logged and never shown to the player. No retry loop within a session.
- Produces: preload adds `onUpdateReady(cb: (version: string) => void): () => void` on `window.ascentDesktop`, and for
  `updating.html` only, `onUpdateProgress(cb: (percent: number) => void)`. Both stay frozen and take no input from the page.

- [ ] **Step 1:** Failing tests in `updater.test.ts`: `isNewer('0.2.1','0.2.0')`, `!isNewer('0.2.0','0.2.0')`,
  `isNewer('0.2.0','0.2.0-test.1')`, `isNewer('0.10.0','0.9.9')`; `decideLaunch_ignoresStaleMarker`
  (`decideLaunch({version:'0.2.0'},'0.2.0') === 'boot'`, `decideLaunch({version:'0.1.9'},'0.2.0') === 'boot'`);
  `decideLaunch({version:'0.2.1'},'0.2.0') === 'install'`; `decideLaunch(null,'0.2.0') === 'boot'`;
  `launchPlan_timesOutToBoot`: with a fake updater that never emits, fake timers advanced 60 s → `createGameWindow` called
  once and the marker deleted.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement `updater.cjs`. Inject `autoUpdater`, `fs` and timers so the test can fake them.
  Set `autoUpdater.autoInstallOnAppQuit = false` and `autoDownload = true`. Gate on `UPDATES_ENABLED && app.isPackaged && !SMOKE && process.env.ASCENT_NO_UPDATE !== '1'`.
- [ ] **Step 4:** Write `updating.html`: self-contained (inline CSS, no network), the board's dark `#211d27`, the ASCENT
  logo copied from the game's public art, "Installing update v<version>…" and a progress bar fed by `onUpdateProgress`.
  Mike reviews the look.
- [ ] **Step 5:** Tests pass, and `npm run release:desktop` smoke still passes (the updater is off in smoke).
- [ ] **Step 6:** End-to-end: run the workflow (`publish=false`) for `0.2.0-test.2` and `0.2.0-test.3`, then publish each artifact set by hand as a **prerelease** (`gh release create v0.2.0-test.N --prerelease <the four files>`). Prereleases never show up at `releases/latest`, so friends are unaffected. Install test.2 and launch it with `ASCENT_UPDATE_URL=https://github.com/kcodea/ascent/releases/download/v0.2.0-test.3`. Confirm test.3 downloads, the marker is written, and the next launch (same env) shows the installing screen and relaunches into test.3. Then delete both prereleases and their tags.
- [ ] **Step 7:** Commit, PR, merge.

### Task 4: "Update ready" notice and "Updated to vX" panel in the game

**Files:**
- Create: `packages/ui/src/updateNotes.ts`, `packages/ui/src/updateNotes.test.ts`, `packages/ui/src/UpdateReadyNotice.tsx`,
  `packages/ui/src/UpdatedPanel.tsx`, `packages/ui/src/updatedPanel.test.tsx`
- Modify: `packages/ui/src/desktop.ts` (`onUpdateReady` passthrough, no-op in browser), `packages/ui/src/Title.tsx`
  (mount `UpdatedPanel`), the app root that's always mounted (mount `UpdateReadyNotice`), `packages/ui/src/styles.css`
  or a sibling css, `packages/ui/src/patchNotes.ts` (a `Systems` entry: "Ascent now updates itself…")

**Interfaces:**
- Consumes: `window.ascentDesktop.onUpdateReady` (Task 3), `PATCH_NOTES`, `PatchNotesBody`.
- Produces: `notesSince(notes: PatchNote[], sinceDate: string | null): PatchNote[]` (entries with `date >= sinceDate`;
  `null` → `[notes[0]]`); `readUpdateSeen(): { version: string; buildDate: string } | null` and
  `writeUpdateSeen(v: { version: string; buildDate: string }): void`, localStorage key `ascent.desktop.updateSeen`,
  try/catch-wrapped; `shouldShowUpdated(seen, currentVersion: string): boolean` (desktop only, `seen` present, and the
  version differs).

- [ ] **Step 1:** Failing tests: `notesSince` keeps same-date entries (`>=`), drops older ones, and with `null` returns
  only the newest; `shouldShowUpdated(null,'0.2.1') === false` (first ever launch shows nothing and records the version);
  `shouldShowUpdated({version:'0.2.0',…},'0.2.1') === true`; same version → false. `updatedPanel.test.tsx`: renders
  "Updated to v0.2.1" plus the filtered notes, and dismiss calls `writeUpdateSeen` with `__APP_VERSION__` and `__BUILD_DATE__.slice(0,10)`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. The panel reuses `PatchNotesBody` for the notes and gives a Gem-plate "Continue" button. The
  notice is a small corner toast: "Update v<version> downloaded. It installs next time you start Ascent." No button.
  It sits in `stageHost()`, isn't hover-only, and never covers the board's controls.
- [ ] **Step 4:** Tests pass and the full gate passes. `npm run dev` with a stubbed `window.ascentDesktop` in the console
  shows both. Mike reviews the look before merge.
- [ ] **Step 5:** Commit (with the patch-notes entry), PR, merge.

### Task 5: "Ship Ascent" — `npm run ship`

**Files:**
- Create: `scripts/ship.mjs`, `scripts/lib/deployServers.mjs`, `apps/desktop/ship/shipLib.mjs`, `apps/desktop/ship/shipLib.test.ts`
- Modify: `scripts/release-web.mjs` (use `deployServers.mjs`, same behaviour), `package.json` (`"ship": "node scripts/ship.mjs"`),
  `.github/workflows/desktop-release.yml` (`publish=true` path: `gh release create v<version> --draft --target <sha> --title "ASCENT v<version>"` with the four assets),
  `.gitignore` (`.claude/ship-state.json`), `CLAUDE.md` (new "Releasing: Ship Ascent" section, above the Netlify one)

**Interfaces:**
- Produces: `deployServers({ wt, persist }): Promise<{ hubUrl, hubNote, workerUrl, workerRev, newSecrets: string[] }>`,
  lifted verbatim from `release-web.mjs` steps 3b–3c. `newSecrets` lists the SQL lines printed for any newly set writer secret.
- Produces (pure): `nextVersion(latestTag: string | null, bump: 'patch' | 'minor' | 'major'): string` (`null` → `'0.2.0'`);
  `releaseNotesMarkdown(notes: PatchNote[]): string`; `resumeState(saved, now)` → the saved `{ sha, version, workerUrl, hubUrl, contentRevision }`
  unchanged (it never re-reads `origin/main`).
- `ship.mjs` flow:
  1. Preflight: `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` set, `gh auth status` ok, clean release worktree
     (reuse `release-web.mjs`'s worktree routine).
  2. Resolve `origin/main` SHA. Refuse unless check-run `verify` on it has `conclusion: success`
     (`gh api repos/kcodea/ascent/commits/<sha>/check-runs`).
  3. Version = `nextVersion(<newest non-draft release tag from gh release list>, bump)`.
  4. `deployServers`. If `newSecrets` is non-empty, write `.claude/ship-state.json`, print the SQL lines and
     "PAUSED — run this SQL in Supabase, then `npm run ship -- --resume`", and exit with code 3.
  5. Dispatch `desktop-release.yml` with `publish=true`, find its run id, `gh run watch <id> --exit-status`.
  6. On green: `gh release edit v<version> --notes-file <releaseNotesMarkdown(notesSince(PATCH_NOTES, <previous non-draft release publishedAt, YYYY-MM-DD; null if none>))> --draft=false`.
     On red: leave the draft and print the run URL.
  7. Verify `https://github.com/kcodea/ascent/releases/latest/download/latest.yml` reports the new version.
  8. Print version, SHA, Worker URL + content revision, release URL and the permanent installer link. Delete the state file.
- `CLAUDE.md` wording: only the exact phrase **"Ship Ascent"** from Mike or Kevin runs `npm run ship`. Nothing else
  publishes a release. On exit code 3, relay the SQL to the developer and resume only after they confirm.

- [ ] **Step 1:** Failing tests in `shipLib.test.ts`: `nextVersion(null,'patch') === '0.2.0'`, `nextVersion('v0.2.0','patch') === '0.2.1'`,
  `nextVersion('v0.2.9','minor') === '0.3.0'`, `nextVersion('v0.3.4','major') === '1.0.0'`; `resumeUsesSavedState`;
  `releaseNotesMarkdown` emits each change's `text` and its `details` as sub-bullets, grouped Game/Systems.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement `shipLib.mjs`, `deployServers.mjs` (then refactor `release-web.mjs` onto it and diff its
  console output on a dry read), `ship.mjs` and the workflow's publish path.
- [ ] **Step 4:** Tests pass, and the full gate passes.
- [ ] **Step 5:** Commit with the `CLAUDE.md` section, PR, merge.
- [ ] **Step 6 (first real ship, with Mike):** Mike says "Ship Ascent" → `npm run ship` → v0.2.0 published. On two PCs,
  Mike installs it from the permanent link (SmartScreen: More info → Run anyway). Check: a Versus match between the two
  installs, a DM, presence, and email sign-in by code. Then ship v0.2.1 (any small patch-notes change) and confirm both
  PCs show the installing screen at next launch and then "Updated to v0.2.1".

### Task 6: Retire Netlify (after Task 5 step 6 passes and Mike has sent friends the link)

**Files:**
- Modify: `workers/versus/wrangler.toml`, `workers/versus/hub.wrangler.toml`, `packages/ui/src/friends/dm/hubUrl.ts`
  (drop `https://ascent-game-web.netlify.app`), `workers/versus/src/health/healthProtocol.ts`
  (`SITE_URL = 'https://github.com/kcodea/ascent/releases/latest/download'`, `RELEASE_PATH` stays `/release.json`),
  `CLAUDE.md` (remove the Netlify release section and point `R-VERSUS-CF-ONLY-01` wording at `npm run ship`),
  delete `scripts/release-web.mjs` + its `package.json` script + `apps/web/public/_headers` if Netlify-only, and every
  doc or skill that tells agents to use `release:web` (`grep -rn "release:web\|netlify" docs .claude/skills CLAUDE.md ONBOARDING.md`).
- Test: the origin and hub tests from Task 2 (Netlify now refused), a health test asserting the release URL, and an
  amendment to the rules registry for any rule whose statement names Netlify.

- [ ] **Step 1:** Update the tests: Netlify origin → refused; health fetch URL →
  `https://github.com/kcodea/ascent/releases/latest/download/release.json` (it follows the redirect). Run → FAIL.
- [ ] **Step 2:** Make the changes. Tests, docbot check and the full gate pass.
- [ ] **Step 3:** Commit, PR, merge. Ship once ("Ship Ascent") so the live Workers drop the Netlify origin.
- [ ] **Step 4 (Mike, manual):** Take the site down in the Netlify dashboard. Also update the Supabase Auth "Site URL"
  (it still points at Netlify, so sign-in *links* in emails go nowhere; the code still works).
