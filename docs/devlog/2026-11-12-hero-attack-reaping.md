# 2026-11-12: The Reaping, the Ancient of Death's hero attack (style `reaping`, Ancient, dev only)

One of sixteen attacks built in parallel on `feat/hero-attacks-16` (see `2026-11-11-attack-scaffold.md`). Scaffolded
from `stitch`; nothing of Soul Stitch is left (no needles, thread or knots). The style is DEV ONLY and has no cosmetic
yet: it plays through the "Attack style" override and its tuner (Dev menu, "Hero Attack: The Reaping").

## The signature

WHAT THE SCYTHE CUTS IS COLOUR. Every cut drains the struck portrait to greyscale along the cut, and a few warm motes
of its colour lift off and drift into the striker. The top look drains the WHOLE SCREEN to monochrome and silence before
colour floods back to everything except the loser. No other attack removes colour. The palette is the Ancient of
Death's spectral teal (`#2fe0bc`) against black and bone white; the motes are the only warm things on screen. It uses
none of Grave Call's skulls, hands or wisps and none of Hemorrhage's red slashes or blood.

## What it does

Four looks on the shared thresholds (I 1-5, II 6-11, III 12-19, IV 20+; a knockout always plays IV; there is no
separate knockout variant). Flat 2D, no hit-stop, the clock never slows. The blow lands once, as the blade crosses the
middle of the struck portrait.

- **I, the cut.** A long thin crescent blade of teal light sweeps once, point first, along a shallow arc through the
  struck portrait. A STRIP of the portrait goes grey behind it, a hairline of bone light marks the cut, and five motes
  of colour drift to the striker. The colour seeps back after a beat. Which way the cut leans is rolled from the seed.
- **II, the cross.** Two cuts cross at right angles. The first is a tick (its strip, a few motes). On the second the
  two wedges between the cuts drain as well: HALF the portrait is grey, and more motes stream away.
- **III, the shadow.** A tall hooded shadow (an empty cowl, no face, a rim of teal light) rises at the struck portrait's
  side, a scythe raised in its hands, while a small candle burns at the portrait's other side. The scythe comes over
  the top and down through the portrait; the whole portrait goes grey; the flame gutters, bends away and goes out
  (two curls of smoke). A low bell.
- **IV, the reaping.** The whole screen drains to monochrome while every other sound bus is hushed, then a beat of
  silence. ONE bell tolls (a faint ring opens from the striker). A single clean line of teal light is drawn across the
  full width of the screen, through the struck portrait. Its colour streams out of it as thirty motes, the only colour
  on a grey screen, into the striker. Then colour FLOODS back in a wave from the striker's side, to everything except
  the struck portrait, which stays grey a moment longer and gets its colour back last.

The struck portrait takes a short knock along the cut and then SAGS (a touch smaller and lower) while it is grey. The
striker swells a breath through the ready and pulses as the colour reaches it.

## How the colour is drained (and what was measured)

`heroReapingDrain.ts`. Each grey area is an empty `div` with `backdrop-filter: grayscale(1) brightness(0.9)`, appended
to `#stage` at z 160: over the dim (150) and both portraits (40 to 100), under the above-portrait FX canvas (200). A
pane greys whatever is painted under it and touches no other element, so there is no clone of the portrait, no filter
on the game root and no Pixi filter, and the teal blade and warm motes drawn on the canvas keep their colour over a
monochrome screen. After the build ONLY `opacity` and `transform` are written, from the one clock:

- a **strip** is a thin bar across the portrait, turned to the cut and grown along it with `scaleX` as the blade passes,
  inside a round `overflow: hidden` wrapper that clips it to the portrait;
- the **full** pane covers the round portrait and fades with `opacity`: a half-opaque grey pane is a half-drained
  portrait. On II it is two wedge panes instead (two squares with a corner on the portrait's middle, turned to lie
  between the cuts): a `clip-path` polygon on one pane was tried first and drained the whole portrait in the captures;
- the **veil** (IV) is a square big enough to cover the screen at any angle; it fades in with `opacity`, and colour
  floods back by sliding it off along the strike line with `translateX`, its trailing edge feathered by a mask painted
  once.

The wrapper is written the struck portrait's own transform each frame, so the grey rides the face. Every exit (the end,
`finish()`, `cancel()`, the safety timer; an unmount cancels) removes every pane, restores both portraits' transforms,
resets the camera and restores the hushed buses. Neither portrait's filter, opacity or z-order class is ever touched.

The brief's first suggestion (a one-shot `filter: grayscale()` on the game root) was not used: the FX canvas lives
inside `#stage`, so a root filter would have greyed the scythe and the motes too.

**Frame times (DEV build, headless Chrome 1920x1080 with the GPU, `requestAnimationFrame` deltas from the charge to
the end).** The numbers below were taken while fifteen other builders were running dev servers, test suites and
headless Chromes on the same machine (CPU at 100%, under 1 GB of 31 GB free), so they do NOT show whether the 6.25 ms
bar is met; they only compare like with like in the same page and minute. The page idles at a 5.6 ms median, worst
6.7 to 7.1 ms (about 180 Hz).

