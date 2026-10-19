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

## Follow-up (same day): one light grey everywhere

Owner, comparing screenshots: hovering showed a light grey, the hand and Inspect looked dark, and dragging darker still.
The drag was my own deeper flat tint (blur off, `rgba(14, 18, 28, 0.72)`); Inspect is dark because its backdrop is dimmed.
Owner: *"i like the lighter grey hover effect more and want to get it closer to that at all times. maybe increase the
amount of blur a bit"*. Now: a frosted grey layer `rgba(138, 144, 156, 0.6)` (strong enough that what is behind only
colours it), blur 6px to 10px, and the drag state keeps the same grey (only the blur is dropped).

Then *"can you reduce the opacity of the light grey by 60% and increase the blur by 50%"*: grey 0.6 to 0.24, blur 10px to 15px.

Then *"can you have it apply the blur while moving ?"*: the drag layer (`.dragcard`) carries a `filter: drop-shadow`, which
makes it a backdrop root, so a blur inside it sees nothing behind the card. A dragged GLASS card (`.dragcard:has(.plate-frosted)`)
now drops that filter and puts the same drop-shadow on its `.plate-frame` instead, so the blur stays on while it moves.
Cost: one re-blur per frame for that card while dragged.

Then *"reduce the opacity of the light grey to 0 for now. i just want to see the blur"* and *"dramatically increase the blur amount"*: grey 0, blur 40px, while the owner judges the blur. Found on the way: Inspect's overlay (`.inspect-ov`) has its own `backdrop-filter: blur(8px)`, which makes it a backdrop root, so inside Inspect the glass can only show the overlay's dark tint (which fades in: the "delayed colour change"), never the board behind it.

Then, from a dragging screenshot: *"THIS is the effect i want on it at all times"*. Dragged over the beige board the glass read rgb(140, 118, 120); in the hand it sits over the purple tray and read purple. The layer is now that colour at 65% () with the 40px blur, so it holds the dragging look over any backdrop.
