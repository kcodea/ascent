# `npm run release:desktop` — an exe that is provably `origin/main`

**Owner ask 2026-09-03:** "I want to take exactly what is in main and turn it into an exe to share with my
friend. Things missing after a certain turn, fonts not loading, images not loading, effects not perfect. How
can we guarantee the game is 100% identical to the version synced to main?"

## The actual defect

`npm run package:itch:win` never built main. It built **the working folder**: Vite bundles whatever is on
disk, so the exe carried every uncommitted edit, every untracked file a glob picks up, whatever branch the
shared checkout had been switched to by another session, and whatever `node_modules` was last installed —
and it lacked whatever had merged since the folder last pulled. Proof on the day: the untracked
`packages/ui/src/fx/defs/acid-lazer-beam.json` was inside the zip built at 22:34 (the FX defs are an
`import.meta.glob`), while the build stamp said `a3afc7b6` = `origin/main`. The stamp recorded HEAD, not
whether the tree matched HEAD.

The individual symptoms were real bugs (the two asset-path traps, #1356 / #1362; the fontsource move) that
had already merged — the exe in the friend's hands simply predated them, and nothing on the title screen
could tell anyone that.

## What shipped

- **`scripts/release-desktop.mjs`** (`npm run release:desktop`): fetch → resolve the `origin/main` SHA →
  detached worktree at `.claude/worktrees/release` → refuse unless `git status --porcelain
  --untracked-files=all` is empty and HEAD is that SHA → `npm ci` → `build:web` → `package-desktop.mjs` →
  `resources/dist/BUILD.json` → **smoke test the packaged exe** → zip → copy to
  `ascent-itch-win64-<sha>.zip` beside the repo. It never touches the primary checkout.
- **Smoke mode in the Electron shell** (`ASCENT_SMOKE=1`, `apps/desktop/main.cjs`): windowed boot, waits
  for `window.__boot` (the boot loader preloads every image, font, clip and effect — PR #1358), then reports
  every `app://` request whose file does not exist in the bundle (the handler now returns a real 404 and
  records it), every failed boot stage, every `document.fonts` entry in `error`, every FX def the warm pass
  could not fire, and every renderer console error. Any of those fails the release. It runs against the
  exe's own `resources/dist` over the exe's own protocol handler — the player's exact code path.
- **Build identity is honest now:** Vite bakes `__BUILD_DIRTY__` (uncommitted or untracked changes present)
  and `__BUILD_DATE__` next to `__BUILD_SHA__`. The title screen reads `v0.1.0 · a3afc7b6`, with a `*` when
  the tree was dirty, so a hand build can never pass for a release and "which version do you have?" is
  answered by looking at the screen.

## Corrections to the first diagnosis

`apps/web/.env` is **tracked** (`.gitignore` re-includes it), so the Supabase backend is not a drift source
between machines. "Missing after a certain turn" was most likely a stale exe, not a missing backend.
