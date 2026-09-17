# FX workbench: sound import pipeline (PR 2)

Second PR of the workbench audio feature (design: `docs/superpowers/specs/2026-09-17-fx-sound-primitive-design.md`).
Lets the owner **import a WAV/MP3 into a `sound` layer** — committed and bundled, so it plays for every player.

## The pipeline (mirrors the image pipeline + its #1469 hardening)
- **`/__fx/sound` dev endpoint** (`apps/web/fxDefsPlugin.ts`): POST writes `audio/fx/<slug>.<ext>`; GET serves it
  back. Validation is a pure, unit-tested `planSoundWrite` (slug grammar + `wav`/`mp3` allow-list + audio magic
  bytes — RIFF/WAVE or ID3/frame-sync — + a 16 MB cap + a containment gate) and `planSoundRead`.
- **`sfx.ts` `importFxSound(file)`**: decodes the file into a buffer **now** (so it plays the instant it's
  imported, no wait on the write or the glob), POSTs it to the endpoint, and remembers `{slug → ext}`. Returns
  the clip id `fx/<slug>` to store in the layer's `clip` param. The `audio/fx/*` glob makes committed clips
  bundle for all players; `clipNames()` also lists this-session/persisted imports so they show in the picker
  immediately.
- **Reload safety**: `audio/fx` is watch-ignored (an import mustn't reload the page mid-edit and drop the layer's
  new clip), so a just-imported file isn't in the frozen glob. `loadSample` falls back (DEV only) to
  `GET /__fx/sound/<slug>.<ext>`, so a reload before a restart re-fetches it off disk. A restart lets the glob
  catch up. Production is untouched — the endpoint is `apply:'serve'` and the build-time glob bundles the bytes.
- **Inspector**: the `SoundField` picker gains an **Import** button (accepts `.wav`/`.mp3`) that imports, re-reads
  the library, and selects the new clip.

## Why committed, not local-only
Same lesson as the custom-image work (the `test-orb` trap): a local-only import is silent for everyone else. The
endpoint writes into the committed, globbed `audio/fx/` tree, so a clip an author imports here ships with the
build. `audio/fx/README.md` keeps the directory present in git.

## Scope / next
No new player-facing gameplay (a dev-authoring tool) → no patch note. Next: the audio Filter Lab — core native
(PR 3), reverb (PR 4), modulation (PR 5).

Files: `apps/web/fxDefsPlugin.ts` (+ test), `packages/ui/src/sfx.ts`, `packages/ui/src/fx/defStore.ts`,
`packages/ui/src/fx/ui/Inspector.tsx`, `packages/ui/src/audio/fx/README.md`.
