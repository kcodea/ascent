# 2026-11-24: The location reveal in Versus and Duos

Owner ask, the same day as the reveal shipped to Ranked and Practice. Rule R-LOCATION-03.

- **Where:** every live mode starts through one seam (`driveGates`, versusStore), so 1v1, Group, Versus Duos and Ranked Duos
  (party or not) all get it. `locationReveal/versusReveal.ts` is the pure part: the match's set, the player's own run seed.
- **The pick clock.** The server starts the Hero Select clock when the match is made, which is the same moment the crystals
  break, so an 11 s reveal would have eaten half of it. `versusHeroSelectMs` (sim, read by the Worker's three match makers)
  adds `VERSUS_REVEAL_SECONDS` (12) when the set is a location; the clock face holds at 20 until they are over.
  **The Worker must be deployed for the reveal to show**: a client plays it only when the server left it at least 17 s of
  pick time, so against the old Worker the live modes look exactly as before. An older client on a new Worker simply sees a
  32 s clock.
- **A match that ends under it.** `requestRankedGate` joins a gate already playing and drops the second swap. With a reveal
  that window went from about two seconds to thirteen, and the dropped swap was the end gate's (back to the room). So
  `playVersusEndGate` now cuts the entry gate short (`cancelRankedGate` stops a playing reveal) and asks again after it.
- The phone memory walk (`scripts/phone-run-memory.mjs`) tapped a hero while the reveal was still over it and went red on
  the first PR; it now waits for the gate. The phone itself was fine: the light version played, peak 243 MB of 300.

## Hero select stays alive, and the water maps (R-LOCATION-04)

- `atmosphereGl.ts`: one small WebGL 2 canvas (540 rows) over the same blurred picture: drifting mist, sway, water, flicker,
  motes, and a lean of at most about 8 px from the depth map. Built while the gate is shut, not drawn while the reveal covers
  it, handed the reveal's clock at the wash, freed with hero select. Phones and reduced motion keep the still picture. A
  teammate's hero select over your own keeps the still one too (only one is ever on screen).
- **The water map** (`water.webp`, `.claude/location-reveal-prototype/watermap.py` in the primary checkout): the old water was a
  few rough shapes in the depth map's blue channel, all poured straight down, the Underbelly's whole pool included, across its
  dock, posts and boats. Now R = falling (between two traced edges), B = across the stream (so streaks follow the curve), G = a
  flat surface with everything standing in it cut out, rippled in perspective. The Outskirts' falls and puddles are traced too.
