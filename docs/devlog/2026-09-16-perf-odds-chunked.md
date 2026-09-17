# The odds probe runs in idle-time slices, not one synchronous block

Owner's 2002 s perf recording (2026-09-16): `odds:deferred` — the 200-sim Monte Carlo behind the Combat
Summary's win/draw/loss bar — showed up as ONE long task at every combat start: ~7 ms at wave 2, 30–44 ms by
waves 9–14 (bigger boards → longer sims). The probe was already deferred off the End Turn click (2026-08-01)
via `requestIdleCallback(compute, { timeout: 1500 })`, but on a busy replay the timeout fires mid-frame and
the whole block runs anyway. Owner-approved as a mechanical cleanup: same look, same function, no gameplay
change, no patch note.

## What changed

- **`packages/sim/src/odds.ts`** — `createOddsProbe(input, seed, wave)` returns `{ step(n), done(),
  progress(), result() }`. Sim `i` always takes `mixSeed(seed, wave, TAG.ODDS, i)` and the tallies fold in the
  same order regardless of how the steps are sliced, so `result()` after any slicing is **byte-identical** to
  the one-shot. `computeCombatOdds` is now the one-shot wrapper over it (tests / headless tools unchanged).
- **`packages/ui/src/Recruit.tsx`** (the single odds effect) — drives the probe in slices: each
  `requestIdleCallback` runs a 10-sim step, then keeps stepping only while `deadline.timeRemaining()` holds
  more than 4 ms (a timed-out callback still runs one step so a saturated replay can't starve it). Per-callback
  timeout 200 ms; `setTimeout(32)` fallback without rIC; cancel on unmount / new combat exactly as before. Each
  slice records under `odds:deferred`, so the perf monitor now shows many small calls instead of one long one.
- **`packages/sim/src/odds.test.ts`** — determinism pin: a greedy practice run (invulnerable, so the bot
  reaches full 7v7 late boards) harvests the real `oddsInput` of every wave for three seeds; slicing at 1 / 7 /
  20 / 33 / 200 sims per step, plus an uneven deadline-style plan, all `toEqual` the one-shot.
- **`npm run perf:odds`** (`packages/tools/src/perf-odds.ts`) — micro-benchmark: one-shot vs the largest
  single 10-sim step at real boards from wave 1 to 14.

## Consumer / timing

The only reader of `combatOdds` is the Combat Summary overlay (`showLog`), which already renders behind a
`combatOdds && (…)` guard — it opens after the replay, long after ten idle slices have drained. If the thread is
saturated for the whole replay the worst case is 20 callbacks × 200 ms = 4 s (vs 1.5 s before), during which
the overlay would simply omit the odds block; in practice idle frames during the intro absorb several steps
per callback.

## Numbers (`npm run perf:odds`, tsx / Node, median of 5, max across 4 seeds — Node-side absolutes, the
browser's prod build runs the same code somewhat faster; the ratio is what carries)

| wave | board | one-shot block (before) | largest 10-sim step (after) |
| --- | --- | --- | --- |
| 1–3 | 2–5 | 13–21 ms | 1.0–1.6 ms |
| 4–6 | 8–10 | 28–36 ms | 1.6–2.2 ms |
| 7–14 | 10–14 (7v7) | 45–51 ms | 2.6–4.4 ms |

So the single long task at every combat start becomes ≤ ~4 ms steps, and an idle callback only strings steps
together while `deadline.timeRemaining()` still holds more than 4 ms. Total work is unchanged (same 200 sims).
