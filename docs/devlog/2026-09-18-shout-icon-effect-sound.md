# FX: ship shout-icon-effect's sound + medallion tuning (def + imported clip together)

The generic Shout cue (`shout-icon-effect`, the `shout` binding) gets:
- an authored **sound layer** — the imported clip **`fx/shout-effect-2`** (gain 0.78, pitch 1.25, algorithmic
  reverb: size 1.5 / damping 0.85 / mix 0.24), on the `combat` bus;
- the burst pinned to the **medallion** (`anchorPart: medallion`) with its `offsetY: 87` compensation removed
  — the hack that faked the medallion position back when the anchor resolved to the card centre, now
  unnecessary after the `.cgem` medallion fix — plus the owner's burst tuning (count 209, life 1140, etc.).

`embermouth` gets the same medallion-adaptation: its per-layer `offsetY` compensations zeroed now that the
medallion resolves correctly.

## Def + sound shipped together (the important part)
`fx/shout-effect-2` is committed alongside the def (`packages/ui/src/audio/fx/shout-effect-2.mp3`) so the Shout
sound plays for **every player**, not just on the importing machine — the same "commit the asset with the def"
rule as custom images. Only the referenced clip ships; the other audition imports (elf warcry, horror scream,
shout-effect) are unreferenced and deliberately left out.

The def edits were reconciled from two divergent workbench saves (one carried the latest burst tuning, the
other the sound layer); this is the union — latest burst + the sound.

Files: `packages/ui/src/fx/defs/shout-icon-effect.json`, `embermouth.json`,
`packages/ui/src/audio/fx/shout-effect-2.mp3`.
