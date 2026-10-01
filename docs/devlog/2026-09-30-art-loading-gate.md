# 2026-09-30 — The boot splash is a real loading gate: every image is decoded before you can play

Stacked on the art pop-in fix (#1866, `docs/devlog/2026-09-29-art-pop-in.md`). The first plan for today was
blurred previews (ThumbHash placeholders) plus predicting and preloading the next shop. The owner replaced it
before any of that was built:

> *"i think id rather load everything. i dont want blurry images, i wanna stop pop in."*

So nothing is shown until everything it could show is ready. No previews, no prediction.

## What changed

- **The splash holds until the art is decoded** (`Boot.tsx`). `preloadBootArt` (preloadPlan.ts) queues every
  image a session on the live set can show and RETURNS that list; `whenArtReady` (artPreload.ts) resolves once
  every one of them has settled (decoded, or failed / timed out after 15 s, so a broken file can never hang the
  game). Then the menu mounts and the splash fades off it, exactly as before. This replaces the fixed 3.5 s fake
  timer of 2026-08-25, which the owner's new ask supersedes.
- **The bar is real progress.** Images decoded / total, written as `transform: scaleX(p)` on the fill (a 220 ms
  transform transition glides between steps; compositor-only, no layout or paint loop), at most once a frame,
  with a count under the bar: `Loading art 228 / 1126`. The old CSS keyframe fill is gone. The ⏳ Load Screen
  dev tuner's preview parks the bar at 60% with a sample count.
- **What the gate covers** (1,126 images, 76.7 MB): every card of the live set (and of the saved run's set when
  Continue would resume another one), every token, Ruby, gift and Choose One branch (they live in no set's pool,
  so all of them are in), hero portraits and powers, hero and minion skins, equipment, quests, Ancients, the
  runes the gated sets can offer (plus any rune file with no live definition, e.g. an archived rune an old board
  may carry), FX images and portrait-frame art, every public image the UI names (boards, frames, plates, tier
  stars, medallions, milestone discs, buttons, cursors), rank crests, mode tiles and the UI chrome.
- **Behind the gate** (`idle` lane, still decoded and held): the cards and runes that belong ONLY to sets no one
  can play in this build (set 1 and set 3's own cards and runes, which the Collection's set picker can show:
  257 card images + 71 rune images, 20.5 MB). Sounds stream after the art, as before (the `audio` lane drains after the gate's lanes).
- **Every image is now decoded and held for the session.** #1866's `idle` lane only fetched (no decode, no held
  Image) to save memory; the owner chose zero pop-in, and the steady-state cost turned out to be nil (below).
- **The pipe runs 32 wide while the gate is up** (`setConcurrency`, new on the asset queue): nothing is on
  screen to protect, only throughput. It goes back to 6 when the menu opens. (On HTTP/1.1 the browser caps a
  host at 6 anyway; Netlify serves HTTP/2.)
- The R-PRESENT-25 placeholder (dark stand-in, then a fade) stays, as a safety net only.

## How it was measured

The #1866 harness: the prod build (`npm run build:web`) behind a Node server that behaves like Netlify (reads
`_headers`, ETag + 304s, gzip) with one shared bandwidth cap and per-request latency; headless Chrome over CDP at
1920×1080; a fresh profile for cold, the same profile again for warm. Scenario: boot → gate → title → Play →
tutorial prompt → skip → hero select → first shop (6 s) → Refresh → Refresh → Compendium (Tab). The per-frame
probe counts, for every visible image, frames where it is in the DOM but has no pixels ("blank"), and frames
where the safety-net placeholder hides it ("placeholder"). Memory = Windows private bytes per Chrome process
after a forced GC.

## Numbers

**Gate time** (from the moment the bundle starts running; add the bundle's own download, ~1-3 s, for the time
from navigation):

| line | cold (first visit) | warm (returning, same profile) |
|---|---|---|
| 4 Mbps / 120 ms | **161 s** | **4.3 s** |
| 10 Mbps / 60 ms | **66 s** | **4.4 s** (4.8 s with the pipe 16 wide) |
| 50 Mbps / 40 ms | **17 s** | **4.2 s** |

Cold is bandwidth-bound (76.7 MB of images: 61 s is the theoretical floor at 10 Mbps, 12 s at 50 Mbps). Warm
reads everything from the disk cache (0 bytes over the wire, 5 revalidations, all of them non-art) and is
DECODE-bound: ~1,100 images at ~3.8 ms each; widening the pipe from 16 to 32 moved it only 4.8 → 4.4 s. It is
above the hoped-for 1-2 s. The only big lever left is smaller art files (see follow-ups).

**Pop-in after the gate** (every scenario above, cold and warm, 4 / 10 / 50 Mbps): **0 blank frames** on the
title, hero select, first shop, both rolls and the Compendium, for card art, card chrome and every other image.
Every card's art was ready on its first frame (4/4 in the first shop, 8/8 per roll, 14/14 in the Compendium).
One residual: the FIRST spell card of a session hides its spell frame behind the placeholder for 1-2 frames
(`spell-frame-arch.webp`, the frame image a CSS rule also loads; the new element reports `complete` a microtask
late, so the element check errs on the safe side). It is present in #1866 as well, is never a blank frame, and
happens once.

**Collection** (a separate cold 10 Mbps run): 0 blank frames.

**Memory** (Windows private bytes, after 2 forced GCs):

| | #1866 (no gate) | this PR |
|---|---|---|
| renderer, steady state (50 Mbps, 120 s into the first game, everything loaded in both builds) | 754 MB | **671 MB** |
| whole Chrome (renderer + GPU + browser + utility), same point | 1,645 MB | **1,584 MB** |
| renderer, 30 s after the menu opens (10 Mbps) | 468 MB (still loading) | 845-900 MB |

Decoding and holding everything costs nothing at steady state: Chrome keeps decoded pixels under its own
decode-cache budget either way, and the held Images keep ~97 MB of encoded bytes in both builds. The transient
peak right after the gate is higher because this build has everything in hand at once, while #1866 was still
fetching. The GPU process (~800 MB steady, ~1.2 GB at the busiest moment) is the same in both builds: it is the
headless D3D11 context plus Pixi, not art. The owner's rough ceiling of ~1.2 GB for the whole process is
exceeded by the GPU process in this headless harness with or without the gate; the renderer, which is what the
gate touches, is 671 MB.

## Not done / follow-ups

- **Cold gate at 4 Mbps is 2 min 41 s.** That is the price of "load everything" on a slow line. The biggest lever
  is art size, which is the owner's call (art files were not touched): #1866 measured card art re-encoded at
  512 px / quality 75 as -41% bytes, and 384 px / quality 82 as -51%, on a 40-card sample. Either would cut the
  cold gate roughly in half and the warm gate somewhat (fewer pixels to decode).
- **Warm gate ~4.3 s** (decode-bound). Smaller art helps here too. Skipping the decode on warm visits would make
  it near-instant but would reintroduce the decode-at-first-paint cost the gate exists to remove.
- **The first-spell frame's 1-2 hidden frames** (above).
- **Discover** was not driven by the harness; its cards come from the run's pool, which is entirely in the gate
  (pinned by `preloadPlan.test.ts`).
- A resumed run on a set that is not live is covered only when the save is found at boot (it is: `savedRun`).
- Oracle: R-PRESENT-26 (foundation.ts), quoting the owner. R-PRESENT-25's "everything else (fetch-only)" updated.
