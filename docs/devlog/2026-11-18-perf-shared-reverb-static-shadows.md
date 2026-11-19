# 2026-11-18 — Perf: shared effect reverb and two static shadows

Part of the 2026-11-18 perf pass (owner bar: 240 fps constant, recruit phase first). Sibling of
`2026-11-18-perf-always-on.md`. The same-day measurement (E1) named the first: the reverb convolution thread was busy
0.4 cores in a round-3 turn and 1.4 in a round-13 turn, with `acquireConvolver` at 82 ms of self time in one round-8
turn.

## What changed

**One shared convolver per impulse for effect sounds (R-PERF-SHARED-FX-REVERB-01).** An effect `sound` layer with
reverb used to take a ConvolverNode of its own from a pool of two per impulse; a third overlapping play built one
(about 6 ms of main thread at a 96 kHz context) and every live node is convolution work on the audio thread. Now a
one-shot layer whose reverb had nothing after it but the fader (no Pan, a flat mix, a flat level curve) sends into
a shared node for its bus and impulse, built once on idle time.

- The send carries the fader's level. The fader's FADES stay behind the convolver, on one gate gain per node,
  because a fade moved in front of the convolver changes the sound.
- Plays with the same fade-in share a node; its gate rides the fade-in when the node has rung out.
- Fading-out plays get two nodes per impulse (one on a phone: what the pool kept idle before), and a new play takes
  one no play is still fading on.
- A finished voice is disconnected from its bus once its own chain has stopped ringing (`playSample`, `playFxSound`).
- The Ruby landing's tail convolver is built on idle time on desktop instead of by the first Ruby of a session.

**Two shadows moved onto static boxes.**

- Hover preview (R-PERF-HOVER-SHADOW-01): the three drop-shadows sat on the parent of a child that bobs forever, so
  the filter re-ran every frame. `.cardref` now carries the motion (slide-in on `transform`, bob on `translate`) and a
  new plain `.cardref-shadow` inside it carries the filter.
- Damage numbers (R-PERF-DMG-SHADOW-01): the drop-shadow moved from the animated float to a static `.dmgbody` inside
  it that holds the number and its burst.

## Measured

Prod bench build, Playwright driving its own headless Chrome (throwaway profile, hardware GL), network blocked.

| | before | after |
|---|---|---|
| ConvolverNodes built by 14 big hits 350 ms apart (strike-impact pink / purple / blue) | 16 | 0 |
| ConvolverNodes built by 8 buff trails 300 ms apart | 6 | 0 |
| ConvolverNodes built at start-up (idle time) | 13 | 10 |

So a busy stretch that held up to 13 + 22 live convolvers now holds 10 for the whole session.

## Does it sound the same

Offline render of the old graph against the new one (same clip, same impulse, `OfflineAudioContext`), difference
relative to the signal:

| case | difference |
|---|---|
| no fades, one play or three overlapping (Shout icon, Beast bite) | -139 to -145 dB (floating-point noise) |
| strike impact, 50 ms or 170 ms fade-in, one play | -144 to -145 dB |
| strike-impact-blue's two layers together, twice, 3 s apart | -143 dB |
| grant trail (400 ms fade-out), one play, or two 300 ms apart | -142 to -143 dB |
| three strike impacts 350 ms apart | -30 dB |
| four grant trails 200 ms apart | -20 dB |

The last two rows are real differences and the owner should listen for them. Three hits inside one 2 s tail: the
second and third hit's reverb onset (its first 50 ms) is not faded in, under the tail still ringing. Four trails
inside one clip: past the two nodes a trail shares a gate, so an earlier trail's tail rings under the later one
until that one fades, where it used to be cut with its own clip. I could not listen to it (headless, muted), so
"same to the ear" is a claim from the numbers, not from ears.

## Does it look the same

- Damage numbers: pixel-identical (0 of 255 on every pixel) at two frozen moments of the pop, for the float and the
  killing-blow float.
- Hover preview: with every animation frozen at the same time, the popup and its haze differ by at most 3 of 255
  (mean 0.24), which is the bob's fractional pixel being resampled by the compositor instead of at raster. No
  vertical offset: the bob travels the same distance.

## The buff trail: measured, not changed

E1 named `rune-buff-trail` as the top label inside dropped shop frames. I built a fan budget for it (one even
particle scale for all the trails of one moment) and a pool for effect filter instances, measured them, and took
both out again:

- Seven trails at once, as authored: 280 to 314 ms of script per fan, 1,414 particles at peak. With the fan held to
  900 particles: 200 to 296 ms (median 287 against 302). About 5% for half the sparks on every ribbon. Not worth a
  visible change.
- A CPU profile of the fan says why. The particle emitter is about 35 ms of a fan. The per-frame filter work in
  script (the stack's `frame`, its curve samples, the filter system's push and uniform updates) is about 50 ms. The
  rest is time inside the browser under the filter passes: each play carries four filter stacks (Bloom + Glow on the
  ribbon, Glow on each burst), so seven trails are 28 render-to-texture chains every frame. Building the filter
  objects does not show at all, so pooling them buys nothing.
- So the lever is the number of filter PASSES, not particles or construction: one shared Bloom + Glow for the whole
  fan (`sharedFilters.ts` declines this def today because its layers carry different filter params), or baking the
  glow into the ribbon and burst textures. Either changes how overlapping ribbons glow near the source, so it is a
  look decision for the owner and Mike, with crops, in its own PR.

## Verification

`npm run typecheck`, `npm run lint`, targeted Vitest (`fx/sharedFxReverb`, `fx/convolverPool`, `staticShadowCss`, the rules package), `npm run build:web`; CI `verify` runs the
full suite.
