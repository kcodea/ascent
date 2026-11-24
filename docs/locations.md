# Locations: how a place is made

A **location** is where a game is played. A location IS a set (`SetDef.location`): Set 2 is The Outskirts, Set 3 The Underbelly.
Nothing in the engine knows about it. This is the playbook for adding one, and the rules the two we have taught us. History and
measurements are in the devlog (`docs/devlog/2026-11-24-*`); the rules are `R-LOCATION-01..08`, `R-COMPENDIUM-QUICK-01` and
`R-GOODLUCK-STAR-01` in `packages/rules/src/registry/approved/foundation.ts`.

## The sequence, and the file that owns each part

| Moment | What happens | Where (`packages/ui/src/`) |
|---|---|---|
| Gate shut | everything below is built, one small step a frame | `prepareReveal`, `warmAtmosphere`, `warmRipple` |
| Crystal breaks | its heart sweeps ahead like a comet, pieces of the place pour off it, it lands, a wave welds the place | `locationReveal/revealTimeline.ts` (time), `revealGl.ts` + `revealShaders.ts` (picture), `revealSound.ts` |
| The name | letters rise, the announcer speaks, a parchment drops for each tribe | `revealPlayer.ts`, `locationReveal.css` |
| Into hero select | a wave from the landing point washes it in | `heroArrive.ts` |
| Hero select | the same painting, blurred and alive (mist, sway, water, flicker, motes, lean) | `placeGl.ts` (`Place`), `atmosphereGl.ts`, `LocationGround.tsx` |
| Parchments | hang down the right side; each opens the quick Compendium on its tribe | `LocationPosters.tsx`, `quickBook/` |
| Select Hero | one ripple out from the button; behind it the hero is there in their frame | `heroRipple.ts`, `hero-select/heroRippleTiming.ts` |
| The hero speaks | the frame charges; the run is built as they finish | `hero-select/heroLine.ts`, `launchCharge.ts` |
| Into the game | the frame opens past the screen onto the board; motes drift down | `heroRipple.ts` (`open`), `HeroLaunchCurtain.tsx` |
| Good Luck | a comet off the hero lights the words, dust streams into the End Turn crystal, the clock starts | `goodLuck/luckStar.ts`, `GoodLuckIntro.tsx` |

Live modes go through one seam (`versus/versusStore.ts` `driveGates`, pure part `versusReveal.ts`). The server holds the pick clock
for it (`versusHeroSelectMs`), so **a Worker deploy is part of shipping a change to its length**.

## Adding a location

**From the owner** (never redraw, tone or fill in art: flag what is off):

1. The painting, 21:9 (ours are 6336 x 2688), full detail. `C:/Game Assets/Ascent Art/Locations/<Place>/<Place>4k.jpg`.
2. The same painting with every near piece REMOVED (`...4kBG.jpg`), same size and registration. This is the one input that makes
   the parallax clean; without it, what is behind a piece has to be invented and it shows.
3. One square picture a tribe (600 x 600), for the parchments.
4. The name, the announcer's line, and the mood of its magic (two colours).

**Then, in order** (scripts in `scripts/locations/`, run from the repo root; they need Python with numpy, scipy and Pillow):

1. `packages/content/src/sets.ts`: `location: '<Name>'` on the set.
2. `locationReveal/locations.ts`: a `LocationDef`. `vp` = where the crystal lands (everything radiates from it: pick the painting's own
   vanishing point or brightest focus). `focus` = what a 16:9 window is centred on. `deep` / `second` = the travel's dark and its second hue;
   `cool` / `warm` = the hues all blue and gold light is turned to (leave them out for ice blue and gold). `lights` = every lantern,
   crystal and fall in the painting, each `[x, y, size, depth, r, g, b]`: the wave wakes them one by one, so trace them all.
   `posters` = the order the parchments hang in. The whole sequence takes its colours from here, Good Luck included: no other file
   should name a location.
3. `layers.py <id>`: add a function for the place (outlines as polygons read off zoomed crops, depths, wind, sky) and run it. It writes
   `layer0..3`, `flat`, `blur`, `data` into `apps/web/public/locations/<id>/`. Look at every `move-*` proof it writes: no rims, no
   smears, nothing sliding at its feet.
4. `watermap.py`: trace every fall by its two edges and every flat surface with what stands in it cut out. Check the proof.
5. Posters: `poster-<tribe>.webp` (600 x 600, quality 86). Then `sheets.mjs` bakes `sheet-<tribe>.webp` from the reveal's own shader at
   rest (needs the dev server).
