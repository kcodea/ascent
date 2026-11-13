# 2026-11-12: Paid in Full, the rubber stamp hero attack (style `stamp`, Rare, dev-only)

One of sixteen attacks built in parallel on top of the `npm run attack:new` scaffolds (this one scaffolded from `coin`).
The style is DEV-ONLY: it has no cosmetic, so no player can equip it; it plays through the dev "Attack style" override
and its tuner. The coordinator adds the cosmetic, the rules entry and the patch note later.

## The signature

A big office RUBBER STAMP (a turned wooden handle, a brass collar, a dark mount, a red rubber die) thunks down on the
struck portrait and LEAVES A MARK ON IT: a wet ink seal, a bold ring with a star inside (a skull on a knockout), no
words. No other attack stamps its target or leaves anything on it.

## What it does

A Rare has two looks. The shared tiers map onto them the way the Coin Flick's do: I-II play Small, III-IV play Big, a
knockout always plays Big. Flat 2D, no hit-stop, the blow lands once, on the last thunk.

- **Small (tiers I-II), about 1.4 s after the damage formation:** the stamp grows up out of the striking hero, winds
  back a touch, swings over on a low arc with its handle trailing, hovers and THUNKS down once. The portrait squashes
  under it, dust puffs out either side of the die, a few drops of ink fly. The stamp lifts away and fades, and the
  seal is left on the portrait, slightly crooked: glossy for a moment, then dry (the shine goes, the ink dulls), then
  it fades out.
- **Big (tiers III-IV and every knockout), about 2.1 s:** an INK PAD (a steel tin with soaked red felt) pops up beside
  the striking hero and the stamp hops onto it first (the pad dips, a small splat, a few drops). Then it swings over
  and stamps THREE times fast: thunk, thunk, THUNK. Each mark sits crooked the other way from the one before and a
  little off it; the earlier marks dim as the next lands over them. The third is wound up half as high again, lands
  hardest (a bigger squash and shake, a spray of droplets, a few blots round the seal), sits nearest straight, is the
  biggest, and is the blow.
- **A knockout** stamps a skull instead of the star.
- **Reduced motion:** no stamp, no camera, no portrait moves; the numbers fade and the blow lands.

## How

- `heroStampConfig.ts`: the tuned values, the pure plan (`stampPlan`, `stampCues`), the pure track (`stampTrack`: sizes
  off the struck portrait's radius, contacts, hovers, each mark's angle and size rolled from the seed) and the pure pose
  (`stampPose`: where the die is at any time, written into a reused object), plus the camera and `stampPress` (how hard
  the struck portrait is pressed).
- **The axis.** The stamp is drawn handle up and comes straight down when the struck portrait has headroom (the foe
  stamping you, bottom left). The foe's portrait sits hard against the top right corner, where an upright stamp would
  leave the screen, so `fitAxis` leans the stamp back toward the striking hero by exactly as much as keeps the handle
  under the ceiling (about 70 degrees there: it comes in from the side). The slam, the portrait's squash
  (`rotate(axis) scale(...) rotate(-axis)`), the push and the camera shake all follow that axis. At the striking hero
  the stamp always stands upright; a striker near the top brings it out lower, in front of its portrait, and its ink
  pad sits lower too. A test walks the whole pose in both directions and asserts the die and the handle stay on screen.
- **The seal is nudged off the big `-N`.** The shared hit number pops beside the struck portrait; the last mark's
  centre is moved 0.2 radius away from it so the two do not sit on each other.
