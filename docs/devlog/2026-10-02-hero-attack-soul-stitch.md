# 2026-10-02: Soul Stitch, the first Ancient-built hero attack (attack_soul_stitch)

Owner ask: an "ancient" attack for the ANCIENT OF BONDS style: "this ancient binds things together and using
soulbindings". The owner picked the concept **Soul Stitch**. Its signature is STITCHING the target to you: crystal needles
on violet soul thread. No other attack sews.

## What shipped

- **Cosmetic:** `attack_soul_stitch` ("Soul Stitch"), **Ancient**, crate drop, style `stitch`. It is the first hero attack
  BUILT at Ancient; Arcana and Consecration were moved up to it. Ancient now has 11 items at 3 / 11 = 0.273% each
  (it was 10 at 0.3%). The other rarities do not move. Category shares in a first crate: title 11.8, minion skin 38.4,
  hero skin 14.8, hero attack 8.3, portrait frame 26.7. The Collection total is 198, and the Attack Animations tab
  shows 21.
- **The tiers.** These are the shared thresholds, and a knockout always plays IV.
  - **I, Needle.** One needle pierces the face and the thread hangs taut. Then a tug: the striker leans back, the
    target is yanked toward it, and a bead of light runs down the thread. The needle shatters and the thread snaps.
  - **II, Cross.** Three needles cross-stitch an X: two sew the diagonals and the third pins the crossing. The striker
    yanks and the threads snap through the face.
  - **III, Pinned.** Five pins stab into the rim at the points of a star, one after another. The striker leans back
    on all five and the portrait stretches toward it about its far rim. All five pins rip out at once: five snaps,
    with bursts and splinters at each pin. The portrait snaps back through a squash, with a flash, a shockwave, a
    crystal spray and light streaks.
  - **IV, Bound Together.** Six needles lace the portraits together. The striker yanks, and the target is dragged
    halfway across the board into a gold heart-knot that ties shut round it: three cinch pulses, a gold glow, a violet
    crystal clasp, and the portrait crushed small. The striker strikes down the laces and the knot bursts: a nova,
    shockwaves, light streaks, gold and violet soul ribbons, crystal rain, and a slow-motion dip. The target is flung
    home.
- **Shared wiring.** Runner, scene, textures and config live in `packages/ui/src/heroStitch/`. Also: the tuner
  (`HeroStitchTuner.tsx`, Play row at the top, all four tiers both directions), the DevMenu entry, `tunerAll`, the
  `Recruit.tsx` dispatch, the Collection preview, the style list and the dev override. The cosmetic is in the Edge
  Function mirror (`npm run progression:shared`). Oracle rule R-PROG-ATTACK-34 is new, and R-PROG-RARITY-01 plus the
  hero-attack crate rule were updated. GAME-RULES and the patch note are updated.

## How it got here (owner review loop, all on 5173 the same day)

1. First build: I needle, II cross, III a zig-zag seam down the face that cinched, IV a cocoon that was ripped open.
   Owner: "t1 and t2 are great. t3 is abysmal, and t4 is a 4/10 max. do not use the rune explosion sound, it is
   overused right now". The rune sounds (`rune-chain-break`, `runeselectimplosion`) and `turnexplosion` came out of
   every tier.
2. Three new III+IV concept pairs went to the owner, who picked **Bound Together**. III became a zipper seam ACROSS the
   board, with a pulse that raced down it. IV became the drag into a heart-knot.
3. Owner: "the huge one looks pretty awesome, but the heart isn't over the target enough". "t3 attack is HORRIBLE.
   please redo it entirely". Three new III concepts went over, and the owner picked **Pinned**.
4. Owner: "can you make a bit more oomph on t3 and t4". Layered blasts were added to III's rip-out and IV's burst. IV
   gained the cinch pulses and the knot glow.

## Non-obvious fixes

