# FX workbench: over-time automation for the audio Filter Lab (headline dials)

Owner ask (2026-09-19): adjust an effect's dial over the course of the clip — volume over time, reverb over
time, etc. The audio Filter Lab shipped with STATIC amounts; this adds per-dial curves.

## Mechanism — Web Audio param automation, not per-frame sampling
The visual Filter Lab samples a curve every FRAME and writes the property. Audio instead uses Web Audio's own
**`setValueCurveAtTime`**: at fire time, an automated dial's curve is baked into a LUT (`bakeCurveLut`) and
scheduled across the clip's play window (0 = fires, 1 = clip ends), so it runs sample-accurately on the audio
thread. The curve is a **multiplier** on the dial (flat = held constant), and a flat/absent curve is a no-op —
the param is set statically, so every un-automated sound is byte-identical and allocates nothing extra.

## What's automatable (headline dials, owner's call)
Each gets a `…Curve` companion param + the same curve editor as the visual lab:
- **Clip Level** (volume over time — `sound.ts`, a unity gain after the fader riding `gainCurve`),
- **EQ** low / mid / high, **Compressor** threshold,
- each space effect's **Mix** — distortion (a true dry/wet crossfade: wet = mix×curve, dry = 1−wet), delay,
  reverb — and **Pan**.

## What stays static (they BAKE a buffer/waveshape at fire time, not a live AudioParam)
Reverb **size/damping** (generate the impulse), distortion **drive** (generates the waveshaper), delay **time**
(automating it pitch-warps the echoes). Their tooltips say so. Pitch is left static too (a 0–1 multiplier is
ill-defined for it) — a dedicated pitch-envelope can come later.

Files: `packages/ui/src/fx/audioFilters.ts`, `packages/ui/src/fx/primitives/sound.ts`, `packages/ui/src/sfx.ts`
(+ `audioFilters.test.ts`). Dev-authoring tool → no patch note.
