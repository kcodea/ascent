# 2026-10-12 — The ranked confirmation opens over the Play menu, with a bounce

**Owner ask (with a screenshot of the confirmation on its own navy page):** "can this actually take place on the play
menu screen instead? and have the background blurred and darkened? can we add a bit of movement to the experience?
after clicking ranked play, i want the screen to darken and blur as this window expands out with a little bit of a
bounce."

## What changed

The R-RANK-06 confirmation (`Title.tsx`, `rankedConfirm`) was a `.modepick` page of its own, so it replaced the
mode picker with an opaque navy screen. It is now `.rankedconfirm-ov`, one layer above the picker (z 401 over 400):

- **The veil** (`.rankedconfirm-veil`) darkens the picker (`rgba(3, 7, 16, 0.6)`) and blurs it
  (`backdrop-filter: blur(7px)`). The blur is STATIC; only the veil's opacity fades in (0.26 s), so the blur is
  painted once and faded by the compositor. The blur radius is never animated.
- **The card** expands out of the centre (`rc-pop`, 0.44 s): scale 0.55, out past full size to 1.06, a dip to
  0.985, rest at 1. `transform` + `opacity` only.
- **"No, go back."** plays a 160 ms reverse (`.closing`, `RANKED_CONFIRM_EXIT_MS`) before the card unmounts, so the
  exit matches the entrance. Pressing the dimmed picker around the card does the same. Pressing Play again during
  the exit cancels it.
- **Reduced motion:** no animation; the veil and card simply appear.

## Then: the Compendium's chrome

**Owner asks, same day (with screenshots of the Compendium):** "can you use the border that the compendium uses? and
emulate the title and underline structure here?" and "can you make the buttons look like the UI elements here? these
are in the top right of the compendium".

- **The frame:** the book's painted 9-slice (`/frames/compendium-frame.webp`) and its top and foot crests, over the
  same dark plate, at `--rc-s: 0.2` (the book uses 0.25; this window is a fraction of its size).
- **The title:** "Ranked Lobby" in the book's title face over the painted name divider, then the question under it
  where the book has its subtitle. The title's WORDING is Claude's pick, not the owner's.
- **The answers:** two Gem plates (the book's zoom / close / set-picker pill: sheen + plate inside a gold edge, a
  7px corner). "Yes, let's go." is the LIT plate so the primary still reads; "No, go back." is the plain one.
  The orange `.endplay` button is gone from this window.
- The rules live in styles.css under their own classes (`.rankedconfirm`, `.rc-crest`, `.rc-title`, `.rc-btn`),
  not shared with compendium.css: that sheet only loads with the book. The art and the `--ui-*` tokens are shared,
  so the UI Theme switch reskins both.

The rule itself (what Yes and No do, what leaving costs) is unchanged, so R-RANK-06 is not amended.

## Verified

`packages/ui/src/rank/rankedEntry.test.tsx` (15 tests): the picker stays mounted under the dialog, the veil is
painted under the card, the veil press and No both close after the exit, reopening mid-exit keeps the card, and a
CSS tripwire that the four keyframes touch only `transform` / `opacity`, that the bounce overshoots and rests at 1,
and that reduced motion is honoured.

Looked at in a real render of this branch's production build (served statically, 1600x900): the picker stays visible
behind the window, darkened and blurred; the window sits centred in the gold frame with its crests, the title over
the divider, and both Gem-plate buttons; "No, go back." closes it and leaves
the picker, with no entry stored. That is the SETTLED state only. The motion itself (the fade and the bounce) was
not watched: the preview pane does not run animation frames reliably, so the timings, the blur strength and the
bounce size are first guesses for the owner to tune by eye.
