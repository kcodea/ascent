# 2026-10-08: "printed stats" wording sweep + the Rise definition

**Owner ask:** "find any place the game says 'printed stats' and fix the wording. make rise say 'Returns once when
destroyed with 1 health.'"

## What changed (text only, no behaviour)

- `keywordGlossary.ts`: Rise def is now exactly "Returns once when destroyed with 1 health." This one def feeds the
  hover pill, the Glossary and the Compendium. Its wiki fingerprint moved `e1b677d7` → `2187eacf` (all ten
  `covers` in `rulesWiki/kwCombat.ts` re-pinned after re-reading each answer).
- `rulesWiki/kwCombat.ts`: the five Rise answers say "a fresh copy" / "its original Attack" instead of "the plain
  printed card" / "printed Attack". The `rise` entry opens with the owner's sentence.
- `rulesWiki/glossaryMore.ts`: plain copy = "a fresh copy of the card" (was "fresh card as printed").
- `patchNotes.ts`: four older entries reworded the same way; new 2026-10-08 entry.
- `UnitEditor.tsx` (sandbox): the card-swap aria-label.

Left alone on purpose: plain uses of the verb ("a tribe printed on the card", "spells cost whatever is printed on
them", "printed number" in patch notes) read as normal English. No card, rune, hero or quest text used the jargon.

## Rise behaviour check

Matches the new line: `simulate.ts` resets to `def.attack × (gilded ? 2 : 1)` and `health = 1`, strips granted
keywords and per-instance improvements, then re-applies Auras (R-RISE-01, R-RISE-04); the Shop Rise
(`recruit.ts riseReturn`) builds a fresh body the same way.

## Guard

`R-TEXT-PRINTED-01` (registry `text.ts`) + `packages/ui/src/plainRulesWording.test.ts`: pins the Rise def and sweeps
glossary defs, wiki Q/A, card and rune text for "printed stats/Attack/Health/card/body/copy" and "<body> as printed".
