# 2026-10-09 — Compendium polish: painted frame, title bar, rail menu, and a real performance fix

Owner ask: "this stands out as left behind and unkept ... make a massive polish pass". Three rounds the same day.

## Look (round 2, after "it looks super mobile app-y" on a Gem-pill first pass)

- **Frame.** The window is framed in the Runeforge's painted gold frame (`runeforgebg2.webp`), re-cut once into a
  9-slice: `apps/web/public/frames/compendium-frame.webp` (parchment cleared to alpha, the four centre ornaments
  swapped for plain rail so the rails stretch along their length only), plus the top and foot crests as their own
  crops (`compendium-crest.webp`, `compendium-crest-foot.webp`). Corners and crests keep their painted size at any
  window size. It is a `border-image` on `.book::after`, a static overlay above the content (pointer-events none).
- **Header.** A three-part title bar: Rules / Glossary / Guides as menu tabs on the left (the lit one underlined by the
  cards' painted `name-divider.webp`), the name and live subtitle centred under the crest, search / card size / close
  on the right.
- **Tier row.** Squared Gem-plate chips; a picked tier or Gilded turns solid gold; Gilded wears the painted crown
  (`frames/gilded.webp`).
- **Left menu.** A lobby-rail panel: rows are rail seats with a round portrait of real card art, ringed in the tribe
  colour, under "Minions" and "Library" captions. Portrait pick is deterministic per set: a tribe's highest-tier minion,
  the set's top spell, and so on (`railArt` in MinionBook.tsx).
- Every colour is a `--ui-*` theme token. The Compendium's CSS moved out of `styles.css` into `compendium.css`.

## Performance (round 3, "performance is horrible still")

Profiled with CPU profiles and Chrome traces (headful GPU Chrome, real wheel gestures, 240 Hz):

1. **GPU raster during scroll** was the felt lag: each plated card carries ~10 large images with drop-shadow filters
   (a 7.2 px-blurred 1059x1427 frame copy, a 1254 px art master, the gilded-name SVG filter). As one big scroll layer,
   tiles re-rastered those filters piecemeal as they scrolled in (~11 ms GPU per frame). **Fix:** each mounted card is
   its own compositor layer (`will-change: transform` on `.book-cell`), so it rasters once and scrolling only moves
   layers.
2. **Mounting all 144 cards** on open, tab switch and every keystroke (the card-name fitter forces a layout per batch:
   ~100 ms). **Fix:** `bookLazy.tsx`: cells mount only within two screens of the scroller's viewport
   (IntersectionObserver rooted on the scroller), first screen eager, the rest at 2 per frame; pending cells hold the
   row height. Runes and the Guides tab use the same thing. A memoised `BookCardCell` builds each card's view and hover
   previews once. Search filters read `useDeferredValue`. Glossary clickable terms build only while the glossary is up
   (cached per set + tribe scope).
3. **`backdrop-filter` blur** on the overlay re-ran every frame the game behind animated. Replaced by a deeper scrim.

Prod before -> after: open 160 -> 19 ms (cold 381 -> 54), back to all minions 153 -> 24 ms, search keystroke median
62 -> 12 ms (worst 214 -> 21), wheel fling frames over 20 ms 50 -> 1, hover sweep 8 -> 0. Dev server similar
(open 220 -> 25 ms, keystroke 86 -> 17 ms).

## Follow-up (not approved yet)

The one remaining >20 ms frame per cold fling is the GPU rastering a just-mounted card for the first time (its own blur
and drop-shadow filters). Fixing it means changing the shared Card paint everywhere, which would also speed up the shop
and hand. Proposed separately.
