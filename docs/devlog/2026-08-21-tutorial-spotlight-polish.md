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

## Follow-up: no scrim under a picker, and playing what you discovered

**No scrim while a picker is open** (owner: "step 36 should have no scrim so the player's screen isn't dark").
The Discover overlay already dims the board behind itself; the coach's scrim stacked a second dim on top, so
the cards the player was choosing between sat under two layers. Dropped whenever a Discover / Choose-One is
open — which covers step 57 as well.

**A new step 37 — "Play Your Pick".** The Discover put a Beast in hand and nothing asked for it, so the lesson
ended with a card sitting somewhere unexplained. Its completion is a BOARD COUNT rather than `played: cardId`,
because the card the player chose is theirs — the course cannot know its id.

That extra body forced round 7's arithmetic, and getting it wrong twice is worth recording:

1. The board now arrives at round 7 **full at 7**, so the "play Echohorn" step was simply refused. The
   make-room step had to move to the FRONT of the round — clear space, then shop.
2. Two slots are needed, not one: one for Echohorn, one for the Baby its Rally re-fires. The first attempt used
   a free "sell down to 5" count — and a playthrough promptly sold **T-Rex**, which the very next step
   (`r7-position`) and round 8 both depend on. Replaced with two explicitly NAMED sells (Kennelmaster, then
   Sea Urchin, whose Shout has already paid off), which also protects both Packstriders for round 8's triple.

Verified by a full playthrough: board 1→2→3→4→6→7→6→5→5 (never over cap), the golden triple still fires in
round 8, and the course reaches wave 12 `gameover` with 2 seats alive — the 1v1 final intact.
