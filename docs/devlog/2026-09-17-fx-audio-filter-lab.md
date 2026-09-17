# FX workbench: audio Filter Lab — core native + reverb (PR 3)

Third PR of the workbench audio feature (design: `docs/superpowers/specs/2026-09-17-fx-sound-primitive-design.md`).
Gives a `sound` layer a chain of native Web Audio filters — the audio twin of the visual Filter Lab. Folds in
**reverb** too (the roadmap had it as a separate PR 4; owner asked for it in this version, 2026-09-17).

## What's new
Six toggle-gated filters on the `sound` primitive, each off by default (an unused one allocates nothing):

- **EQ (3-band)** — low shelf ~250 Hz, mid peak ~1.2 kHz, high shelf ~4 kHz (`BiquadFilterNode` ×3).
- **Compressor** — threshold / ratio / attack / release (`DynamicsCompressorNode`).
- **Distortion** — soft-clip waveshaper with a drive knob and a dry/wet mix (`WaveShaperNode` + gains).
- **Delay / echo** — feedback delay with time / feedback / mix (`DelayNode` + feedback gain + wet/dry).
- **Reverb** — an **algorithmic** room/hall tail: a `ConvolverNode` fed a **generated** decaying-noise impulse
  (size / damping / mix). No committed impulse files — the IR is synthesised at runtime and cached by
  (size, damping, sample rate), so a fire stays cheap. (The design deferred *file-based* convolution for its
  asset-management cost; a generated IR sidesteps that. Swappable to a comb/allpass Freeverb if wanted.)
- **Pan** — stereo placement (`StereoPannerNode`).

## How it fits the existing graph
`sfx.ts`'s `playFxSound` now builds a per-fire channel strip: **source → [Filter Lab inserts] → fader → bus**.
The fader (`g`, which carries level, fades and per-fire jitter) stays the LAST stage before the bus, so a
fade-out silences any filter tail (an echo) too. With no filters enabled the source wires straight to the
fader, allocating nothing — the pre-PR path exactly.

The filter graph code lives in a new small module, `packages/ui/src/fx/audioFilters.ts`, not in `sfx.ts`:
- `audioFilterSpecs()` generates the flat params (a toggle + gated sliders per filter, grouped by label) that
  are spread into the `sound` primitive's SPECS — so the inspector renders each filter as its own toggle-gated
  group with the existing generic grouping (no new Inspector code).
- `buildAudioFilterChain(ctx, params)` builds the node chain for the enabled filters. It takes the
  `AudioContext` by argument, so a fake context unit-tests the wiring (which nodes, what order, linked how)
  without real Web Audio (`audioFilters.test.ts`).

The `sound` layer hands its whole param bag to `playFxSound` (`filterParams`); the builder reads only the
filter keys off it.

## Scope decisions (v1)
- **Static amounts** — no curve-over-clip automation (owner, 2026-09-17).
- **Fixed order** — the chain applies EQ → Compressor → Distortion → Delay → Reverb → Pan (the standard
  channel-strip order). The approved design calls for *authored* order, but the only order-editing UI today
  (the visual Filter Lab's master-group ▲/▼) is hard-bound to the Pixi filter registry; reusing it for audio
  means forking Inspector JSX or refactoring shared visual code. Deferred to a focused follow-up (PR 3.5)
  rather than bloat this PR. The fixed order is the sensible default the large majority of the time.
- **Reverb folded in** — the roadmap had it as PR 4; owner asked for it in this version (2026-09-17), so it
  ships here. Modulation remains the last PR.

No new player-facing gameplay (a dev-authoring tool) → no patch note.

Files: `packages/ui/src/fx/audioFilters.ts` (+ test), `packages/ui/src/fx/primitives/sound.ts`,
`packages/ui/src/sfx.ts`.
