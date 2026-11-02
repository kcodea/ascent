# 2026-11-01 — rail emotes sized off the Docked slice (R-EMOTE-RAIL-DOCKED-01)

Owner: "emotes on the rail are massive and look bad. can you fix them?"

**Cause.** `placementFor` sized a rail seat's bubble at `BUBBLE_TO_PORTRAIT.rail` (3.1x) the width of the seat's
`.lobbyface`. That multiple was tuned for the old Gem rail's ~58 px round face. On the Docked rail (every mode since
#2504) `.lobbyface` is the slice's portrait art, which spans about half of a 245 px slice, so the bubble came out
~470 x 300 stage px at 1080p: five slices tall, over the board, the End Turn gem and its neighbours.

**Fix** (`emotes/emoteBubble.ts`). A seat inside `.lobbyrail.lrv-docked` is placed by `fitBesideSlice`:

- height = 1.15x the slice's height (the slice already tracks the board's scale, `--dk-s`, so the bubble does too);
  width from the art's aspect. 1.15 keeps the painted part of neighbouring bubbles inside one slice pitch, so all seven
  opponents can emote at once with no slide or wait.
- a floor of 36 SCREEN px tall (`DOCK_MIN_SCREEN_H / screenScale()`): on a phone the whole stage is drawn at ~0.4, and a
  slice-height bubble was unreadable there. That floor replaces `PHONE_BUBBLE_SCALE` for docked seats (the phone run is
  page-scaled, where `phoneLayoutOn()` is false anyway).
- level with the slice's middle, right end a small gap left of the slice, then walked further left past anything in its
  band from `DOCK_OBSTACLES` (every docked slice, the round slice, `.rfbwrap`, `.etb-base`, `.goldpill`: the same pieces
  `useDockedRail` measures). So a seat beside the gem or coin gets its bubble left of that piece, and a Duos pair laid
  side by side gets it left of both slices.

One rect read per bubble plus a handful of obstacle rects, never per frame; the pop animation is unchanged
(transform + opacity). The Gem rail fallback, the Versus foe block, the combat foe, your own portrait and the
spectator stands keep R-EMOTE-LAYOUT-01's portrait fit.

**Measured** (dev server, headless Chrome, isolated contexts, local Worker for Versus): 1920 x 1080 lobby slice
245 x 61 -> bubble 109 x 70 (was 467 x 299); Versus 1v1 / Duos slices 245 x 83 -> 148 x 95; phone 844 x 390 -> 94
stage px tall (~37 screen px). Seven simultaneous rail emotes: all shown, none overlapping, none over a slice, the gem
or the coin.
