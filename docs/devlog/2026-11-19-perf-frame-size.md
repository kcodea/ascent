# 2026-11-19 — Right-sized card frames: what they buy, and why they are NOT invisible

Branch `perf/frame-size`, stacked on `perf/card-raster` (PR #2791). Rule: `R-PERF-FRAME-SIZE-01` (proposed). Test:
`packages/ui/src/cardFrameSize.test.ts`. **Recommendation: do not merge without the owner's look.** The gain is
smaller than the brief expected and the frames look a little smoother.

## What it does

The 42 card frame masters (every tribe's oval and Taunt shield, their Gilded twins, `standard-oval-v2.png`,
`taunt-shield.png`) are 1059 x 1427 / 1086 x 1448. `scripts/optimize-art.mjs` now writes a 640 px wide copy of each
into `apps/web/public/frames/w640/` (Lanczos, WebP q92; the masters are never written to). `cardFrameArt` in
`phoneArt.ts` loads the copy on a desktop whose screen it covers (`cardFramesFit`: the largest card frame drawn, the
Inspect card at 0.27 of the viewport height, times the device pixel ratio, must be at most 640 px: 1080p at 1x or 2x,
1440p at 1x or 1.5x, 4K at 1x; a 5K screen keeps the masters). Phones keep their own 512 px build copies. The preload
plan loads exactly one of a master and its copy. The two CSS masks on the glow rim use the copy everywhere.

## What it buys

- **Decoded size of the 42 frames: 247 MB -> 88 MB** (6.0 / 6.3 MB each -> 2.2 MB). Files 7.9 MB -> 3.0 MB.
- **But that is not what the GPU holds.** A memory-infra dump of the late-game recruit state (tier 6, board 7, hand
  10, Shop 6), same page build, masters vs copies:

  | allocator | masters | 640 px copies |
  |---|---|---|
  | GPU process `gpu/transfer_cache` | 180.4 MB | 175.4 MB |
  | GPU process `skia/gpu_resources` | 183.1 MB | 178.1 MB |
  | renderer `web_cache/Image_resources` | 190.8 MB | 184.5 MB |
  | renderer `cc/image_memory` | 551.8 MB | 563.4 MB (noise: the frames are not the bulk of it) |

  About 5 MB of GPU memory and 6 MB of image cache. Chrome's compositor uploads an image at the mip level it is drawn
  at (a frame drawn 240 px wide is uploaded at about 265 px), so the 6 MB full-size bitmap was never what sat on the
  GPU. The "180 MB of GPU image cache" in the brief is the whole page's art, not the frames.
- **A frame decode that returns mid-turn costs less**: 0.55 megapixels to decode instead of 1.51 (about 2.7 times
  less work for the 11 to 54 ms decodes in the brief). Estimated from the pixel counts, not measured as a hitch: no
  mid-turn frame re-decode happened in the bench state.
- Raster time: not measured separately; with the card layers of #2791 a frame is drawn into a card's tile once.

## Why it is not invisible

Pixel diff, late-game state at 1x, masters vs copies (`perf-card-raster-diff.mjs`): the difference is confined to the
frames' carved stone and gold edges (art, names and numbers identical), 8 to 11% of a Shop card's pixels differ by more
than 2 levels and up to 0.6% by more than 24. Laplacian edge energy per card, copies against masters:

| card | 640 px copy | 800 px copy | 900 px copy | 640 lossless | master re-encoded at full size, q92 |
|---|---|---|---|---|---|
| Shop cards | -7% to -11% | -5% to -8% | -4% to -7% | -7% to -11% | 0% |
| board cards | -1% to -6% | -1% to -6% | -0% to -7% | | |
| hand cards | -2% to -5% | -2% to -3% | -2% to -3% | | |

The softening is the resample, not the encoding (lossless 640 = lossy 640; a full-size lossy re-encode = the master),
and it does not go away at 800 or 900 px: Chrome's own mip-level downscale of the master keeps a little more edge than
any copy made ahead of it. A half-size copy (Chrome's own mip level 1, box or Lanczos) measured the same as 640. At 4x
the frames' stone texture is a touch smoother; at 1x it is hard to see, but it is a change of look, so it is the
owner's call.

Evidence (all in `C:/Users/kevin/the ascent/.claude/perf-scope-2026-11-18/card-raster-2/frames/`): contact sheets
`sheet-old-vs-new-*.png` (before | after | difference x8), 4x crops `x4-recruit-{s,b,h}@1x-*.png`, the memory dumps
`mem-old.json` / `mem-new.json`. 2x-DPR captures did not return in this headless Chrome (`Page.captureScreenshot` hangs
at DPR 2 with this much on screen), so the 2x look is unproven.

## The largest real use

Measured by the first builder at 1920 x 1080: Inspect card frame 283.6 px wide (0.263 of the viewport height), hover
preview 0.210, a popped hand card 0.203, a hand card 0.160, a Shop / board card 0.138. Found in the stylesheet since:
Discover cards 1.3x a Shop card, the Runeforge 1.29x, the quest overlay 1.22x, all under the Inspect card. The Career
trends board (`.ct-board .cv2-team`) has an unbounded tile width (`(100cqw - 236px) / 7`): in a container wider than
about 3,700 px at 1x it would draw a frame slightly over 640 px. Not seen in practice.
