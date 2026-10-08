# 2026-10-08 - Flo Rida says "permanently improve this"

**Owner ask:** "flo rida should add the word permanently to its text so it does not reset per round"

**What changed.** `b2_florida` now reads "When you summon a **Beast**, give it **+5/+5** and permanently improve
this." (Gilded: +10/+10). The +X/+X given to the summoned Beast is unchanged. Patch note in the 2026-10-08 block.
Oracle: `R-FLORIDA-01` (persistence).

**Root cause (investigation).** There was no engine reset to fix. The improve rides the per-instance
`summonBonus` counter (`onSummonTribeBuffFlat`, twin bodies in `recruit.ts` and core `factories.ts`):

- Shop, play and End-of-Turn summons write the board card directly, so they persist.
- Combat seeds the clone from the board card (`minion.ts`), the clone counts combat summons, and
  `carryBacksFor` returns it as `playerSummonBonus`. `settleCombat` (every mode, lobby included) writes it back
  onto the board card by `sourceUid`. Flo is not in `COMBAT_ONLY_SUMMON_BONUS`.
- A triple keeps the two highest copies' improvements (the universal `summonBonus` rule in `checkTriples`).

So the only defect was the text: "improve this" did not say the growth lasts. The new tests pin the behaviour so a
future change cannot quietly make it per-round: 3 rounds of Shop summons (5, 10, 15), a combat Pack Leader Echo
carrying back and feeding the next Shop grant, an End-of-Turn summon, Gilded read-time doubling, determinism, and
the live text on the shared `liveCardText` chain.

**Flagged, not changed.**

- **Beardsley** (`b2_beardsley`, "give it +1/+1 and improve this") runs the exact same factory and the same carry-back,
  so its improve is already permanent too. Its text was left alone; the owner's wording named only Flo Rida.
- **Rise edge.** A risen body resets its `summonBonus` to 0 (R-RISE-01). If a Flo with Rise dies and rises in combat,
  the carry-back writes the risen body's count (losing the pre-combat growth), or nothing if the risen body saw no
  summon (the `> 0` filter keeps the old value). Flo has no native Rise; worth an owner ruling on whether
  "permanently" should survive a combat Rise.
- **In-place gild.** Flo reads `(base + improve x step) x golden`, so gilding an existing copy in place (Indy, Golden
  Touch) doubles growth already earned. `GOLD_SCALED_ACCRUAL_CARDS` exists for this on other cards; Flo and Beardsley
  are not in it.
