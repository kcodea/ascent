# 2026-11-14: one gold rune buff trail, with sound (R-RUNE-TRAIL-01)

**What changed.** The owner-authored workbench effect `rune-buff-trail` replaced two things: the green generic
`tendril-trail` def and the procedural gold quest tendril (`pixiFx.buffTendril` plus its Quest Tendril Tuner and
config, both deleted). Every play goes through `playRuneBuffTrail` in `buffFxRender.ts`.

**Where it plays.** From the rune's own node to the buffed unit in every phase:

- End of Turn and quest rewards: the Choreographer `questTendril` presenter and the `eotEffect` path in `Recruit.tsx`.
- Shop actions: the sim only reports THAT a rune buffed a unit (`runeBuffFxUnits`), not which rune. The UI keeps a
  per-card ledger of buff totals by source label and diffs it (`runesThatBuffed` in `fx/runeBuffLabel.ts`), so
  Seasoned Ledger and Kindling draw the trail from their own badge. Before this they only sparkled.
- Combat: a rune buff carries the rune's display name as its `source`; `runeIdForBuffLabel` resolves it to the rune
  id so the trail leaves the player's rune node. Enemy rune buffs keep the sparkle alone.

**Sound.** Two Sound layers on the def (travel + impact). The sound does not stack: a board-wide buff fires one
trail per unit and only the first of the burst is audible (`runeBuffTrailSoundAllowed`, same dial as a spell's cast
sound, `spellCastSfxGapMs`).

**Non-obvious, worth knowing.**

- A slider param outside its spec range is CLAMPED when the def loads (`coerceParams`). An `endOffset` above 2000 ms
  is silently cut to 2000, so a long clip cannot be trimmed short from the def alone. The travel clip was cut to its
  first 2 seconds on disk for that reason.
- The tribe-coloured `tendril-trail-<tribe>` variants are untouched; only the neutral fallback moved to the new def.
