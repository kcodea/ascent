# FX workbench — Sound primitive (design)

Owner ask (2026-09-17): author **sound effects as a workbench primitive** — pick/import a clip, decide when it
plays, set its level, and run it through an audio filter lab (reverb, compression, distortion, and more). Sounds
must be **available to all players** (committed + bundled, not local-only).

## Why it fits
A def is already "layers on a shared clock, each with `at`/`life`". A sound is a layer that, at its `at`, plays a
clip — the audio twin of the visual layers. The existing `screen` primitive already fires a bare `sfx` cue and
its own comment calls richer per-effect sound authoring "a later pass"; this is that pass.

## What already exists (reuse, don't rebuild)
`packages/ui/src/sfx.ts` is a mature Web Audio system:
- **AudioContext** + a full graph: `clip → category bus → per-bus comp → master limiter → master volume → mute → out`.
- **Committed + bundled clips**: `import.meta.glob('./audio/**/*.{mp3,wav,mp4}')` — a committed file ships to
  every player automatically. This is the answer to "available for all players."
- A **mixing desk** (per-bus / per-category / per-clip faders, meters, gain reduction).

So a def-sound routed through this graph automatically obeys master volume, mute, skip-combat, and the desk.

## Design
1. **`sound` primitive** (`fx/primitives/sound.ts`) — draws nothing (models `screen`). At its layer `at` it plays
   the clip and holds a handle; `destroy` fades/stops it; fires once, retrying until the buffer decodes.
2. **Audio-graph code stays in `sfx.ts`**: one new export `playFxSound(clip, opts) → handle` builds
   `BufferSource → [per-layer filter chain] → bus input`. The primitive only describes params.
3. **`sound` param kind** (`params.ts`) — a runtime clip picker (mirrors the `image` kind), value is a clip id
   string; Inspector renders a dropdown + ▶ preview.
4. **Audio Filter Lab** — audio twin of the pixi Filter Lab: per-effect enable + amount + authored **order**
   (order matters). Static amounts in v1 (no curve-over-clip automation — owner, 2026-09-17).
5. **Asset pipeline** mirrors images: import WAV/MP3 → `/__fx/sound` dev endpoint → committed under
   `packages/ui/src/audio/fx/<slug>` (globbed → bundled) → `sound:<slug>`; plus a picker over existing clips.

## v1 scope (owner-approved)
- Source: **import new (committed) + pick from library**.
- Filters: **core native + reverb (algorithmic) + modulation** — NOT pitch-shift/bitcrush (deferred).
- **No filter automation** (static amounts).

## Ship order (each its own PR)
1. **Primitive skeleton** — plays a *library* clip at `at`, full playback params (level, pitch/rate, fade
   in/out, reverse, start-offset, loop, per-fire gain/pitch randomization, delay, target bus), routed through the
   bus graph. Inspector `sound` picker + preview. **← this PR.**
2. **Import pipeline** — `/__fx/sound` + `sound:<slug>` (committed/bundled), like images.
3. **Filter Lab: core native** — level, 3-band EQ, compressor, distortion, delay/echo, stereo pan.
4. **Reverb** — algorithmic (Freeverb-style; no asset files).
5. **Modulation** — tremolo, chorus/flanger, phaser, vibrato, ring-mod.

Deferred: pitch-shift (independent of speed) + bitcrush (AudioWorklets); curve-over-clip filter automation;
convolution reverb (needs committed impulse files); per-clip/per-category desk faders for def-sounds.
