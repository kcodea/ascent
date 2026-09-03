# Boot preload: click to begin, then EVERYTHING loads before the menu

**Owner report 2026-09-03:** *"despite you saying that the game preloads every single asset, we do see
significant slowdowns the moment something occurs for the first time. I want this gone. I'd rather wait for
2 minutes for the game to preload everything than experience those pop-in hitches."*

This reverses the 2026-08-25 ruling (a fixed 3.5 s splash whose bar was a pure CSS fill, gating on nothing).
Owner answers on the two forks: **click to begin, then load** (so audio can decode during the bar) and
**self-host the fonts and gate on them**.

## What was actually preloaded before (the audit)

| Thing | Before 2026-09-03 |
|---|---|
| Boot gate | a 3.5 s timer; the art preload ran but was never awaited |
| Images | minions + heroes + powers + 8 public files. **Not** spells (115), quests (116), runes (293), equipment, mode tiles, the 87 `public/frames` images (card plates, oval frames, End Turn / hero power buttons — 13 MB), the damage burst, the opponent rune slots… |
| Image decode | `decode()` fire-and-forget; the gate was `onload` (bytes cached, bitmap not decoded) |
| Audio | all 88 clips decoded lazily in one burst after the first click anywhere — the first sound of each kind could beat its buffer, and the burst landed as play began |
| FX | canvas + shader links + shape bakes only once the board (later: the hero picker) mounted; the documented 0.6–0.8 s first-play freeze; imported/committed art textures decoded + uploaded on their first fire |
| Fonts | Google Fonts, `display=swap` — fallback text reflowing as each face arrived; the exe ran on fallback fonts offline |

## What ships

- **`bootLoader.ts`** — four weighted stages (`images .55 / audio .25 / fx .15 / fonts .05`), every item with
  its own timeout so boot is always bounded; images/fonts/fx start on mount, audio starts on the unlock click
  (the audio context needs a gesture). The splash bar (`--boot-p`) shows the weighted mean. Menu opens when
  the loader finishes AND ≥ 3.5 s have passed since the click.
- **Images:** `ALL_IMAGE_URLS` = every art glob + `PUBLIC_ASSETS`, a GENERATED manifest of `apps/web/public/`
  (`npm run assets:manifest`; `publicAssets.test.ts` fails when it is stale). `preloadAllArt` now awaits
  `decode()` per image.
- **Fonts:** `@fontsource/outfit|nunito-sans|cinzel-decorative` imported in `main.tsx`; `preloadFonts` loads
  every face in `FONT_FACES` (test pins it to the weights styles.css uses and to the imports). Cinzel
  Decorative is cut in 400/700/900 — the stylesheet's 600 resolves to 700, as it always did on Google Fonts.
- **Audio:** `unlockAudio()` (from the gesture) + `preloadAllSamples(onProgress)`; `loadSample` returns its
  in-flight promise so the boot and a lazy first play never double-load.
- **FX:** `PixiFxLayer` now mounts in `Boot`, permanently (a detach throws compiled programs away with the
  context). `warmFx()` waits for `ensureDefsReady`, then for every wanted slot's link queue to drain, then
  decodes every shape/art texture (`awaitShapeTextures`) and the Echo skull (`pixiFx.warmBuiltinTextures`)
  and `bind`s each on every live renderer so the first draw never uploads.
- **Hitch log:** `perfMonitor.recordLongTask` keeps every long task ≥ 50 ms with phase/wave/marks
  (`perfMonitor.hitches()`, `window.__perf.hitches()`; DEV also `console.warn`s). This is how "no first-use
  hitches" is verified after a session, rather than assumed.
- **DEV escape:** `?skipboot` skips the gate (never in a production build).

## Still first-use by design (known, measured next)

- The Discover overlay's own FX canvas (`discoverFx`) attaches when the overlay first opens — its own GL
  context. Candidate for a boot attach if the hitch log shows it.
- "CRIT!" text textures are keyed by size/colour and rasterised on first use per key.
- React's first render of each screen (JIT). Not an asset; measured by the hitch log, not preloadable.
