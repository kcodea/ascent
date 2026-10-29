# 2026-10-29 — Late-game slowdown, part 2: fixed inputs, a real GPU, the dev server, the network

Follows `2026-10-29-perf-degradation-hunt.md`. Owner, top priority: "Performance degrades over the course of a game.
It degrades massively by end game ... and it degrades even faster on mobile."

Part 1 measured whole scenes. A scene's cost depends on what the walk did in it, so a growing number could mean the
game got slower, or only that the walk did more. Part 2 measures **the same inputs every round**, on a real GPU, on the
dev server and against the live backend.

## How it was measured

New `perf:gauntlet` flags (listed in `docs/performance.md` §2b):
- `--action-bench`: after each round's probe, two fixed input sets.
  - A hover sweep. Real mouse moves over every shop, board and hand card and the `[data-tip]` elements, 350 ms on each,
    so previews, keyword definitions and tooltips open.
  - Three cycles of roll, buy, play, sell. The run is snapshotted first and put back after.
  - Each input is its own scene (`hover#rN`, `act-roll#rN` ...).
- `--profile-re`: a CPU profile per matching scene, saved per scene.
- `--gpu`: a real GPU (ANGLE D3D11, an RTX 4080 SUPER here, confirmed by the WebGL renderer string).
- `--gpu-trace`: GPU-process, viz and cc events per scene.
- `--layers`: the compositor layer tree at every probe.
- Draw calls across every WebGL context, counted at every mark.
- `--url`: drive a running server, e.g. the dev server.
- `--allow-net` / `--allow-write`: let named live reads through. Writes stay blocked unless named.

Game: a typical balance-bot Practice game, 4 tribes, rounds 1-14 (and lobby mode for the network pass).

## 1. The round-9 shop-actions lead: the action mix, not the round

The bot did one action a turn in rounds 6-8 (only the tier-up) and two from round 9. Per-frame `shop-actions` cost
followed the action count.

The fixed bench, net main-thread ms per input, prod build, real GPU (one run, noisy):

| round | 1 | 4 | 8 | 10 | 12 | 14 |
|---|---|---|---|---|---|---|
| hover (per card) | 91 | 86 | 135 | 134 | 105 | 72 |
| roll | 111 | 211 | 205 | 184 | 113 | 133 |
| buy | 249 | 349 | 391 | 406 | 251 | 235 |
| sell | - | - | 248 | 219 | 148 | 162 |

No input gets more expensive as the game goes on. Profiles of the same input at r4 and r13 have the same top functions.

A software-GL run showed a one-off 1.7x step from round 12 on every scene. The real-GPU run did not repeat it.

## 2. Real GPU, early vs late

| per frame | r3 | r8 | r11 | r14 |
|---|---|---|---|---|
| DrawAndSwap, idle shop | 0.44 ms | 0.40 | 0.42 | 0.43 |
| DrawAndSwap, combat | 0.25 ms | 0.73 | 0.65 | 0.41 |
| render passes, idle shop | 4.3 | 6.7 | 6.9 | 8.0 |
| render passes, combat | 4.8 | 5.7 | 5.7 | 7.5 |
| raster ms, combat | 0.001 | 0.016 | 0.038 | 0.072 |

- **Layers:** 59 at round 1, 78-91 from round 5, then flat. Runeforge rounds briefly reach ~150. The area of drawing
  layers stays at about 17-18 Mpx from round 5, nine of them full-viewport canvases.
- **No accumulation:** no will-change or layer pile-up.
- **Main-thread combat cost** tracks each fight's content: 1.3-2.5 ms a frame, with no upward trend.

Render passes per frame roughly double between an empty early board and a full hand plus board. That is card count,
not buildup. On a phone GPU it is the most plausible reason a late game costs more than an early one.

## 3. The dev server: no DEV-only degradation

Same bench against Vite dev (`VITE_PERF_BENCH=1`, StrictMode on):
- **Heap:** 102 → 119 MB over 14 rounds (prod: 35 → 49). The same slope from a bigger base.
- **DOM, listeners and timers:** flat, as in prod.
- **Per-frame cost:** about 1.0-1.5x prod, and flat late. Combat main thread: r3 2.0 ms, r11 2.3 ms, r14 1.6 ms.
- `window.__fxFires` grows one small object per FX play. Memory only, with no frame cost.
- The DEV beat capture (`latestBatch` / `latestCombatTimeline`) keeps only the latest.

## 4. The network path (live Supabase, one anonymous lobby game)

- 63 requests in the game:
  - 33 `lobby_live_heartbeat` RPCs (every 15 s), then `lobby_live_end`
  - the served-board reads (`pool_runs_*`, the histograms)
  - profile and cosmetics reads
- Every end-of-game write (boards, lobby_fights, run_history, submit-rating, replay storage, telemetry, perf_runs) was
  blocked by the harness. One anonymous user was created by the sign-in.
- **Main-thread cost:** in the CPU profile of every scene of every round, Supabase, realtime, live publisher and friends
  code totals **0.0 ms**. The only exception is the game-over return, about 7.5 ms (the run outbox).
- With nobody watching, the publisher builds no deltas, so nothing grows with the board.

## Also seen (not changed)

`deriveState`, the progression and telemetry observer, grows about 5 KB a round (1.4 KB → 60 KB by round 14). It is
serialized only by the idle-time autosave (0.25-1.3 ms, part 1).

## Where this leaves the owner's report

No desktop measurement, main thread or GPU, prod or dev, offline or online, shows the same input getting slower as a
game goes on. What does grow late is the amount on screen: hand, board and shop cards, their layers and render passes.
The work per frame scales with that and then plateaus.

The phone report still needs a real device. Next step: a Safari Web Inspector timeline on an iPhone, early round vs
late round, with the same hover and roll. Also worth checking on a phone: whether the 48 MB decoded-art LRU
(`LITE_KEEP_BYTES`) thrashes once a late shop plus hand shows more distinct art than it holds.
