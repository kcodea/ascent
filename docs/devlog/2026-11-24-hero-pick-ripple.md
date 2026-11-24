# 2026-11-24: The ripple through hero select and into the game

Owner and Mike, the day the reveal shipped. Rules R-LOCATION-05 to R-LOCATION-07.

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
- **The charge** (`hero-select/launchCharge.ts`): layers made and painted while the hero speaks (made on the press they were first
  painted when the loading was over), each moved by exactly ONE WAAPI animation a property (two on one property are run by the page and
  freeze with it). The comets and sparks first drew nothing: `--ch` is a registered length in this game.
- **No Start button**: the launch begins 0.52 s before the end of the hero's line (`heroLine.ts`), so the loading is under its tail.
- **Stray text after a pick:** the Ancient's words set `visibility: visible` themselves; hero select is now also at zero opacity.
- **Sound can never strand a launch:** a cue that throws is caught (a reversed clip set its buffer twice and did).
- **The lobby reveal waits** (`lobbyReveal.hold / release`): it is up from the start (the shop and its clock wait behind it), but its
  dim and line-up begin once the ring is most of the way out.
- **Ready before the press:** hero select makes the ripple ready in the background and uploads the hero being looked at and the
  player's ring; one unseen draw. Nothing ready = exactly the older ceremony and curtain.
- **Phone reveal sound:** the light reveal decoded the full version's clips (85 MB of decoded audio at peak, over the 80 MB
  budget) and played none. It now decodes only the four short kinds it uses, and plays them.

Pick: median 4.2 ms; the first pick of a
fresh browser profile has one 40 to 58 ms frame (Skia compiling the name plate's paint on the GPU process, as the old ceremony did); the
second run's worst is 12.5 ms.

## The parchments at hero select (R-LOCATION-08)

`LocationPosters.tsx`: the reveal's torn sheets, baked once from its own shader at rest (`sheet-<tribe>.webp`, ten files, about 48 KB
each; only the game's five are fetched), down the right side. A press opens the Compendium on that tribe (`openBookTribe`), in the set
that game is played with, without touching where the book opens next. In Duos the column is smaller and stops above the teammate's
portrait. The View Compendium button stays only where there are none.
