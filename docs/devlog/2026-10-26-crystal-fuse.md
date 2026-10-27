# 2026-10-26: the end-of-turn charge becomes a crystal fuse (R-CHARGE-FUSE-01)

**Owner ask (Mike):** a new look for the end-of-turn countdown with the exact same behaviour and sounds: a blue crystal
fuse that disintegrates left to right like a burning rope, its broken crystal pulled into the End Turn gem, with debris
swirling round it. Built as code plus a tuner, not in the FX workbench (owner choice), with real physics so "the effect
is actually slightly different each time". Design and plan: `docs/superpowers/specs/2026-10-26-crystal-fuse-charge-design.md`,
`docs/superpowers/plans/2026-10-26-crystal-fuse-charge.md`.

**What changed.** `ChargeGlyph` (Recruit.tsx) keeps every clock, hold, sound, covered/quiet and perf-mark line, and swaps
its visuals:
- `.fuse-body` is the owner's art (`apps/web/public/fx/crystal-fuse.png`) masked left to right by `--burn`, the art's
  tip-to-tip span (`FUSE_ART_SPAN`) as charge goes 0 to 1. A front glow rides it and flares at each bright seam (`FUSE_SEAMS`).
- `fuseSim.ts`: a seeded force sim (pull to the gem, a clockwise vortex, the workbench's layered-sine turbulence, drag,
  mass). Spawns follow the CHARGE delta, not frame time, so a hitch leaves no gap. `step(0)` is a no-op and the
  component never steps it while the clock is held (R-TIMER-SYNC-01). Modes: charging, collapsing (0:00), idle (the
  wait for End Turn: at most `idleOrbiters` pieces on a mass-free calm orbit, nothing spawned, flat cost forever).
- `fuseRender.ts`: one sim, two passes. Behind the cards (`.charge-motes`) and over the End Turn button
  (`.fuse-gemfx`, portalled to the stage, z 42), split at `captureR`. Sprites are baked once per config.
- `fusePhase.ts`: light on a dead clock goes straight to the charged wait (no burst, no sound); unlight before 0:00
  flashes and fades the fuse (`flashOutMs`, 180 ms), at or after 0:00 the gem's strike releases it.
- `EndTurnButton.playStrike` now plays once per End Turn (skips while pressed or within 1.5 s of a strike), and
  `VersusHud` emits the `endTurn` press cue before its automatic End Turn, so Versus releases the charge too.
- Dev Menu: **Crystal Fuse** (🔷) replaces Charge Glyph: Aggression master dial, forces, spawning, gem, fuse, colours,
  plus scrub / Play 20 s / Show 0:00 / Lock seed. Layout Lab's group is renamed Crystal Fuse.
- Removed: `chargeMotes.ts`, `turn-glyph.svg`, the two preview pages, `chargeTune`, `ChargeGlyphTuner.tsx`.

**Not yet checked:** the on-screen position (Layout Lab defaults W 1320, X -42, Y -63 were computed, not eyeballed)
and a prod-build performance trace of the last 20 s on a full board. Both are for the owner's own pass.
