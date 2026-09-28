# 2026-09-28: the Collection screen + the crate opening (Pixi) + its tuner

Owner ask 2026-09-28: "make the collection screen separate and build a AAA animation for crate opening, with pixi
and everything. put a tuner in for it to test it". Oracle R-PROG-COLLECTION-01. Builds on the crates slice
(`2026-09-28-progression-crates.md`, PR #1779).

## What was built

- **The Collection is its own screen** (`packages/ui/src/progression/CollectionScreen.tsx` + `collection.css`), a
  ladder page with the menu sidebar. Reached from a new **Collection** plaque on the title (with the sealed count),
  a sidebar plaque, and the Account Level card on your Career (which now opens the screen over the Career, so Back
  returns there). Store: `showCollection` / `openCollection` / `closeCollection`, `MenuDest` `'collection'`, and
  `PAGES_CLOSED` + the replay snapshot know the flag. The plaques show once crates are live, and always in DEV.
  Sections: Crates (a big crate with the count, the next crate's name, Open, Open all), Titles (equip, unchanged
  logic), Coming soon (the categories still switched off, as quiet pills), and the guest save prompt. The old
  modal `CollectionPanel.tsx` is gone.
- **The crate theatre** (`CrateOpener.tsx`, rewritten): a full-stage overlay portalled into `stageHost()`, used by
  the Collection and the post-game "Crate earned" row. Flow: sealed -> anticipation (on the click, while the
  request is in flight; holds for a slow server, "Still opening" after 2.5 s) -> charge -> burst -> reveal ->
  settled. Failure winds down to "Could not open the crate. Try again."; an empty pool says so. A click or any key
  skips to the settled reveal (before the answer, it lands settled the moment the answer arrives). Reduced motion:
  no Pixi, a 240 ms fade. Open all chains the queue with a 700 ms pause and ends on a "You found" summary.
- **The Pixi layer** (`crateFx/`): `crateScene.ts` is the whole scene as a plain Pixi scene graph (headless
  testable): a procedural crate (layered Graphics body + lid, gold bands, a gem that takes the rarity colour),
  motes, pulled charge particles, the lid blowing off, flash, staggered shockwave rings, sparks, debris, a rarity
  aura, god rays, rising motes. `crateFxPixi.ts` owns the Application (full-theatre canvas, resolution x
  `stageScale()`), the ticker (runs only while there is work), the textures (a canvas radial gradient for the glow,
  so the upscaled aura has no banding) and the art loader. **Crate art drops in through one config key,
  `crateArt`** (a URL; empty = the drawn crate).
- **The tuner** (DEV hub, "Crate opening", `CrateFxTuner.tsx` + `crateFxConfig.ts`): every beat per rarity, the
  particle counts, crate + screen shake, flash, rings, rays, colours, six sound cues (clip, gain, offset, window),
  reverb, the art URL. Buttons: Play Common / Rare / Epic / Legendary (practice crates in the real theatre with a
  local fake answer, never the server), Replay, Slow server, Failure, Open all (4), and Speed 1x / 0.5x / 0.25x
  (never saved). Values persist to localStorage in DEV only; production plays `CRATE_FX_DEFAULTS`. Loads and
  writes are clamped (`clampCrateFxValue`).
- **Sound**: existing clips only, six new mixer faders (`crateHum` ... `crateSting`). Hum = `turncharge`, charge =
  `runeselectimplosion`, burst = `rebornshatter` (a crack, not a boom), reveal = the sparkle clip's glitter tail,
  stamp = `equipmentsheen`, Legendary sting = `triplereward`.

## The shipped timeline (ms from the branch: the answer is in AND the 700 ms anticipation minimum is over)

| Rarity | Burst at | Reveal at | Settled (buttons) | Click to settled |
|---|---|---|---|---|
| Common | 300 | 458 | 1478 | ~2.2 s |
| Rare | 550 | 743 | 1963 | ~2.7 s |
| Epic | 950 | 1195 | 2615 | ~3.3 s |
| Legendary | 1500 | 1815 | 3635 | ~4.3 s |

## Non-obvious

- **StrictMode stranded the opening in dev.** The first cut bumped the opening's generation on unmount, and the
  dev double mount runs that cleanup right after `autoOpen` has fired the request, so the answer was dropped and the
  crate sat in "Opening" forever. The in-flight request now checks `live` (which the remount sets back), and a
  remounted theatre brings its fresh Pixi controller up to the opening's current phase. Regression test in
  `Crates.test.tsx`.
- **A box-sized canvas clipped the burst** into a hard rectangle. The canvas covers the whole theatre now, and the
  DOM (name, plate, buttons) is placed around the same centre the scene uses.
- Measuring on the prod build needs the practice crates, which are DEV only: `VITE_CRATE_PREVIEW=1` bakes them into
  a prod bundle for profiling (docs/performance.md).

## Wanted from the owner

- Crate art (drop in via `crateArt`); optionally a dedicated crate hum, burst and Legendary sting.
