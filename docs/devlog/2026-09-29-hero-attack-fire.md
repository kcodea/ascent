# 2026-09-29: Inferno (the fire hero attack) + live particle fire (Enraged's fire fixed)

Owner ask (2026-09-29): "make some more attack types - we need a fire animation ... use the same 4 tier strategy we have
been ... fix the fire in enrage with pixi style fire so it looks less like a flame image and more liike actual fire. same
with the new fire animation, it should look like live flame/fires pixi sprites etc". First review: "enraged looks way
better" and "fire one looks solid - can you make the 3rd fire tier a bit better and the meteor slightly slower build up
and a cooler explosion"; plus, for every attack tuner, the Play row on top and no speed / reduced-motion buttons.

## The shared live fire (`packages/ui/src/heroAttack/pixiFire.ts`)

`PixiFire` is a pooled particle fire any scene can mount (its `back` container holds smoke and a deep body, its `front`
the flame and embers). What makes it read as fire rather than a picture of fire:

- The body is many small soft puffs, ADDITIVE and overlapping (a white-hot heart where they pile up, orange and red at
  the thin edges). Each is born small and hot, swells, then shrinks as it rises, cooling along a 64-step colour LUT
  (white-hot, yellow, orange, red, dark ember). A share are TONGUES (a teardrop stretched along the flow, always leaning
  up), so the fire licks in strands.
- Buoyancy plus a cheap travelling-sine curl field (the plume sways and curls), per-particle flicker, an emitter gust.
- A NORMAL-blend body layer under the additive flame keeps the colour on a light board; dying flames leave SMOKE; embers
  flutter up.
- Emitters (point, ring arc, disc, line) are live objects the host moves every frame; a moving emitter spreads its births
  along the path it swept (a fireball crossing the board in a third of a second leaves a continuous tail, never beads).
  Timed emitters burn, die down and stop themselves. One-shots: `burst` (blooms out against drag, then rises), `embers`,
  `smokePuffs`.
- Perf: records and sprites are pooled with a HARD cap (a free sprite is borrowed across layers at the cap, so the pool
  never passes it), nothing allocates per frame, `planReserve` / `reserveStep` build the pool a slice a frame during the
  damage formation (a detonation never creates hundreds of sprites and rebuilds the render structure in one frame).
  Textures are painted once per session on CPU-backed canvases (15 ms including the shared Arcana set; it was 57 ms with
  GPU canvases read back).

Colour note: stacking additive orange saturates red first and then green, which goes lemon. The palette's hot stop is
kept orange with some blue in it (`#ffa640`) and the flame alpha moderate, so dense fire reads orange with a white core,
not lemon.

## Inferno (`attack_fire`, Legendary, placeholder name)

Every flame is PixiFire. After the formation fire catches round the hero's upper rim and fireballs ignite round the
portrait (a dense head riding the ball plus a swept comet tail, over a white-hot heart and its light), draw back and are
hurled on slight arcs.

- I: one fireball bursts on the struck hero (a flash, a ball of fire blooming and rolling up into smoke, embers).
- II: two, the struck rim briefly alight.
- III (owner: "a bit better"): five bigger fireballs in rhythm; the struck hero catches more with every tick, then the
  last FLARES it up (a gout of flame off the portrait) and leaves it ABLAZE, dying down to embers and smoke before the end.
- IV (owner: "slower build up and a cooler explosion"): three fireballs (ticks), the hero hurls a column of fire up, and
  the struck hero is MARKED for the whole build (the ground glowing hotter, heat rings closing in, flames licking up round
  it) while a meteor streaks in from above the frame on a low diagonal (so it is on screen for most of its fall even when
  the target sits at the top). The DETONATION is layered: a white-hot core and flash, thin shockwaves (a thin-line ring
  texture, never a thick band), a fire nova racing outward, a dome of fire, a fireball rolling up into a mushroom of smoke a
  beat later, nine pieces of burning debris flung out on arcs each trailing its own fire, a pillar of fire engulfing the
  struck hero that burns out, and a scorch.

