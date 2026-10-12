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

The rule itself (what Yes and No do, what leaving costs) is unchanged, so R-RANK-06 is not amended.

## Verified

`packages/ui/src/rank/rankedEntry.test.tsx` (14 tests): the picker stays mounted under the dialog, the veil is
painted under the card, the veil press and No both close after the exit, reopening mid-exit keeps the card, and a
CSS tripwire that the four keyframes touch only `transform` / `opacity`, that the bounce overshoots and rests at 1,
and that reduced motion is honoured. Not looked at in a real render by Claude (no dev-server slot was free): the
timings and the blur strength are first guesses for the owner to tune by eye.
