# 2026-09-24: Rune of Hoardcalling is a Dragon rune again

Owner ask (verbatim): *"hoardcalling should have a dragon tag"*. The Balance 9/23 rune rework (#1669) rewrote Rune of
Hoardcalling to "When you trigger 3 Shouts, get a Hoardflame or Dragonflame" and dropped its `dragon` tag, because
`tribeGate.test.ts` does not read "Hoardflame" / "Dragonflame" as naming Dragons. The tag is restored on
`rune_hoardcalling` (`packages/content/src/runes.ts`) and recorded as an owner ruling in the test's
`OWNER_TRIBE_RULINGS` map (the Deathtouched Apple mechanism), so the text-matching rule stays strict for every other
rune. Effect: Hoardcalling is offered only in runs that rolled Dragons, so it leaves Set 3 (no Dragons) — the
`set3RuneRoster.test.ts` Basic pins drop 110 → 109. R-RUNE-04's evidence carries the quote. Rune of Hoardflame and
Rune of Dragon Breath (same spells, untagged) were left alone pending an owner call.
