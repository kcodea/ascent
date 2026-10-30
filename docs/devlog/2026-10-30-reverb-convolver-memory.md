# 2026-10-30 — The renderer's 60 MB steps were reverb convolvers (R-PERF-SHARED-TAIL-REVERB-01)

Follow-up to #2462 (the medallion re-fetch). After it, the desktop renderer still grew ~34 MB a round. Chrome's
memory-infra put most of it in Blink's `partition_alloc/partitions/buffer`, rising in ~60 MB steps (+120 by round 6,
+60 at 8, +60 at 12), with a +155 MB allocate-and-free on every fight.

## How it was found

`scripts/perf-mem-watch.mjs` (new) attaches to a running `perf:gauntlet` page and takes a light memory-infra dump every
second beside the game state, so every change in a bucket has a time, a phase, the FX playing and the falling gate's
classes. The +155 MB landed exactly as the gate lifted on every fight; the kept 60 MB steps landed during deaths in
some late fights. A/B runs with one thing removed at a time (same seed 424242), none of which moved it:

- every background / mask / border image off and every `<img>` hidden; the board, gate and vista art alone; card art
- every `<canvas>` hidden; canvas / WebGL readbacks wrapped (none large at the steps)
- `img.decode()` stubbed; a critical memory-pressure signal (nothing freed: not a cache)
- music, announcer, clip playback each off; `localStorage` / `structuredClone` / IndexedDB / fetch bodies (none at the
  steps)

Stubbing `decodeAudioData` made the steps come and go instead of staying, which pointed at audio. A 6 s broad trace at
the gate lift then showed a busy **Reverb convolution background thread**, and `--init-js` (new) replacing
`createConvolver` with a plain gain node kept the buffer partition at **~60 MB all game** (vs 520 at boot rising to
~1,066). All of it was ConvolverNodes: ~60 MB each at this 96 kHz context (the partitioned impulse plus FFT buffers),
~6 ms of main thread each to build.

## Where they came from

1. **The falling gate's crank** (`playTailedSample`, `WIPE_GATE_LAYERS.crank`): four layers with a 40% reverb, each
   building a NEW convolver every fight as the gate lifted: the +155 MB allocate-and-free and ~25 ms of main thread on
   every combat start. Fix: one shared convolver per (bus, tail length), built when audio starts. Convolution is
   linear, so the sum of every play's send through one node is exactly the sum of their tails. Each play keeps its own
   send (level, envelope, mix); on a skip, the send fades with the voice and the tail already in the reverb rings out
   (before, the whole voice, tail included, faded in 0.12 s).
2. **The effect-layer reverb pool** (`fx/audioFilters.ts`): two nodes per impulse prewarmed at boot (most of the
   ~460 MB at run start), and up to 8 idle nodes per impulse kept. Every burst of overlapping reverb'd fires that
   outran the pool built nodes that then stayed: the 60 MB steps. The pool now keeps at most 2 per impulse on desktop
   (1 on a phone, as before); a burst's extra nodes are let go once their tails ring out.

## Numbers (seed 424242, headless prod bench builds, `--img-census --mem-infra`, one game each)

Base = main eab8c074a. After = this branch.

| round | Blink buffer MB before | after | renderer MB before | after | GPU process MB before | after |
|---|---|---|---|---|---|---|
| 1 | 514 | 554 | 909 | 951 | 1263 | 1271 |
| 2 | 819 | 577 | 1276 | 1035 | 1468 | 1463 |
| 3 | 824 | 582 | 1313 | 1067 | 1473 | 1446 |
| 4 | 825 | 582 | 1333 | 1094 | 1493 | 1494 |
| 5 | 826 | 584 | 1365 | 1134 | 1521 | 1518 |
| 6 | 946 | 584 | 1513 | 1154 | 1592 | 1595 |
| 7 | 945 | 584 | 1519 | 1155 | 1547 | 1534 |
| 8 | 1005 | 585 | 1578 | 1159 | 1692 | 1720 |
| 9 | 1005 | 586 | 1594 | 1188 | 1505 | 1517 |
| 10 | 1005 | 586 | 1599 | 1191 | 1712 | 1716 |
| 11 | 1006 | 586 | 1603 | 1190 | 1705 | 1732 |
| 12 | 1066 | 585 | 1685 | 1203 | 1435 | 1438 |
| 13 | 1066 | 585 | 1693 | 1204 | 1460 | 1439 |
| 14 | 1067 | 585 | 1698 | 1210 | 1437 | 1442 |
renderer slope r3+: before 36.4 MB/round, after 11.8 MB/round

The kept growth goes, and so does the per-fight transient (a 1 s watcher on the shared-crank build shows no
allocate-and-free at the gate lift). Renderer is 488 MB lower by round 14, and its slope from round 3 goes from 36.4 to
11.8 MB a round. What is left is the SFX cache filling to its cap (R-AUDIO-MEMORY-02), `blink_gc` and v8 (the replay
frames, ~0.6 MB of JSON a round).

Frames (A/B `perf:gauntlet`, headless, rounds 9-11, main-thread work per frame; one run per build, a quick screen):

- base vs shared crank: End Turn work 3.91 to 2.96 ms, long frames 100 to 52; combat work 3.79 to 3.10 ms, long frames
  2,217 to 1,352; return trip 2.94 to 2.22 ms.
- pool 8 vs pool 2 (both with the shared crank): combat work 3.80 to 3.15 ms and LoAF blocking 165 to 22 ms; End Turn
  LoAF 277 to 163 ms; shop actions about the same (12.2 vs 12.9 ms, noise). The rebuilds a smaller pool costs did not
  show up as main-thread work.

## Guard

- `audio/sharedTailReverb.test.ts`: one convolver per (bus, tail length) however many plays; `playTailedSample` builds
  none of its own.
- `fx/convolverPool.test.ts`: a burst of six builds six, but only two stay pooled.
- `bufferGrowthVerdict` (`perfGauntletStats.ts`): `perf:gauntlet --img-census --mem-infra` FAILS (exit 3) when the
  buffer partition grows more than 8 MB a round from round 3.

## Left for later

The boot prewarm (2 nodes per reverb impulse, ~8 nodes, about 460 MB at a 96 kHz context on desktop) stays: it is what
keeps the first reverb'd fires from building a node mid-frame. Prewarming 1 per impulse would save about half of it at
the cost of a ~6 ms build on the first overlapping fire of each impulse. That trade, and anything that changes how a
reverb sounds (a mono impulse, running the context at 48 kHz), is an owner call.
