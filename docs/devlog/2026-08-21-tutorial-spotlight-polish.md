# 2026-08-21 — tutorial spotlight polish: softer, bigger, and out of the player's way

Owner notes after playing the reworked course.

**Softer, larger spotlights.** The cutout padding was 14px and the mask's feather blur 11 — tight enough that a
card's own glow, a pill's outline or a row's overflow sat OUTSIDE the hole and stayed dimmed, so the highlight
read as missing the thing it pointed at, with a visible edge where the scrim ended. Padding is now 26 and the
feather 22 (with the ring halo 3 → 6), and all three **scale with the stage** like every other authored size,
so the softness stays proportional instead of being fixed pixels on a small window. The blur filter regions
widened (160% → 200%) so the larger blur isn't clipped at its own bounds. Measured on the dev viewport: 14 → 21px
of padding per side, feather 11 → 18.

**The coach panel stopped covering the Discover picker.** Reported at steps 36 and 57; one cause. A picker fills
the middle of the screen, and the panel is centred when a step has no anchor (36) or flips up off the hand when
it does (57) — either way it landed on the cards the player has to choose between. While a Discover or Choose-One
is open the panel now parks at the bottom, the same treatment combat already uses. Verified at both steps: panel
at y 1002 against cards at y 591, no overlap.

**Hero-power reminders light the warband too.** They spotlighted only the button, but Preparation is *targeted* —
tapping it is half the instruction, and a first-time player still has to know the buff goes onto one of their own
minions. The reminder now lights the power AND the warband with an arrow running between them, matching what
`r1-power` already did with its named target card.

Gates: typecheck ✅ · lint 0 errors ✅ · 6511 tests / 396 files ✅ · build:web ✅
