# 2026-10-18: iPhone crash on pressing Play (audio decode burst) + phone crash breadcrumbs

Owner report: on a recent iPhone (14 or newer), opened from the Home Screen icon, live build main 480583bb0 (with
#2160, the menu-layer fix), pressing PLAY crashed the page. iOS reloaded it once, then showed "A problem repeatedly
occurred" on the second try: the WebContent process killed by iOS, almost always for memory. Rule:
R-TOUCH-PLAY-MEMORY-01.

## Why the menu model missed it

`scripts/phone-menu-memory.mjs` navigates with `element.click()`. That is not a user gesture: no `touchend`, so the
iOS audio unlock (#2149) never ran, and anything the first real touch starts was never measured. It also only counts
compositor layers.

## Measured (prod build, headless Chrome as an iPhone: 932x430 @3x, iOS UA, touch, standalone display-mode)

New `npm run perf:phone-play` (scripts/phone-play-memory.mjs) presses Play with a REAL touch
(`Input.dispatchTouchEvent`) and samples from an init script: every AudioBuffer decoded or created
(length x channels x 4), ConvolverNodes, WebGL contexts, decoded `<img>` bytes, the JS heap, plus the OS private
memory of the renderer and GPU processes. `--full` goes on through the Play tile, the tutorial nudge, "Yes, let's go.",
the gate crystal and hero select. Every request off 127.0.0.1 is blocked.

Main 480583bb0, title then the press:

| | title | Play +1 s | Play +15 s |
|---|---|---|---|
| decoded audio | 0 | **120.5 MB (87 buffers)** | 120.5 MB |
| decoded `<img>` | 9 MB | 35 MB | 35 MB |
| WebGL contexts | 7 | 7 | 7 |
| renderer process | 186 MB | **373 MB** | 351 MB |
| all Chrome processes | 533 MB | 794 MB | 745 MB |

The press makes the AudioContext, and `prefetchSamples` then decoded the whole core bank (87 top-level + ceremony
clips) at once, six in flight on the asset pipe, at the context rate, in stereo. This machine's context runs at
96 kHz; an iPhone runs 48 kHz, so about 60 MB there, all inside the same second as the mode home's layers (~196 MB
estimated by the menu model) and its tile art. It was the biggest single allocation Play causes. The press also queued
fetches of ~430 per-card, per-hero and FX clips (12 MB of MP3, read into ArrayBuffers and dropped). No reverb is built
on the way to hero select (0 ConvolverNodes): the earlier phone pass already stopped pre-warming them.

Gate: the tile press adds the gate FX WebGL context (8 contexts, +60 MB GPU in Chrome) and the "Yes" doors peak the GPU
process at ~410 MB. Unchanged here.

## Fix (phone path only, `LITE_ART`; desktop reads none of it)

`packages/ui/src/audio/phoneAudio.ts`, used by `sfx.ts`:

1. The first core decode starts 2.5 s after the press that made the context, not on the next task.
2. One decode at a time (`serialQueue`), never six together.
3. Decoded through an OfflineAudioContext at 32 kHz (`PHONE_AUDIO_RATE`; decodeAudioData resamples to its context's
   rate), then kept MONO (`downmixToMono`). A third of the bytes at 48 kHz. Everything up to 16 kHz survives, past a
   phone speaker.
4. No fetching of non-core clips at the first touch: they load on their first play (the synth fallback covers that
   play, as it always did for an undecoded clip). Their LRU cap went from 64 to 32 MB.

After, same run:

| | title | Play +1 s | Play +15 s | hero select |
|---|---|---|---|---|
| decoded audio | 0 | 0.4 MB | **20.3 MB** | 20.3 MB |
| renderer process | 188 MB | 210 MB | **245 MB** | 160 MB |
| all Chrome processes | 537 MB | 644 MB | 647 MB | 624 MB |

(At an iPhone's 48 kHz the stored bank is the same 20 MB: it is stored at 32 kHz whatever the context runs at. Before,
about 60 MB there.)

## Crash breadcrumbs (the owner has no Mac, so no Web Inspector)

`packages/ui/src/crashLog.ts` records on a phone (or any device with `?crashlog=1`): a breadcrumb per step to
`localStorage['ascent.crashlog.v1']` with the time since load, decoded audio MB, decoded `<img>` count + MB, WebGL
contexts made / still in the page, and the JS heap where reported. Steps: boot, art stream start + progress (one line,
updated every 100 items), gate open, title, play pressed, audio unlocked, title view modes, play tile pressed, pixi init
(each layer), reverb built, ranked yes pressed, hero select shown, resumed. A heartbeat every 5 s while visible says how
long the page lived past its last step. `pagehide` or the page going hidden marks the session clean; an unclean session
found on the next load is a crash (the last three are kept).

The readout (`CrashLogReadout.tsx`, top left, Close forgets the crashes) shows with `?crashlog=1` (remembered until
`?crashlog=0`). A Home Screen web app cannot be given a query and keeps its own storage, separate from Safari, so it ALSO
shows in a standalone phone app on the first load after a crash. That is a judgement call: a player whose phone app
crashed would see it once too. Verified end to end with `npm run perf:phone-play -- --crashtest` (CDP `Page.crash`, which
fires no `pagehide`, then a reload): "Last session crashed after: title view modes (still alive 15 s later)".

## Not confirmed / follow-ups

- Not confirmed on a real iPhone: Chrome stands in for WebKit. If it still crashes, the readout names the step.
- Seven WebGL contexts are alive at the title on a phone (main FX, under, above, wipe, gate later, plus probes). The
  "under" canvas has a live context while not in the page. Each phone FX canvas renders at resolution 2. Fewer
  contexts or resolution 1.5 on phones would cut GPU memory; it is a visual call.
- `playTailedSample` in sfx.ts builds a fresh ConvolverNode per reverb'd play (the FX layer pools them, this path does
  not). Not on the way to hero select, but it is in the shop.
