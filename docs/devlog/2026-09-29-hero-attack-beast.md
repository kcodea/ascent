# 2026-09-29: the Stampede, the ninth hero attack (beast chomp rush, Legendary)

Owner ask (2026-09-29): "branch off and make some more attack types - we need a fire animation, a bleed/gash animation,
some sort of an undead animation, a beast chomp rush animation, and i would love a king oona banana cannon animation.
use the same 4 tier strategy we have been."

This branch is the **beast chomp rush** only (the other four were built on their own branches in parallel). Branched
off `main` after #1832, so it runs on the shared hero-attack core and the shared damage formation. Nothing changes for
players until the owner deploys `progression-inventory` (the catalog sync adds `attack_beast`). The equip SQL already
accepts the `hero_attack` slot, so there is **no SQL** and no new migration.

## What shipped

**The Stampede** (`packages/ui/src/heroBeast/`). The shared damage formation runs first. Then:

- **Growl.** The striking hero crouches back from the target and swells a touch while feral energy gathers round it:
  an amber ring closing in, a green bloom, embers drawn in, a low growl.
- **Rush.** Spirit wolves burst off the hero's rim and LEAP at the target. A wolf is a side-view head of feral energy
  (deep green pelt, a lit amber rim and fur streaks, a burning eye, gleaming fangs) with a streaming mane of green flame
  behind it (three strips sampled back along its leap). The head gallops (a small bob), swells as it pounces and swings
  its lower jaw open about the hinge as it closes in. Running left, it is mirrored, never upside down.
- **THE CHOMP** (the signature). As each wolf lands, a pair of spectral front-view jaws (an upper fang row and the same
  texture flipped for the lower, offset half a tooth so they interlock) fades in wide and **slams shut** over the struck
  portrait exactly on the arrival beat. The close is cubic, so the last quarter of the snap covers more ground than the
  first three quarters together: a snap, never a slide. The fangs bite a hair past shut and spring back to a clench that
  worries side to side, then let go. The wolf's own jaw snaps shut and it dissolves into the bite. Every chomp brings a
  white flash where the fangs meet, a ring, sparks sprayed sideways off the bite line, bite marks (punctures matching the
  tooth row) that ride the portrait, and a feral tint pulse. The struck portrait is squeezed flat between the jaws.
- **Tiers** (the shared thresholds):
  - I (1 to 5): one wolf, one chomp (the impact).
  - II (6 to 11): two wolves, one high and one low, staggered: the first chomp a tick, off-centre and smaller.
  - III (12 to 19): a pack of five streaming across in lanes, flanks first and the centre last, kicking up scattered
    dust, with a synth ground rumble under the run. Chomp, chomp, chomp, chomp, then the dead-centre impact. Tick
    jaws let go after half the hold, so each chomp reads on its own.
  - IV (20+): six chomps ring the face (all ticks). Then **the colossus**:
    1. **Rise.** Colossal jaws (a near-black maw, burning amber rim, huge gleaming fangs) fade in far above and below
       the target over a darkening backdrop, a mane of light flaring round them and the eyes igniting above. A jaw on a
       side with little room waits just inside that screen edge, and the maw slides toward the middle of the screen, so
       a hero in a corner is still framed by fangs. The jaws creep in, breathing, while a deep growl and the rumble build
       and the struck hero trembles harder.
    2. **Slam** (the impact). The jaws slam shut over the whole portrait: a white flash, a shockwave, a thick amber ring,
       a flash along the bite line, a storm of sparks, huge bite marks, dust thrown out all round.
    3. **Roar** (FX only, 300 ms later). The jaws spring open, shockwave rings tear outward one after another, speed lines
       streak away, the mane blasts outward and the view rattles; then the colossus dissolves.
- **The consequence lands ONCE**, on the last chomp (Tier IV: on the slam). No hit-stop or freeze anywhere.
- **Cosmetic:** `attack_beast`, "Stampede" (a placeholder name for the owner), Legendary, crate, style `beast`, in the
  Collection's Attack Animations tab with the in-place preview, and in the dev "Attack style" switch.
- **Tuner:** "Hero Attack: Beast" in the hub (🐺): beasts, stagger, leap speed and height, lanes, size, dust and the
  colossus per tier; beast size, glow, mane, embers and jaw open; the chomp (snap lead, size, clamp hold, bite marks,
  tint, dust); the colossus (rise, slam, size, roar delay, hold, rings, size); camera, colours, and a clip / gain /
  pitch per sound cue. **Per the owner's ask for every hero attack tuner, it has no Speed or Reduced motion buttons and
  its button row (Copy JSON, Reset, the Play buttons at 3 / 8 / 12 / 40 both ways) sits at the TOP** (the panel's
  `readout` slot, so no shared panel code changed). The shared panel still draws its own Copy JSON / Reset at the
  bottom; when the shared "row at the top" change lands for every tuner, this tuner can drop its own row.

