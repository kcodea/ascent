# FX workbench: the `sound` primitive (PR 1 — playback skeleton)

First PR of the workbench audio feature (design: `docs/superpowers/specs/2026-09-17-fx-sound-primitive-design.md`).
Adds a **`sound`** primitive: a non-drawing layer that, at its `at` on the def timeline, plays a clip — the
audio sibling of `screen`/`react`.

## What it does
A `sound` layer plays a chosen clip with a full playback param set: **level, pitch (playback-rate), fade
in/out, reverse, loop, start-offset, delay, per-fire level/pitch jitter, and target bus.** It fires once,
retrying each tick until the clip's buffer decodes (giving up after 4s so a mistyped clip can't retry forever),
and fades out on `destroy` — so a scrubbed cue or a looped clip leaves nothing ringing.

## How it routes (the load-bearing decision)
All audio-graph code stays in `sfx.ts`. A new export, **`playFxSound(clip, opts) → handle`**, builds
`BufferSource → level/fade gain → the chosen bus input`, so a def-sound rides the *same* graph as every other
sound: chosen bus → per-bus comp → master limiter → master volume → mute → out. That means an authored sound
**automatically obeys master volume, mute, the skip-combat fade, and the mixing desk's per-bus fader** — no new
volume/mute plumbing. The handle lets the primitive stop/fade a long or looped clip (Web Audio sources are
otherwise fire-and-forget). Reverse is a cached reversed `AudioBuffer` (Web Audio has no negative playback-rate).

## New param kind: `sound`
A runtime clip picker mirroring `image` — value is a clip-id string (a library name today, a `sound:<slug>`
import in PR 2), `''` = none, and an unresolved id survives a round-trip (a def shared from another machine).
Inspector renders a `<select>` over `clipNames()` + a ▶ preview.

## Available to all players
Sounds ride the existing `import.meta.glob('./audio/**')` — a **committed** clip is bundled for every player, so
picking from the library ships correctly. The import pipeline (PR 2) writes + commits under `audio/fx/` the same
way, avoiding the local-only trap that bit the custom-image work.

## Scope
PR 1 = playback + library picker. Next: import pipeline (PR 2), then the audio Filter Lab — core native (PR 3),
reverb (PR 4), modulation (PR 5). Not yet wired to any card/moment; it's an authoring primitive.

Files: `fx/primitives/sound.ts` (+ test), `sfx.ts` (`playFxSound`), `fx/params.ts` (`sound` kind),
`fx/ui/Inspector.tsx` (`SoundField`), `fx/ui/copy.ts`, `fx/primitives/index.ts`.
