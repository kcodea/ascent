# 2026-09-29: Grave Call, the undead hero attack (attack_undead, Legendary)

Owner ask (2026-09-29): "branch off and make some more attack types - we need a fire animation, a bleed/gash
animation, some sort of an undead animation, a beast chomp rush animation, and i would love a king oona banana cannon
animation. use the same 4 tier strategy we have been."

This is the undead one. The design was left to the builder ("some sort of an undead animation"). Fire, bleed, beast and
banana are being built on their own branches at the same time, so the style list, the crate pins, the Collection counts
and the patch notes will conflict with whichever lands first (expected). Nothing changes for players until the owner
deploys `progression-inventory` (the catalog sync adds `attack_undead`). No SQL.

## What shipped

**Grave Call** (`packages/ui/src/heroUndead/`), sickly spectral green and teal over a deep purple-black, with bone
white. Flat 2D throughout (every circle, hole, rift and crack is a top-down shape; nothing is skewed). The shared damage
formation runs first. Then:

- **The raise.** A necrotic grave circle (thick ring, angular runes, thorns pointing in, a clear middle so the face
  stays readable) turns on the board under the striking hero, grave smoke circles its rim and ghost wisps spiral in.
  The circle flares when the dead answer.
- **The skull** (every tier's lead element). A spectral skull painted as two pieces on one hinge: the cranium (slanted
  sockets, the nasal cavity, the upper teeth, cut out as real holes, and a crack across the dome) and the jaw. Three
  aligned layers: a purple-black body a touch larger than the rest (so it keeps a dark rim on a light board), a sickly
  green additive fill and pale green-bone line work, plus a soft teal halo and two burning eyes. It pops out of the hero
  on the side facing the target and SHRIEKS (the jaw drops, shriek rings pulse off it), flies on a slight arc with a
  wobble, jaw wide, trailing crisp line-work AFTERIMAGES and shedding wisps, and BITES as it lands (the jaw snaps shut
  over the last 70 ms). The bite: a short flash, the skull's own outline swelling off the hit as a spectral echo, rings,
  bone shards and a swirl of wisps curling up.
- **I (1-5).** One skull.
- **II (6-11).** Two skulls on opposite arcs, the second popping out as the first is loosed. The first is a tick.
- **III (12-19).** A grave circle opens under the struck hero. Four skeletal hands claw up out of dark holes round it,
  reaching in, grip (each a tick) and drag: the portrait sinks and trembles. A swarm of eight ghost wisps streams from
  the hero on curving paths and strikes it in rhythm (each a tick). Then one big skull finishes it and the hands shatter
  into bone.
- **IV (20+), the showpiece.**
  1. A grave rift tears open across the board between the heroes: a jagged purple-black void lit green inside, a burning
     rim, a deep shadow round it, cracks racing off it, grave dust and bone kicked up. It keeps pouring motes, wisps and
     mist while it is open.
  2. A giant spectral skull maw rises out of it (mist and wisps pouring round it) and its eyes ignite.
  3. It shrieks: the jaw drops wide, three shriek rings pulse off it, wisps are blown out, the view trembles and the
     struck hero shudders.
  4. It lunges across the board, accelerating and growing, trailing afterimages, jaw wide, and chomps shut on the struck
     hero. This is THE blow. It bursts into wisps and bone, and a wave of necrotic mist washes out across the board. The
     rift closes.
  The maw is always whole on screen. Its chomp slides toward the middle of the screen (still over the struck hero) far
  enough that the maw and the camera punch fit; a view too short makes it smaller, never cropped. The window height is
  read once at the start.
- **Living wisps.** Each wisp is a bright head, a feathered tail stretched along its velocity (longer the faster it
  goes), and an echo a beat behind it. Free wisps are thrown, dragged, rise and wander across their heading, so they curl
  and drift. The swarm's wisps ride bent curves and arrive on the planned beat.
- **The consequence lands ONCE:** on the last skull's bite, or at IV on the chomp (never on the rift, the rise, the
  shriek or the lunge). No hit-stop or freeze anywhere.
- **Cosmetic:** `attack_undead`, "Grave Call" (a placeholder name), Legendary, crate, style `undead`, mirrored in the
  Edge Function copy. It has a Collection tile with the in-place preview and a place in the dev style switch.
- **Tuner:** "Hero Attack: Undead" in the hub (💀). It covers the raise, the skulls, the wisps, the Tier III hands and
  swarm, the Tier IV rift, maw and mist, the camera, the colours, and a clip / gain / pitch row per sound cue (17 cues).
  Per the owner's ask the same day for every hero attack tuner, it has no Speed or Reduced motion buttons, and its button
  row (Copy JSON, Reset, the Play buttons) sits at the TOP, through the shared `TunerSpec.buttonsOnTop` from #1843 (the
  branch's own copy of that flag was dropped on merge). On merging #1849 it also picks its tier with the shared
  `attackTier`, so a knockout always plays Tier IV (the rift and the maw).

