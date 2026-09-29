# 2026-09-29: Oona's Banana Cannon, the ninth hero attack (attack_banana, Legendary)

Owner ask 2026-09-29: "branch off and make some more attack types - we need a fire animation, a bleed/gash animation,
some sort of an undead animation, a beast chomp rush animation, and i would love a king oona banana cannon animation.
use the same 4 tier strategy we have been." This entry is the banana cannon slice (the others shipped on their own
branches).

## What it is

`attack_banana`, placeholder name **"Oona's Banana Cannon"** (Legendary, crate, account-wide, style `banana`). The
catalog caps names at 20 characters, so "King Oona's Banana Cannon" (25) did not fit; the owner can rename it (the id
stays). The cannon is King Oona's own (the `b2_oona` art): a jungle-green barrel, gold bands, a flared brass bell muzzle,
a spiral emblem, wooden grips and a little gold crown on top. Everything is canvas-painted once per session, flat 2D.

After the shared damage formation:

| tier | what plays |
| --- | --- |
| I (1-5) | The cannon pops in on the hero's rim (leaves, gold sparkle) and aims. It pumps ("chk"), fires with a big recoil and muzzle puff, and one spinning banana lobs on a high arc and splats: a peel bursts open and sticks, chunks fly, a yellow comic POW star. |
| II (6-11) | A double shot (one high and wide, one flatter). The first splat is a tick. |
| III (12-19) | A rapid barrage of six, the cannon pumping in rhythm; peels pile up on the face; the last is the impact. |
| IV (20+) | Three quick warm-up bananas (ticks). Then the cannon glows gold, swells and trembles, a golden halo builds and its crown glints twice. It fires a GIANT GOLDEN BANANA that climbs out of the top of the screen while a flat golden target ring locks on to the struck hero, which cowers. The giant slams dead centre: a white-gold flash, a golden shockwave, gold rays, the biggest comic star, a shower of whole bananas tumbling out, peels scattered round the face, then three banana pops. |

The blow lands exactly once: on the last banana (I-III) or on the slam (IV). No hit-stop; the clock never pauses.
Reduced motion: fades only.

## How

- `packages/ui/src/heroBanana/`: `heroBananaConfig.ts` (per-tier dials t1..t4, the pure plan and cues, the pure cannon
  rig and ballistic banana paths, the pure camera), `heroBananaScene.ts` (Pixi, pooled, cap 600 sprites),
  `heroBananaTextures.ts`, `heroBanana.ts` (the runner on the shared clock), `heroBanana.test.ts` (35 tests).
- A banana is a quadratic run at a LINEAR parameter, which is a true parabola (even sideways speed, falling faster), so
  the lob reads as a cannon shot. The giant's apex (not its control point) is capped at `giantOvershoot` above the frame.
- The cannon flips its Y scale when it fires leftward, so the foe's cannon is never drawn upside down.
- Draw order: sprites are pooled per layer, so a reused sprite can land anywhere in its layer's order. Every multi-part
  object puts each part on its OWN layer (haze | glow | body | trim | ink | core): the trim always over the barrel, the
  banana's brown ends over its body, the star's yellow fill over its dark outline. (Caught in review: with one shared
  body layer the star rendered as a brown blob once its sprites were reused.)
- DEV tuner "Hero Attack: Banana Cannon" (DevMenu, tunerAll): every dial, colours, a clip / gain / pitch row per sound
  cue, Play both ways at 3 / 8 / 12 / 40, reduced motion, 1x / 0.5x / 0.25x, Attack style row.
- Wired into `Recruit.tsx`, the Collection preview (`HeroAttackPreview.tsx`), `heroAttackStyle.ts`, the cosmetic in
  `packages/progression/src/cosmetics.ts` and its Edge Function mirror. No SQL: the catalog syncs on the next
  `progression-inventory` deploy.
- Crate odds: Legendary now has 12 items, so each Legendary is 5 / 12 = 0.42%; the hero attacks together 3.8%.
- Oracle: R-PROG-ATTACK-15 (quotes the owner); R-PROG-ATTACK-01 lists the ninth attack. GAME-RULES and a patch note.

## Sounds (existing clips only)

summon `equipclang`, sparkle `fx/djartmusic-christmas-sparkle-whoosh-1-275404`, pump `blastpump`, fire `fx/oona-launch`,
muzzle boom `turnexplosion` (pitched up; low for the giant), whoosh `fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3`,
splat `fx/oona-splat`, smack `smack2`, impact `crit`, royal charge `fx/oona-powerup`, descent `fx/metal-woosh` (low),
slam `fx/heavy-rock-impact`, pops `fx/oona-splat` (high), stow `equipclang` (high). Clips that would help: a cartoon
cannon "foomp", a descending whistle for the giant, a comedic boing/splat.

## Perf (PROD build, `vite build` + `vite preview`, private headless Chrome over CDP, 1600 x 900, RTX 4080 D3D11, vsync and frame cap OFF, so the numbers are raw frame cost)

Real rAF playback, sound off, temporary uncommitted hook to reach the runner.

| run | frames | p50 | p95 | p99 | worst | > 16.7 ms | long tasks | peak sprites |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| IV you (40, first play, cold page) | 17044 | 0.3 | 0.5 | 0.7 | 430.2 | 9 | 6 | 175 |
| IV you (40, again) | 12264 | 0.5 | 0.7 | 0.9 | 8.8 | 0 | 0 | 174 |
| IV foe (40) | 13046 | 0.5 | 0.7 | 0.8 | 6.4 | 0 | 0 | 187 |
| III (14) | 10623 | 0.5 | 0.7 | 0.9 | 6.9 | 0 | 0 | 145 |
| II (8) | 9963 | 0.4 | 0.7 | 1.1 | 6.4 | 0 | 0 | 65 |
| I (3) | 8434 | 0.5 | 0.9 | 1.4 | 7.2 | 0 | 0 | 43 |

The first-play spike is the harness's cold start, not the cannon: painting all the banana textures takes 3.4 ms, and
Venom Volley (poison) played first on the same cold page spikes the same way (worst 491 ms, 6 long tasks). It is the
first Pixi overlay render / first formation on a fresh title screen; in a real fight the overlay is already warm. Worth
a follow-up on the shared warm-up if the owner ever sees a first-attack hitch.

## Open for the owner

- The name (placeholder "Oona's Banana Cannon") and whether the cannon should be bigger or the giant slower.
- Sound: the clips above are stand-ins from the existing library.
- Deploy `progression-inventory` so `attack_banana` reaches the catalog. No SQL.
