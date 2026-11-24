# 2026-11-24: The ripple through hero select and into the game

Owner and Mike, the day the reveal shipped. Rules R-LOCATION-05 and R-LOCATION-06.

- **The pick** (`locationReveal/heroRipple.ts`): the living place is drawn small into a picture (`placeGl.ts`, now shared with hero
  select's ground, on the same clock), then one pass draws the finished composition (veil, scrim, glow, the art in its circle, the
  equipped ring) and bends all of it with the reveal's own lens. The picture is what the wave has passed. A DOM cannot be bent, but
  this picture matches the DOM layer for layer, so the hand-over is invisible.
- **The ceremony** keeps its machine, phases and tuner; with the ripple it lays its DOM out finished from commit (no clone, exits,
  bursts or flash), hides it, and shows it when the wave is done. Decided once, at commit, by `readyRipple`.
- **Start Game** was first the same wave outward. The owner: it hung, and it was one wash too many. So the hero takes their seat
  (`hero-select/heroSeat.ts`): plain DOM layers, every motion WAAPI transform / opacity, so the browser runs them on its own and they
  keep moving while building the run blocks the page (about 0.5 s in all). Lift on the press; the place alone holds the screen on
  the ripple's canvas, stilled before the block; then the flight, once three frames in a row have come on time. The seat's face is
  hidden but its ring stays: the board art has a dark socket under it.
- **The lobby reveal waits** (`lobbyReveal.hold / release`): it is up from the start (the shop and its clock wait behind it), but its
  dim and line-up begin as the hero lands.
- **Ready before the press:** hero select makes the ripple ready in the background and uploads the hero being looked at and the
  player's ring; one unseen draw. Nothing ready = exactly the older ceremony and curtain.
- **Phone reveal sound:** the light reveal decoded the full version's clips (85 MB of decoded audio at peak, over the 80 MB
  budget) and played none. It now decodes only the four short kinds it uses, and plays them.

Prod bench, 1080p: Start Game leaves at about 0.8 s, the board is in view by 1.0 s, seated at 1.35 s. Pick: median 4.2 ms; the first pick of a
fresh browser profile has one 40 to 58 ms frame (Skia compiling the name plate's paint on the GPU process, as the old ceremony did); the
second run's worst is 12.5 ms.
