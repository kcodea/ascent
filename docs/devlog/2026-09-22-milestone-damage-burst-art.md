# Milestone-coloured damage bursts (authored art, not a filter)

**2026-09-22 · owner ask**

A real melee card-attacks-card hit now shows a colour-authored burst behind its damage number at the top
three attack milestones — **pink at tier 4 (≥500), purple at tier 5 (≥2000), blue at tier 6 (≥5000)**. Tiers
1–3, and any untagged hit (spell / AoE), keep the base gold burst. Owner-supplied art.

## How it works

The float's burst is an `<img class="dmgsplash">` (an image element since 2026-09-03, so it can carry
`decoding="sync"` and paint on the same frame as the number). `spawnFloats` already tags a clash hit's float
with `atkTier` — the attacker's attack-milestone tier, derived from the damage amount, covering both the
initiating swing and the retaliation (a big retaliation has no `attack` event of its own but is still a clash
hit). `splashImgSrc(atkTier)` in `floatConfig.ts` now selects the tier's PNG (`fx/burst-pink|purple|blue.png`)
for tiers 4/5/6 and the picker's gold art otherwise. The three PNGs live in `apps/web/public/fx/`.

## Why art instead of the earlier hue-shift filter

The first cut recoloured the one gold star at runtime via `hue-rotate() saturate() brightness()` derived from
a per-tier colour picked in the Float tuner. Owner feedback: the colours always read too bright and were hard
to line up with intent even after deriving saturation/lightness from the pick. Authored art is exact — the
star is drawn in each colour with its own shading — so the whole filter path was removed: the HSL helper, the
base-hue/SL constants, the six `--dmg-splash-hue/sat/bright-N` CSS variables and their `[data-atktier]` filter
rules, and the six per-tier colour pickers in the Float tuner. Nothing left to tune per tier; the milestone
just selects the file.

## Touched

`packages/ui/src/floatConfig.ts` (tier→PNG map + `splashImgSrc(atkTier)`, filter machinery removed),
`Recruit.tsx` (pass `f.atkTier`, drop the dead `data-atktier` attribute), `FloatTuner.tsx` (drop the colour
controls), `styles.css` (drop the filter rules), `apps/web/public/fx/burst-{pink,purple,blue}.png` (new art).
The `atkTier` tagging in `choreo/channels/float.ts` and its tests are unchanged — still the source of the tier.
