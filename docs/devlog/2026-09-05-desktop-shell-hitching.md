# The exe hitched and Chrome didn't — it was the shell's asset handler (and an old Electron)

**Owner, 2026-09-04:** *"so much random hitching … so much worse than the local dev server."* On a 360 Hz
display, a 4090, and the game code ruled out by measurement.

## The bisect (each step a build the owner played)

| Build | Result |
|---|---|
| The production bundle served to **Chrome** from a local static server | "butter smooth" |
| The exe, windowed (F11) instead of fullscreen | mediocre, worse as the game went on |
| The exe loading that same bundle **over http** from the local server, everything else identical | better |
| The exe with the `app://` handler serving from disk **with cache headers** (this change) | "it feels so much better" |

So: not the game, not the bundle, not fullscreen — the `app://` protocol handler. It proxied every request
through `net.fetch(file://…)` with **no headers**, so Chromium could cache nothing. Every image, clip and
chunk the renderer needed — and needed AGAIN after its cache evicted it under memory pressure — was a fresh
round trip through the main process. A long game evicts more, so it got worse over time. Chrome on a static
server caches everything and never pays twice.

## What ships

- `apps/desktop/main.cjs`: the handler reads the file from disk and returns a `Response` with `Content-Type`,
  `Content-Length` and `Cache-Control` (`immutable` for Vite's content-hashed `assets/`, a day for the rest).
  Same `app://ascent` origin, so saves and settings are untouched.
- Electron **32.3.3 → 44.2.0**. The exe was rendering with Chromium 128 against the owner's Chrome 152; the
  drag trace showed 860 of 1,065 over-budget frames in per-frame style-recalc + Layerize (~57 compositor
  layers), which newer Chromium handles better. The upgrade alone was "still hitching" — the handler was the
  fix — but it is the right baseline and the desktop shell's API surface needed no change.

## What the trace also found (separate branches)

- `fix/hand-flip-simple`: the hand-reorder `Flip.getState` without `simple: true` was a 36 ms layout thrash
  per hand-slot crossing (~40 forced layouts inside one React commit). Real, fixed, but not the hitching.
- The effects canvas processes every mouse move at a 1 kHz mouse (Pixi's `_onPointerMove`, ~200 ms per 13 s)
  though it never receives input — a candidate `eventMode: 'none'`.

## Lesson

The owner's "why is dev better than the exe?" was the whole answer. Judge every performance report against
the **shipped shell on the owner's display**, and bisect environment (browser vs exe, fullscreen vs windowed,
protocol vs http) BEFORE touching game code. The measured diff — same bundle, two shells — took thirty seconds
per step and pointed at one file.
