# 2026-10-02: Bullet Time, the Ancient of Time hero attack (attack_bullet_time, Ancient)

Owner ask (2026-10-02): "build a new ancient animation for this ancient, the ancient of time". It took six builds on one
branch (PR #1912) in one day.

## The history (what was tried, so nobody re-tries it)

1. **Rewind & Replay (v1).** Each hit landed, time rewound along the exact path, and the same hit replayed. Owner:
   "3.5/10 ... boring and slow paced".
2. **Rewind, fast (v2).** Fast reverse scrubs, rubber-band replays, an RGB split, scrub bars, a sand vortex. Owner:
   "still a 4/10 ... a god's attack. make it cooler".
3. **Rewind, god scale (v3).** The Ancient's art (`art/ancients/time.webp`) appeared as a bust over the board. Owner:
   "5/10. i dont like using the art for the attack. try again". **Lesson: don't draw hero or Ancient art in an attack.**
4. **Bullet Time, stopped time (v4).** The shots hung frozen while the world went grey. Owner: "3/10 ... we need a
   10/10. this also needs a knockout tier". The shots were small, their streaks were long cobweb lines, and everything
   round a corner target was clipped.
5. **Bullet Time v5.** Big shots fanned toward the board, a giant clock, a sweeping ripple, a chromatic snap, and the
   Knockout variant. Owner, on IV: "looks weird not being centered and prefer slow motion vs stopped/grey time. like
   more cutting through time than stopping it and dont grey out". **Lessons: centre every shape on the target; no
   desaturation; slow motion reads better than a stop.**
6. **Bullet Time v6.** CUTTING THROUGH TIME, in slow motion, centred on the target. Owner: "bullet time looks good but
   remove the bullet aesthetic. make it more magic inspired". The choreography and timings were approved; the LOOK was
   to change from ballistic to arcane.
7. **v7 (this build): the magic restyle.** The same choreography and timings, cast as magic (see below). The name
   "Bullet Time" stays as a placeholder until the owner picks one; the id stays `attack_bullet_time`.

The rewind code is gone. `attack_rewind` was never merged or deployed, so the id became `attack_bullet_time` (style
`bullettime`), and nothing in a database or a save refers to the old one.

## The magic restyle (v7)

Nothing reads as brass, metal, mechanical or ballistic.

- **The missiles** are crystalline LANCES of light: a faceted shard, additive so it glows, with a time rune (an
  hourglass sigil in a ring) spinning at the head. They have soft sparkling comet tails (`ribbonSoft`, and specks of
  starlight shed in flight).
- **The cuts** are magical RIFTS: a soft violet aurora, a shimmering gold seam and a thin white-hot thread of light
  (soft-ended glows stretched along the cut, not hard bars), with time runes drifting off them.
- **The clock** is a MAGIC CIRCLE (`clockFace` is now a rune circle):
  - two luminous rings, with twelve time runes between them (hourglass, crescent, eye, diamond), a ring of sixty points
    and a small inner ring;
  - it turns slowly;
  - two runes orbit it in place of hands, and sparks trail off the outer one;
  - the 3-2-1 is drawn as glowing runes over a violet halo.
- **The impacts** use spell-burst language:
  - an arcane nova (core and glows);
  - a RUNE-RING shockwave (the rune circle blasting outward) on every tier;
  - starlight sparkle, prismatic flecks and drifting runes;
  - no blade debris.
- **The Knockout** is restyled the same way: prism rings, a prism rune circle and prism starlight.
- **The sound** is magical:

  | cue | sound |
  | --- | --- |
  | cast | the sparkle whoosh |
  | cut | the `prismaticpick` chime |
  | the time snap | an `equipmentsheen` shimmer plus a synth BELL (a bright fifth; `playBellStrike`) |
  | hit | `fx/blue-impact-hit` |
  | thud | a resonant arcane `castspell` |
  | under the IV collapse | a low `equipmentsheen` shimmer and a great synth time bell (196 Hz) |
  | rumble | a deep cinematic whoosh |

  The old finger snap (`clickthock`), the glass crack, the metal clang (`equipclang`) and the rock impact are gone.

**Name options** for the owner: "Timebreak", "Chronoweave" or "Sands of Eternity" (the placeholder stays "Bullet Time").

## The signature: CUTTING THROUGH TIME

**The cut.** Crystal lances of golden light slice in toward the struck hero. As each one arrives, time drops into dramatic SLOW
MOTION (`dartEase` is near-linear, so the blade is still fast when it brakes), and it leaves a TEAR sliced through the
air behind it (`scene.cut`):
- a white-hot gold slash over a violet rift glow;
- capped at a few portrait radii, so it reads as a slash, not a laser;
- it lingers through the slow motion.

**The slow motion.** Nothing stops (R-PROG-ATTACK-10):
- the blades CRAWL on toward the target (`crawl`, a fraction of the remaining way);
- every FX runs at `slowFx` (0.25x: sparks, motes, ripples, glints, the tears; `scene.setTimeScale`, easing in over 80 ms);
- afterimages peel off the crawling blades, and glints run along their edges;
- a clock dial ringing the target sweeps its hand (sparks trailing off the tip) and ticks faster and louder toward the
  snap;
- a gold ripple sweeps the screen, motes drift, and the camera pushes in;
- in the last 300 ms the blades strain (the anticipation), with a riser on III and IV.

**The snap.** Time snaps back to full speed with a finger snap, a white flash, a cyan and magenta chromatic burst, a
camera kick, and FX instantly back at 1x. Everything lands. The colours stay full throughout: there is no desaturation
of any kind.

**Centred on the target** (owner review): the blades, the clock, the 3-2-1 and the collapse all centre on the struck
portrait's at-rest centre. `portraitGeometry` already measures it with `restingRect` (the drop-in animation fix Soul
Stitch made), and the runner uses it as is. Near an edge, the dome shrinks to fit (down to 60%), and any blade still off
screen is clamped on, without ever moving the centre. This was checked You→Foe and Foe→You at 1920x1080 and You→Foe at
1280x720.

