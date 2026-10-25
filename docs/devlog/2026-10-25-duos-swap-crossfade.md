# 2026-10-25 — Duos teammate view: the panel sweep becomes a cross-fade

Owner (2026-10-25): "The flip to teammate view and back should be extremely fast and clean/smooth" and "The teammate
view swap animation is really ugly". The ask: a quick, clean cross-fade (~150-200 ms) with zero frames over 6.25 ms.

## What shipped

- `teammateView.turn`: no team panel, no sweep. At the click a frozen clone of `#root` (the GHOST, a few hundred plain
  nodes, ids stripped, `inert`, `aria-hidden`) goes on top and the real screen swaps underneath it at once. Once the store
  holds the new screen, at least 70 ms have passed and three frames in a row came in under 8 ms (capped at 160 ms), the
  ghost fades out (130 ms, opacity only, one-shot) and is removed.
- The pitch had two looks, captured mid-transition on the bench build: a plain cross-fade and a cross-fade with a
  slight scale (outgoing 1.0 to 0.985, incoming 1.015 to 1.0). The scale makes the two screens' text double up
  mid-fade, and it promotes `#root` to its own layer (more raster). So the plain fade shipped.
- `.duosghost` has NO `will-change` / `contain`. On a full-screen subtree full of fixed layers they cost 40-70 ms
  frames, both when the ghost was inserted and when its fade started. This was measured in isolation with no swap: the
  plain ghost costs 8-16 ms once.
- The `.duosswap` panel, `prepareTeammateSweep` and the HUD's idle call are gone. `teammateSweep.test.ts` became
  `teammateFade.test.ts`. R-DUOS-VIEW-01, GAME-RULES and the patch notes are updated.
- `perfBench.ts` exposes `bots` (the Versus test bots), so a prod bench build can seat its own Duos table.

## Measured (prod bench build, own Chrome 150 window, RTX 4080 SUPER, 240 Hz display = 4.2 ms frames)

Live backend, Claudebot1 plus three test bots, early rounds. Five swaps each way per build.

| | flip (ms) | frames > 6.25 ms | p95 | p99 | worst |
|---|---|---|---|---|---|
| main (sweep), in | 443-486 | 3-6 | 4.3-8.3 | 12.5-25.1 | 16.7-29.2 |
| main (sweep), out | 436-454 | 2-4 | 4.2-4.3 | 12.5-16.6 | 16.7-24.9 |
| cross-fade, in | 250-323 | 2-6 | 4.3-20.8 | 33.3-50 | 37.4-50 |
| cross-fade, out | 231-280 | 2-7 | 4.3-8.4 | 20.8-41.7 | 29.2-45.8 |

- **Flip time is about halved.**
- **Long frames still happen, before the fade starts.** They are the new screen's two heavy frames: the React commit
  with its forced style recalc and paint, then a second compositor-bound frame about 35 ms later. In both builds they
  land while a still image covers the screen (the panel on main, the frozen ghost now), so nothing visible stutters
  through them. They are longer than on main (the clone adds its own style and paint), and the 0.999-opacity trick
  against occlusion did not change them.
- **During the visible fade:** mostly zero frames over budget. Sometimes one 8.3 ms frame (a single dropped 240 Hz
  vsync). Occasionally a 12-20 ms frame at the end (the ghost's removal).
- **Idle shop is unchanged:** p50 4.2 / p95 4.3 / p99 4.3 on both builds.
- **Memory:** JS heap after GC is 58.5 MB (main) vs 58-61 MB (cross-fade). Five extra swaps on the same page added no
  DOM nodes (no ghost leak).

## Not met: zero frames over 6.25 ms

Profiling (sourcemapped CPU profile and trace) shows the rebuild cost is spread across the whole screen, not in one
hotspot:
- the React commit;
- a full style recalc (about 20 ms, forced first by Recruit's tavern rect sweep in `useLayoutEffect`, which only pays
  what the frame would have paid anyway);
- paint;
- raster and decode of a full new screen.

Art preload on hover would only touch the decode part (about 29 ms of raster-worker time, off the main thread). The
only way to zero is a pre-built second screen kept mounted and rastered, which needs a second store instance. That is
written up for an owner decision (see the PR) and is not started.

Also checked on the GPU browser: with the teammate's buffs pop-out open (the bottom-left hero), a click on my own
bottom-right portrait still returns at once. The buffs were dev-injected into the store for the check.
