# 2026-09-24: Compendium set picker

Owner ask (verbatim): *"add a set drop down in our art style in the compendium on the far right of the tier bar so
you can view any card sets. default to the active set, though."*

## What shipped

- `packages/ui/src/CompendiumSetPicker.tsx`: a custom listbox dropdown (not a native `<select>`). Button with
  `aria-haspopup="listbox"` / `aria-expanded`; options are `role="option"` with `aria-selected`. Arrow keys,
  Home/End, Enter/Space; Esc and click-outside close it. Esc is claimed on a window CAPTURE listener while open,
  so it closes the dropdown and not the whole Compendium (Game.tsx's Esc handler is bubble-phase on window).
  The live set wears a gold "Live" tag.
- `MinionBook.tsx`: the book's set is now local state. It lists every entry in `SETS` (Set 1, Set 2, Set 3,
  including the disabled ones). The default is the same set the book always opened on: the active set from the
  title, the run's pinned set mid-run (normally the same set). The book remounts per open, so it resets each time.
- Styles in `styles.css` next to the tier chips: same chip grammar as the tier buttons and Gilded toggle, a dark
  list with the gold Gilded face on the picked row. Open/close is a one-shot opacity + transform transition.
  The button gets the gauntlet cursor from the global `button` rule; the `li` options use the gauntlet URL form.

## Runes tab: Neutral filter

Owner addition, same PR (verbatim): *"add a "neutral" filter to the rune section of the compendium next to the
tribes filters."* A Neutral pill now sits after the set's tribe pills in the Runes tab (same `.book-runetribe`
style). An untribed rune is one whose `tribes` gate is ABSENT (`RuneDef.tribes?`, "Absent = tribe-agnostic" in
`packages/core/src/types.ts`; no rune uses an empty array, but an empty one is treated as untribed too). Neutral
ORs with the tribe pills like any pill, a tribe-gated rune never matches it, and it respects the picked set's
Runeforge scope. It survives a set switch (the tribe pills a new set lacks are dropped).

## How it coexists with "findable this run"

Mid-run the book scopes to the run: the run's active tribes, "findable this run" in the subtitle, and the
run-aware Choose One (Both) text. That scoping now applies only while the picker shows the run's OWN set. Pick
any other set (or open from the title) and the book shows that set's whole tribe roster and says "in the game".
Runes follow the picked set's Runeforge scope. Heroes are not set-scoped, as before.

Switching sets drops tribe chips the new set lacks (tier, search, Gilded and keyword filters carry over).

## View-only

The picker only changes which pool `poolFor(setId)` the book reads. It never writes the store, the run or the
registry. `activeSet()` is read once, for the title default and the Live tag (the "what would a new run play"
question it exists to answer).

Test: `packages/ui/src/compendiumSetPicker.test.tsx` (default = active set, switching swaps the listing and rail,
active set + run unchanged, Esc closes only the dropdown, the Neutral rune pill per set).
