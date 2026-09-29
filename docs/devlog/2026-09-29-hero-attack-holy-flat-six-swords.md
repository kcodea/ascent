# 2026-09-29: Consecration goes flat, and gets the six-sword finale

Owner ask (2026-09-29), after #1811 merged: "branch off and modify the holy attack sequence - i want this to be flat and
not faux-3d. also, let's take this animation to the extreme - have 6 swords fly in from different directions starting
with 1, then they ramp up in speed and the center implodes into that blest towards the enemy."

The owner's screenshot showed Tier IV mid-blast. The slam point's sigil was drawn as a perspective ellipse, and the
foe portrait was ringed by tilted ellipses. That perspective look is what "faux-3D" means here. Only Holy's own files,
tuner, tests and docs changed. Oracle rule R-PROG-ATTACK-14 was rewritten to quote the ask.

## Flat, every tier

- The ground plane is gone. The old `groundTransform` composed a rotation with a tilt through the sprite's skew; it is
  now `flatTransform`, which only turns and scales, never skews or squashes. The tuner's `groundTilt` dial is removed.
- Every sigil, rune circle, shockwave ring, consecration ring, crack and rune is a full, top-down shape.
- The ring that used to sit under a portrait ("the ground under it") is centred on the portrait.
- The blast strikes the portrait's centre (`footOf` is the centre now).
- The halo is a flat golden ring round the portrait, not an ellipse over the head.
- The eruption's holy flames are a flat corona licking OUT round the portrait's rim, not tongues rising off a tilted
  ellipse. Its rising pillar is gone.
- Lower tiers keep their concepts (sigil and pillar, double smite, spear rain with seeds), flattened. The pillars of light
  that drop onto the target stay as screen-plane beams; they were never ellipses.
- A test now asserts that no visible sprite of a whole Tier IV is ever skewed.

## Tier IV, to the extreme

1. **Sword one.** One holy sword flies in from off screen along its own heading, with a light trail, and bites by the
   centre of the board (the midpoint between the heroes, as before). A holy ring forms at the centre and dust rolls out.
2. **Five more** follow from different directions, each from roughly opposite the one before and stepping round the
   compass. With the first from the top, the headings are 0, 180, 60, 240, 120 and 300 degrees, plus a little jitter.
3. **The ramp.** Each flight is 0.72 times the last and each gap between bites is 0.68 times the last. The arrivals, in
   ms from the charge, are 880, 1340, 1653, 1866, 2010 and 2108: slow, faster, a barrage. Each bite also gets bigger,
   with more chips, a harder camera kick and a brighter ring. The swords grow, and the last is the biggest (1.35x).
4. **Planted.** The swords stay with their points round the holy ring: a charged star of blades that glows brighter with
   every hit.
5. **Implosion** at 2278. Every sword and all the light is sucked into the centre over 210 ms, easing in so it snaps
   shut. The ring shrinks to a point, rings close in and motes are pulled in.
6. **Release** at 2488. A short white flash, a cross gleam, god rays, golden shards, flat rings and radiant cracks. The
   flat crescent blast forms facing the target and is fired; it skims the board, tearing cracks and lighting runes.
7. **The strike** at 2778 (1600 px apart): the flame corona and light erupt round the struck portrait. **The blow lands
   here, once.** Every sword bite, the implosion and the flight are ticks.

The whole of Tier IV ends at about 3.8 s after the damage formation.

Everything is tunable in "Hero Attack: Holy":
- the sword count (1 to 8) and the first heading and jitter;
- the first flight and its ramp, the first gap and its ramp;
- sword size, last-sword size and the plant ring;
- the charge before the implosion and the implosion time;
- the release size, shards and cracks;
- the implosion sound.

## Sound

- **Each sword:** a whoosh on each flight, climbing in pitch and gain. The first carries the descending swoosh, timed as
  a riser so its hit lands on the bite.
- **Each bite:** `titanhammer`, `equipclang` and a synth bell, all climbing in pitch and weight through the ramp.
- **The charge:** a synth choir swells from the second sword to the implosion.
- **The implosion:** a sharp inward suck (`runeselectimplosion`).
- **The release:** `turnexplosion` pitched up (a crack, not a boom) and a bell; then the whoosh and the swell into the
  strike, as before.

## Perf (PROD build, headless Chrome 1600 x 900, 240 Hz, a temporary uncommitted hook)

| run | frames | p50 | p95 | p99 | worst | > 16.7 ms | long tasks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IV you (40, first play) | 1837 | 4.2 | 4.3 | 4.3 | 16.7 | 0 | 0 |
| IV you (again) | 1846 | 4.2 | 4.3 | 4.3 | 8.3 | 0 | 0 |
| IV foe (40) | 1409 | 4.2 | 8.4 | 12.5 | 25.1 | 1 | 0 |
| III (14) | 1376 | 4.2 | 8.3 | 8.4 | 8.4 | 0 | 0 |
| II (8) | 1271 | 4.2 | 4.3 | 4.3 | 8.3 | 0 | 0 |
| I (3) | 1128 | 4.2 | 4.3 | 4.3 | 4.3 | 0 | 0 |

After every run, no DOM is left behind and `#stage` is restored. Sprites are still pooled under the 900 cap: six swords
at five sprites each.

## Open for the owner

- The dropping pillars of light (I to III) and the rising prayer beam stayed as screen-plane beams. If the owner reads
  those as faux-3D too, they can become a flat radial burst.
- The first sword comes from the top by default (`swordAngle` -90).
