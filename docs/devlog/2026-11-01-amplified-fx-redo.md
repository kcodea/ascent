# 2026-11-01 · A new look for Amplified Equipment

Owner ask 2026-11-01: redo the Amplified Equipment effect ("Design a new one"). Branch `feat/amplified-fx-variants`.

## What

- Three new looping defs, each built to read as "doubled, will fire twice", picked by a DEV switch in the dev menu's
  Equipment Slot tuner (`amplifiedFxConfig.ts`, DEV localStorage `ascent.amplifiedFx`; production plays the default):
  - **Twin echo** (`amplified-twin-echo`, DEFAULT): two painted rings leave the slot rim 210 ms apart, then a rest
    (1.4 s cycle), plus a few rim motes. A heartbeat in pairs: the same two-pulse language as the release.
  - **Twin orbit** (`amplified-twin-orbit`): two comets half a turn apart circle the slot (one turn per 2 s cycle).
    Built from emitters at fixed offsets inside a spinning container (`fxSpin`), six shrinking segments per comet.
  - **Rune halo** (`amplified-rune-halo`): two counter-turning rings of star / diamond glints that beat twice in
    scale, then rest (3 s cycle, one full turn each way per cycle).
  - **Classic** (`amplified-slot`, PR #1633): the original ring, kept selectable for before / after.
- **The release** (`amplified-release`, new): two quick ring + shard pulses on the slot the moment an Amplified
  activation fires. `useAmplifiedReleaseFx` in `useAmplifiedSlotFx.ts`: fires when a fresh `use` cue arrives on the
  `equipFxSeq` channel for the Equipment that WAS Amplified on the previous render. Never on mount, never twice per
  action, never for an unamplified use or for the Amplification ending without a use.
- The loop's show / hide rules are unchanged (selected + will Amplify + a charge + recruit + nothing covering). A look
  switch while the loop runs disposes it once and starts the new look once.

## Notes

- Seamless joins: every looping def uses `loopMode: seamless`, and each spinning def's cycle is exactly one turn, so
  the fresh cycle starts at the same angle the old one is draining at. Emitter mote life equals the cycle, because the
  first cycle of a `fireLoop` spawns its layers one-shot (emit window = mote life).
- Rings and comets use `blendMode: normal`: additive blue washes out to white on the light board.
- Perf (dev build, headless Chrome, 1920x1080, 4 s idle shop, main-thread task ms per frame, loop on vs off): twin echo
  +0.02 ms (noise), twin orbit +0.24, rune halo +0.26, classic +0.66. Estimated live particles: classic ~3,700, twin
  echo ~22 (+2 shockwave quads), twin orbit ~160, rune halo ~54, release ~52. All Pixi; no CSS animation was added.
- Phone screenshots used the shipped phone path (phone zoom; the 2:1 phone layout is still behind `phonelayout`).
