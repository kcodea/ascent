# 2026-10-23: iPhone hero-pick crash, why no crash report arrived, and hardening the next one

Owner, real iPhone (15/16/17 Pro class): *"the phone just crashed twice from trying to play. i got to hero select and
then it crashed both times after selecting a hero, when the animation should play"*. And no row reached
`public.client_crash_reports`. Later the same day, on a new Netlify build that includes #2242: *"okay just tested on
the new build and i did not crash"*. So this PR is hardening only. Rule: **R-TOUCH-CRASH-REPORT-02**.

## Why no crash report arrived

The phone ran **v0.1.0 0aeaa366b (#2211, 2026-10-21)**, read off its own crash readout. That build predates #2241 (the
uploader) and #2242 (the hero-pick memory fix). Its crash log recorded the crashes in localStorage, but it had no code
to send them. The readout's last step was `art stream 15.5 s, images 9 (3.6 MB), WebGL 3 alive (2 in page) of 4
made, 7.2 MB`, with no heartbeat after it, so the page died within 5 s of the background art stream's last update,
i.e. at the hero pick. The JS-visible memory was small; on that build hero select and the run were still on the
stage TRANSFORM, where the iOS layer model peaked at 455-651 MB through the ceremony and launch curtain (#2242's table).

Checked in code for a build that has the uploader:

- **requestIdleCallback**: Safari has none; `scheduleCrashReportUpload` already fell back to running from its delay
  timer. Now pinned by a test that deletes it (`crashReportIos.test.ts`).
- **Detection on iPhone**: `LITE_ART` is true for any `iPhone|iPod|iPad` UA (or `?art=full` / `ascent.artMode=full`
  overrides it; no UI sets that). Fine.
- **Clean marking**: `pagehide` / hidden mark the session clean; a page restored from the back/forward cache was left
  marked clean. Now `pageshow` with `persisted` marks it live again.
- **The insert**: the columns the client sends (`last_step, ua, standalone, build, session_key, payload`) match the
  migration's column grant exactly; supabase-js inserts with `return=minimal`, so the missing select policy is not a
  problem. Verified against the live table with the new REST route: one test row, `last_step
  'claudebot-telemetry-test'`, **id 4** (delete it when convenient).
- **Weak spots fixed**: a failing or hung client insert (auth refresh, lock, network) spent the try with no second
  route, and a load that started offline spent one of its 3 tries. Now:
  - the same row goes once more in the same try as a plain PostgREST insert with only the publishable key
    (`anonRestInsert` in remoteBoards.ts, role anon, `keepalive` under 60 KB);
  - an offline load waits for the `online` event before it spends a try.

## Crash-log steps the next crash will name

- `hero picked` (+ `painted`, `+1 s`, `+2.5 s`, `+4 s`), `hero ceremony materializing`, `hero ceremony ready`
- `launch cover`, `launch covered`, `run built`, `launch reveal`, `first shop` (+ its trail)
- `gate coverIn`, `gate combat`, `gate coverOut`, `gate revealOut`

These are LIGHT steps (`crumbLight`): no per-element style scan, only the running animations, so they are safe
mid-animation. Every step now also carries:

- `ly` / `ln`: a composited-layer estimate, the elements with a running animation or `will-change` at their backing
  size (on-screen box x DPR^2 x 4, clipped to the window; under a transformed stage, their full stage size). A model.
- `gs`: each live WebGL context's drawing-buffer size.
- `xf`: the stage was on a transform (`z` already meant zoom).

So a crash report now says which stage path ran on that iPhone, which the #2242 zoom probe left unknown.

## Measured: did anything since #2242 raise the phone peak?

`npm run perf:phone-run -- --interact` (prod build, headless Chrome as an iPhone 852x393 @3x, standalone; the script
now also samples +0.25 s / +1 s / +2 s / +4 s after the pick and takes a turn-1 Discover so `--interact` works on every
hero). iOS est = layers + WebGL buffers + textures + decoded images + audio + 2D canvases, MB.

| step | #2242 (2026-10-22) | main ec1a71ef7 | this branch |
|---|---|---|---|
| hero select | 110 | 110 | 111 |
| picked +0.25 s | | 139 | 141 |
| picked +1 s (ceremony) | 134 | 143 | 145 |
| picked +4 s | 143 | 143 | 145 |
| Start Game +0.7 s (curtain) | 116 | 116 | 118 |
| Start Game +2.5 s | 116 | 116 | 116 |
| first shop | 198 | 235 | 236 |
| after a buy + play | 198 | 230 | 231 |
| End Turn, gate down | 204 | 238 | 240 |
| first fight | 227 | 252 | 219 |
| **peak** | **227** | **252** | **240** |

The branch matches main within run noise (the fight sample lands on a different FX frame each run). The hero pick
itself did not move. The run is about 30 MB higher than #2242, all of it decoded images (97 to 126-128 MB):

- **#2266 (the return trip vista)**: `vista-flat.webp` 2560x1440 (14.1 MB, a CSS background) and `vista-doormask.png`
  2560x1440 (14.1 MB) decoded on Shop mount and held for the run. Not changed here: R-PRESENT-36 (the vista rule from
  #2266, owner "part of the image disappears and returns") requires the mask decoded before a trip can use it. A phone
  copy at about 1280 px (3.5 MB each) would keep that rule and save about 21 MB; both files are named in a stylesheet,
  so the phone-art plugin skips them today. Owner call.
- **#2236 (the falling gate)**: `transition-gate.webp` 12.9 MB and `transition-poster.webp` 5 MB are counted as CSS
  backgrounds, but the parked gate is `visibility: hidden` on phones (#2242), so WebKit should not decode them until
  the gate falls; the gate's own full-screen layer (11.5 MB) shows only while it falls. Unchanged from #2242.
- **#2252 (hand-summon flight) and #2259 (opponent hand)**: no layer or image of theirs appears in the top lists at
  the shop, the gate or the first fight. No measurable cost.

WebGL at the hero pick: 3 alive of 5 made. Pixi's own shared test context (0x0, alive, no buffer), the board FX layer
(1278x590), the ceremony layer (1278x590); lost: the ranked gate's FX canvas and Pixi's support probe. At the shop:
6 alive (5 x 1278x590 + the test context), 29 MB of buffers, the same as #2242. None is idle or duplicated, so none
was trimmed (cutting the ceremony's would change the ceremony).

On the transform path (`--flags gamexf`, what a phone whose Safari fails the zoom probe would run) main still reads
457 MB at the pick and 587 MB as the gate falls (full-stage layers at 87 MB each). The owner's phone did not crash on
the new build, so either it passes the zoom probe or that path survives; the new `xf` / `z` field in the next report
will say which.

## Verification

- `crashReportIos.test.ts` (no requestIdleCallback, idle + cancel, offline then online, hung client then REST,
  REST only, back/forward cache, light step fields), `phoneRunHardening.test.ts` (the new steps are wired).
- Desktop pixel-identical: 1920x1080, mouse, seeded Math.random + crypto, animations finished/paused, canvases hidden;
  hero select, the ceremony and the first shop, main vs branch: 0 differing pixels (each build was also run twice; one
  run of each showed sub-pixel raster noise on looping elements that the rerun did not).
- typecheck, lint, test, build:web: see the PR.
