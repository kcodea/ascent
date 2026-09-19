# 2026-09-18 — Glossary true-up: one definition per term, Amplified pill, legible Compendium glossary

**Owner handoff (three items):** (1) Rune of Amplification's text becomes the one-liner *"**Equipment** you do
not use becomes **Amplified**."*; (2) an **Amplified** keyword pill + glossary entry (*"An Amplified Equipment
will trigger its effect twice for no additional gold."*) that shows wherever the word is printed and is coloured
like other keywords; (3) the Compendium glossary's term names were pale orange on cream (unreadable), and every
term in the game needed a true-up against the current rules with ONE definition shared by the hover pill and the
Compendium.

## What changed

- **`packages/ui/src/keywordGlossary.ts` is now THE glossary.** Each `KeywordDef` carries `section`
  (`triggers` / `combat` / `build` / `tokens`), an optional `mechanic` link into the `MECHANICS` registry (glyph +
  card predicate for the Compendium row), an `icon` for terms with no registry mechanic, `detectRe` for a
  lower-case phrase that raises a pill without being coloured ("summon … from your hand", "permanently",
  "improve"), `pill: false` for Compendium-only rows (Watcher) and `inert` for a row with no card filter (Gilded).
- **`mechanics.ts` no longer authors definitions.** `Mechanic.def` is filled at module load from the glossary
  entry whose `mechanic` links it (a missing link throws), so the medallion registry and the pill can never
  disagree. Glyphs and `detect` predicates are untouched — no card wears a different medallion.
- **`MinionBook.tsx`'s `GLOSSARY` is generated** from `KEYWORD_GLOSSARY` × `GLOSSARY_SECTIONS`. Mechanic rows
  filter by the registry predicate as before; text-only rows (Start of Turn, Orbit, Amplified, Starform, …) filter
  by the same text hit the pill uses (and go inert when nothing in scope matches, as before);
  `GLOSSARY_MECHANIC_IDS` is derived, so `mechIcon.test.ts` still guards it.
- **`termColour.ts`** drops `EXTRA_MECHANIC_TERMS` — every coloured non-tribe term is a glossary term by
  construction (Orbit, Bleed, Equipment, Shop Spell are glossary entries now).
- **Pills on more surfaces:** `RuneCard` hover shows the `KeywordDefs` column for the rune's text (beside the
  preview cards when it has any); the Equipment slot's tooltip (`StatusBar`) stacks the pills its text raises.
- **Legibility:** `.gloss-group` re-pins `--ink` / `--ink2` to the root's dark values — `.book` overrides `--ink`
  to a pale orange for its black surround, which the cream glossary panels inherited. The codex body is now
  `auto-fit` columns (four sections).
- **Rune of Amplification** text shortened to the owner's one-liner; the Amplified definition lives in the pill.
  `docs/GAME-RULES.md` Equipment section updated to match. Reward/engine untouched.

## Definitions re-read against the engine (rewritten)

- **Rise** — returns once with its **printed** stats at 1 Health (was "returns with 1 health").
- **Dawn / Dusk** — board GEOMETRY (`sim/alignment.ts`): left half Dawn, right half Dusk, the exact middle
  minion counts as both; locked when combat starts. The old pill said Celestials "alternate each combat" — wrong.
- **Attachment** — dropped directly onto a friendly minion sharing a type (`magnetizesTo`), not "to the left of
  a mech".
- **Stealth** — lost when it attacks. **Avenge** — "Avenge (N): each time N of your minions have died".
- **End of Turn** — "…before you fight" (from the Compendium wording).

## Tests

- `keywordGlossaryCoverage.test.ts` rewritten: walks EVERY shipped text (cards + gilded + Choose One branches,
  runes, Equipment, Gifts, hero powers, quest objective/reward text) — FORWARD (every coloured term has a
  definition) and REVERSE (every pill entry is raised somewhere, or is on the deliberately-kept list: `stealth`
  — badge with no printed card; `watcher` — Compendium-only). Also pins the four Amplified surfaces.
- `detectCardKeywords.test.ts` — order pins updated to the new section order; new cases for `detectRe`
  phrases, Compendium-only rows and Amplify/Amplified.

## Judgement calls to confirm

- **Improve** and **Permanent** raise pills on lower-case text ("improve", "permanently") — they were on the
  owner's term list, but they are frequent (55 / 40 texts), so hover columns get longer on those cards.
- **Equip** and **Equipment** are separate entries (both on the owner's list); Calibration Master shows Equip +
  Equipment + Amplified.
- **Gift / Clue** are defined as classes; the hover preview still shows the actual card where a card is named.
