# 2026-10-29 — A smoother card drag on phones: no page-wide restyle at pickup and drop, no Flip on slot crossings (R-PHONE-DRAG-02)

**Owner (2026-10-29, real phone, prod build):** "Mobile dragging still feels stutter/janky. Can you improve that? Feels
like it is stuttering trying to catch up". Follows #2324 (R-PHONE-DRAG-01: lighter per-frame writes, no drag shadow
filter, deferred pop art) and #2330 (lasso sub-steps).

## What the phone itself said

The owner's own perf reports (`client_crash_reports`, `last_step = 'perf-report'`, iPhone, iOS 18.7, Home Screen app)
put the `drag` scene well behind the idle `shop` scene on every session:

| session (build) | drag frames | drag p95 | drag frames > 33 ms | shop p95 | shop frames > 33 ms |
|---|---|---|---|---|---|
| id 19 (79be42468, today) | 507 | 36.5 ms | 28 (5.5%) | 23.5 ms | 26 of 912 (2.9%) |
| id 14 (2c98f484d) | 63 | 43.5 ms | 5 | 21.5 ms | 46 of 1880 |
| id 9 (000e0bcc6) | 403 | 47.5 ms | 43 (10.7%) | 18.5 ms | 76 of 4515 |
| id 8 (000e0bcc6) | 522 | 34.5 ms | 28 (5.4%) | 19.5 ms | 34 of 2451 |

p50 is one 60 Hz frame everywhere, so the steady drag is fine; the drag loses a few frames per gesture. "Catching up" is
the card freezing for one of those frames and then jumping to the finger.

## Root causes (prod bench build, headless Chrome as a Pixel 8, real CDP touch at 60 Hz)

Traced three drags (Shop card wandered then bought, hand card wandered then played, a board minion reordered along the
row, lifted and put back). The steady frame was already cheap (well under 1 ms of main thread unthrottled; the finger
position is applied 1:1 from the latest event in one rAF, transform-only, no React render per move, no layout read
per move). The lost frames were three events per drag:

1. **Every pickup and every drop restyled the whole document.** `body.dragging` flips at the pickup and the drop, and
   the replay rail's own cursor rule `.roundrail-wrap.dragging, .roundrail-wrap.dragging * { cursor: … }` shared the
   class name. A class in front of a featureless subject (`.x *`) makes the browser invalidate the whole subtree of ANY
   element that gains the class, so `<body>` gaining `dragging` restyled 476 elements: ~20 ms at a 4x-throttled phone
   profile, twice per drag. Bisected unthrottled over the 22 rules that name `dragging` (best of 5 toggles each): all
   of them 4.0 ms, none 0.0 ms, that rule alone 4.1 ms, no other rule over 0.3 ms.
2. **Every slot crossing ran a GSAP Flip that never showed.** `RowFlip` played `Flip.from` off the state captured after
   the previous crossing, then captured again with `Flip.getState`. That capture COMPLETES any in-flight flip on its
   targets, so the moved row's flip ended in the same task it started; the other row ran a zero-offset tween
   (`translate3d(0, 0, 0)`, briefly promoting those cards to layers); and the `!important` CSS transition on the cards
   (`body.dragging … .card { transition: transform 0.36s … }`) was the visible glide all along. It cost two forced
   style + layout passes and a full inline-style restore per row card at every crossing. A probe that sampled every
   live drag frame found GSAP transforms on the row cards only as those zero-offset tweens.
3. The pickup's own mount (the floating card) and the drop's game action remain. The drop is the action commit (the
   same work as a click buy or play); it is not part of this change.

## Fix

- The replay rail's class is `rr-dragging`. `bodyClassRestyle.test.ts` collects every class the game toggles on
  `<body>` / `<html>` (from `body.x` selectors and `document.body.classList` calls) and fails if any stylesheet puts one
  in front of a featureless subject.
- `RowFlip`'s dragging branch does nothing, and `startDragSession` captures no Flip state (`flipStateRef` is gone).
  Committed moves (a drop, a sell, a summon) keep their manual slides. `dragSession.test.ts` pins both.

