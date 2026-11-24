---
name: ascent-locations
description: Work on ASCENT's locations (The Outskirts, The Underbelly, and any new one) — the gate reveal, the living hero select, the hero ripple and frame opening, tribe parchments, the quick Compendium overlay, the Good Luck comet, and the art preparation behind them (parallax layers, water maps, baked parchments, sound). Use when adding a location or a new effect in this sequence.
---

# ASCENT Locations

Read [`docs/locations.md`](../../../docs/locations.md) first: the sequence and the file that owns each moment, the steps for adding a
location, the approved and refused looks, the building patterns and the traps. Keep it true in the same PR as any change here.

- Everything a location is lives in `packages/ui/src/locationReveal/locations.ts`, its art in `apps/web/public/locations/<id>/`, its name on the
  set (`SetDef.location`). No other file names a location.
- Art preparation is `scripts/locations/`. The owner's art is never redrawn, toned or filled in: flag what is off.
- Timings are pure files; pictures are `draw(t)`; canvases are made early, drawn once unseen, freed at the end, and gated by `canRun()`.
- Measure on a production bench build, first and second run of a profile, at 16:9 and 21:9. The bar is 240 fps.
- Feel is the owner's call: show it, and say what is new, before calling it done.
