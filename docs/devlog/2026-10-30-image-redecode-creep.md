# 2026-10-30 — Image re-fetch creep: the medallion tint mask (R-PERF-MEDALLION-MASK-01)

Owner (via the lead, top priority): performance degrades over a game, worse on phones. After #2455 the lead's
`perf:gauntlet --round-probe --audio` showed DOM, `<img>` count, JS heap and decoded audio flat after round 3, but the
renderer creeping ~31 MB a round and the page's cumulative image bytes climbing (139 to 173 MB) with the distinct
image URL count flat at ~1,826: pictures fetched again, not new ones.

## The cause

`perf:gauntlet --img-census` (new) counts, per round, every image request that missed Blink's memory cache (CDP
`Fetch.requestPaused`). From round 2 on a desktop round asked for **~300 images, all the same 10 keyword medallions**
(shout, endTurn, watcher, chooseOne, echo, rally, spend, execute, cleave, sell). The phone path (`--lite-art`) asked
for ~400.

The `.cgem-tint` overlay on every card medallion took its mask from an INLINE custom property,
`--cgem-artsrc: url("/medallions/<x>.webp")`, substituted into `mask: var(--cgem-artsrc) ...`. A url() that arrives
through `var()` is parsed into a new image value per element, so every medallion that mounted (and every trigger
pulse remounts one: `.cgem` is keyed on the pulse nonces) went back to the network stack and decoded the picture
again. The overlay is inert for every mechanic but Execute (tint amount 0), so all of that bought nothing.
Confirmed before fixing: the same build with `--css ".cgem > .cgem-tint { mask: none !important }"` dropped to 1-4
requests a round.

## The fix

`mechMedallion.ts` installs one stylesheet (`#cgem-art-masks`) with a literal url() rule per medallion art,
`.cgem-tint[data-art="shout"] { mask-image: url(...) }`; `Card.tsx` and the Medallion tuner set `data-art` instead
of the inline url; `styles.css` keeps the mask position / size / repeat. A stylesheet url() is one shared value,
loaded once. Verified in a headless prod build: the Execute and Watcher overlays compute the same mask-image as before.

## Guard

- `mechMedallion.test.ts`: the sheet holds one rule per art (aliases included); Card / the tuner never set the mask
  through an inline url; the `.cgem > .cgem-tint` rule never reads its mask from `var()`.
- `imageCensusVerdict` (`perfGauntletStats.ts`, tested): `--img-census` FAILS (exit 3) when any round from 3 on asks
  for more than 25 images (150 on `--lite-art`, whose LRU drops art on purpose). It reports the renderer's MB/round
  slope; `--renderer-limit <MB>` makes that gate too (not on by default: see "what is left").
- `--mem-infra` adds Chrome's memory-infra allocator dump per probe (a separate light trace).

## Numbers (seed 424242, Dwarf board, headless prod bench builds, rounds 1-14, one game each)

"requests" = image loads that missed the memory cache that round; "decode tasks" = the trace's `ImageDecodeTask`
(compositor raster decodes); renderer / GPU = OS private MB after a full GC; last column = cumulative
`decodedBodySize` of image resource entries.

Desktop (1920x1080, RTX 4080):

| round | requests before | after | decode tasks before | after | renderer MB before | after | GPU proc MB before | after | image bytes fetched, cumulative MB before | after |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1833 | 1828 | 2046 | 2047 | 908 | 908 | 1273 | 1255 | 128.9 | 128.9 |
| 2 | 241 | 21 | 157 | 273 | 1274 | 1272 | 1464 | 1410 | 132.6 | 130.4 |
| 3 | 321 | 8 | 167 | 279 | 1312 | 1300 | 1181 | 1413 | 136.0 | 130.6 |
| 4 | 253 | 11 | 298 | 314 | 1335 | 1330 | 1466 | 1477 | 138.5 | 130.8 |
| 5 | 337 | 8 | 330 | 355 | 1376 | 1369 | 1206 | 1501 | 141.9 | 131.0 |
| 6 | 310 | 9 | 340 | 327 | 1526 | 1516 | 1281 | 1301 | 145.1 | 131.2 |
| 7 | 318 | 9 | 323 | 322 | 1522 | 1525 | 1498 | 1531 | 148.4 | 131.3 |
| 8 | 302 | 5 | 328 | 305 | 1598 | 1580 | 1663 | 1399 | 151.6 | 131.4 |
| 9 | 297 | 10 | 325 | 324 | 1610 | 1592 | 1620 | 1742 | 154.7 | 131.6 |
| 10 | 265 | 13 | 214 | 316 | 1612 | 1596 | 1718 | 1677 | 157.4 | 131.9 |
| 11 | 250 | 12 | 343 | 324 | 1612 | 1600 | 1710 | 1451 | 160.0 | 132.1 |
| 12 | 237 | 8 | 326 | 337 | 1696 | 1663 | 1445 | 1738 | 162.5 | 132.2 |
| 13 | 187 | 9 | 318 | 312 | 1706 | 1667 | 1450 | 1757 | 164.3 | 132.4 |
| 14 | 198 | 6 | 309 | 308 | 1713 | 1674 | 1718 | 1730 | 166.4 | 132.5 |