**Visual equivalence.** A scripted touch drag with pauses (Shop reorder two slots and back, lift out of the row and
back, a board reorder on a full row, lift and back) recorded every row card's settled position at each pause on the
old and new builds: identical, card for card.

## Measured

Prod bench builds (`VITE_PERF_BENCH=1`), headless Chrome as a Pixel 8 (915 x 412 @ 2.625, touch), real CDP touch moves
at 60 Hz, the three drags above twice per run. The machine was shared and at 100% CPU from other sessions the whole
time, so wall-clock frames are noisy; each build ran three interleaved rounds.

**Main-thread work per drag (unthrottled, thread time from a trace, two interleaved runs each):**

| drag | tasks over 4 ms: before | after | tasks over 2 ms: before | after | worst three tasks after (ms) |
|---|---|---|---|---|---|
| Shop card, wandered then bought | 8 / 10 | 3 / 5 | 13 / 14 | 9 / 10 | 17.4, 17.2, 7.1 (drop, pickup) |
| hand card, wandered then played | 3 / 3 | 3 / 3 | 8 / 7 | 5 / 7 | the drop's play action |
| board reorder, lift and back | 3 / 4 | 2 / 2 | 10 / 12 | 2 / 2 | 8.2, 6.4, 1.7 (pickup, drop) |

`requestAnimationFrame` work (where the React commit of each crossing ran) fell 30-50% on the Shop and board drags,
and the pickup and the drop each lost the 476-element restyle. A slot crossing is now a commit of the rows and nothing
else (under 2 ms unthrottled).

**Frames during the drags (rAF intervals; headless rAF runs at 240 Hz, so read the over-16.7 / over-33 counts):**

| profile | build | frames | p50 / p95 / p99 (per round) | over 16.7 ms | over 33 ms |
|---|---|---|---|---|---|
| 4x CPU | before | 4,913 | 4.2 / 8.4-16.8 / 29-67 | 165 (3.4%) | 63 (1.3%) |
| 4x CPU | after | 5,188 | 4.2 / 8.4-12.6 / 21-63 | 115 (2.2%) | 55 (1.1%) |
| 6x CPU | before | 3,367 | 8.3 / 16.7-33.3 / 50-100 | 263 (7.8%) | 116 (3.4%) |
| 6x CPU | after | 3,640 | 4.3-8.3 / 12.5-20.8 / 33-79 | 128 (3.5%) | 59 (1.6%) |

At 6x (a mid-range phone) the frames lost during a drag halved. The remaining ones are the pickup (mounting the
floating card) and the drop (the buy / play / reorder action itself), plus the noise of the shared machine (the third
round of BOTH builds was much slower). Zero is not reached: the drop is the game action's commit, out of scope here.

**Finger to card:** after every rendered frame, the floating card's anchor (read back from the transform the rAF wrote)
sat on the latest pointer position: 0 px at p50, p95 and max, before and after (touch follow is instant). The card
does not trail the finger; what read as "catching up" was the frames it froze.

**Desktop (1920 x 1080, mouse, unthrottled):** 1,168 vs 1,183 frames, over 16.7 ms 4 vs 3, over 33 ms 1 vs 0. No
regression.

## Not changed (judgement calls)

- The dive tilt's input is the card's travel per frame, so its unclamped range scales with the refresh rate. On a
  phone the tilt sits at its 16 degree ceiling for nearly any finger speed either way, and changing the gain would
  change the owner-tuned desktop feel. Left as is.
- The per-frame `Layerize` in Chromium comes from the floating card's 3D tilt (hiding the card removes it; `zoom: 1`
  does not). ~0.1 ms a frame unthrottled: left as is.
- Headless WebKit on Windows composites in software, so the iOS side is reasoned, not measured: a whole-document
  restyle and per-crossing forced layouts cost WebKit at least as much as Blink. The owner's next perf report (the
  `drag` row) is the check.
