# 2026-09-09 — per-tribe buff ribbons (tendril-trail-<tribe>)

The generic `tendril-trail` (a minion buffing an ally, fired by `fireBuffFx`) now has a variant per tribe. Owner
asked for "different versions for each tribe" and chose the seed-then-refine path: I generated the 7 variants as
palette-swaps of the generic, keyed to each tribe's `:root` colour, and owner tunes any in the workbench.

## Seeding

`scripts`-style node seeder (kept out of the repo — in the session scratchpad) deep-clones `tendril-trail.json`
per tribe and rewrites every layer's `palette` (+ `glow_color`) to a 4-stop brightness ramp in the tribe hue
(`--t-beast #4ea83b`, `--t-demon #b15cf0`, `--t-dwarf #f0c33c`, `--t-mech #27a9dd`, `--t-undead #22b8a8`,
`--t-kobold #e8763a`, `--t-dragon #ffffff`). Everything else — geometry, timing, the ribbon's `travelMs` — is
identical, so `TENDRIL_TRAIL_TRAVEL_MS` still schedules the stat roll for every variant. Dragon reads near-white
(its token colour); a good candidate to gold in the workbench.

## Wiring

`fireBuffFx` picks the variant from the BUFFER's tribe (`o.tribe` — Warhorn Captain = dwarf → `tendril-trail-dwarf`).
`neutral`, the archived `celestial`, and any unlisted tribe keep the generic. Two sibling branches on purpose:
the per-tribe `playDef(`tendril-trail-${tribe}`, …)` is a DATA-RESOLVED (dynamic) call — registered in
`fx/directCalls.ts`'s `DYNAMIC_CALL_SITES` (`buffFxRender.ts: 1`) with the Equipment-use exception's reasoning —
while the generic-fallback `playDef('tendril-trail', …)` stays a literal in `DIRECT_CALL_SITES`.

Card-authored buff defs (Dragonflame, Karwind, Broodfire) still resolve UPSTREAM of `fireBuffFx` and are
unaffected — a card with its own look never reaches the per-tribe generic.
