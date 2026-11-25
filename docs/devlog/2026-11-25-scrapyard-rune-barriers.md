# 2026-11-25: The Scrapyard and the Rune Barriers

Two new locations from the owner's paintings (R-LOCATION-11): Set 1 is the Scrapyard, Set 4 the Rune Barriers. Dev Practice picks them; nothing live moves.

- Cut, matted and filled by `scripts/locations/layers.py s|r`, the owner's backgrounds behind (`<Place>/parallax/*BG.jpg`). Two new knobs: `clean`
  zones and `tone`; `align` moves a background that came back a few pixels off (the Scrapyard's was up to 7 of 1980).
- `watermap.py`: the falls and puddles, (the barriers were first run like falls of light: refused).
- The mix levels of a location's own clips moved from `revealSound.ts` to `LocationDef.mix` (they were an "is it the Outskirts" test).
- Not done: Guardians (parchment supplied, no tribe in Set 4 yet); frame times on these two; a phone.

## The Rune Barriers, second pass

Owner: "the rune barriers parallax looks bad, warping and not really all that exciting, plus the rune barrier movement looks off too".

- **Warping:** only the first gate was a piece; the other four, the hill and the rocks were one picture bent by the depth map, which shears uprights. Now
  four rigid pieces: the whole row of gates is one plane receding in x (`row`), the hill with its ruins, the near rocks, and a sky that never bends.
- **The barrier:** its own effect (`energy` in `revealShaders.ts`): pulses run out along the painted cracks from each barrier's heart, the light behind is
  deep violet, rolls, has stars in it and lies deeper than its frame, and the landing's wave rings it. Out of focus in hero select it breathes.
- The floating islands hover (`floats`).
