# Testing a desktop update end to end

Use this to prove auto-update on a real PC before the first "Ship Ascent", or after a risky shell change. Nothing here touches `main`. Prereleases never appear at `releases/latest`, so friends never see them.

Prereqs: this branch merged or checked out; `gh` authenticated; a Windows PC (ideally not your dev PC) you're happy
to install ASCENT on. Nothing here touches `main`; the prereleases are invisible at `releases/latest`.

1. Build two installers with the workflow (publish=false), same commit, two versions:
   `gh workflow run desktop-release.yml --ref feat/desktop-auto-update -f sha=<commit> -f version=0.2.0-test.2 -f versusUrl=<url> -f hubUrl=<url> -f contentRevision=<rev>`
   and the same with `-f version=0.2.0-test.3`. Wait for both runs: `gh run watch <id>`.
2. Download each artifact into its own empty folder: `gh run download <id> -n ascent-installer-0.2.0-test.2 -D t2`
   (and `-n ascent-installer-0.2.0-test.3 -D t3`). Check `t3/apps/desktop/release-ci/latest.yml` says
   `version: 0.2.0-test.3` and `path: ASCENT-Setup.exe`.
3. Publish each as a **prerelease** (target the same commit):
   `gh release create v0.2.0-test.2 --prerelease --target <commit> --title "test.2" t2/apps/desktop/release-ci/ASCENT-Setup.exe t2/apps/desktop/release-ci/ASCENT-Setup.exe.blockmap t2/apps/desktop/release-ci/latest.yml t2/apps/web/dist/release.json`
   and the same for test.3. Confirm `https://github.com/kcodea/ascent/releases/latest` does NOT show them.
4. On the test PC: run test.2's `ASCENT-Setup.exe` (SmartScreen: More info → Run anyway). Quit the game it launches.
5. Launch test.2 with the override feed, from PowerShell:
   `$env:ASCENT_UPDATE_URL='https://github.com/kcodea/ascent/releases/download/v0.2.0-test.3'; & "$env:LOCALAPPDATA\Programs\ASCENT\ASCENT.exe"`
   Play/idle on the title for ~1–2 min (the check starts 10 s after launch; ~100–200 MB download).
6. Confirm: `%APPDATA%\ASCENT\pending-update.json` contains `{"version":"0.2.0-test.3"}`, and
   `%APPDATA%\ASCENT\updater.log` shows `downloaded 0.2.0-test.3; installs next launch`. (With Task 4 merged, the game also
   shows the "installs next time" notice.) Quit the game.
7. Launch again **with the same env var** (step 5's command). Expect the full-window "Installing update v0.2.0-test.3…"
   screen, then the small installer progress window and a relaunch into test.3 (the relaunched game has the same env, finds nothing newer,
   and boots normally). Check the version (Settings/release.json or Explorer → ASCENT.exe → Details) and that
   `pending-update.json` is gone after that launch.
8. Offline fallback (Review Focus 1): repeat steps 4–6 to get a pending marker, then disconnect the network and launch.
   The installing screen should give up within 60 s and boot the game; the marker is gone; `updater.log` says
   `install gave up`. (Note: electron-updater may still validate the cached download offline; if it installs instead,
   that's fine too: the point is it never hangs.)
9. Clean up: `gh release delete v0.2.0-test.2 --cleanup-tag -y` and `gh release delete v0.2.0-test.3 --cleanup-tag -y`;
   uninstall ASCENT from Windows Settings → Apps on the test PC if wanted.
