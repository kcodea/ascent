# 2026-10-02: Bullet Time, the Ancient of Time hero attack (attack_bullet_time, Ancient)

Owner ask (2026-10-02): "build a new ancient animation for this ancient, the ancient of time". It took five builds on one
branch (PR #1912) in one day.

## The history (what was tried, so nobody re-tries it)

1. **Rewind & Replay (v1).** Each hit landed, time rewound along the exact path, and the same hit replayed. Owner:
   "3.5/10 ... boring and slow paced".
2. **Rewind, fast (v2).** It added 150 ms reverse scrubs, rubber-band replays, an RGB split, scrub bars and a sand
   vortex. Owner: "still a 4/10 ... a god's attack. make it cooler".
3. **Rewind, god scale (v3).** The Ancient of Time's art (`art/ancients/time.webp`) appeared as a bust over the board.
   Owner: "5/10. i dont like using the art for the attack. try again". **Lesson: don't draw the hero or Ancient art in
   an attack.**
4. **Bullet Time (v4).** The owner picked BULLET TIME from three fresh directions. Owner: "concept for bullet time is
   cool but it is currently like a 3/10 and we need a 10/10. this also needs a knockout tier". The shots were too
   small, their streaks too long, and everything round a corner target was clipped off the screen.
5. **Bullet Time (v5, this build).** Big shots fanned out over the board, a giant clock, a sweeping ripple, a chromatic
   snap, anticipation, and the Knockout variant.

The rewind code is gone. `attack_rewind` was never merged or deployed, so the id was renamed to `attack_bullet_time`
(style `bullettime`), and nothing in a database or a save refers to the old one.

## The signature: STOPPED TIME, the shots hang in the air

Gold clock-hand darts fly and STOP DEAD (a near-linear ease, so they never coast to a halt). Each is aimed at the struck
hero. They fan out from the target toward the middle of the board (`inwardAngle`), so a target in a corner never has
its shots clipped, and every hang point is clamped on screen.

**Only the shots stop** (owner rule R-PROG-ATTACK-10: "it looks like lag"). While time is stopped the screen stays
alive:
- **Desaturation.** The boards, the background and both portraits go grey. This is a CSS `filter` SET once with a
  one-shot transition in, then snapped back off with no transition. It is never animated per frame, and the elements
  are found once at the start and restored exactly on every exit.
- **Ripples.** A gold time ripple sweeps the whole screen, then pulses off the target.
- **The clock.** It ticks faster and louder toward the restart, and its hand spins in the last beat.
- **The hung darts.** They tremble, turn a hair and glint (a highlight runs along a blade every 45 ms). In the last
  ~300 ms they STRAIN, which is the anticipation.
- **Motes and the camera.** Dust motes drift, and the camera keeps pushing in.

The **restart** is a hard snap:
- a white flash;
- a cyan and magenta chromatic burst, with streaks flung outward;
- a camera kick, a finger snap and a rising whoosh.

| tier | what plays | impact / end (ms after the formation) |
| --- | --- | --- |
| I (3) | one big dart stops just short of the target inside a clock dial ringing the portrait; snap; hit | 910 / 1270 |
| II (8) | three darts stop in a fan; snap; they hit together | 1110 / 1490 |
| III (14) | a volley of twelve freezes mid-flight at one instant in a spiral as a giant clock face appears; the hero snaps; a machine-gun run lands (ticks, the blow on the last) | 1552 / 1992 |
| IV (40) | time stops for the whole board; 36 blades stream out into a half-shell DOME before a giant clock face counting 3-2-1; restart; the dome collapses at once into one massive gold and violet impact (four shock rings, a blown-out clock face, streaks, sparks, blade debris) on a slow-mo dip | 1830 / 2927 |
| Knockout | IV with an extra ring of cyan and magenta blades (48), a prismatic collapse (`koFlourish`), a 1.3x shake, a deeper and longer dip and the KO sting | 2022 / 3306 (+379 ms) |

For comparison, Bleed ends at 1470 / 1740 / 1990 / 4159 and Banana at 1596 / 1838 / 2343 / 7064. I and II sit under
both.

**The contract:** every hit before the last is a tick. The consequence lands exactly once, on the last hit (IV: the
collapse).

## The Knockout variant (PR #1911 plumbing)

- `bullettime` is in `KNOCKOUT_VARIANT_STYLES`. The plan reads `isKnockoutVariant(input)`; `plan.ko` and `plan.dip`
  (a `KoDip` for every IV) drive it.
- `bulletTimeScale` / `bulletSlowExtraMs` are now `koTimeScale` / `koDipExtraMs` over `plan.dip`.
- The runner calls `koFlourish` and `playKoSting` on the impact.
- The tuner sets `knockoutHint`, which gives it the Knockout buttons.
- `knockoutVariant.test.ts` has a row for it, plus a Bullet Time check: one more ring, a bigger shake, a deeper and
  longer dip.
- `extraRings` stays as a plan input (the earlier bolt-on point).

## Calibration against Arcana (the owner's "top tier good")

I compared frame strips of Arcana's IV and Bullet Time's IV on my own port (manual clock through the `frames` seam).

- **Arcana's strength:** one vivid, saturated shape (the ribbon vortex) over the target, then a clean white burst.
- **Bullet Time v4's gaps:**
  - the shots were thin and small;
  - their frozen streaks were long lines across the board (a cobweb);
  - the dome and clock round a corner target were half off screen;
  - the stop had no single big shape;
  - the restart was weak.
- **What v5 fixed:**
  - darts 2.6x bigger, with short motion-blur streaks;
  - everything fanned toward the board;
  - a GIANT clock face (40% of the screen) as the dominant shape, the screen-wide sweep, and the 3-2-1 big over the clock;
  - anticipation: the strain, the hand spin and a riser;
  - the chromatic snap, layered impacts (a core flash, two or more rings, streaks, sparks), a bigger shake and a deeper
    dip on IV.

## Sound (existing clips only; no rune explosion, no turnexplosion)

The ElevenLabs key is not in the main checkout's `.env` files.

| cue | clip |
| --- | --- |
| tick | `thymepiece` |
| throw | the stereogenic swish |
| freeze | `divineshieldbreak` |
| time stops | the sparkle whoosh, reversed (`AttackVoices` gained `reverse`) |
| anticipation riser | the sparkle whoosh |
| snap | `clickthock` |
| restart | the sparkle whoosh |
| hit / thud / boom / gong / rumble | `fx/blue-impact-hit` / `crit` / `fx/universfield-cinematic-swoosh-impact-454392` / `equipclang` at 0.5x / `fx/heavy-rock-impact` |
| KO sting | `playKoSting` |

ElevenLabs prompts, for when credits are available:

1. "a crisp finger snap that freezes time, glassy shimmer tail, 0.4 s".
2. "time stopping: a deep descending whoosh that sucks all sound away into silence, 0.7 s".
3. "a single heavy brass clock tick, dry, close, 0.15 s".
4. "time restarting: a violent rising whoosh into a glassy crack, 0.5 s".
5. "dozens of steel blades hitting one point at once, a colossal metallic impact with a deep boom, 1.5 s".

## Perf

**Tier IV**, CPU per frame (the sequence step plus the Pixi submit), dev server, manual frames at 60 fps:

| run | frames | p50 | p95 | max | peak sprites |
| --- | --- | --- | --- | --- | --- |
| Bullet Time IV | 364 | 0.0-0.1 | 0.3-0.4 | 0.7 | 298 |
| Bullet Time Knockout | 399 | 0.1 | 0.3 | 1.1 | 355 |
| Arcana IV | 357 | 0.1 | 0.5 | 6.8 | 179 |
| Arcana Knockout | 388 | 0.1 | 0.4 | 1.4 | 211 |
| Bleed IV | 577 | 0.1 | 0.4 | 1.4 | 553 |

**The cap.** The sprite cap is 520. Darts are own objects (a body, a glow, one ribbon strip each, at most 64), and so
is the clock (a face and two hands).

**Paint.** The only paint-property change is the stopped-time desaturation: a `filter` set twice per attack, with a
one-shot transition (140 ms) in and none out. Nothing loops.

**Not measured.** There is no PROD-build GPU profile yet. The Browser pane was hidden, so compositor frames were not
measured.
