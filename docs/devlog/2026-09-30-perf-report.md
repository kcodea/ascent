# 2026-09-30 — perf report: particle blow-up, milestone filter passes, aim reads, portal counter, hidden-tab spikes

Owner's in-game perf monitor report from a ~33-minute session (two full games, 240 Hz, 4.17 ms budget): worst
frame 321 ms, 20,685 frames over 8.3 ms, `fx:particles` peaked at 8,661 in a shop second, `fx:tick` worst 60.7 ms,
`fx:render` 54.2 ms, `fx:sim` 35.7 ms, "portals" DOM grew 82 → 664 and never came back, `layout:read-in-move`
1,813, `test-ascent-frame-*` FX ~30k frames each, phase-start spikes of 18,280 / 8,254 / 1,900 / 1,250 ms, and a
213 ms task at game over.

## How it was measured

PRODUCTION bundles, both built with the new `VITE_PERF_BENCH=1` switch (`packages/ui/src/perfBench.ts` puts
`window.__bench` = store, FX overlay, `playDef` on the page; player builds never set it):

- **before** = `origin/main` + only `perfBench.ts` (served by `vite preview` on :5392),
- **after** = this branch (:5393).

Each scene drives the Pixi ticker by hand at 4.17 ms steps and times every `ticker.update` (the FX sim + render +
GL submit), as in `docs/performance.md` §3b. **Caveat:** the browser pane was HIDDEN during the prod runs (the
GPU is throttled in a background tab), so absolute milliseconds are inflated on both sides; the before/after pair
ran under identical conditions. The same scenes on the dev build with the pane visible gave the same direction
(numbers in brackets).

| Scene | Before | After |
|---|---|---|
| 7 x `shop-buff-purple` fired in one frame (every shop card buffed) | peak **6,993** particles, tick mean 34.6 ms, p95 108 ms | peak **3,250**, mean 4.2 ms, p95 15.9 ms (dev: 13.0 → 4.7 ms mean) |
| 14 x `tendril-trail-dwarf` in one frame | peak 5,054, mean 34.1 ms, p95 154 ms | peak 1,967, mean 1.5 ms, p95 7.9 ms |
| 7 x `blast-pump` in one frame | peak **9,317**, mean 16.7 ms | peak 4,127, mean 0.9 ms |
| 8,000 sprite particles in one burst (dev) | 8,000 live, mean 1.46 ms, mass-death frame 9.2 ms | capped at 1,200, mean 0.9 ms |
| Late-game board: 7 units at 6,000 / 6,000 (14 milestone-badge loops) | **112 live filters**, tick mean 37-209 ms (dev, visible: 16-24 ms) | **4 filters**, mean 2.0-3.7 ms (dev: ~2.7 ms) |
| `layout:read-in-move` over 8 aim moves (hero power armed, dev) | 7 | **0** |
| "portals" container on a shop screen | 528 nodes (the whole game) | 13 (real portals only) |

## 1. The particle blow-up — root cause: admission read a lagging count

`fxBudget.admitPlay` compared the pool's REAL live particle count against the 4,000 cap. A play fired this frame
has emitted nothing yet (its layers spawn on the next tick, delayed layers later), so every play of a same-frame
fan saw the same near-empty pool and passed: `fx:culled` stayed 0 at 9,317 live. Fixed with:

- **pending load**: a play registers `bornAt` + `rampMs` (`rampMsOf`: latest burst `at`, emitter `at + life`),
  and while ramping counts at its expected load; it is never a trim victim (it is the moment landing now);
- **thinning**: when trimming already-emitted plays cannot make room, the incoming play's burst `count` /
  emitter `rate` are scaled down (`thinDef`, floor 35%, `fx:thinned` counter) instead of the cap being ignored.
  Every play still fires; sizes, timings and colours are untouched. Loops / follows are never thinned;
- **a shop scene cap** (`maxParticlesShop` 1,500, set from `Game.tsx` while `phase === 'recruit'`, seeded on
  mount: the subscription alone never fired for a run that was already in the shop);
