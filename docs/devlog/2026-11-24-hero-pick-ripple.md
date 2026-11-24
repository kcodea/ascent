# 2026-11-24: The ripple through hero select and into the game

Owner and Mike, the day the reveal shipped. Rules R-LOCATION-05 and R-LOCATION-06.

- **The pick** (`locationReveal/heroRipple.ts`): the living place is drawn small into a picture (`placeGl.ts`, now shared with hero
  select's ground, on the same clock), then one pass draws the finished composition (veil, scrim, glow, the art in its circle, the
  equipped ring) and bends all of it with the reveal's own lens. The picture is what the wave has passed. A DOM cannot be bent, but
  this picture matches the DOM layer for layer, so the hand-over is invisible.
- **The ceremony** keeps its machine, phases and tuner; with the ripple it lays its DOM out finished from commit (no clone, exits,
  bursts or flash), hides it, and shows it when the wave is done. Decided once, at commit, by `readyRipple`.
- **Start Game** took three goes. The same wave outward: it hung, and was one wash too many. The hero flying down to their seat:
  refused outright. Then the owner's pick of four, the frame opens: the ripple's canvas holds the same picture, pushing in on the
  hero (WAAPI on the canvas element, so it runs straight through the 0.5 s of work that stops every frame); the hero fades to the
  board behind the canvas, and their ring opens past the screen (`open`, `openAt`) once three frames in a row have come on time.
- **The lobby reveal waits** (`lobbyReveal.hold / release`): it is up from the start (the shop and its clock wait behind it), but its
  dim and line-up begin once the ring is most of the way out.
- **Ready before the press:** hero select makes the ripple ready in the background and uploads the hero being looked at and the
  player's ring; one unseen draw. Nothing ready = exactly the older ceremony and curtain.
- **Phone reveal sound:** the light reveal decoded the full version's clips (85 MB of decoded audio at peak, over the 80 MB
  budget) and played none. It now decodes only the four short kinds it uses, and plays them.

Pick: median 4.2 ms; the first pick of a
fresh browser profile has one 40 to 58 ms frame (Skia compiling the name plate's paint on the GPU process, as the old ceremony did); the
second run's worst is 12.5 ms.
