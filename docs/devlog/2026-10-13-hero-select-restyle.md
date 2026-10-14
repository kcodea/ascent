# 2026-10-13 · Hero select: Compendium-style title, blue and gold buttons

Owner: "can we remove the Ascent title from this screen? and can we move the choose your hero text up? can we actually
give it the same treatment as we did for the compendium? with the title text and the little underline icon
underneath? ... the button needs to change and should look fancy and blue and gold trim".

## What changed

- **The ASCENT lockup is gone from hero select.** `AscentLogo` is still the Title screen's.
- **"Select Your Hero" is the screen title**, an `<h1>` in the Compendium's treatment: `--font-title` 800 caps at
  0.16em, `--ui-title` gold with the hard drop and soft halo, the painted `name-divider.webp` beneath. It is the first
  child of `.hsbox`, so it rides the picker's zoom, and the group (title + heroes) centres in one auto row. The gap
  under the title is what lifts it. The run pills (Oath, Rift) moved under it as a subtitle row.
- **Start Game** (the ceremony's button) was the flat tangerine Go button. It is now a blue plate with the painted
  gold edge (`--ui-edge`), the shared sheen, an inner gold hairline and two gold studs beside the label.
- **Main Menu / Back** (`.hsback`, also the Practice options screen's Back) wears the same blue and gold plate. The
  armed "Abandon?" state keeps its red, in the same plate grammar.
- **Difficulty chips** sit on the newer UI's dark chip with a lit top edge; the three hues are unchanged.
- The ceremony fades the title out with the rest of the header (it faded the lockup before).

## Decisions worth knowing

- "The button" was read as Start Game, the screen's call to action, and Main Menu was restyled to match. Both are
  blue with gold trim.
- The blue is the title menu's Play family, not the theme's indigo plate, because the owner asked for blue. The gold
  edge and sheen are the theme tokens, so the UI Theme tuner still retunes them.
- Both buttons carry `.pressable`. Their press vars are set where the primitive cannot override them
  (`.hsback` on the line beside the other press surfaces, `.hsc-start.pressable` at two-class specificity), and
  `.hsc-start` sets NO `box-shadow` of its own, so the primitive's resting and pressed shadows are the only ones.
- The ceremony tuner's `logoScale` / `logoGap` dials are removed with the lockup they sized.
- DESIGN.md reserves Tangerine for the next action. Start Game is blue here on the owner's explicit brief.

## Verification

- Rendered in a local preview of this branch: the picker (title, divider, Back) and the ceremony (Start Game).
- `rankedEntry.test.tsx`, `heroSelectGauntlet.test.tsx`, the hero-select suites, `stageTripwire`, `patchNotes`: green.
