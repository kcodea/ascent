---
name: ascent-choreography
description: Work on ASCENT's beats, Choreographer, Beat Lab, Pixi FX, audio cues and consequence timing — adding a missing beat, binding FX, changing when a consequence plays, or fixing an effect that resolves invisibly. Use for presentation timing. Not for changing gameplay order or balance.
---

# ASCENT Choreography & FX

The engine decides **what happened and in what order**. Choreography decides **how that truth is presented over
time**. It must never become a second gameplay engine.

## Protect authored FX

Mike's custom FX, bindings, offsets, durations, easing, sound cues and target mappings are authored work.

- Inspect existing bindings before adding a fallback.
- Never swap a bespoke effect for a generic one during unrelated work.
- Never reset tuned values to defaults. Publishing tuner values is explicit — `npm run fx:publish` — and never
  a side effect of opening or testing a tuner.

## Beats

Every perceptible trigger needs a **stable, source-attributed beat**, and each fired effect needs its OWN beat
so the choreographer allots it a real animation window. Batching several effects into one beat is the bug that
makes a rune "work but show nothing": the consequences land in a single frame with no source to pulse.

Two failures worth knowing because both shipped here:

- **No nested identity.** Effects dispatched bare inside an outer trigger collapse under it with no per-effect
  identity, so authored FX and watcher pulses have nothing to bind to. Wrap each (source × effect) dispatch in
  its own nested trigger carrying the same `factory:<do>:<trigger>` identity the other phase uses. Use the
  collector's `discardIfEmpty` so an effect whose own guard filters it out leaves no empty beat pulsing an
  innocent bystander.
- **Consequences without position.** A summon consequence that carries no board index makes the projection
  append the arrival, which then visibly snaps to its real slot at commit. Stamp the committed index.

Other rules:

- Separate trigger presentation from consequences: a source may pulse first, with buffs/summons/casts landing
  at deliberate offsets.
- Left-to-right ordering and repeated triggers must stay inspectable in the timeline.
- Skipping or accelerating playback must reach the **same final state**.
- A missing FX after adding a beat hook is acceptable. A missing gameplay consequence is not.
- Clean up Pixi tickers, filters, containers, listeners, particles and transient textures.

## Perf rules that bite here

Never animate paint properties (`box-shadow`, `filter`, `drop-shadow`, `background`, `border-radius`) in a
**looping** animation — animate `transform`/`opacity` only. For a breathing glow, animate the opacity of a
`::before` with a *static* shadow (see `kwglow` in `styles.css`). A short **one-shot** transition may touch
paint properties if profiled.

## Verify

`npm run beats:audit`, focused Choreographer/Beat Lab tests, and live playback at normal, accelerated and
skipped speeds. When a beat's job is to *reserve time*, assert the compiled timeline's duration grows with the
number of effects — counting beats does not prove they got room.
