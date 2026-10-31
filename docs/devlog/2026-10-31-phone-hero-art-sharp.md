# Phone hero art per display slot (R-PHONE-HERO-SHARP-01)

Owner 2026-10-31: "Hero art in mobile is blurry".

**Cause.** Phones load the build's 384 px copy of every hero / skin portrait (`PHONE_ASSET_CAPS.heroes`). Measured on a
production build (Playwright WebKit as an iPhone 852 x 393 @3x, Chromium as a Pixel 915 x 412 @2.625, real page scale):

| slot | iPhone drawn | Pixel drawn | served before | image px per device px before -> after |
|---|---|---|---|---|
| lobby rail face (x8) | 59 | 54 | 384 | 6.6 -> 2.7 (160 thumb) |
| hero select card | 261 | 338 | 384 | 1.47 / 1.14 -> 1.96 / 1.52 |
| your portrait | 307 | 282 | 384 | 1.25 / 1.36 -> 1.67 / 1.82 |
| combat foe portrait | 296 | 275 | 384 | 1.30 / 1.40 -> 1.73 / 1.87 |
| hero pick ceremony | 632 | 580 | 384 | 0.61 / 0.66 -> 0.81 / 0.88 |
| hero power button | 128 | 117 | 256 | 2.0 / 2.2 (unchanged) |

No `transform: scale` upscaling, `image-rendering` or filter softens the hero `<img>`s themselves.

**Fix.** Per-slot variants. Big slots go through `useSharpArt` / `<SharpImg>` (the 512 px master once decoded through the
art pipe's `now` lane; the 384 copy until then, never empty). The lobby rail uses a new 160 px thumbnail
(`assets/t1/`, written by `phoneArtPlugin` for `PHONE_THUMB_CAPS`, ~12 KB each, 2.7 MB in dist) and fetches each seat's
master ahead of the fight (`warmSharpArt`). Everything else keeps the 384 copy. Desktop unchanged.

**Memory (phone path).** On-screen hero art decoded: hero select 1.7 -> 3.0 MB, shop 5.3 -> 2.0 MB, combat 6.1 -> 3.3 MB.
The whole-page image total (`perf:phone-run --interact`) is unchanged within noise (iPhone shop 134 -> 133 MB, Pixel
134 -> 134 MB; CI cap 140) because the bounded decoded keep (LITE_KEEP_BYTES, 48 MB) dominates it.

**Open.** The ceremony portrait is still drawn larger than the 512 px master (0.81x). The source masters in
`Ascent Art/Heroes` are 1254 px; a bigger bundled hero size is an art-wiring call for the owner.
