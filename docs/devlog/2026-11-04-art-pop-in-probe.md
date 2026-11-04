# Art pop-in, phase 1: a probe, a tripwire, and why returning players saw it (2026-11-04)

Owner: "i am seeing a ton of art pop in. how do we resolve that once and for all where we simply never have to worry
about it again?" and "I'm seeing it on both 5173 and the netlify. It's really bad for me for some reason." Rules
R-PERF-ART-STAYS-FRESH-01, R-PERF-ART-PLAN-COMPLETE-01, R-PERF-ART-MASKS-HELD-01.

## The tools

- `?popin=1` (or the Dev menu's Art Pop-in Probe) turns on `packages/ui/src/popIn.ts`, a lazy chunk. It logs every image
  that was not ready when it reached the screen, with why. `window.__popin.text()` or the panel's Copy button is the report.
- `npm run perf:popin` serves a `VITE_PERF_BENCH=1` build and walks it: title, ten menu pages, hero select, shop rounds,
  fights, end screen. Bundled headless shell, throwaway profile. `--headers expire:<s>` plays a returning player.
- Do not use Playwright's `page.route` for this: routing turns the HTTP cache off. The first numbers here were wrong for
  that reason (every miss looked like a network fetch). External hosts are blocked with `--host-resolver-rules` instead.

## Root cause 1: expired copies, the big one

A new `<img>` reuses Blink's in-memory copy only while that copy is FRESH. Public art was `max-age=3600` plus
`stale-while-revalidate`. A player returning more than an hour later got every public image from disk, already expired.
SWR let that stand: the load succeeded, the re-check ran in the background, and the in-memory copy stayed expired for the
whole session. So every new element for that URL (frames, stat icons, shop buttons, medallions) went back to the disk and
painted blank until it landed: p50 54 ms on an idle machine, 147 ms on a busy one. A fresh visit never shows it, which is why earlier passes missed it,
and why it is worst for someone who plays daily.

Fix: a day of freshness and no SWR on images. An expired file is re-checked once, in the boot gate (a 304), and the copy is
then fresh for the session. Six paths had no rule at all (`/backdrops`, `/menu`, `/currency`, `/vista-*`, `/transition-*`,
and `/m1`, every phone copy) and sent `max-age=0, must-revalidate` from Netlify. A test now fails on an image with no rule.

Note the odd part: `no-cache` (the dev server) does NOT behave like an expired copy. Same-session mounts reused it.

## Root cause 2: art outside the plan

Portrait frame skins (58), emotes (26), pings, the Versus arena and all card plates (249 files) never reached the pipe.
Those are exactly what a player who owns cosmetics sees, so the owner's account is the worst case. Frames, emotes and pings
join the gate. Plates ride `idle` behind it (most belong to other people) and the worn plate is raised at run start.
`artPlanCoverage.test.ts` walks the disk: every image file is planned or exempt with a reason.

## Root cause 3: masks

CSS masks load in CORS mode, and Blink's memory cache keeps ONE entry per URL. The medallions are drawn both as a plain
`<img>` and as a mask, so each use evicted the other and every mount went to disk. An unloaded mask hides what it masks.

The first fix held a CORS copy under the same URL, and the A/B caught it making things WORSE: warm pop-ins 14 to 32, since
the held copy now fought the plain one. Masks are written `<file>?mask`, a URL of their own, held on desktop
(`requestMaskArt`). A test fails on a mask URL without it. Costs one more small fetch per mask file.

Plates are held without `decode()` (`requestHeldArtList`). Decoding them behind the gate tripled the compositor's decodes in
a first measurement, for pixels it dropped again before anyone drew them.

## Numbers

Prod bench build, headless shell, 1920 x 1080, 2 shop rounds, 20 ms added latency, same probe both sides, nothing else
running. "Pop-ins" are images on screen that were not ready at mount. One run each, so small counts are not precise.

| Visit | Before | After | Before, by cause | After, by cause |
|---|---|---|---|---|
| First ever (cold) | 5 | 2 | 4 disk, 1 redecode | 2 redecode |
| Second, within the hour (warm) | 14 | 0 | 12 disk, 2 redecode | none |
| Returning, copies expired | 155 | 0 | 154 disk, 1 redecode | none |

Late image fetches after the gate: 49 to 0 warm, 126 to 0 returning.

Costs: gate 1,481 to 1,571 items (6.4 s to 6.7 s returning, 7.5 s to 8.0 s cold, on localhost). A cold desktop visit
downloads 157 MB to 194 MB, nearly all of it plates, behind the gate. GPU raster trace (SwiftShader, 2560 x 1440, cold,
no probe): 82 to 86 decodes, worst 65 to 69 ms, images decoded twice 3 to 6.

Numbers taken while anything else ran were thrown away: under load the same trace read 306 decodes, and 288 ms worst.


## What this does not explain

5173 is NOT explained. The dev server sends `no-cache`, and `no-cache` did not reproduce the expired-copy storm: 11 pop-ins
on one round there (measured before `?mask`, mostly masks; not re-run after). Netlify's cause does not apply to it, so
whatever makes 5173 bad is still unknown and may also be part of what the owner sees on Netlify.

The compositor is the other unknown. The trace shows no checker imaging and few repeat decodes, but SwiftShader is not a real
GPU or its budget, and nothing here can see a blank tile on a moving layer. The owner's report from `?popin=1` on his own
machine is the next input.

A tab left open past a day goes back to popping: the copies expire mid-session. Not fixed here.
