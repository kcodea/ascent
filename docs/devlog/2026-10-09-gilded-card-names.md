# 2026-10-09 — Gilded card names (true inner strokes via an SVG filter)

**Owner ask:** amp up card names: gradient letters, bold, a bigger drop shadow. Dialled in on a standalone
preview page, the spec became, from the outside in:

| Layer | Value |
|---|---|
| Drop shadow | heavy but tight, spread 185% of the base |
| Outer stroke (outside the letter edge) | `#775a33`, 0.005em |
| Inner stroke 1 (inside, against the edge) | `#c7ad88`, 0.020em |
| Inner stroke 2 (inside) | `#f4e9d4`, 0.030em |
| Fill | gradient `#fbfcf7` → `#decca9` |
| Font | Belwe Bold wanted; **Fraunces 900 (SOFT 100)** stands in until a licensed Belwe file exists |

## Why a filter, not CSS strokes

`-webkit-text-stroke` always straddles the glyph edge (half in, half out), and `paint-order` / `mask-clip: text`
can't confine it to the inside in Chromium (tested). My first build stacked centred strokes, which pushes every
ring OUTSIDE the letter. The owner had been explicit that the two light strokes are inner, so that was wrong.

`cardNameFilter.ts` instead takes the gradient-filled letters (`background-clip: text`) and builds everything
from their alpha. A `feMorphology dilate` gives the outer stroke, the letter itself gives inner stroke 1, one
`erode` gives inner stroke 2, a deeper erode masks the gradient core, and a blurred dilate gives the shadow.
`text-shadow` is off on the name: on gradient-clipped text it paints OVER the gradient.

## Sizing

Filter radii are pixels, but the rings are em. `CardName` (Card.tsx) reads its computed font size once in a
layout effect and gets a filter for that size, bucketed to 0.5px and built once into a hidden `<svg>` in
`stageHost()`. A Compendium page of 144 names shared ONE filter. CSS applies it only through
`.drawer .cn { filter: var(--cn-filter) }`.

The name size is `0.094 × --ccw` (`--cn-size`). It first shipped at `0.122` to match the preview, and the owner
cut it 30% after seeing it in game, then raised it 10% (`0.0854` → `0.094`) (the old Outfit name was `0.1056`). The gold diamond divider between the name
and the rules text (`.namediv`, owner art) is `0.84 × --ccw` wide, also cut 20% from the first pass. It shows only
on cards with rules text. Inline padding plus an equal negative margin widens the filter's
bounding box so a short name's halo isn't cropped, without moving layout.

## One line, always

Names never wrap (owner 2026-10-09). `.cn` is `white-space: nowrap; width: max-content` and centres itself in
the drawer. A name may run to `CARD_NAME_MAX_W` (1.06) × the text column, which is just inside the plate's gold
trim. A wider one shrinks its own font via `--cn-fit`. `trackCardName` batches every name that needs fitting into ONE
microtask, doing all reads and then all writes (one layout, still before paint), and re-fits on window resize
(`--ccw` follows the window height) and on `fonts` `loadingdone`. A ResizeObserver was avoided on purpose:
writing the fit inside its callback resizes the observed box and trips the RO loop error. The gradient lives on
an inline `.cn-t` span with `box-decoration-break: clone`, so even a wrapped name would get a gradient per line.
Two names were shortened for it: Coppercoat Spellsword → **Spellsword**, Malphas, Lord of Want → **Lord of Want**
(ids unchanged).

## Divider + spell text

The divider carries a static `drop-shadow`. Spell cards (shop spells and rubies, `.spellcard`) lift their whole text
panel by `--spell-txt-lift` (0.05 × --ccw). The backbox is a card-body silhouette that lives INSIDE the drawer,
so it is pushed back down by the same amount or it would ride up off the plate. The Compendium's in-flow drawer
(`.book-grid`) ignores the absolute `top`, so it gets the same lift as `margin-top`, plus a smaller minion lift
(`--book-minion-txt-lift`, 0.04).

## Known limits

- feMorphology uses a square kernel, so stroke corners are very slightly squared (only visible when enlarged).
- Rings stay proportional under transforms (hover zoom), because the filter scales with the transform. A
  `--ccw` change without a window resize (the dev Card Text tuner) re-fits on the next resize or remount.
- Swap the font by changing the one `--font-cardname` token once Belwe (ITC/Monotype, needs an app/web
  embedding licence) is available.
