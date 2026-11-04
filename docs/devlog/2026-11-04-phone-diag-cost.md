# 2026-11-04 — The phone diagnostics stop costing frames in play (R-PHONE-DIAG-COST-01)

**Owner (2026-11-04, iPhone 17):** "the game becomes near unplayable after a few turns. really huge hitching and
freezing throughout". A native wrapper was ruled out first (every iOS web view is WebKit: same engine, same limits).

The crash log (`crashLog.ts`) and perf log (`phonePerfLog.ts`) record on EVERY phone session. Reading their in-run
paths found work that repeats every round:

- `crumb('gate fx created')` (gateFx.ts) ran on every gate on a phone (the layer is freed after each one): a
  `getComputedStyle` read of up to 6,000 elements, as the gate starts to fall.
- Four `crumbLight` gate crumbs a round (Recruit.tsx) each read up to 400 element boxes, a forced layout mid-animation.
- `crumbProgress('art stream')` every 100 art loads ran the same full scan, mid-shop, all game.
- The perf log stored itself every 15 s, and `buildPerfRow` re-stringified the whole ~50 KB session on every trim step
  (3-7 stringifies per store once its windows filled, ~20 min in).

## Changes (phones only; desktop records nothing here)

- New `crumbTick`: memory numbers + a running-animation count, no style or rect read. The gate crumbs and the gate
  layer use it; `crumbProgress` measures the same way. One-off steps keep the full scan.
- `buildPerfRow` measures the payload once and trims by subtraction (each list entry measured once, only when a trim is
  needed). The stored copy refreshes every 60 s (`PERSIST_MS`); the 15 s state snapshot keeps its cadence, and going
  hidden / pagehide still stores at once.

Pinned by `packages/ui/src/phoneDiagCost.test.ts`. Not measured on a device yet: the owner plays a few rounds on the
next build (or runs `?phonebench=1`) to confirm.

## Also measured this session (for the next step)

`perf:late` with a replay-size print, four 8-seat games: the in-memory replay recording reaches ~300 KB of JSON by
round 16 (fights ~150 KB), the autosave ~105 KB at ~0.55 ms (desktop). Both are small next to ~130 MB of phone image
memory, so turning replays off on phones was rejected. Next candidate: the autosave's double encode and the per-round
cloud upload of every seat's recording.
