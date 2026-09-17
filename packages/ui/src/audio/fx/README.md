# `audio/fx/` — imported `sound` FX clips

WAV/MP3 clips imported through the FX workbench's **Sound** primitive land here, named `<slug>.<ext>`, and are
referenced by the clip id `fx/<slug>`. They are **committed and bundled** (via `sfx.ts`'s `import.meta.glob`),
so a clip imported here plays for every player — not just on the importing machine.

Written by the dev-only `/__fx/sound` endpoint (`apps/web/fxDefsPlugin.ts`); do not hand-place large files here
without reason. This README keeps the directory present in git so the glob is always valid.
