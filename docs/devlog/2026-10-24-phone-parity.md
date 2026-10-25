# 2026-10-24 — Phones: Pixel and iPhone are one experience (R-PHONE-PARITY-01)

**Ask (owner 2026-10-24).** "Pixel and iPhone should be 1:1 experience". After the phone layout (#2287) the two
reference phones (emulated iPhone 15 Pro 852 x 393 @3, Pixel 8 915 x 412 @2.625) showed the same game at different
sizes, and the Pixel's drag looked slower than main.

**Why they differed.** The bottom inset. iOS reports its home indicator as a 21 pt bottom inset; Chrome on a Pixel
reports 0 for its own gesture bar. The run's zoom took the inset off the height it frames against, and the plain fit
(menus, hero select) took it off TWICE (the fit is symmetric per axis). As a share of the screen the Pixel showed the run
~5.6% larger (minions 21.1% vs 20.0% of the screen height, hand pop 27.7% vs 26.1%, its Health plate 1.6 pt off the
bottom edge vs 22 pt) and the menu sidebar, Settings and the Compendium ~12% larger. Not DPR (2.625 vs 3), aspect (2.22
vs 2.17) or the UA.

**The fix.**
- `stage.ts`: one shared bottom gesture strip, `phoneBottomStrip(h, inset) = max(inset, PHONE_GESTURE_FRAC * h)` with
  `PHONE_GESTURE_FRAC = 21 / 393` (the iPhone's own share). `fitStage(..., phone)`: the run frames the housed span above
  that strip on every phone (the iPhone keeps exactly its approved framing, the Pixel's run zoom goes 0.4079 -> 0.3861);
  the plain fit (menus, hero select) no longer counts the bottom inset at all (the iPhone's menus grow to the Pixel's
  size, 0.325 -> 0.364). A phone reporting a bigger inset keeps it.
- `--pz-safe-b` (every phone in landscape, layout px): the resting hand, the corner buttons, `--edge-b`, the menu pages'
  foot, Settings and the Compendium sit on the strip instead of the raw `--safe-b`. The hand / corner-button offsets are
  layout px now (they were screen px, so they did not scale with the game).
- `touchInput.ts` `popSafe`: the hand pop's foot clears the same strip, so the pop is one proportion everywhere.
- `touchUi.css`: the lobby rail sits 56 layout px from the right SAFE edge on every phone. A `max(-110px, …)` clamp to the
  box edge held it 95 px in on a Pixel (wider safe width) vs 56 on an iPhone.
- Tried first and dropped: framing every phone against its FULL height (the iPhone grows to the Pixel's size). The
  iPhone's Dynamic Island insets (iOS reports 59 pt on BOTH long sides) then leave the rail no room right of Refresh and
  its "ROUND 9" header runs into Refresh.

**Result (share of the screen height, iPhone / Pixel, after).** Run, hand, pop, Discover, Runeforge, rail, End Turn,
corner buttons, menu sidebar, Settings and the Compendium match to 0-0.4% (they were 5-12% apart). What still differs is
hardware: widths as a share of the screen width are ~2.4% apart (the Pixel's screen is relatively wider), and the
iPhone's 59 pt island insets narrow its safe width, so the rail-to-Refresh gap is 8.6 pt on the iPhone and 70 pt on the
Pixel (never touching), and the Compendium is narrower on the iPhone (its height, cards and text match).

**Perf: the Pixel "drag regression" was the bench, not the zoom.** The drag bench moved the finger a fixed number of
SCREEN px. At the Pixel's larger zoom that path sat on the edge between the Shop row and the board, so the drop preview
toggled in and out; on the iPhone the same screen-px path went deep into the board. With the path in LAYOUT px the zoomed
Pixel matched main, and MAIN driven along the Pixel's old in-game path showed the same 8-10 frames over at 4x CPU. Not
DPR (the Pixel at DPR 3: same), not the UA, not the hand or rail (hidden: same). After this PR the Pixel's old screen-px
drag is back at main's numbers too (2 frames over vs 8-9), because its framing now equals the iPhone's. The edge-hover
cost itself is on main and left for its own pass. The bench (`perf2.js`) now drives the drag in layout px.

**Gotchas.**
- A fixed screen-px input path is not the same in-game gesture on two phones once their stage scales differ: scale bench
  paths by the stage scale before comparing devices.
- iOS reports the Dynamic Island on BOTH long sides in landscape, so the iPhone's width is the binding side for anything
  placed outside the housed span (the rail).
