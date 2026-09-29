# 2026-09-29: Blast gets a real fourth tier (a barrage of five, then the beam and a supernova)

Owner ask (2026-09-29, part of the hero-attack batch): "use the same 4 tier strategy we have been. add a tier to the
blast attack so they all have 4".

Blast read four thresholds, but its steps did not read as four: I / II / III only differed by bolt count (1 / 2 / 3)
and intensity, and IV was a single colossal beam. The later attacks ladder in four clear steps (Arcana: one ribbon,
two, a barrage of five, a vortex that explodes; Frost: one icicle, two, a volley of five, a frost nova). Blast now
does the same, keeping everything the owner already approved: the thresholds 6 / 12 / 20, the charge / fire / impact
feel, the colossal beam, and no hit-stop.

## The ladder

| tier | blow | what plays | where the blow lands |
| --- | --- | --- | --- |
| I | 1-5 | one bolt | the bolt |
| II | 6-11 | a volley of two | the lead bolt |
| III | 12-19 | a BARRAGE of five fanned bolts (was 3), secondary booms, embers | the lead bolt (the rest pound in after it) |
| IV | 20+ | the colossal beam lands (a tick), holds, then POURS into the struck hero and implodes, then detonates in an arcane SUPERNOVA | the supernova |

**IV, the judgement call.** The beam stays exactly as approved up to its landing. The landing is now a heavy tick (a
flash, a ring, sparks, a lighter camera kick and knock, a quieter impact sound) and the blow waits. After the hold the
beam's TAIL races after its front, so the whole beam pours into the struck hero, its glow thinning as it goes, while a
wide ring and motes implode onto the portrait, the portrait is compressed and trembles, the view inhales and the
rumble builds (`runeselectimplosion`). Then it detonates: a white core flash, a huge side-coloured bloom, 12 long rays,
three shockwaves (the last sweeps most of the screen), a ring of fast streaks, a lingering corona, on top of the
existing impact (the portrait flash, spikes, sparks, embers) and the four secondary booms (`turnexplosion` pitched up,
layered over the impact). The camera's biggest kick of any tier lands here. The damage number, Armor and Resolve land
exactly once, on the detonation.

## Timeline (ms from the charge, at 1x, 1600 px between the heroes)

| tier | impact | end | before |
| --- | --- | --- | --- |
| I (3) | 586 | 1230 | same |
| II (8) | 686 | 1430 | same |
| III (14) | 846 | 1849 | 846 / 1741 |
| IV (40) | beam lands 1049, pour + implosion from 1279, supernova 1619 | 2884 | 1049 / 2314 |

The shared damage formation plays before the charge, unchanged.

## Code

- `heroBlastConfig.ts`: `Bolts` [1, 2, 5, 1]; III `BoltSize` 1.4 -> 1.3 (five bolts on screen); a new per-tier
  `Nova` switch (IV on; ignored without `Beam`); globals `collapseMs` 340, `collapseMotes` 30, `novaSize` 1,
  `novaRays` 12 (cap 20); cues `sfxCollapse*` and `sfxNova*`. The plan gains `nova`, `beamHitAt`, `collapseAt`,
  `novaRays`; `blastCues` adds `beamhit` and `collapse` before `impact` at a nova tier.
- `heroBlastScene.ts`: `beam(..., drainMs)` pours the beam in; `collapse` (a second gather slot, wider reach);
  `beamHit`; `nova`. The update loop is split into per-kind steps (same behaviour).
- `heroBlast.ts`: the cue handlers, the camera (a kick on the beam landing, the inhale, a bigger detonation kick, the
  rumble through the implosion), the focus locks on the target from the beam landing, the foe's compress and tremble.
- Tuner: a "Supernova" group (implosion, motes, size, rays), the per-tier Supernova toggle, implosion and supernova
  sound rows, and a Tier II (8) play button.
- Oracle: R-PROG-ATTACK-03 updated (it is the Blast rule; updating it rather than adding a new number avoids an id
  collision with the hero attacks being built in parallel). Patch note added.

## Perf (dev server, headless Chrome 1600x900, 240 Hz, practice shop, sound off, the tuner's demo hook)

| run | frames | p50 | p95 | p99 | worst | > 16.7 ms | long tasks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| I (3), the session's first play | 1007 | 4.2 | 4.3 | 8.4 | 62.4 | 9 | 0 |
| IV you (40) | 1604 | 4.2 | 4.3 | 4.3 | 16.7 | 1 | 0 |
| IV you (40) | 1618 | 4.2 | 4.3 | 4.3 | 8.4 | 0 | 0 |
| IV you (40) | 1599 | 4.2 | 4.3 | 4.3 | 33.3 | 1 | 0 |
| IV foe (40) x3 | ~1613 | 4.2 | 4.3 | 4.3 | 12.5 | 0 | 0 |
| IV foe (40) | 1598 | 4.2 | 4.3 | 8.3 | 20.9 | 1 | 0 |
| III you (14), five bolts | 1304 | 4.2 | 4.3 | 4.3 | 12.5 | 0 | 0 |
| III foe (14) | 1303 | 4.2 | 4.3 | 4.3 | 12.5 | 0 | 0 |
| II (8) | 1160 | 4.2 | 4.3 | 4.3 | 12.5 | 0 | 0 |
| I (3) | 1077 | 4.2 | 4.3 | 4.3 | 8.4 | 0 | 0 |

- The session's first play pays the one-off mount of the above-portrait Pixi slot (as Frost's table notes).
- IV occasionally shows ONE long frame (about 1 run in 4, 20 to 33 ms). Each play builds a fresh scene whose sprite
  pool grows on demand, so the detonation frame creates its sprites; pre-warming the pool is the fix if the owner
  sees a hitch. This is the dev server; a prod-build check needs an equipped cosmetic, so it is part of the owner's
  review.
- An earlier batch was dropped: the practice shop timer ran out mid-measure (the table above used Unlimited time).
- After every run the `#stage` transform is restored and no `.hblast` DOM is left. Sprites stay pooled under the
  420 cap; DOM moves are transform / opacity only.