- **a sprite-particle cap** (`MAX_SPRITE_PARTICLES` 1,200 per controller, oldest recycled first) plus an
  in-place compaction of the sprite loop (the per-death `splice` was O(n^2)).

Judgement call: the floor means a 7-wide fan of a 1,000-particle def still overshoots the 1,500 shop cap (3,250).
Going lower thins each card's burst visibly; the owner can tune `MIN_PARTICLE_SCALE` / `maxParticlesShop`.

**Not changed (owner's call):** `amplified-slot` (the Equipment Amplified glow) is a protected loop of ~3,719
particles on its own (one layer is 775/s x 4.16 s). While it is on it holds the shop at or over the cap by itself.
A lighter authored version would be the fix.

## 2. Milestone badges: 8 full-screen filter passes per badge

New finding, and the largest late-game cost. `test-ascent-frame-attack` / `-health` are NOT test leftovers: they
are the shipped top-milestone (5,000+) badge loops (`milestoneBadgeFx.ts`, owner-authored in #1588; the `test-`
prefix is just their workbench name). Each has Bloom + Glow on its emitter layer, and as a seamless loop ~4 cycles
are alive at once, each with its own filter stack. Every particle container carries a huge `boundsArea`, so every
pass is FULL-SCREEN: 14 badges = 112 full-screen passes per frame. Stripping the filters in a live test took the
tick from 16.1 to 2.9 ms.

Fix: `PlayDefOptions.shareFilters` + `fx/sharedFilters.ts`. Plays that opt in and whose filters are time-invariant
(flat curves, same params on every filtered layer, no clock-driven filter) draw with their own filters off inside
one group container per def that carries the filters once. Bloom is linear, so the union looks the same wherever
badges do not overlap; Glow differs only where two halos overlap. Measured screen luminance of the under canvas:
7.5 before vs 8.0 after (alpha 2.9 vs 3.1), i.e. within ~6%, and side-by-side screenshots look the same.

## 3. `layout:read-in-move`

The counted reads were the hero-power / Equipment aim and the Battlecry / Choose One target aim:
`elementFromPoint` on every rAF-coalesced move and on release. They now hit-test `aimRectCache.ts`: candidate cards
measured once when the aim starts, re-measured every 200 ms and on resize from a timer (never inside an `input:`
span), so a gliding card or a mid-aim roll is still hit correctly.

The unlabelled long tasks "after pointermove" on hero select, the curtain, rune cards and the game-over screen are
phase-transition renders: `lastEvent` is just the most recent input, and pointermove is the most frequent one.

## 4. The "portal leak" was the counter

Since the responsive stage (2026-09-26) `#root` lives inside `#stage`, and the `portals` selector
`body > :not(#root)` matched `#stage`, i.e. the whole game. "82 → 664, never came back" was the app's DOM going
from the title into a run. The selector now counts `#stage > :not(#root)` plus body children outside both. On a
shop screen: 528 (old selector) vs 13 (new). No real leak found.

## 5. Phase-start spikes: hidden tab, confirmed in code

rAF does not run in a background tab, so the first frame back carries the whole absence as one interval, and the
warm-up recorded it as `worst`. The 18,280 ms `start` and 8,254 ms combat spikes are that. The warm-up now keeps
such intervals out of the frames and reports them as `hiddenMs` on the startup record (`perfWarmup.test.ts`).
Seen while measuring: the boot loading gate also crawls in a hidden tab (100 / 1,170 images after ~40 s).

## Left for a follow-up (too big or too risky for this PR)

- **The 213 ms game-over task.** The end screen is an opaque cover (`body:has(.heroselect) .app { visibility:
  hidden }`), but under it `Recruit` re-lays the whole scene out from combat to the shop layout (`inCombat` flips
  false), which is the `render:recruit` 144 ms. The fix is to keep the combat layout frozen under the cover at a
  terminal phase. That touches the wipe machine and ~100 `inCombat` reads, so it needs its own PR and a careful
  look at what the end screen relies on.
- **`layout:flip:write`** (4.0 ms per dropped frame, worst 19.6 ms): not addressed here.
- **`amplified-slot`'s particle load** (above).
- The milestone loop's `follow` still reads one rect per badge per frame (cheap while layout is clean).
