# 2026-10-26 — Phones measure themselves: frames per scene, WebGL state, an FX ledger (R-PHONE-PERFLOG-01)

**Owner (2026-10-26, iPhone 15/16/17 Pro class, live Netlify build 792caa34a):** "Lots of animations aren't showing on
phone, and general performance is abysmal. How do we optimize this??"

We have no Mac (no Safari Web Inspector), and Windows emulation is not an iPhone: Playwright WebKit composites in
software (a moving div costs ~330 ms a frame there) and Chromium's 4x throttle is only a proxy. So the phone now
measures itself and sends the numbers home. This ships first, on its own, so the owner can play 2-3 rounds on the next
Netlify build and we get real numbers before guessing further.

## What it records (`packages/ui/src/phonePerfLog.ts`)

On every phone (`LITE_ART`, the crash log's gate) and on any browser with `?perflog=1`:

- **Frames per scene.** The perf monitor already samples every frame on every load (its frame ring). Once a second, when
  it closes its bucket, the log reads the frames the ring gained and files each one under a scene: `menu`, `heroselect`,
  `shop`, `drag` (a card held past the drag threshold), `combat`, `runeforge`, `gameover`, `transition` (the monitor's
  2 s warm-up after each phase start), `other`. Per scene: frames, seconds, p50 / p95 / p99 / worst (from a 0.5 ms
  histogram), frames over 16.7 / 33.3 / 50 / 100 ms, long tasks (Chromium only: Safari reports none, see
  `device.longTasksSupported`). Frames whose interval spans a hidden page are skipped. Plus a timeline of 10 s windows
  (main scene, p95, worst, frames over budget, effects asked / missed). No new rAF loop, no per-frame work.
- **State, every 15 s** (and on each WebGL loss / restore): WebGL contexts made / in the page / alive / lost while still
  in the page, loss and restore EVENTS, drawing-buffer MB and sizes; every live Pixi renderer (label, logical size,
  resolution, backing size, context lost?); decoded `<img>` MB; the JS heap (Chromium only); running animations; DOM
  nodes; the measured display refresh (30 Hz = Low Power Mode); Reduce Motion; the diagnostics switches. Peaks are kept.
- **The FX ledger (`fxLedger.ts`).** Every effect asked for against the ones that started, and the reason for the rest:
  `no-renderer`, `ctx-lost` (played on a renderer whose context is lost: draws nothing), `not-ready` (a hand-written
  `pixiFx` / `discoverFx` effect before its controller had a renderer), `defs-unavailable` (`canPlayDefs()` said no),
  `budget` (deduped), `no-def`, `empty`, `offscreen` (every anchor off the screen), `phone-gate`, plus the degrades
  `thinned` / `degraded` and the aux-canvas `waiting`. Instrumented at `playDef` (the one chokepoint for authored defs),
  `canPlayDefs`, and by wrapping the hand-written effect methods of both controllers ONLY when the log is on.
- **Pixi apps** register through `followStage` (every `Application` the UI makes already calls it).

## Where it goes

- `?perflog=1` shows a small readout top right (remembered until `?perflog=0`): the scene table, the WebGL and Pixi lines,
  images / heap, FX asked / drew / missed with the worst misses, and **Send** (upload now).
- **Uploads into the existing `client_crash_reports` table. No migration**: the row is `last_step = 'perf-report'`,
  `session_key = 'perf:<id>@<start ms>'`, the log in `payload` (kept under 46 KB; the table caps 64 KB). It uploads when the
  page goes hidden (switching apps, closing; a keepalive REST insert) if 300+ new frames were recorded, at most 4 times
  a session, each the whole session so far (`payload.session.seq`). The session is also stored in localStorage every
  15 s, so a session that never sent (a crash, a kill in the background) goes on the next load
  (`payload.sentNextLoad`). Desktop without the flag records, wraps, stores and sends nothing
  (`phonePerfLogDesktop.test.ts`).

### Reading them

Crash queries should now exclude these rows (`where last_step <> 'perf-report'`). The newest perf rows:

```
npx --yes supabase@2.120.0 db query --linked --project-ref zcwhbejpqcdcfdpfxeza "select id, created_at, build, session_key, (payload->'session'->>'durS') as secs, payload->'device'->>'hz' as hz, payload->'scenes'->'shop' as shop, payload->'scenes'->'combat' as combat, payload->'scenes'->'drag' as drag, payload->'state'->'gl' as gl, payload->'fx'->'totals' as fx from public.client_crash_reports where last_step = 'perf-report' order by created_at desc limit 10"
```

One whole row: `select jsonb_pretty(payload) from public.client_crash_reports where id = <id>`. Take the highest `seq`
per `session_key`.

## First offline finding (feeds PR B)

Chromium as an iPhone (prod bench build): fire three particle defs at a point, force a WebGL context loss on the board
FX canvas (`WEBGL_lose_context`), let Pixi restore it, fire again. Before the loss the burst draws its sparks, flash
core and ring; after the restore only the ring (a Graphics redrawn every frame) draws. Every texture made with
`renderer.generateTexture` (the controller's spark / glow / shard textures, the def shapes in `shapeTextures.ts`, the
gate / wipe / ceremony textures) lives only on the GPU, and a restored context comes back with them empty, for the
rest of the session. iOS loses WebGL contexts under GPU memory pressure and when a Home Screen app is backgrounded, so
"animations aren't showing" fits. The log's `gl lost` / `restored` events will say whether the owner's phone hits it.
