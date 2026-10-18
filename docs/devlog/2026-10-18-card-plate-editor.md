# 2026-10-18 — The Card Plate Editor (dev tuner, per plate, Save to the repo)

Owner (2026-10-18): *"would it be possible to create a tuner that would allow me to select each Card Plate and individually
edit the card plates frame and interior size and positioning?"*, then *"i need to be able to do it on an individual card
plate level, not a tuner that affects all cards"*, and *"save then. after i save do i let you know and you merge the
changes?"*

## How the owner uses it

1. Dev menu (🛠️) → **Card Plate Editor**.
2. Pick a plate in the dropdown. The preview card wears it; so does every card on screen already wearing it.
3. **Frame**: Size, Left / right, Up / down. **Interior**: Width, Height, Left / right, Up / down. Live.
4. **Save plate** writes that plate's numbers into `packages/ui/src/cardPlate/plate-tuning.json` and rebuilds its
   Collection picture. **Reset** drops every unsaved edit.
5. Tell Claude "ship the plates": commit, PR, merge. Then the usual web zip (no function deploy: nothing in the catalog
   changes).

## What shipped

- **Two new knobs** on every plate: `frameY` (`--plate-frame-y`, moves the frame or single image, its glow and its
  interior down) and `interiorX` (`--plate-interior-x`, the interior's own sideways nudge under the frame). Absent = 0,
  so no existing plate moves.
- **`plate-tuning.json`** (static import in `cardPlateLook.ts`): per-plate saved values laid over `SETTINGS`. It ships, so
  a saved plate reaches players once committed. Keys: `artScale` (the frame size), `frameX`, `frameY`, `interiorSx`,
  `interiorSy`, `interiorX`, `interiorY`. The interior numbers stay the fit on the UNSCALED frame; `scaledInterior`
  derives the rest (it now scales `interiorX` too).
- **Live edits**: a small store in `cardPlateLook.ts` (`setLivePlateTuning`, `clearLivePlateTuning`). `useCardPlateLook`
  subscribes with `useSyncExternalStore` and swaps in the edited look for that plate only. Nothing writes the store
  outside the dev editor, so in production every lookup misses and the context value passes through.
- **`apps/web/plateTuningPlugin.ts`** (`apply: 'serve'`): POST `/__plates/tuning`. `planPlateTuningWrite` is the whole
  validation surface (id pattern, the seven knobs all present and in range, interior name pattern), unit-tested. It
  rebuilds the Collection picture FIRST (`scripts/build-card-plate.mjs`, which gained `--interior-x`), then writes the
  JSON; the write reloads the page through the import graph. A single-image plate has no picture to rebuild.
- **`CardPlateEditorTuner.tsx`**: a schema tuner (`TunerPanel`): the plate picker is a `select`, the preview card is the
  `readout`, Save is an action. Registered in DevMenu and `tunerAll`.

## Checked

- In the browser pane: the panel opens, Goop's preview shows its frame and interior, the Up / down slider moved both
  live, and a Save of Goop's own numbers wrote the JSON and rebuilt a byte-identical Collection picture (then reverted).

## Same PR: Brown plates move to Dark Brown

Owner (2026-10-18): *"replace all cards' brown interior (except the standard card plate) with the dark brown interior and
remove darkening from them"*. Topaz, Blossom, Spirit Carving, Iridescent, Porcelain, Smooth Iridescent, Honey and Goop
now sit on Dark Brown with `darken: false`; their Collection pictures were rebuilt. Dark Brown has Brown's exact outline
(same size, identical alpha), so every fit holds. Brown stays the DEFAULT interior for a new plate unless the owner says
otherwise. `cardPlate.test.tsx` pins it (no plate cosmetic is left on Brown); the paint-order test moved to Magma, the
one layered plate that still has a darkening to order.
