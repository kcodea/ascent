# 2026-10-23 — Two Set 3 Summit minions: Vellum (Royal Edict) and Ending

Owner ask: "add these T7 minions and wire their art", Vellum (T7 Dragon 12/8, Equip Royal Edict (2): Improve your
Shop spells by +2/+2. Your next 3 spells cast from hand this turn cast an additional time) and Ending (T7 Undead
1/1, When you Overflow a minion, give your Undead Aura +4 Health). Art wired for both and for the Royal Edict icon.

**Vellum / Royal Edict** (`d3_vellum`, Equipment `royal_edict`, R-EQUIP-EDICT-01)

- New recruit factory `equipmentRoyalEdict`: +2/+2 to `spellBonus` (the run's spell power, same channel as Adeptus
  and Spell Generator), then arms `RunState.edictCharges` (3) at `edictExtra` (1) extra casts each.
- One read helper, `nextSpellExtra(state)`, folds Comet / Nimbus' `nextSpellExtraCasts` plus one edict charge's
  extra. It replaced the three direct reads (`spellCastsWithout`, `rubyCastCount`, `giftCastCount`), so the x N
  badge previews it. One spend helper, `spendNextSpellCharge(s)`, replaced all seven reducer spend sites: it clears
  Comet's bank and spends ONE edict charge. So "cast from hand" means exactly the casts Comet already covers.
- Charges clear at the turn boundary ("this turn"). Charges add (an Amplified use arms 6); the extra keeps the max.
- Gilded (judgement call): +4/+4 and 2 additional times per charge, still 3 spells.

**Ending** (`u3_ending`, R-AURA-ENDING-01)

- New arena body `overflowGrowUndeadAura` on the `summonOverflow` trigger (Squatimus / Bicycle Bob), calling
  `grantUndeadAura`, the Lantern of Souls channel. In the Shop it raises `undeadHealthBonus`. In combat the living
  Undead gain +0/+4 now and the gain carries home via `playerUndeadAuraGain`. The Aura is run-wide and permanent,
  so the combat grant is permanent too, the same as a Lantern cast mid-fight. No spell power (not a spell).
  Gilded +8.

Tests: `packages/sim/src/set3T7VellumEnding.test.ts`.
