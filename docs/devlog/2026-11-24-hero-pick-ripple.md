# 2026-11-24: The ripple through hero select and into the game

Owner and Mike, the day the reveal shipped. Rule R-LOCATION-05.

- **One canvas, two waves** (`locationReveal/heroRipple.ts`): the living place is drawn small into a picture (`placeGl.ts`, now
  shared with hero select's ground, on the same clock), then one pass draws the finished composition (veil, scrim, glow, the art in
  its circle, the equipped ring) and bends all of it with the reveal's own lens. IN: the picture is what the wave has passed. OUT:
  it is what the wave has not reached. A DOM cannot be bent, but this picture matches the DOM layer for layer, so both hand-overs
  (wave to ceremony, ceremony to launch) are invisible.
- **The ceremony** keeps its machine, phases and tuner; with the ripple it lays its DOM out finished from commit (no clone, exits,
  bursts or flash), hides it, and shows it when the wave is done. Decided once, at commit, by `readyRipple`.
- **The launch** holds the living picture instead of fading to navy. Building the run stops every frame for 0.2 to 0.4 s; the place
  is eased to a standstill first (`still`), so there is nothing moving to see stop. A Versus wait keeps it alive.
- **Ready before the press:** hero select makes it ready in the background and uploads the hero being looked at and the player's
  ring; one unseen draw of each mode. Nothing ready = exactly the older ceremony and curtain (phones, reduced motion, no WebGL 2, no
  location, watched hero selects).
- **Phone reveal sound:** the light reveal decoded the full version's clips (85 MB of decoded audio at peak, over the 80 MB
  budget) and played none. It now decodes only the four short kinds it uses, and plays them.

Frames (prod bench, 2560x1440): pick median 4.2 ms; the first pick of a fresh browser profile has one 45 to 58 ms frame (Skia
compiling the name plate's paint on the GPU process, as the old ceremony did), the second run's worst is 12.5 ms.
