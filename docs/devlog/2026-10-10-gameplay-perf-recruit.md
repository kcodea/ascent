# 2026-10-10 — Gameplay performance pass, part 1: the recruit phase

Owner ask (2026-10-09): a performance pass on actual in-game play, then the bar "over 160 fps at all times if not
240+", with the recruit phase first and flat from round 1 to the end of a game. This PR ships the recruit-phase wins
that change nothing on screen. Combat follows in a second PR.

## How it was measured

PROD bench bundles (`VITE_PERF_BENCH=1`): **before** = `origin/main` (b14b734b8), **after** = this branch. Each was
served by `vite preview`, plus the dev servers for the dev column. A zero-dependency CDP driver ran headful Chrome on
the 240 Hz panel with Supabase blocked, so nothing uploaded. Frame times come from an in-page rAF recorder.
Attribution comes from Chrome traces (main thread, GPU process, raster, decode, selector stats, invalidation
tracking) and CPU profiles. On a 240 Hz panel, "over 6.25 ms" means a missed vsync (an 8.3 ms or longer
interval).

Scenarios:
- A heavy Scene Builder shop: a 7-card board with Ward/Flurry/Rally/Echo/SoC/Rise and golden cards, a 10-card hand,
  and a golden shop.
- An "all keywords" board.
- A full lobby game autopiloted through the store plus real mouse input. Every round runs the same recruit script:
  hover sweep, upgrade, sell, buy, play, roll, freeze x2 and two drags.

## Results: heavy shop, frames over 6.25 ms per action (prod, then dev)

| Action | Prod before | Prod after | Dev before | Dev after |
|---|---|---|---|---|
| idle (2 s) | 0-12 | 0 | 0 | 0 |
| hover sweep (25 cards) | 98-132 | 71-81 | 119 | 85 |
| refresh (click) | 27-58 | 5-7 | 47 | 5 |
| buy | 22-50 | 0-1 | 39 | 0 |
| sell | 20-40 | 2-3 | 31 | 4 |
| freeze | 48-66 | 4-5 | 58 | 5 |
| board drag (there and back) | 98-135 | 25-28 | 127 | 32 |
| hand to board drag | 81-163 | 35-40 | 93 | 43 |

- Board drag p99: 46-58 ms -> 16.7 ms.
- Hand-to-board worst frame: 112-217 ms -> 63-75 ms.
- Every-keyword board at idle: **148 fps -> 238 fps.** The GPU drew 113 render passes per frame before and 63 after.

Full game, frames over 6.25 ms in each round's recruit script. The bots played different games, so this is a
curve, not a paired comparison:

| Rounds | Before | After |
|---|---|---|
| 1-9 (board filling) | 9-27 | 7-37 |
| 10-12 (full board, buying and rolling) | 102-137 | 82-124 |
| 13-18 (full board + 10-card hand) | 35-141 | 18-32 |

Memory over 18-20 rounds:
- Heap: 48 -> 66 MB before, 50 -> 61 MB after.
- DOM nodes and listeners plateau once the board and hand are full (~3,350 nodes, ~1,170 listeners).
- Pixi textures plateau at 52, GL programs flat at 19.
- No leak trend found. The saved run grows ~7 KB per round (the replay), written on idle at phase boundaries.

## What changed

1. **Pixi's DOM event system is detached from every FX canvas** (`pixiNoDomEvents.ts`).
   - Each `Application` put a capture `pointermove` on `document` that read the canvas rect, forcing style and
     layout on every mouse move: 2.5-3 ms each.
   - Its ticker also dispatched a synthetic `pointermove` about 24 times a second while the mouse was still.
   - None of our canvases are interactive.
2. **Keyword FX paint is rasterised once instead of every frame.** This covers the Flurry rings, the Execute
   arcs/blobs/shards and the Rise wisps.
   - The blur, mask, gradient and opacity sat on the animating, composited element, so the GPU re-applied them as a
     render pass every frame.
   - They now sit on a plain child; the animated element keeps only its motion.
   - Same picture: CSS applies filter/mask/opacity in local space before the transform. 2x crops match to max
     15/255, mean under 0.31.
3. **The card/chrome size variables are registered with `@property`** (`--ch-base`, `--ch`, `--cw`, `--ccw`,
   `--u-base`, `--u`).
   - As plain custom properties, every `var(--ccw)` was substituted and re-parsed per element as a four-deep calc
     chain.
   - Full-document restyle: 20.7 -> 13.5 ms.
   - Whole-screen diffs (title, hero select, both shops, Compendium) are identical except sub-pixel antialiasing and
     the clock / version text.
4. **The drag's closed-fist cursor is a veil element** (`dragCursorVeil.ts`), not `body.dragging *`. Flipping that
   universal, inherited rule restyled the whole document at both ends of every drag.
5. **GSAP Flip's body lock is bypassed** (`withoutFlipBodyLock`).
   - In a full-screen window `Flip.from` writes `width` and `overflow-y` onto `<body>` and removes them again.
   - That is two whole-document restyles and a full layout per call, i.e. per drag slot crossing.
   - Our body is `overflow: hidden`, so the lock guarded nothing.
6. **`Flip.from` stays on its simple path.**
   - 77 of 112 card fits in a drag took the deep `getGlobalMatrix` path (temp elements and forced layouts) over a
     -0.031 px size difference.
   - `snapSubpixelSizes` treats under half a pixel as the same box.
7. **The RowFlip tavern sweep is skipped when only the warband gap moved during a drag.** It cost 71 ms of forced
   layout per three drags.
8. **The drop reads the drag-card rect before `body.dragging` comes off.** Before, a ~31 ms forced restyle landed
   inside `pointerup`.
9. **The FX filter programs are pre-linked** with the primitive warm-up (`fx/filterPrewarm.ts`). The first
   Bloom/Glow play was a 97-132 ms freeze, e.g. the first hand-to-board drop.

Tried and reverted: holding the hover glow on its own layer. It halved the hover re-raster but cost ~10 extra
render passes per frame at idle.

## Not fixed here (what still stands between the shop and 6.25 ms)

- **Style cost per element.** A play restyles ~350 elements at ~30 µs each (10.6 ms), plus 8 ms of layout, inside
  the dispatch. Removing only the ~280 matched `var()` rules takes a full restyle from 13.4 to 1.9 ms. The fix is a
  structural CSS change (card-internal geometry on container-query units, not `var(--ccw)` maths). It is proposed to
  the owner, not shipped.
- **GPU raster of new cards.** A played or rolled card's first raster is a 14-34 ms GPU task: art decode plus the
  frame drop-shadows and the blurred frame copy. The fix changes how the card is painted (pre-baked shadows,
  card-size art), which is a visual-tradeoff proposal awaiting the owner.
- **The hover preview.** A triple drop-shadow sits on a container whose child bobs forever, so it is one GPU render
  pass per frame while the preview is open. Changing it changes the look, so it is a proposal.
- **Combat** is the next PR.
