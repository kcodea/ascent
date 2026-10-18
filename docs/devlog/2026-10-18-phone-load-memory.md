# 2026-10-18 — Phones: a short loading gate, small art, bounded memory

Owner report: "the iPhone crashes a lot" (installed to the Home Screen). He approved relaxing the "load everything,
no pop-in" rule (R-PRESENT-26) **on phones / touch only**, because the alternative was crashes and an 83 s first load.
The new rule is R-PRESENT-34. Desktop is unchanged.

## Who is a phone (`packages/ui/src/phoneArt.ts`)

`LITE_ART` is true on any iOS device (iPhone / iPod / iPad, plus iPadOS reporting a Mac UA with touch), or on a
coarse pointer whose screen's shorter side is under 600 CSS px. `?art=lite|full` or `localStorage['ascent.artMode']`
overrides it. Fixed for the session.

## What a phone does differently

1. **Short gate.** `preloadBootArt` gates only the title + menu art (24 items, was 1,247). Everything else queues
   after the gate opens (`startBackgroundArt`): hero portraits + powers, then the shop chrome and the live set's tier
   1-2 cards, then the rest. Other sets' cards are never prefetched on a phone.
2. **Small art.** `apps/web/phoneArtPlugin.ts` (production build only) writes a downscaled copy beside each big image
   and bakes the list into `__PHONE_ART__`: card / minion / spell / rune / quest / power / rank art 256 px, heroes /
   skins / Ancients 384, mode tiles 1024, card frames + shop buttons 512, the two 3840 px boards 1920. 1,480 copies,
   27.9 MB (originals 89.5 MB). The art lookups (`indexArt` in `art.ts`, `publicArt()` for public frames,
   `applyPhoneCssArt` for the `--board` vars) return the copy on a phone. A public file named in any stylesheet gets
   no copy (a CSS url() cannot switch per device). A test fails if UI code builds a raw `BASE_URL + frames/` path.
3. **Bounded image memory.** The preloader's decoded-image hold is an LRU capped at 48 MB on a phone
   (`imageKeep.ts`); its background lanes only FETCH (warm the HTTP cache), they do not decode.
4. **Audio.** The real surprise. Measured with Chrome's memory-infra dump, at the shop:
   - the ~520-clip SFX bank decoded to AudioBuffers was ~400 MB. A phone now decodes only the core bank (top-level
     clips + ceremony); card / hero / FX clips are fetched and decode on first play, in a 64 MB LRU.
   - the **six pre-warmed reverb ConvolverNodes were ~440 MB** (about 70 MB each for the 1.5-4.2 s tails). A phone
     pre-warms none and pools at most one per impulse.
5. **Pixi.** No MSAA on a phone (`PIXI_ANTIALIAS`; four full-screen canvases are up at the menu), the FX image library
   decodes on first use instead of all at boot, and `GCSystem` unloads idle GPU textures after 15 s (desktop 60 s).

## Code-splitting (all builds)

DevMenu (every tuner + the rules registry the Rulebook triage reads), EditorOverlay, BugScenarioPanel and
BalancePanel are now `lazy()` behind `import.meta.env.DEV`. They were static imports whose JSX folded away, but their
side-effectful modules stayed in the player chunk. Patch Notes loads on first open. Main JS 9.47 MB (2.5 MB gz) to
6.89 MB (1.84 MB gz).

## Measured (prod build, headless Chrome, iPhone landscape 844x390 @3x, iOS UA, touch, 4x CPU, 9 Mbps / 60 ms)

| | before | after |
|---|---|---|
| time to menu | 82.5 s | 6.3 s |
| bytes before menu | 85.2 MB (1,321 requests) | 5.3 MB (97 requests) |
| everything fetched by the end of a shop + combat | 128.7 MB | 59.6 MB |
| peak JS heap | 47 MB | 43 MB |
| renderer process, shop / combat | 1,180 / 1,301 MB | 444 / 473 MB |
| decoded images in the renderer (cc image memory + image cache), shop | 635 MB | 63 MB |
| WebGL in the renderer, shop | 231 MB | 71 MB |
| all processes, peak | 2,573 MB | 1,567 MB |
| preloader-held decoded images | all (~1.7 GB if every image decodes) | 16 images, 41 MB |

The GPU-process number (SwiftShader software GL in headless) is not a good proxy for iOS. It also grows ~3 MB/s while
the title's CSS animations run and stops when they are paused, even though they animate only transform/opacity.
That looks headless-specific and is not attributed to the game.

Desktop (1920x1080, no throttle): gate 1,247 items before and after, 86.5 vs 86.8 MB, 5.1 vs 5.4 s (noise), zero
`.art-pending` cards in the shop or in combat, same process memory.

## Not done / follow-ups

- **The three "junk" images are not junk.** `banana.png` and `chatgpt-image-sep-25-2026-09-40-24-am.png` are King
  Oona's banana + splat sheets (`fx/defs/oona-banana.json`, `heroBanana/heroBananaTextures.ts`, the Banana Cannon
  attack); `test-orb.png` is a layer of the live spell aim line (`fx/defs/spell-target.json`). Left in place. They
  could be renamed and re-encoded (1024 px PNG sheets, 0.7-1.5 MB each) in their own PR.
- Desktop also pre-warms the ~440 MB of reverb convolvers. Worth an owner call: shorter tails, or no pre-warm.
- The itch zip: the copies add ~1,480 files to `dist/` (5,037 total, was 3,554). The zip was already far over itch's
  1,000-file cap and is deprioritised. `ASCENT_PHONE_ART=0` builds without the copies. The art-tree budget test
  (`artNoRedundantMasters`) is unaffected: nothing is committed.
- Pre-existing 404s on both builds: `assets/medallions/{rally,shout,echo,sell,watcher}.webp` (a relative medallion
  path resolved against `/assets/`).
- Cosmetic plate skins (`frames/plates/`) are not in the preload list on any device (the derivation in
  `apps/web/publicArt.ts` does not see the `${PLATE_DIR}${id}` template). Kept as is so the desktop gate is unchanged.
