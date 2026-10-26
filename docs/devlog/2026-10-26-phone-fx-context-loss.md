# 2026-10-26 — Phones: effects survive a lost WebGL context; lighter paint in the run (R-PHONE-FX-CTX-01, R-PHONE-RUN-PAINT-01)

**Owner (2026-10-26, iPhone, build 792caa34a):** "Lots of animations aren't showing on phone, and general performance is
abysmal. How do we optimize this??" The diagnostics shipped first (#2332, perf log; #2335, `?phonebench=1`). This PR
contains the fixes that could be confirmed offline.

## 1. A lost WebGL context no longer kills the effects (R-PHONE-FX-CTX-01)

**Root cause, confirmed in Chromium as an iPhone (prod build).** Fire three particle defs at a point, force a context
loss on the board FX canvas (`WEBGL_lose_context.loseContext()`), let Pixi restore it, then fire again. Before the loss
the burst draws its sparks, flash core and ring. After the restore only the ring draws (a Graphics redrawn every frame).
Every sprite texture made with `renderer.generateTexture` exists only on the GPU, and the restore brings it back empty:

- the controller's spark / glow / shard / bubble / rim / pulse / vein / wisp / crescent textures
- the def shapes (`fx/shapeTextures.ts`, cached per renderer)
- the wipe's and the gate's textures

Pixi re-uploads only textures with a CPU source. Every effect built on those textures drew nothing until a reload. iOS
loses WebGL contexts under GPU memory pressure and when a Home Screen app goes to the background, so this fits "lots of
animations aren't showing". The owner's crash readout shows 5 contexts alive of 7 made. The perf log now counts loss
and restore events, so the next reports will say how often it happens.

**Fix.** `watchContextLoss(app, site, onRecover)` (pixiAppSafety.ts) calls `onRecover` once per loss. It fires on the
restore, or 2.5 s after the loss when the page is visible and the context is still lost (a browser may never restore
it). A teardown's own loss is ignored, as before.

- The board overlay (main, under, above) and the Discover layer `scheduleRebuild('WebGL context lost')`: a new
  Application, fresh textures, the shader warm-up again, every live play retired. The main render is skipped while its
  context is lost, so no render faults pile up.
- The wipe and the gate get `recover()`: drop what is in flight and free the app. The next use builds a fresh one;
  desktop rebuilds the kept gate at once.

Measured after the fix: the burst after a lose + restore draws its sparks and flash again (captures in the PR description). One
rebuild per loss. `fx:ctx rebuilt` is a new perf counter.

## 2. Lighter paint in the run, phones only (R-PHONE-RUN-PAINT-01)

From a CSS audit of what costs paint every frame in the shop and combat (no looping paint-property keyframes were found;
the costs are elsewhere):

- **The charge glyph** (the last 20 s of every shop) rewrote `--charge` every frame. That changes its mask, which
  repaints the whole glyph under two big drop-shadow glows. A 120 Hz iPhone paid it 120 times a second. A phone now
  writes it about 30 times a second (`PHONE_CHARGE_PAINT_MS`). The fill moves about a layout px a frame, so it looks the
  same. Desktop still paints every frame.
- **The Gold pill**: its backdrop blur goes on phones. Its fill is 92-94% opaque, so the blur barely shows, but WebKit
  re-blurs whenever anything behind it moves.
- **The Inspect scrim**: on phones a plain darker tint (0.74) replaces the full-screen backdrop blur. **A small look
  change; the owner can veto it by reverting one line in touchUi.css.**
- **The lobby rail**: drops its permanent `will-change` (two tall layers held for the run). Its slide is a transition,
  which promotes the rail on its own while it slides.

## Tried and NOT shipped

- **The falling gate's dust, portal and edge bloom on phones.** They are desktop-only ("phones keep no extra FX
  context"). Enabling them on a phone means one more WebGL context for the run, and the Chromium 4x bench showed more
  frames over 33 ms in transitions (21-23 to 44-47) and combat (8-12 to 18-22). The coordinator's guidance is fewer
  contexts, so they stay off. The FX ledger now counts each skip (`gate:land` / `gate:portal`, `phone-gate`), so the
  owner's reports show how often they are skipped. Bringing them back needs an owner call. The cheapest way would be to
  draw them on the board overlay while the gate is down.

## Read against the owner's crash readout (for the next steps)

- **WebGL contexts are ~12 MB in total** (4 x 1311x603 + Pixi's 0x0 test context): the board overlay, its under and
  above slots, the Discover layer (detached between Discover opens, kept warm by design), and the probe. They are not
  the memory problem. Merging them into one canvas means splitting DOM z-order (under the cards / over the cards / over
  the modals): a refactor with layering risk, not done here.
- **"images 225 (206.2 MB)" counts every `<img>` element.** A frame or badge drawn by 14 cards counts 14 times, but the
  browser decodes a URL once. #2335 adds the de-duplicated figure (`iu` / `ium`, `imgUniqueMb`). Read that before acting
  on images. In Chromium as an iPhone, round 1 is 37.7 MB per element, and the first-fight peak of the run walk is 108 MB.
- **Audio, ~76 MB**: music already streams through `HTMLAudioElement`. The SFX are mono, at most 48 kHz, with the core
  bank resident and a 40 MB LRU for on-demand clips (R-TOUCH-AUDIO-QUALITY-01; a test checks a busy game's working set
  fits it). Shrinking it trades sound quality or misses for memory. That needs an owner call.
- **The gate art** (2455 x 1381) is about the iPhone's own device width (the gate covers the screen at DPR 3), so a
  smaller copy would visibly soften it.

## Verification

See the PR: typecheck, lint, test, build:web, `phone:webkit`, the context-loss captures, and the 4x bench table.
