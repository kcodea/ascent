# Dev server now serves custom-primitive images, so imports survive a reload (no more re-import)

**Symptom (owner, 2026-09-14):** in the FX workbench, a `custom`-layer image had to be **re-imported every
time the effect was loaded**, and a committed one (e.g. `spell-target`'s orb) rendered blank in the dev game.

## Root cause

The app is rooted at `apps/web`, so `packages/ui/src/fx/defs/images/*.png` lives **outside the Vite root** and
is only addressable in dev via Vite's internal `/@fs/<abs>` path. `imageLibrary` resolves an `image:<slug>` id
in three steps: the in-session import **overlay** → the committed **glob** (`import.meta.glob(..., {query:'?url'})`)
→ a **dev fallback URL**.

- The glob works, but Vite expands it at transform time and the images dir is deliberately `watch.ignored`
  (importing writes mid-edit; a reload would race the Inspector and drop the import). So the glob is frozen at
  server start and never sees a *just-imported* file.
- The overlay is in-memory and cleared on reload.
- So after a reload, a freshly-imported image can only come from the **fallback URL** — and that fallback was
  `new URL('./defs/images/<slug>.png', import.meta.url)`, which produced a path that does not serve (confirmed
  by loading it as an `Image()`: every plain source path fails; only `/@fs/` works). Result: blank → re-import.

## Fix

Serve the images through the dev plugin at a stable route and point the fallback at it.

- `apps/web/fxDefsPlugin.ts`: `GET /__fx/image/<slug>.png` now streams `defs/images/<slug>.png` straight off
  disk (`serveImage` + a pure, tested `planImageRead` for the slug grammar + containment). The existing
  `/__fx/image` route is split by method — GET/HEAD reads, POST writes — so one URL both writes and serves.
- `packages/ui/src/fx/imageLibrary.ts`: `devUrl(slug)` now returns `/__fx/image/<slug>.png` (DEV only).

A just-imported image is written to disk by the import, so the route serves it on the next reload with no
re-import and no restart. Committed images still resolve through the glob (primary); a restart still lets the
glob pick up a brand-new file. **Production is untouched** — the plugin is `apply: 'serve'`, `devUrl` returns
`null` outside DEV, and the build-time glob bundles committed images (verified: a prod build bundles
`test-orb-<hash>.png` and serves it 200 image/png; the app boots and the asset loads 1024×1024).

## Scope

Dev-tooling only — no gameplay or player-facing change (so no patch-notes entry). Fixes the workbench
re-import treadmill and makes committed `custom` images render in the dev game to match production.

Files: `apps/web/fxDefsPlugin.ts`, `apps/web/fxDefsPlugin.test.ts`, `packages/ui/src/fx/imageLibrary.ts`.
