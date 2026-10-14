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
- **Start Game** (the ceremony's button) was the flat tangerine Go button. It now wears the Gem plate: `--ui-plate`
  inside the thin painted gold edge (`--ui-edge`), the shared sheen and bevel, cream body-font text in sentence case.
- **Main Menu / Back** (`.hsback`, also the Practice options screen's Back) wears the same plate. The armed
  "Abandon?" state is the same plate warmed to the theme's warning reds.
- **Difficulty chips** sit on the newer UI's dark chip with a lit top edge; the three hues are unchanged.
- The ceremony fades the title out with the rest of the header (it faded the lockup before).

## Decisions worth knowing

- **The buttons are the End Combat pill's paint, exactly.** The first cut read "fancy and blue and gold trim" as a new
  bright-blue plate with gold studs and a thick press edge. The owner rejected it ("that button looks nothing like the
  buttons i want") and pointed at the End Combat pill. When the owner says blue with gold trim, or "the newer UI
  buttons", he means the shared Gem plate: `--ui-sheen` + `--ui-plate` + `--ui-edge`, theme tokens only. No new colours.
- "The button" was read as Start Game; Main Menu was restyled to match.
- Then, same day: "lets incrase the size and put some little details on the sides of the button text". Start Game was
  enlarged (24px label), then enlarged again on "looks good - make the button larger though" (30px label, padding and
  ornaments scaled with it, about 60% larger than the 19px original), and carries a small gold flourish either side of the label: a fine line fading
  away from the text into the theme's gold stud (`.hsc-start-orn`). These ornaments were asked for; the studs in the
  rejected first cut were not.
- Hover lifts 1px onto the lit plate and the press drops 1px, like the Compendium's buttons. `translate`, not
  `transform`: `hscRise` holds `transform` on Start Game (fill forwards) and would swallow it.
- The ceremony tuner's `logoScale` / `logoGap` dials are removed with the lockup they sized.
- DESIGN.md reserves Tangerine for the next action. Start Game is the Gem plate here on the owner's explicit brief.

## Verification

- Rendered in a local preview of this branch: the picker (title, divider, Back) and the ceremony (Start Game).
- `rankedEntry.test.tsx`, `heroSelectGauntlet.test.tsx`, the hero-select suites, `stageTripwire`, `patchNotes`: green.
