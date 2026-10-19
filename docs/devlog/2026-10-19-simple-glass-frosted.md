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

Then, from a dragging screenshot: *"THIS is the effect i want on it at all times"*. Dragged over the beige board the glass read rgb(140, 118, 120); in the hand it sits over the purple tray and read purple. The layer is now that colour at 65% (`rgba(140, 118, 120, 0.65)`) with the 40px blur, so it holds the dragging look over any backdrop.

## Follow-up (same day): the blur in hand hover and Inspect

Owner: *"the blur effect is not happening when hovering, when in hand, when inspecting"*, and *"why were we able to add
blur to the card when moving it? but not when it was hovered?"*. A `backdrop-filter` only sees what is painted inside its
nearest *backdrop root*, and any ancestor with a `filter`, an `opacity` below 1 or a `backdrop-filter` of its own is one.
Checked in the browser pane with black/white stripes behind the card, toggling one property at a time:

- **Hand hover**: `.row.hand .card:hover` adds `filter: drop-shadow(...)` (the lift shadow). With it the stripes showed
  sharp through the glass; without it, blurred. A hovered glass card now drops that filter and puts the same shadow on its
  `.plate-frame`, exactly like the drag fix. At rest in the hand the glass already blurred.
- **Inspect**: `.inspect-ov` carried the dim and `backdrop-filter: blur(8px)` itself. Both now live on `.inspect-ov::before`
  (`z-index: -1`, behind the card), which looks the same and stops the overlay being a backdrop root. The overlay's
  `fadein` and the card's `inspectpop` both fade opacity, which also cut the glass off for their 0.14-0.18 s (the "delayed
  colour change"), so with a glass card only the `::before` fades and the card pops on scale alone (`inspectpop-glass`).
- The `overflow: hidden` on `#root` / `#stage` was a false lead (one test seemed to fix it; a clean retest did not).

Oracle rule: **R-PLATE-02**.

## Follow-up (same day): darker, lighter-touch glass

Owner, happy with the blur everywhere: *"make the grey layer less warm and more dark grey, then reduce its opacity to
15%. reduce the blur by 20px"*. Layer `rgba(140, 118, 120, 0.65)` to a neutral dark grey `rgba(58, 60, 64, 0.15)`; blur
40px to 20px.

Then *"reduce the blur to 13px. increase the grey opacity to 25%"*: `rgba(58, 60, 64, 0.25)` over a 13px blur.

Then *"reduce the blur to 10px"*: blur 13px to 10px.

Then *"increase grey to 35%"*: `rgba(58, 60, 64, 0.35)`.

Then *"reduce blur to 7px"*: blur 10px to 7px.

Then *"the only thing not working still is the hovering a c ard in shop, the blur and grey isnt applied"*. The hover
reveal (`.cardref`) wears its white haze as a `filter` on the whole popup and slides in with an opacity fade, both
backdrop roots. With a glass card the haze moves onto the frame and the side panels (`.cardref-inner > :not(.card)`),
and the slide-in is transform-only (`cardrefin-glass`). The cast preview (`.castprev`) gets the same haze move; its
fades and tunable max opacity still cut the glass off while they run.

Then *"theres a brief mooment that it takes before it loads the blur when hovering"*. Sampled per frame: the reveal's
card mounts with `.popin` (`cardpop`, an opacity fade, ~0.15 s) and the glass `<img>` itself sat at `art-pending`
(opacity 0 until its load event, ~0.33 s on the dev server, which re-checks every file). A glass card now pops on motion
alone (`cardpop-glass` / `handpop-glass`; a delayed token pop keeps its fade so it stays invisible while waiting), and
the glass ignores `art-pending` (it paints none of the image's pixels; its mask shows nothing until the image is there).
After: no ancestor below 1 opacity or with a filter from the first sampled frame.
