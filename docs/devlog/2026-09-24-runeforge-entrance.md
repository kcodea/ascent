# 2026-09-24: The Runeforge entrance, with a tuner to sim it

Owner ask (verbatim): *"make a tuner to sim this as well for us - i want the runeforge entrances to have a small
animation of them coming into few with dust settling etc. take creative liberty but make this look and feel
significantly better when the runeforge opens. i can help source sound effects for it afterwards as well."*

## What plays

The forge only mounts once the return-to-shop wipe is idle (`Recruit`'s existing `overlaysHeld` gate). It then waits
a tuner pad (`openDelayMs`, 150 ms) before anything shows or sounds. After that, the overlay fades in with the forge in shadow and embers rising off the floor. The rune
tablets then drop in from above, left to right, one stagger apart. Each one touches down with a squash anchored at
its base, sinks a few px past its rest, rebounds and settles. Each landing kicks up a dust puff with some grit and a
few forge sparks, and plays the land cue. The shade lifts while the tablets land, and each tablet gets a one-shot
glow ring and a light sweep once it has settled. The Epic Runeforge uses the Epic multipliers (a heavier drop, more
squash, more dust and embers) plus a purple and gold flare as its last tablet lands. The dust and embers take a violet
palette there. A real forge offers FOUR tablets, and the entrance handles any count from the offer length. With the shipped
defaults (the owner's tuned values), and measured from the wipe ending, the first tablet lands at about 0.57 s, the
last at about 1.02 s, and everything has settled by about 1.64 s.

- A tablet can be clicked from the moment it LANDS. A press anywhere during the entrance skips it to the settled
  state. A press on a tablet still in the air never buys it, because falling tablets are `pointer-events: none`, so
  the press lands on the overlay, which skips.
- A re-roll drops only the new tablets. There is no backdrop fade, shade or embers.
- Coming back from "Inspect the board" does not replay the entrance. It is remembered per opening (run seed + wave +
  offer). A teardown in the middle of the entrance forgets it, so StrictMode's dev re-run still plays the whole thing.
- Reduced motion: one plain fade. Every tablet is clickable at once, and nothing drops, sweeps or flares.
- Replays play it at the replay's speed. `armReplayRuneLockIn` calls `skipRuneforgeEntrance()` before it measures
  the row, so a fast replay never catches a tablet mid-fall. The tutorial's forge beat and the Scene Builder show it
  like any other forge.

## How

- `packages/ui/src/runeforgeEntrance/RuneforgeDialog.tsx`: the forge panel was lifted out of `Recruit.tsx`'s
  `RuneforgeOverlay` so the live forge and the tuner sandbox render the same markup. Each tablet sits in an
  `.rfe-slot` wrapper, which is the thing that moves. The button's own `:hover` transform is left alone.
- `entrance.ts`: the runner. It is started from a layout effect so every WAAPI animation is scheduled before first
  paint. Every animation is transform/opacity with `fill: 'backwards'`, so nothing holds a transform or a compositor
  layer after it ends. Layout is read once per play. Landings, dust, cues and the flare run on timers.
- Three Pixi defs on the above-modal canvas: `runeforge-land-dust`, `runeforge-embers` and `runeforge-epic-flare`.
  They are registered in `directCalls.ts`, the playDef uid allow-list and the defs test's above-modal inventory.
- `playDef` gained an `alpha` option, a container alpha where 1 is an exact no-op. It backs the dust-opacity dial.
- Tuner: `runeforgeEntranceConfig.ts` plus the Dev menu entry "Runeforge entrance". It covers timing, motion, dust,
  atmosphere and the Epic multipliers, and has one clip / gain / offset group per sound cue. ▶ Play (Basic) and ▶ Play
  (Epic) fire `ascent:runeforge-entrance-play`. `RuneforgeEntrancePreview` (DEV) opens a sample forge over any
  screen. On the title it mounts its own `PixiFxLayer`, the way the rank screen preview does, and it lifts the FX
  canvas and the tuner panels above itself.

## Owner feedback on the first cut

*"this is actually pretty close. the shine wipe gets slow and choppy at the end though, just make it sweep quickly
in my opinion."* In the first cut the sweep ran 600 ms on a strong ease-out, so its last third crawled a few px per
frame. It also stopped with the band still on the tablet's right edge, and the band snapped away when the animation
ended. Now it is one quick, even pass: 300 ms by default on a gentle ease-in-out. The band travels fully off the tablet
and rides `translate3d` on a pre-rendered gradient, so it never repaints. The ignite ring keeps its own fade
(`max(420 ms, 1.5 × sweep)`), and the flourish ends when that fade does, so nothing is cut short.

## Owner test in a real game: four fixes

1. **Hover bubble under the tablets.** The Re-roll's hover bubble (*"Re-roll the offered Runes for free ..."*) drew
   under the tablets' rules boxes. `.forge-actions` has a transform (the Runeforge Look scale), which makes it a
   stacking context at z auto, so the bubble's z 600 was trapped inside it. Fix: `.forge-ov .forge-actions
   { position: relative; z-index: 20 }`. The geometry is unchanged: in a real forge each `.rfe-slot` rect equals its
   `.runecard` rect exactly (0,0,0,0 at 1600x900).
2. **Four tablets.** The preview now deals four samples. The timeline and the tests cover 1 to 5 tablets.
3. **Sound "early and continuously".** Diagnosis. The first cut started every beat timer in the layout effect,
   which runs BEFORE the commit's paint. WAAPI animations only start on the first frame they render. On a slow first
   frame (a cold forge decoding four tablets' art with `decoding="sync"`, a dev build's StrictMode commit), every timer
   ran ahead of the visuals by that frame's length. The thuds fired before the tablets appeared, then bunched
   together. Second, any remount in the middle of the entrance restarted the whole sequence, sounds included, because
   the "played" memo was forgotten on an unfinished teardown. Fix: the beat queue is released on the lead animation's
   `ready`, minus how long ago it actually started. A remount mid-play now settles (only an immediate StrictMode
   re-run, within 50 ms, replays). Each cue is deduped per tablet per play, and `playFxSound` is called with
   `loop: false`. In a clean headless profile, a real combat return logged the forge mounting on the exact frame the
   curtain went idle, then four thuds, once each, starting 580 ms later. I never reproduced a literal endless loop.
4. **Wipe gate.** The existing `overlaysHeld` gate (the wipe state machine back at `idle`) is the signal. The new
   `openDelayMs` pad runs from it. Cues are clamped so a negative offset cannot land inside the pad.

Then two more owner reports:

- *"fix this so the coin never falls behind the frame thing here"*. While a slot dropped, its transform made it a
  stacking context, which trapped its cost coin (z 6). The coin overhangs the LEFT neighbour, whose glow ring (then
  z 7) painted over it. Fix: every slot is always a stacking context at an increasing z (`--rfe-z`, 1..n, left to
  right), so each tablet, coin included, sits wholly above its left neighbour in every frame. The glow overlay is now
  z 5, under the tablet's own coin. Checked with `elementFromPoint` on every coin, Basic and Epic, at 1600x900 and
  2560x1080. The coin is on top in every case.
- *"Your End of Turn effects trigger 2 more"* looked clipped. At rest nothing is clipped: `scrollHeight ==
  clientHeight` on every rules box, and the box ends 12 px inside the tablet, at both widths. The screenshot was taken
  mid-entrance (squash or sweep) or under the hover bubble, which fix 1 now draws on top.

Then *"add a sound section for the golden wipe/glow sweep"*. The `ignite` cue became `sweep`: its default clip is
`equipmentsheen`, and it has gain, an offset from each tablet's sweep start, and an every-tablet toggle. The default
is once per forge, on the first sweep. In every-tablet mode a minimum gap (120 ms) stops sweeps stacking. Finally, the
owner's tuned values were baked as the defaults.

## Sound cues (for the owner to source)

| Cue | Fires | Shipped clip |
|---|---|---|
| `land` | each tablet touching down | `cardlanding` (gain 0.55) |
| `dust` | each landing's dust puff (+20 ms) | none |
| `sweep` | the glow sweep: once per forge by default, or per tablet with a min gap | `equipmentsheen` (gain 0.45) |
| `epicFlare` | the Epic flare (last landing) | none |

Each cue has a clip select, a gain and an offset in the tuner. The clips play through `playFxSound` on the `ui` bus,
never looped.

## Perf

Measured in the dev build at 240 Hz with the FX canvas warm, using headless Chrome over CDP and rAF deltas. With the
owner's baked values, six alternating Basic/Epic plays had no frame over 6 ms. That includes the 180 ms sweeps and the
Epic's 2x flare and 2.45x embers. The only long frames came from the preview's own cold Pixi init on the title
screen (a one-off that the live forge never pays, because the board's FX layer is already attached).
