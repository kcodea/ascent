# 2026-10-19 — Simple Glass gets a frosted-glass interior

Owner (2026-10-19): *"would it be possible to create a card interior for the blown glass card frame that would actually
just be clear and blurs all imagery behind it?"*, then *"yes simple glass, we can have the frosted blur interior slightly
darkened too to help readability"*.

## What shipped

- **`frosted`** (cardPlateLook.ts): a look flag. The interior `<img>` keeps its box, so the fit, the fade-in and the Card
  Plate Editor's sliders all work unchanged, but paints none of its pixels (`object-position` throws the image out of
  its box). What shows is `backdrop-filter: blur(6px)` of whatever is behind the card plus an `rgba(8, 11, 18, 0.38)` tint,
  both masked to the interior's outline (`--plate-frost-mask`, the same image).
- **`interiors/frosted.webp`**: Simple Black's exact outline (same size), filled with a cool frosted gradient. In game only
  its shape is used; its colours are what the Collection picture shows, since a pre-built picture cannot blur.
- Simple Glass moves to the `frosted` interior, keeping its fit.

## Performance

`backdrop-filter` re-blurs whatever is behind the element whenever it repaints, so the rule is STATIC (nothing animates),
the radius is modest (6px), and a DRAGGED card (`.dragcard`) drops the blur for a deeper flat tint. The drag layer has a
`filter` anyway, which makes it a backdrop root where the blur would see nothing. Any ancestor with a `filter` or
`opacity < 1` does the same, so in those states the interior reads as the flat tint. Not profiled on a full hand of
glass-plated cards; worth a look on a phone.