- `heroStampScene.ts` (on the shared `FxPool`, capped at 120 sprites): the stamp (one sprite anchored on its rubber
  face, with a soft shadow that tightens as it comes down), the pad, the marks (the seal tinted with the ink, plus an
  additive gloss; both ride the portrait's knockback), dust, droplets, blots.
- `heroStampTextures.ts`: eight canvases painted once per session (the stamp, the star seal, the skull seal, a gloss for
  each, the pad, a droplet, a splat). The seals are white so the ink colour tints them; their specks and scratches come
  from a fixed seeded generator.
- `heroStamp.ts`: the runner on the shared `Sequence` / `StageCamera` / `PortraitMover` / `DamageFormation`. The marks'
  crookedness is rolled from `rollSeed` when the caller gives one, else from the total, the distance and the side, so a
  replay stamps the same marks.

## Sound

Two ElevenLabs clips (2 calls, both kept, 0.66 s in total), trimmed to their hit, short fades, mono, 44.1 kHz, 128 kb/s.
Both are far too short for an integrated loudness reading to mean much (0.3 s; ebur128 gives -26 and -33 LUFS on a
padded read), so they were levelled by peak under the -1 dB ceiling instead and are balanced in the config gains.

| clip | kept | hit point | peak |
| --- | --- | --- | --- |
| `fx/stamp-thunk` | 0.36 s | the thump about 20 ms in | -1.9 dBFS |
| `fx/stamp-pad` | 0.30 s | the tap about 25 ms in | -6.5 dBFS |

Cues: the pad tap on the pad beat; the shared swish (`fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3`) as the
stamp leaves; the thunk on every stamp, played from 8 ms in so the hit sits on the frame the die lands. One clip makes
the three: the ticks are lighter and pitched up (1.16x, 1.06x), the last is the lowest and the fullest (0.86x, full
gain, a touch of tail). `ATTACK_FX_CLIPS.stamp` lists the three clips; the Coin's snap is no longer referenced.

## Verified

- `npx vitest run packages/ui/src/heroStamp`: 31 tests (tiers, tuner, plan and cue order per look, the track and the
  pose in both directions, the whole stamp on screen, the blow exactly once on the last thunk, finish / cancel / the
  safety timer / reduced motion put the portraits back exactly, determinism from the seed, the pooled scene drains).
- `npx vitest run packages/ui/src/heroStamp packages/ui/src/heroAttack packages/ui/src/audio`: 22 files, 886 tests
  pass (run with raised hook timeouts: on the loaded machine three audio suites timed out in their setup hooks at the
  defaults). `npm run typecheck` clean; `npm run lint` 0 errors (148 warnings, none in this style's files).
- Looked at in headless Chrome at 1920x1080 through the tuner's demo handle on a manual clock (stills at exact beats):
  Big and Small with you striking, Big and Small with the foe striking, and a knockout. After each run: no formation
  DOM left, `#stage` and both portraits with no inline transform, no updater hooked.
- Perf, DEV build, headless Chrome (about 178 Hz), on a machine that was running fifteen other builders at the time,
  so the frame times below are not a clean reading:
  - The runner's OWN per-frame JavaScript (formation paint + stage paint + scene update, timed inside the updater) on
    the top look, nine runs in both directions: median 0.1 ms, 99th percentile 0.5 to 1.5 ms, worst 1.4 to 2.6 ms.
    The Coin Flick measured the same way in the same session: worst 1.4 to 1.8 ms.
  - Whole frames (requestAnimationFrame deltas across the top look): median 5.6 to 6.0 ms, 99th percentile 18 to 43 ms,
    worst 39 to 94 ms (one run 454 ms). The Coin Flick, interleaved: 99th percentile 23 to 41 ms, worst 49 to 76 ms. An
    idle shop in between: 99th percentile 6.5 to 11 ms. So the long frames are not this attack's own code and the
    existing Rare shows the same ones; where they come from (the dev build, the `#stage` camera, the loaded machine)
    was not found. **The 6.25 ms bar is NOT shown to be met**: it needs a quiet machine and the production build.

## Not done / weak

- No cosmetic, no rules entry, no patch note (by design: the coordinator adds them).
- Nobody has LISTENED to it. The clips were placed from their measured envelopes; the gains and the three pitches are a
  first guess.
- With you striking, the foe's portrait has no headroom, so the stamp comes in leaning about 70 degrees rather than
  straight down. It reads as a stamp pressed on from the side; the straight-down thunk is only seen when the foe
  strikes you (or in a layout with room above the struck hero).
- On the impact frame the shared `-N` pops very large over the struck portrait and hides the third mark for a few
  frames; after it settles it still overlaps the edge of the seal on a three-stamp.
- Three overlapping seals are busy on a detailed portrait. The earlier two are dimmed so the last reads, but it is
  still a lot of red for a moment.
- The Collection sandbox preview was not looked at.

## Second pass (2026-11-12, after the owner played the batch: "great, but they need sound effects")

**Sound (measured, not heard).** The attack's output was recorded in headless Chrome (a tap on the audio destination)
and read in 100 ms windows. Before: the three thunks reached -39 / -38 / -34 dB RMS (peaks -22 / -20 / -17 dBFS), the
swish and the pad tap sat under -39 dB, and the shared swish was cued from the start of a clip whose loud part is
440 ms in, so it was close to silent. The Coin Flick's own sound (the Rare reference) runs about -32 to -40 dB RMS
with -20 dB peaks; the shared formation boom that opens every attack is -17 to -20 dB RMS, peak -10.

- `fx/stamp-thunk` REPLACED: a wooden-handle thock on a desk, 0.6 s, hit 10 to 35 ms in, strong under 400 Hz.
- `fx/stamp-pad` REPLACED: a short wet squelch, 0.3 s, hit 60 ms in.
- `fx/stamp-body` NEW: a low thump (low-passed at 260 Hz), 0.5 s, layered under every thunk and softly under the pad.
- 3 ElevenLabs calls this pass; the three own clips total 1.4 s.
- Cues now: a light swish as the stamp pops out of the hero; the squelch plus a soft thump on the pad; the swing's
  swish timed so its loud part lands late in the flight; thock plus thump on every stamp, the thock climbing in pitch
  and force (0.93x, 1.0x, 1.07x; gain 0.68, 0.82, 1.3) while the thump under it gets deeper and fuller (the third at
  0.8x and three times the second); a quiet pitched-up squelch as the die peels off the last mark.
- After: Big thunks -28 / -26 / -21 dB RMS (peaks -14 / -15 / -10), the pad -31 (peak -13), the swing -25; Small swing
  -26, thunk -24 (peak -11). The last thunk is now as loud as the formation boom. Still silent: the 100 ms wind-up
  before the third stamp (on purpose) and the marks drying.

**Impact (Big only).** The third stamp waits longer (the wind-up 80 to 160 ms), presses the portrait harder (the press
1.25 to 1.8, against 0.5 for a tick), shakes more (9 to 15 px), flings more ink (14 to 22 drops), and adds a pale flash
off the wet ink and a ring of eight dust puffs. Running time 2.12 s to 2.28 s after the formation (Small unchanged at
1.38 s). No new drawn objects.

**Size and the top of the screen.** The stamp is 30% bigger (base width 1.17 to 1.57 portrait radii on Big, about 200 px
at 1080p) and the seal was kept inside the portrait (mark size 1.12 to 0.88 stamp widths). Against a foe in the top
right corner an upright stamp needs about 3.4 radii of headroom and there is under one, so pulling the portrait down
cannot buy it (it would have to move about 1.5 radii, out of its frame). The lean stays, now a deliberate sideways
press (about 73 degrees, the cap raised from 1.3 to 1.5 rad so the bigger stamp still fits under the ceiling).

**Perf.** The squash scales the struck portrait, and the browser re-rastered it at every new scale: a run of 8 ms
frames after each thunk. The runner now holds `will-change: transform` on the struck portrait for the attack and puts
the old value back on every exit. DEV build, headless, a loaded machine: median 4.2 ms (240 Hz), 99th percentile 4.3
to 8.4 ms, worst 37 to 54 ms; the worst frames sit about 60 ms after the charge and on the last frame, where the
shared camera starts and resets, and the Coin Flick shows the same two. Not measured on a production build.

Sheets: `scratchpad/attacks/stamp/v2/`. Still weak: nobody has listened; the top-of-screen stamp is sideways; the big
`-N` still covers the third mark for a moment.