Phone path (`--lite-art --cpu-throttle 4`, the downscaled copies + the 48 MB decoded LRU):

| round | requests before | after | decode tasks before | after | renderer MB before | after | GPU proc MB before | after | image bytes fetched, cumulative MB before | after |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1542 | 1534 | 213 | 213 | 248 | 241 | 757 | 726 | 57.6 | 57.5 |
| 2 | 310 | 76 | 122 | 112 | 377 | 383 | 922 | 920 | 63.0 | 60.1 |
| 3 | 410 | 88 | 100 | 99 | 452 | 454 | 756 | 755 | 68.5 | 62.5 |
| 4 | 398 | 88 | 124 | 126 | 462 | 478 | 788 | 773 | 73.9 | 64.7 |
| 5 | 412 | 82 | 173 | 158 | 533 | 520 | 819 | 949 | 79.7 | 67.3 |
| 6 | 348 | 89 | 225 | 223 | 531 | 525 | 1065 | 1035 | 85.5 | 70.0 |
| 7 | 316 | 90 | 208 | 219 | 542 | 527 | 1005 | 1012 | 90.3 | 72.7 |
| 8 | 287 | 57 | 193 | 186 | 559 | 542 | 1195 | 1162 | 94.8 | 74.8 |
| 9 | 331 | 79 | 233 | 217 | 566 | 543 | 1008 | 971 | 99.6 | 77.6 |
| 10 | 372 | 107 | 0 | 0 | 563 | 542 | 1190 | 1185 | 105.4 | 80.9 |
| 11 | 324 | 95 | 215 | 223 | 581 | 554 | 1195 | 1197 | 110.3 | 83.6 |
| 12 | 273 | 72 | 206 | 199 | 587 | 566 | 1194 | 1211 | 114.1 | 85.5 |
| 13 | 266 | 64 | 202 | 197 | 596 | 569 | 1209 | 1178 | 117.9 | 87.3 |
| 14 | 245 | 76 | 207 | 202 | 593 | 572 | 998 | 998 | 122.2 | 89.3 |

Requests drop ~30x on desktop (300 to ~10) and ~4x on the phone path (what is left there is the lite LRU reloading
card art by design). Fetched image bytes are flat after round 2 instead of +3 MB a round. Renderer at round 14:
-39 MB desktop, -21 MB phone path; Blink's GC heap (`blink_gc`) ends at 128 MB instead of 156. Decode task counts
did not move: they are the compositor re-rastering tiles, not the re-fetch.

## What is left (not images)

The desktop renderer still grows ~34 MB a round. Memory-infra per allocator, rounds 2 / 5 / 8 / 11 / 14, fixed build:

| allocator | r2 | r5 | r8 | r11 | r14 |
|---|---|---|---|---|---|
| web_cache (decoded images) | 156 | 156 | 156 | 156 | 155 |
| cc (tiles) | 46 | 52 | 52 | 55 | 47 |
| partition_alloc buffer | 819 | 825 | 1005 | 1005 | 1065 |
| partition_alloc array_buffer (SFX) | 231 | 273 | 290 | 297 | 300 |
| blink_gc | 81 | 108 | 119 | 125 | 128 |
| v8 | 47 | 54 | 59 | 63 | 67 |
| webgl | 120 | 120 | 144 | 158 | 159 |

- `partition_alloc/partitions/buffer` (Blink's Vector / String / SharedBuffer backing) grows in 60 MB STEPS
  (+120 by r6, +60 at r8, +60 at r12), the same on both builds. That is the next lead: something decodes or copies a
  ~60 MB buffer a few times a game and keeps it (two 3840 x 2160 RGBA frames are ~63 MB; texture uploads from images
  and canvas readbacks are the first places to look).
- `array_buffer` follows the SFX cache filling to its cap (`sfx.lruMB` 38 to 108 at a 96 kHz context,
  R-AUDIO-MEMORY-02): bounded.
- A heap snapshot diff r4 to r12 shows only ~10 MB of JS / Blink objects retained, so `blink_gc` / `v8` growth is
  mostly heap slack plus the replay frames (~0.6 MB of JSON a round), not a retained leak.

Raw logs (local): the lead's scratchpad `img/` (m-base, m-fix, l2-base, l2-fix, run-css, snap-fix).
