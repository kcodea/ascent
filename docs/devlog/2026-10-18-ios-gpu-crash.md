# 2026-10-18: iPhone crash on the mode home, round three (GPU memory) + phone diagnostics

Owner report: a recent iPhone (14 or newer), Home Screen app, landscape, live build main 79e57dd59 (with #2160 menu
layers and #2163 phone audio). Pressing Play still crashed. The on-device crash log read: last step "title view modes" at
3.4 s, audio 0 MB, images 15 (35.5 MB), "WebGL 4 of 7", no heartbeat after it. So it died within 5 s of the mode home,
with audio and decoded images ruled out. Rule: R-TOUCH-GPU-MEMORY-01.

## What "WebGL 4 of 7" meant

`crashLog.ts` counted canvases that ever got a WebGL context (7) and how many of those were still in the DOM (4). A
canvas outside the DOM keeps its context, so neither number was "alive". The log now records `ga` (contexts not lost,
in the page or not) with their drawing-buffer MB, plus running animations, `will-change` and filter element counts
(steps only, never the heartbeat), whether the stage is zoomed, and the diagnostics switches in force.

## Measured (prod build, `npm run perf:phone-menus`, iPhone 932x430 @3x)

The script now also prints each screen's live WebGL contexts and their drawing buffers (w x h x 4 x 2), and the total.
New screens: `gate` (doors shut, crystal waiting) and `hero` (real hero select, through the crystal). Layers MB is the
WebKit model from the menu-crash pass (each layer at its stage size x 9 x 4 bytes).

| screen | before: layers / WebGL alive / buffers / total | after |
|---|---|---|
| title | 140 MB / 6 / 56 MB / 196 MB | 28 MB / 0 / 0 / 28 MB |
| mode home | 196 / 6 / 56 / **252** | 31 / 0 / 0 / **31** |
| Versus | 295 / 6 / 56 / 351 | 59 / 0 / 0 / 59 |
| Practice | 292 / 6 / 56 / 348 | 58 / 0 / 0 / 58 |
| Career | 209 / 6 / 56 / 264 | 59 / 0 / 0 / 59 |
| Compendium | 587 / 6 / 56 / 643 | 101 / 0 / 0 / 101 |
| gate | 346 / 7 / 63 / 409 | 346 / 3 / 14 / 360 |
| hero select | 188 / 6 / 56 / 243 | 188 / 2 / 7 / 194 |

(The "alive" counts include a 0 x 0 probe context Pixi makes once; it holds no buffer.) `perf:phone-play --full` walks
title, Play, the tile, Yes, the crystal and hero select: no WebGL context until Yes, 4 made by hero select (gate, its
probe, main board layer, Pixi probe), decoded images on the mode home 31 MB (was 35.5: the 1280-wide backdrop).

The six contexts before were: the main board layer, the under canvas (alive though never in the page), the above canvas,
the Discover layer (warmed into an off-screen div at the title), the wipe (warmed at the title) and the probe, each main
one at resolution 2. Layers: `#stage` alone was 87 MB on every screen (a full design-size layer at 3x3), the Play tile kept
a finished `menu-rise` entrance as a 23 MB layer, and the bobbing logo and tile swirls kept others.

## Fix (phone path only: `PHONE_GPU` = `LITE_ART`; desktop reads none of it)

`packages/ui/src/phoneDiag.ts` holds the policy and the switches.

1. Lazy, short-lived contexts. `PixiFxLayer` takes `gameplay` (hero select or a run) and `inRun`. On a phone the main
   board layer attaches at hero select (its shader warm-up runs there); the under / above slots and the Discover layer
   come up when the run starts; leaving to the menus detaches all of them, releases the wipe (`wipeFx.release`, new) and
   resets the Discover warm-up. `Game.tsx` no longer warms Discover or the wipe at the title on a phone, the def
   pre-warm no longer creates the slot canvases there, and the ranked confirmation no longer starts the gate's layer
   (the gate starts it as it plays, and frees it after, as before). Cost: the shader warm-up once per run, and the very
   first under / above effect of a run can still be dropped while its canvas comes up.
2. Every Pixi `app.init` goes through `phonePixiOptions`: resolution 1.5 (x stage scale for stage-sized renderers),
   `powerPreference: 'low-power'`, no antialias, no preserved buffer, and for transparent overlays a WebGL2 context made
   with `depth: false` (Pixi asked for none, so every canvas got the browser default depth buffer). Stencil stays.
3. Menu layers (touchUi.css, `html[data-touch-ui][data-phone-gpu]`): the logo bob and the tile swirls stop, the two
   account nudges rest at their reduced-motion opacity, every other loop on a menu plays one cycle, no menu element keeps
   a `will-change`, and the `menu-rise` entrances fill `backwards` (same look, layer freed when done).
4. CSS `zoom` on the menus (stage.ts `setStageMenuZoom`, called from Game.tsx): a zoomed stage lays its layers out at
   their on-screen size, so the model's 87 MB `#stage` layer becomes a 14 MB one. Measured control boxes match the
   transform within 1 to 2 px on the title and mode home. Hero select and the run keep the transform: their drag and FX
   maths measure the screen, and how Safari reports geometry under zoom is not proven there yet.
5. The menu backdrop plates (`hall-soft`, `hall`) get a 1280-wide phone copy.

## Phone diagnostics (Settings, phones only)

A Home Screen app takes no query and keeps its own storage, so the switches are toggles in Settings > Phone
diagnostics, saved in localStorage (`ascent.phonediag.v1`), read once at launch (the section has a Reload button and
says what is on now and after Reload). `?phonediag=nofx,res1` / `?phonediag=0` works in a browser too. Every crash-log
step records them.

- `nofx` No effect canvases: no Pixi app is ever made (the game plays bare).
- `res1` Effects at resolution 1.
- `noanim` No menu animations: every menu animation and transition at zero length.
- `zoom` Flat stage everywhere: CSS zoom in hero select and the run too.
- `nozoom` Old stage on menus: back to the transform on the menus (to bisect step 4).
- `litebd` Lite menu backdrop: no painted plate.

The crash readout still shows by itself in a standalone phone app on the first load after a crash, and the mode home
now leaves a trail: `title view modes`, `... painted`, `+1 s`, `+2.5 s`, `+4 s`, `backdrop loaded modes`, plus
`gate fx created`, `fx canvases up / down` and `pixi init <layer>` each time.

## Not confirmed / follow-ups

- Chrome stands in for WebKit: the layer model and the zoom win are estimates. If it still crashes, the new trail and
  the switches are the next step (try `nofx`, then `nozoom` vs `zoom`).
- The gate (346 MB modelled) and hero select (188 MB) keep the transform and their big layers (doors with
  `will-change`, the full-stage `.heroselect`). Zoom there is the `zoom` switch until Safari's geometry is checked.
- `--shot` screenshots from headless Chrome hung on this machine; the zoom check used control boxes (`--rects`) instead.
