# 2026-10-25 — Duos pass polish: the arrival grows, the portrait stays in combat, release-only passing

Three owner asks on the Duos pass (2026-10-25). Oracle: R-DUOS-PASS-02, R-DUOS-PASS-03, R-DUOS-VIEW-02
(approved/foundation.ts). Patch note under 2026-10-25.

## What

- **The arrival grows** ("can you make the passed card get larger as it gets closer to hand?"). `passLob.emergeFrames`:
  the card leaves the teammate portrait at about the portrait's size (`emergeStartScale`, clamped 0.18 to 0.6 of a
  hand card) and its size follows how close it is to the hand, eased and back-weighted, never shrinking, landing at
  exactly full size in its slot. It turns face up between 35% and 80% of the 640 ms flight. Transform / opacity only.
- **Found while capturing it:** the arrival was blank after its flip (the flying copy had no face, so the back turned
  away onto nothing), and the real card showed in the hand during the whole flight (the `passincoming` class was
  overwritten when the hand re-rendered). Now the flying copy is a clone of the landed card (its inline hide removed,
  fitted to the slot size: one layout read per pass) and the waiting card is hidden by a Web Animation React cannot
  undo. The dead `.passincoming` rule is gone.
- **The teammate portrait stays in combat** ("also keep the teammate portrait in the bottom right during combat too").
  `VersusHud` mounts `DuosMateDock` in recruit and combat; in combat it is a face only (no click, no pass glow, no
  note), same spot.
- **Release-only passing** ("Passing a minion or spell should require the player to release it over their teammates
  frame"). The hit area was the square box around the disc and the shared pointerup / pointercancel handler passed on
  either. Now `overMateFrame` (the round disc only) drives the hover glow and `passOnRelease` (a real `pointerup` over
  the disc, mouse or touch) is the one pass path. No proximity, snap or rail-row pass path existed; the rail row stays
  a click into the teammate view.

## Verification

- `duosMateDock.test.tsx` (the ramp: starts at the portrait size, grows monotonically, under half grown at half way,
  lands at 1 in the slot; the combat portrait), `duosPassRelease.test.ts` (inside, the rim, box corners, just
  outside, hover then away, touch, cancelled touch, one pass path in Recruit).
- Live (a local build of this branch merged with the dev tuner PR, live backend, Claudebot1 + bots): arrival frames at
  20 / 50 / 80% before and after, and the clean Duos capture set, saved in the session scratchpad.
