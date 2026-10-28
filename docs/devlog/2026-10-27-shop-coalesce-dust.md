# 2026-10-27 — Late-game shop: generated-card dust at 120 fps, at most 3 at once

The first fix from the perf gauntlet (`npm run perf:gauntlet`, docs/performance.md §2b), aimed at the late-game shop
(owner: "im FAR more worried about the shop performance than the fight performance").

**What the profile showed.** `perf:gauntlet --profile shop-actions` covered rounds 9-10 of the owner's Ale engine
(gilded Edward Keg-hands, two gilded Tapkeepers, Mountainbond, Chef Gary Toast), buying and playing as fast as it
can. The biggest named JavaScript cost was the arcane coalesce on generated cards (`plateCoalesce.ts`): 1.75 s of
canvas drawing in 23 s. Every Dwarven Ale is a generated card, and each one drew 390 motes (two sprites each) into
its own canvas on every display frame, 370 times a second on the owner's panel. Next were the 5000+ badge-ring
layout reads (`milestoneBadgeFx.ts`, 1.26 s) and the tavern rect sweep (`Recruit.tsx`, 0.74 s). The bug-report
state hash and replay capture, suspected from reading the code, were small (0.3 s and 0.1 s).

**The change (owner ruling, R-PERF-COALESCE-DUST-01):**
- The dust draws at most 120 times a second.
- At most 3 coalesces carry dust at once. Past the cap, the wireframe still forms and resolves into the card.
- The trail smear is per elapsed time at the rate it was tuned on (360 Hz), so it looks the same on the owner's
  panel. On a 60 Hz panel the trail is now shorter than it was, because it used to smear once per drawn frame.
- The effect only writes the wireframe opacity, the wireframe scale and the hidden card's opacity when they change.

**Measured** (blind A/B, 3 runs a build, rounds 9-10, against the same base commit 8019f68f7, 370 Hz). The judge
picked the fix before the key was opened:
- shop-actions p95 22.2 vs 27.8 ms (-20%)
- shop-actions p99 33.4 vs 41.6 ms (-20%)
- main-thread work 5.50 vs 6.35 ms per frame (-13%)
- Every other scene was within noise.

The buy-and-play turn is still about 5x over the 4.17 ms budget at p95, so this is a first step.

**Next candidates:**
- the badge-ring layout reads,
- the tavern sweep after every buy, play or sell,
- GSAP computed-style reads (0.46 s),
- the browser-native style, layout and paint share, which still needs a trace to break down.
