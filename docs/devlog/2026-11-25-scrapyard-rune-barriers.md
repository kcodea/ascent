# 2026-11-25: The Scrapyard and the Rune Barriers

Two new locations from the owner's paintings (R-LOCATION-11): Set 1 is the Scrapyard, Set 4 the Rune Barriers. Dev Practice picks them; nothing live moves.

- Cut, matted and filled by `scripts/locations/layers.py s|r`, the owner's backgrounds behind (`<Place>/parallax/*BG.jpg`). Two new knobs: `clean`
  zones and `tone`; `align` moves a background that came back a few pixels off (the Scrapyard's was up to 7 of 1980).
- `watermap.py`: the falls and puddles, and the barriers themselves, which run like falls of light.
- The mix levels of a location's own clips moved from `revealSound.ts` to `LocationDef.mix` (they were an "is it the Outskirts" test).
- Not done: Guardians (parchment supplied, no tribe in Set 4 yet); frame times on these two; a phone.
