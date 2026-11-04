# 2026-11-04 — Desktop app with auto-update from GitHub Releases, and "Ship Ascent"

**What shipped:** the Electron desktop build now installs with an NSIS installer and updates itself from GitHub Releases
(electron-updater). On launch it installs a pending update in its own "Installing update" window and relaunches, then
the title shows an "Updated to vX" panel (what changed since the last build the player saw); a downloaded update
announces itself with a small notice. `npm run ship` ("Ship Ascent") is the one release flow: it refuses unless `verify`
is green on `origin/main`, deploys the hub and Versus Worker, dispatches the `desktop-release` workflow (build, CI smoke
test), verifies the draft, writes the release notes from `patchNotes.ts`, and publishes it (marked latest).

**Permanent installer link:** `https://github.com/kcodea/ascent/releases/latest/download/ASCENT-Setup.exe`

**Differs from the spec:** the release tag `vX.Y.Z` is created when the draft is published; there is no tag push.

**Hardening from the final review:** the installer runs non-silent (NSIS shows its own progress window), the shell holds a
single-instance lock, CI release badges are no longer marked dirty (the version stamp is `assume-unchanged`), Escape on
the Updated panel no longer also opens Settings, the panel opens on the first tab that has entries, and `ship` refuses a
`VERSUS_ALLOWED_ORIGINS` override that drops `app://ascent`.

**Pending:** Netlify / `release:web` retirement (plan Task 6).