| run (warm) | median | p95 | p99 | worst | frames over 6.9 ms |
| --- | --- | --- | --- | --- | --- |
| The Reaping IV, you strike (3 runs) | 5.6 to 5.7 | 6.7 to 11.3 | 18.0 to 23.0 | 47 to 106 | 26 to 50 of about 580 |
| The Reaping IV, the foe strikes | 5.8 | 12.1 | 28.2 | 65 | 58 of 534 |
| The Reaping IV with every pane hidden (`display: none`) | 5.8 | 12.5 | 30.2 | 58 | 67 of 516 |
| Soul Stitch IV, the shipped source attack, as a control (2 runs) | 5.8 to 5.9 | 12.7 to 17.4 | 30.5 to 43.7 | 54 to 67 | 76 to 77 of about 505 |
| The Reaping III / II / I | 5.6 / 5.7 / 5.6 | 16.1 / 28.1 / 11.2 | 34.1 / 49.1 / 27.9 | 51 / 61 / 35 | 39 / 41 / 19 |
| Soul Stitch I (control) | 6.1 | 24.0 | 42.2 | 44 | 53 of 199 |

What that supports: with the panes hidden the top look is no faster, so the full-screen backdrop pane is not what
drops frames here; the long frames do not cluster on the drain (0 to 520 ms) or the flood (2200 to 2760 ms); and the
shipped control attack drops more frames than this one under the same load. What it does not support: any claim about
the owner's idle machine or the production build. That needs one run in Chrome DevTools on a quiet machine. If the veil
does cost there, the fallback is a grey pane with `mix-blend-mode: saturation` in the same place (not built).

## How (the rest)

- `packages/ui/src/heroReaping/`: `heroReapingConfig.ts` (per-tier dials on the shared `configStore`; the pure plan,
  cues, blade / scythe / line geometry, the pure drain envelope `drainAt`, the portrait's knock and sag, the camera),
  `heroReapingDrain.ts` (the panes), `heroReapingScene.ts` (the shared `FxPool`, cap 220, plus its own sprites: the
  blade and its shade, the shadow, the snath, the candle, the flame, the line; up to 44 pooled motes on bowed paths),
  `heroReapingTextures.ts` (seven canvases painted once: the crescent blade, the line, the snath, the hooded shadow,
  the candle, the flame, the mote; glows and rings come from the shared Blast set), `heroReaping.ts` (the runner on the
  shared Sequence / StageCamera / PortraitMover), `heroReaping.test.ts` (49 tests).
- `HeroReapingTuner.tsx` on the shared tuner builder with four tier groups (buttons on top).
- Shared files: only this style's own entries (`audio/codeClips.ts`, its paragraph in `heroBlast/heroAttackStyle.ts`,
  one typo in its `DevMenu.tsx` hint).

## Sound

Three clips made with ElevenLabs (4 calls: the first exhale came back almost silent and was regenerated), processed
like the other fx clips (trimmed, short fades, mono, 44.1 kHz, 128 kb/s):

| clip | length | loudness | what |
| --- | --- | --- | --- |
| `fx/reaping-bell` | 3.30 s | -20.4 LUFS, peak -6.5 dB | one strike of a large deep bell, the strike at 0 ms, a 1.3 s fade on the tail |
| `fx/reaping-sweep` | 0.80 s | -22.4 LUFS, peak -10.9 dB | a cold airy scythe sweep; its body runs 250 to 670 ms (cues place 420 ms on the cut) |
| `fx/reaping-breath` | 0.90 s | -24.5 LUFS, peak -11.2 dB | a soft exhale, onset 20 ms, fading over 0.9 s |

5.0 s in all. Cues: the sweep is started early (or part way in) so its body lands on the crossing; the breath plays as
colour leaves (lower and longer on III's rise and IV's drain, short and high as the candle goes out, BACKWARD as colour
floods back on IV); the bell is the one toll on IV and a lower, shorter strike on III's cut; a soft low `smack2` sits
under each cut. IV hushes every other bus (`sfxHush` 0.25, the shared `duckSfxBuses`) from the drain until the flood,
with 260 ms where nothing plays before the toll. Nobody has LISTENED to these yet: levels and pitches were placed from
ffmpeg measurements only.

## Verified

- `npx vitest run packages/ui/src/heroReaping packages/ui/src/heroAttack packages/ui/src/audio`, `npm run typecheck`
  and `npm run lint`: results in the commit's report.
- Looked at, in headless Chrome through the tuner's own Play path (the real runner between the two real portraits):
  every look with you striking, and III and IV with the foe striking. Contact sheets were read and three things fixed
  from them: the motes were invisible on a pale board (now a solid fleck inside a halo, larger), II drained the whole
  portrait (the wedge panes), and III's candle sat half off the screen edge (now kept inside it) while the scythe hung
  under the portrait after the swing (it now thins away after the follow-through).
- After each run: no pane left in the DOM, the striker's transform and class as before, `#stage`'s inline style
  restored, the body class unchanged.

## Not done / weak

- Nobody has heard it. Gains, pitches and the sweep's placement come from measurements, not ears.
- The 6.25 ms bar is unverified (see above).
- II and I with the foe striking were not captured (III and IV were); the geometry tests cover both directions.
- The Collection sandbox (local space) is covered by one unit test only; it was not looked at.
- A scaled stage (a window that is not 1920 x 1080) and phones were not looked at. The panes use `toStage` like the
  shared dim does. `backdrop-filter` on an old phone GPU is the first thing to check there.
- The shared hit number sits over the struck portrait for most of I and II and hides part of the grey strip.
- III's snath is a thin dark line and nearly disappears against the shadow; the blade carries the read.
- No knockout variant ("Tier V"): a knockout plays IV. No cosmetic, patch note or rules entry: dev only.
