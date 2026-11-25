# Making a location's parallax: the method and the bar

How the Scrapyard and the Rune Barriers were made on 2026-11-25 (owner: "they look great"). `docs/locations.md` says what files a location needs
and where; this is how to get the result, how hard to work at it, and what "done" means. Expect several full passes on the cuts. The first
run of `layers.py` is never the one that ships.

## The bar

1. **Nothing warps.** Anything upright and big (towers, gates, cranes, scaffolds) is a rigid piece. Only mist, sky, water and far hills may bend.
2. **Every cut is exact.** The owner pauses on them: "Be very precise with our movement cuts. I see some sloppy cuts there."
3. **The place has one idea of its own that moves**, made for it. The Barriers were refused as "warping and not really all that exciting"
   while they had only the shared water and sway.
4. **Nothing is lost at rest.** The layers put back together are the painting.
5. **Everything in it that glows wakes.** Two or three dozen lights, traced one by one, is normal.
6. **Every sound is measured**, not guessed.

## 1. Look before cutting

Open the painting whole, then in quarters. Write down, before any polygon:

- **The pieces**: 1 (far), 2 (middle), 3 (near, at the frame's edge). A piece is what moves together. Everything that stands on it goes with it: a post
  left behind is seen twice.
- **Rigid or bending ground.** Uprights all over the ground mean rigid pieces (`planes` / `row`, the Barriers); uprights on a few near pieces over soft
  ground mean a depth map (the Scrapyard). When a depth map is used, ease depth WIDE around each foot: the ground must never be seen to bend.
- **The crystal's landing point** (`vp`): the painting's own vanishing point or brightest focus. Everything radiates from it.
- **The place's own idea**: what would this place do if it were alive? A barrier whose pulses run out along its painted cracks from its heart; a forge that
  breathes. A mask and a few lines in `revealShaders.ts`, not a new system, and never the water map bent to look like something else.
- What hovers (`floats`), hangs and sways (`wind`), falls and lies flat (`water`), glows (`lights`).

## 2. Trace on zoomed, gridded crops

`crop.py "<painting>" x0 y0 x1 y1 out.png` gives a 1500 px wide crop with a 100 px grid, and prints the `view(...)` to read it with. Each piece on its own crop
tight enough that its edge is at least 2 px of crop a point; complicated ones (chains, scaffolds) on a second, closer crop. Never trace from the whole picture.

Outlines only have to be close: with `snap` on, a graph cut on the painting's own colours finds the edge in the band (5 to 9 px; narrower for ropes and
chains, wider for leaves and rocks). Holes (the sky through an arch) are polygons of their own. Lattices (chains, rails) are a `key` zone: a
rule on colour for what is piece and what is sky. `open` is where a lattice drawn solid lets light through.

## 3. The background, from the owner

1. `layers.py <id> <dir> maps`: look at `cut-<id>.png` first (outlines over the painting). Fix the tracing before anyone paints to it.
2. Copy the three maps to `Locations/<Place>/parallax/` as `0-full-painting.png`, `1-background-blurry.png`, `2-background-holes-magenta.png`.
3. Give the owner the prompt below (also kept in `Locations/background-prompts.md`) and where to save the result.
4. When it comes back: overlay it on the painting. A few pixels of drift: `align=True`. Something of a piece still painted in it (a tower it
   refused to remove, a ghost of the crane): `fill` there, or ask for it again; never paint over it yourself.

The prompt, with one line a hole in plain words (what was there, what is behind it from top to bottom, how it meets the frame's edge) and the
things it must not add, named:

> The first image is my finished painting. The second is the same painting with the closest objects cut out in solid magenta. Repaint the second
> image with every magenta area filled in, as if those objects were never there, so I get one complete background with nothing missing. Everything
> that is not magenta must stay exactly as it is, in the same place and at the same size.
>
> Fill in this way:
> - `<where>`, where `<what>` was: `<top>`, then `<middle>`, then `<bottom, continuing to the edge of the frame>`.
>
> Do not add any `<every kind of thing cut out>` in the filled areas. No people, text or borders. Same style, lighting, colors and camera. Keep the exact
> same framing and aspect ratio. No magenta left anywhere.

If the result drifts, send the blurry map instead and say "the blurry areas".

## 4. Cut, look, fix, again

Run `layers.py`, then look at all of it, every pass:

- `at rest: mean` small and few pixels off by more than .08; `lost-*` shows where (red).
- `ground-*`: the background with nothing on it. No ghosts, no light seam (`tone` down), no specks (`clean`).
- `move-*-a` and `-b`: pushed further than the game ever does. No rims, smears, creases, feet that slide.
- `proof.py <place> <dir>`, then **`proof.py ... <layer> x0 y0 x1 y1` along every edge of every piece** on magenta. Look for a rim of the old background, stair steps,
  bites out of the piece, islands of sky inside it, half a chain link, a post cut at its foot.

Which knob for what: a rim travels with the piece, so narrow the band and check `reach`; a piece's inside is torn, so widen the solid core (smaller
band); sky left in a lattice, `key` / `open` / a hole; specks on the ground, `clean`; a seam of light where painting meets background, `tone`; mist behind
a piece that shows stone, `misty` or `haze`; a piece another one covers, `back`. A foot that slides: `fade` it, or give the ground under it the piece's own
depth.

## 5. Bring it to life

Lights at each piece's own depth, or they swim on it. Water traced by its two edges. Wind on cloth, leaves and ropes only, never on stone. The magic
moves **inside** the stone that holds it: feather the mask inwards so that nothing but the magic moves.

Judge it moving, at 16:9 and 21:9, on a production bench build: the travel, the landing, the wave, the weld, the name, hero select's blur
and lean. Take a still at each (`draw(t)` makes any moment repeatable) and ask: does anything warp, pop, smear, swim; is there one moment
someone would remember; would it look as good on the owner's screen at 2560 wide? If the answer is "it works", it is not done.

## 6. Sound

- Prompts in `sound.mjs` follow a shape: what it is, "close and clearly present", "constant even volume the whole time", what it must not have (no voices, no
  music, no impact). `ride` and `ambience` are loops. The announcer reads at 0.78, with the owner's own punctuation as the pauses.
- `loudness.mjs` on every clip, then trims in `mix` so that what is HEARD matches: an announcer line lands at about -16 to -17 LUFS at the default
  sliders, level with the hero lines, the travel and the landing (R-LOCATION-12). A new line is measured and given its own trim.
- It is Mike's ElevenLabs account: report the credits. Nobody but the owner has ears: say plainly that you have not heard it.

## 7. Show it honestly

Show stills of the travel, the landing, the rest and hero select, and say what was not checked (phones, 21:9 in game, frame times, the sounds). Check that 5173
serves the new files before saying so: new art needs a server restart, and the owner's file may be newer than the one you copied.