6. Sound: `sound.mjs`. Per location: `ride-<id>`, `ambience-<id>`, `vo-<id>` (the Announcer voice, slower than the game's 0.89). The rest is
   shared. The ElevenLabs key is Mike's, in `.env.secrets`, read at run time: never print or commit it, report the credits used.
7. Tests: `locationReveal.test.ts` checks every location's files, lights and posters; add the new one's expectations.
8. Rules, patch note, devlog in the same PR.

**Check it:** 16:9 and 21:9; both a fresh and a warm browser profile; Practice, Ranked, Versus, Ranked Duos; light version on a phone;
reduced motion; `phone-budgets` in CI (300 MB, 6 GL contexts, 80 MB decoded audio, 140 MB images); frames on a production bench build.

## The look (what was approved, and what was refused)

- **One language.** Water and light: a wave that bends the picture, ribbons of the place's magic, fine dust, thin flares, cut Cinzel lettering. A new
  moment is made from these before anything new is invented.
- **Energy, not metal or stickers.** Lettering is white at its heart, the place's hue at its edge, a tight glow and no stroke.
- **Nothing bounces, squashes, tilts or lunges.** "Cutesy" was refused for Good Luck; parchments leaning out were refused for the
  Compendium. What is chosen is LIT; what is not sits back.
- **Nothing freezes.** "Stop and go" was refused: time may lean for an instant on a hit and never stops.
- **One wash.** The wave is the arrival and the pick. A third use was "too much of the wash ripple"; the next moment gets its own idea.
- **The hero is just there.** No flying to a seat. No Start button: they speak and the game goes.
- **No boxes over a place.** A panel is the place itself gone dark, dissolving into the game at its edge, lettering on it, one line of light.
- **Small movement only at rest.** Hero select's lean is at most about 8 px.

## How it is built (copy these)

- **Draw from the time.** Every picture is `draw(t)`: a dropped frame is skipped, never drifted, and any moment can be screenshotted.
- **Timeline in one pure file**, read by the picture, the words and the sound.
- **One WebGL 2 canvas a moment**, made early and freed at the end (`WEBGL_lose_context`). Compile through `beginProgram` / `compiled` /
  `finishProgram` (the driver compiles off the page), decode pictures off thread, and draw everything once unseen: otherwise the
  first frame seen pays for it.
- **Particles live in the vertex shader**, placed from `gl_VertexID` and the time. No arrays to update a frame.
- **To bend the DOM, draw its twin.** A DOM cannot be refracted: `heroRipple` draws the finished composition layer for layer, and the DOM
  takes over underneath when the wave is done.
- **Fall back at one gate**: `canRun()` (`rippleSupport.ts`). Phones, reduced motion and no WebGL 2 get the still picture, the light reveal, the
  plain fade. The game must be whole without any canvas.
- **Colour magic** through `mg()` in `revealShaders.ts` or `LocationDef`'s colours, never literals.

**Traps that cost us a day:**

- Building the run blocks the page for about half a second. Whatever must move through it is a WAAPI transform / opacity animation on a layer
  painted BEFORE, ONE animation a property (two on one property run on the page's thread and freeze with it).
- `--ch`, `--cw`, `--ccw`, `--u`, `--u-base`, `--hand-glide` are registered `@property` names. Reusing one gives a number nobody set.
- A sound must never be able to stop a launch: every cue is in a try / catch, and an `AudioBuffer` cannot be set twice.
- A match can end under the reveal: `playVersusEndGate` cancels the entry gate first.
- Imperative layers go into `stageHost()`, never `document.body` (`stageTripwire.test.ts`); measure in screen px, convert only when writing CSS.
- Anything with its own `visibility: visible` survives a hidden parent: fade the container too.
- `<img decoding="sync">` on everything player-facing (`imgDecodingSync.test.ts`).
- A fresh browser profile compiles Skia and GL pipelines for the first time: measure both a first and a second run before calling something a hitch.
- The dev server's watcher can die and go on serving old files: check that it serves the new source before judging a screenshot.

## Where a new effect goes

Reusable drawing (the place, programs, textures) in `placeGl.ts`; a moment of its own in its own file with its own timeline and its own
`LuckStar` / `HeroRipple` shaped class: `make` (or warm) / `ok` / `play` / `destroy`, safe to destroy at any time, leaving nothing behind.
