# 2026-09-18 — Term colouring pass, Equip/Starform/Collapse pills, Vaultkeeper live in combat

Owner handoff (four presentation items, three shipped here; the fourth was a duplicate of the first).

## Term colouring — root cause and fix

**Report:** "Seedling Spirit's 'Spirit' in text isn't coloured, and Collapse should also be a coloured keyword."

**Root cause:** there was no term-colouring pass at all. Colouring was *bold-driven*: `mdBold` turned `**…**` into
`<b>`, and `.card.compact.showtext .drawer .desc b { color: var(--c) }` painted bold in the card's tribe colour.
So a tribe / mechanic word was coloured only when the card author happened to wrap it in `**`. Seedling Spirit's
text is `**Rally:** summon a random Spirit from your hand.` — "Spirit" is plain, so it rendered as body text.
A content sweep found **371** such plain occurrences across cards, gilded texts, Choose One branches, runes and
hero powers (top offenders: Shop spell(s) ×64, Rubies ×32, Discover ×26, Beast(s) ×32, Spirit(s) ×39, Fodder ×19,
Dragon(s) ×20, Starform ×12, Celestial(s) ×16, Consume(s) ×15, Collapse(s) ×6, Equipment ×7, Orbit ×4, …).

**Fix:** `packages/ui/src/termColour.ts` — `colourTerms(html)` runs LAST in the rules pipeline and wraps every
depth-0 tribe name (singular + plural, all ten tribes) and every `KEYWORD_GLOSSARY` name/alias (plus Orbit, Bleed,
Equipment, Shop Spell) in `<b class="term">` (`term tribe` for tribes), so it takes exactly the colour bold
already does. Depth-aware: text inside `<b>` or any marker span (`descup` / `descrune` / `descboth` / `desctemp`)
is untouched, so already-coloured terms are never double-wrapped and markers keep their own colour. Idempotent.
Case-sensitive + letter-bounded (no "Mechanic", no lowercase verbs). `mdBold` now folds it in (rune tips, hero
powers, Compendium, hero select); the card body uses the new `rulesHtml` (markers first, then terms) — which is
what `Unit.tsx` renders too, so combat is covered by the same path.

**Judgement call (flag for the owner):** terms take the *card's* tribe colour (`--c`), matching the existing bold
convention and the "(Both) follows the tribe colour logic" ruling — not each tribe word's own hue. A Kobold
card's "Beasts" reads orange, not green. The `term tribe` class is there if that should change.

**Test:** `termColour.test.tsx` — unit cases + a sweep of every card / gilded / Choose One / rune / hero-power
text through the real pipelines asserting zero uncoloured terms, plus a jsdom render of Seedling Spirit and a
plain-Collapse card through the real `Card`.

## Keyword pills (`keywordGlossary.ts`, the KeywordDefs hover column)

Owner wording, verbatim:
- **Equip** (new): "Can be triggered once per turn, per equipment, for a cost." Detects on the word `Equip` in
  text — every Equipment minion prints `**Equip <Name> (cost):**`, and runes saying "an Equip minion" hit too.
  `Equipment` alone does NOT raise it (letter-bounded match). No schema badge (`on: 'equip'` is a trigger).
- **Starform**: "A minion that occupies a Shop slot and stays in place until purchased or destroyed. Purchasing a
  Starform grants stats to the left-most Celestial."
- **Collapse**: "Grant 50% of your Starform's stats to 3 Celestials and destroy it."

Not added to the `MECHANICS` registry / Compendium glossary (that list drives the medallion glyph too, and none of
Starform / Collapse live there either) — `GLOSSARY_MECHANIC_IDS` untouched, `mechIcon` drift test green.

## Vaultkeeper — live in combat

**Report:** "Vaultkeeper's text doesn't update in real time in combat."

Both chains already read the umbrella (`spellsCast + rubyCasts`), but in combat they read `run.spellsCast`, which
only takes the in-fight carry-back (`CombatResult.playerSpellsCast`) at settle — so a Taragosa / Staff / Warden
cast mid-fight never moved the printed grant or the "N spells to next step" countdown until the shop.

**Fix:** `computeFrame` now counts `spellcast` events per side (its own tally — the event's `count` is seeded with
the player's lifetime total and 0 for the enemy) and stamps `spellsCastCombat` on every unit of that side;
`Unit.tsx` adds it to the run / `enemyScalers` umbrella. Works for the foe's Vaultkeeper too. Added to the `Unit`
memo comparator (moves only on a spellcast beat). Tests in `renderedText.test.tsx` (player side, foe side, and
the frame stamping).
