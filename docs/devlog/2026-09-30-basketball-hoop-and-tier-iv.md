# 2026-09-30: Nothing But Net, the hoop as one piece on the target, and the Huge tier rebuilt

This follows `2026-09-29-hero-attack-basketball.md` (the attack itself, merged as #1867).

Owner reviews on 5173, in order:

1. "the backboard on the slam is not behind the rim, it's broken and offset. can you fix it?"
2. "the hoop should be like in the second image, on the enemy player. add to huge -> he drills a 3 then rotates up and
   gets passed a ball and drills another, than rotates back to baseline and does the slam dunk sequence"
3. "the slam still has a 'first hit' thing that i dont want, add more epic emphasis to the leap, slow down that part
   where he catches it, then one fluid slam motion to deal the dmg and blast pixi"
4. "the basketball -> huge's leap should not beat the basketball there. he should chest pass the basketball that bangs
   against the backboard and bounces off it, then the player leaps into the air and catches it at half court and slams it
   into the opponent"

## The hoop: one assembly, always on the struck portrait

- **`hoopLayout(rim, dR, hoopSize)`** is the one source of the hoop's shape: the rim's width, the net hanging from the
  rim, and the backboard behind it. The board is centred on the rim, and the rim sits at `HOOP_RIM_Y` (0.86) of the
  board's height, the bottom of the shooter's square.
- **The scene draws only from it.** The backboard sprite's anchor is the rim's mount (0.5, 0.86), placed at the rim, so
  the two cannot drift apart. The net hangs from the rim. The rim rattle sways all three together.
- **Every tier hangs the hoop on the struck portrait's centre**, in both directions. The earlier Tier IV board that
  stood beside the portrait (so the fast throw would miss the face) is gone, and with it the rim that stayed behind on
  the target.
- **Verified in the real game:** frame captures at 1920x1080 and 1600x900, you striking and the foe striking, every
  tier. The drawn rim, backboard and net positions were read off the scene. The rim and backboard were at the struck
  portrait's centre, with the backboard anchored at 0.86, in all 16 plays.

## Tier IV, rebuilt

- **The opening (new):**
  - A pull-up three from the slot, swish.
  - A rotation up court to the rolled spot (the same spots as Tier III), a pass in from the side the spot faces, and a
    second three, swish.
  - Both swishes are ticks: a swish, the crowd building, no damage, no reaction from the target. Each ball drops away
    through the net as a scene effect, so only one ball is ever in play.
  - A rotation back to the slot.
- **The slam sequence:**
  - A hard, flat chest pass from the slot bangs the backboard's upper area. The board wobbles on its own, with a thud
    and a glassy knock. The target portrait does not react (no knock, squash, flash or damage), and the rim does not
    rattle.
  - The rebound arcs back out to half court and gets there first: `ballLeadMs` (100 ms) before the player, who reaches
    it at the end of the leap. (A self-lob, from review 3, was replaced by review 4.)
  - A deep crouch that charges up: a squash, a low rising whoosh, the crowd rising, and an aura starting to build.
  - An explosive launch: a dust shock ring and grit at the take-off point, a whoosh and a thump, speed lines behind the
    rise, and the portrait growing toward the camera as it climbs.
  - The catch in the air at half court, in deeper, longer slow motion: 0.25x, about 560 ms of real time, with the aura
    pulsing.
  - One fluid flying slam: a single accelerating stroke from the half-court catch through the rim onto the target, a
    touch faster than normal (1.3x). The blow lands at that contact, the only one in the sequence, with the explosion,
    the glass, the shake and the crowd.
- **Length at 1x:**
  - The attack after the damage formation is 4.2 s of attack time, plus 0.5 s of slow motion: about 4.7 s.
  - With the formation, about 5.6 s for a single-number blow, or 7.4 s for a seven-number board.
- **New tuner dials:**
  - `oopThrees` (0 to 2) and the timings of the opening: `oopShotMs`, `oopScootMs`, `oopPassMs`, `oopBackMs`.
  - `reboundMs` (off the board to half court), `ballLeadMs` (how long the ball is there first) and `alleyRise` (how
    high over the player's head it is caught). Tier IV's Shot flight is the chest pass speed.
  - `crouchMs` and `crouchSquash`, `launchSize` and `auraSize`.
  - The IV slow-motion depth and length, and the slam speed.
  - `riseMs` (the old bounce) is removed.

## Tests

- The hoop layout keeps the rim on the board's lower centre. The scene pins the board's anchor at the rim.
- The runner draws the hoop on the struck portrait in both directions at every tier.
- The rim never rattles before the slam.
- IV's plan has two swishes, one backboard bang and exactly one impact.
- The ball reaches the half-court catch point no later than the player.
- The slam stroke is one accelerating motion, and the portrait never teleports.
- The safety timer covers the slow motion.

## Perf

Measured on the PROD build of the self-lob build (review 3; the chest pass swaps the lob's path and adds a small glass ring, the same FX load) (`vite build` + `vite preview`), headless Chrome over CDP at 1920x1080 on an RTX 4080
(D3D11), with vsync and the frame cap off and sound off. A temporary, uncommitted hook reached the runner.

| run | p50 | p95 | p99 | worst | long tasks |
| --- | --- | --- | --- | --- | --- |
| IV you (40, again) | 0.7 | 1.1 | 2.2 | 11.7 | 0 |
| IV foe (40, again) | 0.5 | 0.9 | 1.5 | 7.5 | 0 |
| III (14) | 0.5 | 0.8 | 1.7 | 6.6 | 0 |
| II (8) | 0.5 | 0.8 | 1.4 | 6.1 | 0 |
| I (3) | 0.4 | 0.7 | 1.1 | 6.5 | 0 |

The cold first plays spike as every style's do (the page's first overlay render and formation): worst 115 ms for your
first IV and 54 ms for the foe's first.