| tier | what plays | impact / end (ms after the formation) |
| --- | --- | --- |
| I (3) | one blade cuts in and crawls just short of the target inside a clock dial; snap; hit | 910 / 1270 |
| II (8) | three blades from evenly round the target crawl; snap; they hit together | 1110 / 1490 |
| III (14) | a volley of twelve brakes at one instant in a spiral round the target, the dial flares; finger snap; a machine-gun run (ticks, the blow on the last) | 1552 / 1992 |
| IV (40) | 36 blades in a dome of three rings round the target, a 3-2-1 over the dial; snap; the dome collapses at once into a massive gold and violet impact (four shock rings, the clock face blown out, streaks, sparks, blade debris) on a slow-mo dip | 1830 / 2927 |
| Knockout | IV with an extra ring of cyan and magenta blades (48), a prismatic collapse, a 1.3x shake, a deeper and longer dip and the KO sting | 2022 / 3306 (+379 ms) |

For comparison, Bleed ends at 1470 / 1740 / 1990 / 4159 and Banana at 1596 / 1838 / 2343 / 7064. I and II sit under
both.

**The contract:** every hit before the last is a tick. The consequence lands exactly once, on the last hit (IV: the
collapse).

## The Knockout variant (#1911 plumbing)

- `bullettime` is in `KNOCKOUT_VARIANT_STYLES`. The plan reads `isKnockoutVariant(input)`; `plan.ko` and `plan.dip` (a
  `KoDip` on every IV) drive it, and `bulletTimeScale` / `bulletSlowExtraMs` are `koTimeScale` / `koDipExtraMs` over
  `plan.dip`.
- The runner calls `koFlourish` and `playKoSting` on the impact.
- The tuner's `knockoutHint` gives it the Knockout buttons.
- There is a `knockoutVariant.test.ts` row and a Bullet Time check. `extraRings` stays as a plan input.

## Calibration against Arcana (the owner's "top tier good")

I compared frame strips (a manual clock through the `frames` seam).

- **Arcana's strength:** one vivid, saturated shape over the target, then a clean white burst.
- **What Bullet Time now matches:**
  - one dominant, readable shape centred on the target: the dial and the ring of blades;
  - full colour;
  - a clear anticipation (the strain, the riser, the accelerating ticks) and then a payoff;
  - layered impacts (a core flash, two or more rings, streaks, sparks, debris), a camera kick and shake, and the dip on
    IV.
- **What it adds on top:** the distinct beats of the cut, the slow motion, the snap and the hit.

## Sound (existing clips only; no rune explosion, no turnexplosion)

The ElevenLabs key is not in the main checkout's `.env` files.

| cue | clip |
| --- | --- |
| tick | `thymepiece` |
| cast | the sparkle whoosh |
| cut | `prismaticpick` |
| slow-mo swell | the sparkle whoosh, reversed (`AttackVoices` gained `reverse`) |
| riser | the sparkle whoosh |
| snap | `equipmentsheen` + a synth bell |
| restart | the sparkle whoosh |
| hit / thud / boom / bell / rumble | `fx/blue-impact-hit` / `castspell` / `fx/universfield-cinematic-swoosh-impact-454392` / `equipmentsheen` at 0.55x + a synth time bell / the cinematic whoosh at 0.6x |
| KO sting | `playKoSting` |

ElevenLabs prompts, for when credits are available:

1. "a blade slicing through the air that tears into a slowed, deep, stretched whoosh, 0.6 s".
2. "time slowing down: a descending, smeared, underwater whoosh, 0.7 s".
3. "a single heavy brass clock tick, dry, close, 0.15 s".
4. "time snapping back to full speed: a sharp finger snap into a violent rising whoosh and a glassy crack, 0.5 s".
5. "dozens of steel blades hitting one point at once, a colossal metallic impact with a deep boom, 1.5 s".

## Perf

**Tier IV (v7, the magic restyle)**, CPU per frame (the sequence step plus the Pixi submit), dev server, manual frames
at 60 fps, 1024x768:

| run | frames | p50 | p95 | max | peak sprites |
| --- | --- | --- | --- | --- | --- |
| Bullet Time IV | 381 | 0.1 | 0.5 | 0.9 | 503 |
| Bullet Time Knockout | 401 | 0.1 | 0.5 | 1.1 | 615 |
| Arcana IV | 357 | 0.0 | 0.3 | 1.1 | 179 |
| Arcana Knockout | 388 | 0.1 | 0.4 | 1.1 | 211 |

The sprite cap is 900, matching Arcana and Holy. Before that it was 520, which the slow motion's lingering tears and
afterimages were reaching. Darts are own objects (a body, a glow, one ribbon strip each, at most 64), and so is the
clock. The tears and afterimages are pooled. An afterimage lives 110 ms of FX time, and IV sheds one per blade only every
320 ms.

There are no paint-property animations at all. The DOM writes are only `transform` (the camera, the portraits), and the
grey `filter` is gone. The Browser pane was hidden, so GPU and compositor frames were not measured; there is no PROD GPU
profile yet.
