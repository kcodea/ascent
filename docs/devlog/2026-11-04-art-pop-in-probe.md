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
painted blank until it landed: p50 147 ms, measured. A fresh visit never shows it, which is why earlier passes missed it,
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

CSS masks load in CORS mode, which cannot share the pipe's plain copy, and nothing held them. They went back to disk on
every mount, and an unloaded mask hides what it masks. Desktop now holds a CORS copy (`requestMaskArt`).

## Numbers

RESULTS_TABLE

## What this does not explain

Headless shows a clean first visit on the dev server too (11 pop-ins, 1 round, mostly masks), so 5173's "a ton" is NOT
reproduced. Candidates left, none proven: the compositor. With GPU raster on SwiftShader at 2560 x 1440 the trace shows
images decoded again within two rounds (worst 288 ms, software decode) and no checker-imaging events, but that is not a real
GPU or its budget. The owner's report from `?popin=1` on his own machine is the next input.
