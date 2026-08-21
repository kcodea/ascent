# 2026-08-21 — ceremony AV upgrade: stingers, the ring flash, and a circular portrait

Owner upgrade pass on the day-old Hero Select Ceremony, all dialed through the 🎭 tuner.

**Four ceremony stingers** (`audio/ceremony/*` — asiansong, woosh1, woosh2, ceremonyrevealsound) picked up by
a new sfx glob + `sfx.ceremony(name, vol)`. Each has its own tuner row: an **on/off switch**, a **timeline
mark** (ms from the hero click, the same clock as every other beat) and a **volume** multiplier applied on
the live gain node over the ceremony bus. Scheduled by the ceremony's sequence runner from the shipped config
(prod plays defaults; the tuner overrides in dev), and §15-safe throughout — a missing or still-decoding clip
is silence, never a stall.

**The circular-portrait flash**: at `flashAtMs` a one-shot bloom fires, the `heroportrait` ring image scales
in, and the materialized artwork clips from its soft-masked rectangle to a **circle just inside the ring**
(a one-shot `clip-path` transition — no looping paint animation). The clip circle is computed in the
portrait's own coordinate space from the ring's center + size, so the ring and the clipped art cannot drift
apart regardless of how the knobs are set. New tuner groups: **Flash** (timing), **Hero art** (x/y/scale on
the materialized artwork's bounds), **Ring** (x/y/diameter).

**A dev-loop lesson re-learned**: a mid-edit state (config exporting new keys, tuner not yet consuming them)
wedged Vite's module graph — the tuner module kept failing with its OLD timestamp through hard reloads.
Restarting the dev server fixed it instantly; the stale-`import.meta.glob` rule generalizes to any mid-edit
module-graph error.

Verified live: circular clip lands exactly inside the 380px ring, flash and ring mount at `flashAtMs`,
identity/button unaffected. Audio is registration-verified only (the harness tab is backgrounded and
`playSample` correctly refuses hidden tabs) — the audible mix is the owner's pass on :5201.

Gates: typecheck ✅ · lint 0 errors ✅ · 6382 tests ✅ · build:web ✅.