## Timeline (ms from the raise, 1300 px apart; the formation's lead-in comes first)

| tier | raise | impact | end |
| --- | --- | --- | --- |
| I (3) | 320 | 900 | 1540 |
| II (8) | 360 | 1108 | 1788 |
| III (14) | 400 | 1483 | 2203 |
| IV (40) | 440 | 1878 | 2878 |

IV's beats: the rift at 500, the rise at 698, the shriek at 1218, the lunge at 1598, the chomp at 1798, the impact 80 ms
later.

## Crate odds

Inferno (attack_fire, #1844) landed first the same day, so Grave Call takes Legendary from 12 items to 13: each Legendary
is now 0.385% (5 / 13). The rarity odds never move (50 / 30 / 15 / 5). The ten hero attacks together are 3.85% of a first
crate.

## Perf

Measured on the PROD build (`vite build` + `vite preview`), headless Chrome with GPU at 1600 x 900, 240 Hz, real rAF
playback, sound off, through a temporary, uncommitted window hook.

| run | frames | p50 | p95 | p99 | worst | > 16.7 ms | long tasks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IV you (40, first play) | 1529 | 4.2 | 4.3 | 8.4 | 66.7 | 10 | 1 |
| IV you (40, again) | 1613 | 4.2 | 4.3 | 4.3 | 8.4 | 0 | 0 |
| IV foe (40) | 1612 | 4.2 | 4.3 | 4.3 | 12.5 | 0 | 0 |
| III (14) | 1407 | 4.2 | 4.3 | 4.3 | 8.2 | 0 | 0 |
| II (8) | 1232 | 4.2 | 4.3 | 4.3 | 12.6 | 0 | 0 |
| I (3) | 1100 | 4.2 | 4.3 | 8.4 | 29.2 | 4 | 0 |

The machine was shared with four other builds running their own tests, so single frames of 8 to 29 ms are scheduling
noise (the same runs repeated gave 4.3 to 12.6 worst). Across three measured sessions the cold first play's worst frame
was 54 to 146 ms; the harness attaches the Pixi overlay moments before that play, so its cold start lands there too.

- **The cold first play.** The first measurement found a 320 ms worst frame on the session's very first play. Most of it
  was on the lunge beat and happened even with Pixi off. The cause was `AttackVoices.riser()`, which (unlike `cue` and
  `warm`) reads the clip's buffer without checking the sound flag, so with sound off it woke the audio system cold on
  that beat (an 86 to 150 ms task). The runner now only calls the riser with sound on.
- What remains on a cold first play is about 50 ms near the charge beat, and it goes away with the camera off: it is the
  shared stage camera's first promotion over the Pixi canvas. In the same harness Holy's cold first play shows a 238 ms
  task and several 80 to 135 ms tasks, so this is shared camera and Pixi cold start, not this attack.
- Every later play holds p99 at 4.3 ms. No DOM is left behind and `#stage` is restored after every run.
- Textures paint in 3.5 ms (the skull in two pieces plus line work, a half-size silhouette, the wisp, the hand, the grave
  circle, the rift and its rim, a crack, mist and a bone shard; about 1 MB of GPU memory). Each is pre-warmed by a
  near-invisible sprite during the formation. All sprites are pooled per layer with a cap of 900; the afterimage and
  wisp-echo history is sampled by time (every 16 ms), so the trails sit the same distance apart at any frame rate.

## Sound (existing clips only)

- **The raise:** `undeadaurabuff` (low), then `rebornsummon` as the dead answer.
- **Skulls:** `spirittendril` pitched up for the shriek, a swoosh for the flight, `skullburst` and a light `cleave2` snap
  on each bite; the last bite adds `rebornshatter`, `smack2` and, from III, `crit`.
- **III:** `rune-chain-break` for the hands clawing up and gripping, `fel-spike-echo-land` for each wisp, a low ground
  impact as the grave opens.
- **IV:** `fx/waking-rift` and `fx/universfield-ground-impact` as the rift tears, `undeadaurabuff` pitched down for the
  rise, `fx/voidpanthergrowl` pitched up with the shriek layered over it for the scream, the cinematic swoosh as a riser
  timed to hit on the chomp, `cleave2` for the jaw snapping shut, and `turnexplosion` pitched down for the mist.
- A test checks every default clip exists in the repo (it caught `voidpanthergrowl` living under `fx/`).

Clips worth supplying: a ghostly shriek or wail (0.5 to 1 s), a bony jaw snap, a deep grave-rift tear, a giant roar or
scream, a low necrotic whoosh for the mist.

## Open for the owner

- The name "Grave Call" is a placeholder.
- Legendary rarity matches the others.
- The oracle id is R-PROG-ATTACK-17: 15 and 16 are left for the fire and bleed attacks built alongside it (in the order
  of the ask). Whoever merges later may need to renumber if that guess is wrong.
- Visual review wanted, especially the Tier IV maw (size, how long it holds, the shriek) and the Tier III hands.