The blow lands once: on the last fireball, or on the detonation. No hit-stop. Tiers are the shared 6 / 12 / 20.

Sounds reuse clips: `cards/sp_dragonflame.effect` (ignite, summon), `fx/oona-powerup` (each fireball igniting),
the stereogenic swoosh (hurl), `cards/d2_broodfire.effect` (flame roar), `turnexplosion` (ticks, the blast),
`fx/blue-impact-hit`, `smack2`, `crit`, the cinematic swoosh-impact as a riser landing on the detonation, the ground
impact, `fx/triple-impact` (aftershocks), plus the existing `playRumble` (a roar building from the summon) and
`playEmberCrackle` synths. A tuner row per cue.

## Enraged Strike

The rage aura's swaying strip-mesh flame tongues are gone. The crown is a PixiFire ring emitter on the upper rim, driven
by the hero's heat, the rage surge and the rear; on a dash its arc turns to the TRAILING rim and the fire streams back
(never across the face) and the particles left in the world are the comet trail. The Tier IV rear sends a column of fire
up; the haymaker crater bursts into flame and keeps burning for a beat. Timing, tiers, strikes, claws, sparks, rings and
sound are unchanged. The `flames` and `flameLength` dials now drive the fire's density and height.

## Tuners

`TunerSpec.buttonsOnTop` (from #1843) puts the button row under the header; the Fire and Enraged tuners use it and drop the Speed and
Reduced motion buttons (owner ask for every attack tuner; #1843 did the other eight). On merging #1849, Inferno picks its tier with the shared `attackTier`, so a knockout always plays Tier IV (the meteor).

## Perf (dev server, headless Chrome, ANGLE D3D11, 1600 x 900, 240 Hz, the real runner and scene in a bare page)

Frame intervals while the attack plays in real time:

| run | frames | p50 | p95 | p99 | worst | long tasks |
| --- | --- | --- | --- | --- | --- | --- |
| Inferno IV you (again) | 1620 | 4.2 | 4.3 | 4.3 | 12.5 | 0 |
| Inferno IV foe | 1657 | 4.2 | 4.3 | 4.3 | 12.5 | 0 |
| Inferno III | 1316 | 4.2 | 4.3 | 4.3 | 12.5 | 0 |
| Inferno II | 1053 | 4.2 | 4.3 | 4.3 | 8.4 | 0 |
| Inferno I | 982 | 4.2 | 4.3 | 4.3 | 12.5 | 0 |
| Enraged IV | 1646 | 4.2 | 4.3 | 4.3 | 50 (first play) / 8.3 | 0 |
| Enraged III | 1380 | 4.2 | 4.3 | 4.3 | 20.8 | 0 |

Work per 16 ms step (update + render + `gl.finish`): Inferno IV p50 0.4 / p95 1.2 / p99 1.8 / worst 3.4 ms; Inferno III
0.2 / 1.0 / 1.2 / 1.5; Enraged IV 0.3 / 0.8 / 0.9 / 2.1. Peak live fire: about 1100 particles at the Tier IV detonation (the
cap), about 950 at the Tier III volley; Enraged about 400.

The very first play in a fresh page stalls once (the bare page's first Pixi render compiling shaders, and the fire
textures painted); in the game the overlay has been rendering all along and the textures cost about 15 ms once per
session. Found on the way: a silent attack (`sound: false`) still called `getFxClipBuffer` from `AttackVoices.riser`,
which on a page without an audio context created one mid-attack (a one-second stall in the lab). Silent voices now never
touch the audio engine.

## Owner to-do

- Rename "Inferno" if you want (the id `attack_fire` stays). It reaches the database with the next deploy of
  `progression-inventory` (the catalog sync); no SQL.
- Clip swaps are one tuner row each.