- **The heart-knot sat off the dragged portrait.** At 1920x1080 it was 122 px right and 49 px up. The drag converts
  screen px to the portrait's own transform px using its ancestors' scale, which is read once per attack. A tuner
  preview starts while the foe portrait's `combatoppdrop` entrance (scale 0.86, a -46 px slide) is still running, so
  that measure read the portrait small, and the portrait over-shot the knot. The measure is now taken at rest with
  `restingRect`. It also records where the round art sits from the wrapper's centre (the transform origin), so a
  stretch or a crush is solved about the ART. After the fix, portrait (1086, 455) and knot (1089, 457) agree, checked
  at 1920x1080 and 1600x900 in both directions.
- **"Hit-stop" versus the house rule.** The oomph ask said "a punchier hit-stop on the burst", but R-PROG-ATTACK-10
  forbids a freeze (owner 2026-09-28: "it looks like lag"). IV's burst gets a slow-motion dip instead: the one clock
  drops to 0.3x and eases back over 260 ms (`stitchTimeScale`, the Basketball's technique). It never reaches 0, and
  the safety timer adds the extra real time.
- **Headless captures need a live Pixi ticker.** `pixiFx`'s ticker idles when it has no updaters. A scripted capture
  that drives the attack with manual frames must also hook an updater, or the canvas never re-renders.

## Perf

Measured on the PROD build (`vite build`, then `vite preview`), in headless Chrome on an RTX 4080 SUPER (ANGLE D3D11)
at 1920x1080 and 240 Hz, with sound on. The runner was reached through a temporary, uncommitted hook. Frame times are
in ms, measured over the whole attack plus the 900 ms drain.

| run | frames | p50 | p95 | p99 | worst | > 16.7 ms | long tasks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Soul Stitch IV you (40), first of session | 1695 | 4.2 | 4.3 | 8.3 | 120.8 | 9 | 0 |
| Soul Stitch IV you (40) | 1583 | 4.2 | 8.3 | 8.4 | 20.8 | 2 | 0 |
| Soul Stitch IV foe (40) | 1755 | 4.2 | 4.3 | 4.3 | 20.8 | 1 | 0 |
| Soul Stitch IV you (40), first of a fresh session (re-run) | 1764 | 4.2 | 4.3 | 4.3 | 20.8 | 2 | 0 |
| Hemorrhage IV you (40) | 1846 | 4.2 | 4.3 | 4.3 | 45.8 | 2 | 0 |
| Nothing But Net IV you (40) | 1970 | 4.2 | 4.3 | 4.3 | 20.8 | 2 | 0 |
| Soul Stitch III you (14) | 1479 | 4.2 | 4.3 | 4.3 | 29.1 | 2 | 0 |

The 120.8 ms first-of-session spike did not come back in two more fresh sessions, where the worst was 20.8 and 25 ms.
It reads as session warm-up, not this attack. For comparison, Hemorrhage's devlog recorded 191.8 ms on its own first
play. Thread meshes are 32 x 2 vertices (batchable) and rewritten in place. Sprites are pooled under a hard cap of 520,
and IV peaks under 200 live. No loop animates a paint property: the knot glow is Pixi alpha and scale.

## Sound (queued for ElevenLabs)

No ElevenLabs key was set up: neither the main checkout's `.env` nor `apps/web/.env` has one. Every cue reuses an
existing clip, and none is a rune or explosion sound. When a key is set up, these are worth generating, as cue -> prompt:

- snap: "a taut silk thread snapping under tension, a sharp bright twang and crack, short"
- twang: "five taut strings plucked low at once, a tense resonant twang, short"
- pierce: "a small crystal needle piercing fabric, a glassy tick, very short"
- knot: "a heavy golden rope knot pulled tight, a creak and a metallic clink"
- burst: "a magical golden knot bursting apart, a crystalline shatter with a deep whoosh, no explosion"

## Owner step

Deploy `progression-inventory` after merge, so the catalog sync writes the new item. No SQL is needed: the Ancient
rarity migration already accepts it.