## Timeline (ms from the growl, 1600 px apart; the formation's lead-in comes first)

| tier | first leap | impact | end |
| --- | --- | --- | --- |
| I (3) | 340 | 740 | 1340 |
| II (8) | 380 | 989 | 1629 |
| III (14) | 420 | 1260 | 1920 |
| IV (40) | 440 | 2042 (the slam) | 2942 |

## Crate odds (first crate)

The rarity odds are fixed (50 / 30 / 15 / 5). The Stampede makes Legendary 12 items, so each Legendary is now 0.42%
(5 / 12, was 0.45%). The other rarities are unchanged.

## Perf

Measured on the PROD build (`vite build` + `vite preview`), a private headless Chrome at 1600 x 900 over CDP, 240 Hz,
real rAF playback, sound off, with a temporary, uncommitted hook to reach the runner. Frame times in ms.

| run | frames | p50 | p95 | p99 | worst | > 16.7 ms | long tasks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| I you (3, the session's first play) | 1024 | 4.2 | 8.3 | 12.5 | 237.4 | 9 | 0 |
| IV you (40) | 1100 | 4.2 | 12.5 | 12.6 | 45.9 | 3 | 0 |
| IV foe (40) | 1333 | 4.2 | 8.5 | 12.6 | 20.9 | 2 | 0 |
| III (14) | 1398 | 4.2 | 4.3 | 4.3 | 20.9 | 1 | 0 |
| II (8) | 1292 | 4.2 | 4.3 | 4.3 | 12.6 | 0 | 0 |
| I you (3, again) | 1184 | 4.2 | 4.3 | 4.3 | 8.3 | 0 | 0 |
| I foe (3) | 1181 | 4.2 | 4.3 | 4.3 | 12.6 | 0 | 0 |
| IV you (40, again) | 1712 | 4.2 | 4.3 | 4.3 | 8.4 | 0 | 0 |

- Warm, every tier runs clean: IV p95 / p99 / worst 4.3 / 4.3 / 8.4 ms, no dropped frame.
- The session's FIRST play is not clean in this rig: one 237 ms frame about 260 ms after the preview starts (the foe
  portrait mounting for the preview, the formation's first DOM, and the first upload of the painted textures), and a
  96 ms frame just after the first impact. The second and third plays still show one 20 to 46 ms frame each. No run
  had a long task (so the cost is GPU / upload side, not script), and this rig is headless software GL. **Owner to-do:**
  check the first play on a real GPU (DevTools Performance, prod build); if it hitches there too, paint and upload the
  textures at idle time before the first fight instead of on the first attack.
- After every run no DOM was left behind and `#stage` was restored.

Budget: sprites pooled per layer, capped at 800 (a Tier IV peaks near 400); at most 48 mane strips (three per beast),
each 32 vertices, so every strip batches. Textures are painted once per session and pre-warmed (sprites AND a mane
strip per mesh layer) during the formation. DOM moves are transform / opacity only; the only layout read is the opening
measure (the room round the target for the colossus).

## Sound (existing clips plus the Quake's rumble synth; nothing new recorded)

- **Growl:** `fx/voidpanthergrowl`.
- **Snarl** (the first leap; every leap at I and II): `fx/dragon-growl-2`, pitched up.
- **Rush:** the swish, pitched down, a little higher per beast.
- **Snap:** the whip-snap's crack, pitched down (the jaws), climbing per tick; **crunch:** `smack2`.
- **Impact:** `crit`, and at III `fx/heavy-rock-impact`.
- **Rise:** `fx/dragon-growl`, pitched low; **slam:** `titanhammer` with the snap and the rock impact.
- **Roar:** `fx/dragon-growl` with `turnexplosion` under it.
- **Stampede rumble** (III and IV): `playRumble`, the Quake's synth.

A real wolf snarl, a jaw-snap and a big beast roar would beat these stand-ins.

## Open for the owner

- The name ("Stampede") is a placeholder; the id `attack_beast` stays.
- Deploy `progression-inventory` to put the item in the database (no SQL).
- The oracle rule is **R-PROG-ATTACK-15**. The other new attacks were built in parallel and may have claimed the same
  number; whichever merges second renumbers.
- Sounds: the clips above are stand-ins.
