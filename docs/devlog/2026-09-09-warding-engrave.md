# Rune of Warding × Engrave — the tripled Health now carries back (Bug Board 7130a89b)

Player report (wave 11, Indy): "rune of warding does not work with a dragon and transcendance. i believe
'start of combat' occurs before transcendants engrave effect."

**The reporter's symptom was right; the guessed cause was not.** Engrave is not an ordering question — the
Transcendant aura is a LIVE ADJACENCY READ inside `ctx.buff` (owner respec 2026-08-17), resolved at the
moment stats are gained, so anything that gains stats through `ctx.buff` beside a living Transcendant is
recorded into `permaGain` and carried back. Rune of Warding's Start-of-Combat block did NOT go through
`ctx.buff`: it tripled Health by direct assignment and hand-emitted the buff event. The fight showed the
tripled body; the carry-back never heard about it.

**Fix** (`packages/core/src/combat/simulate.ts`): the tripling loop calls `ctx.buff(lead, 0, lead.health * 2,
lead.uid)` once per rune copy — which is what every other Start-of-Combat rune grant (Five Banners, United
Front, Tempered Time, Underdog, Stoked Menagerie, Held Strength) already did. `ctx.buff` also lifts
`maxHealth`, so the old hand-rolled lift is gone with the bypass. The buff event's shape is unchanged
(same target/amount/source), so the replay and the goldens are untouched.

**Lane**: `packages/core/src/combat/runeWardingEngrave.test.ts` — a warded Dragon beside a Transcendant
carries back +12 Health flagged Engraved; without the Transcendant the gain stays combat-only; an EG body
carries it too. Sabotage-checked: two of the three fail with the direct-assignment code restored.

Bug Board: 7130a89b closed as fixed.
