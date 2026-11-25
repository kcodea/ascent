# Pack shop art: prompts and templates

Written 2026-11-25 for the owner to paste into ChatGPT. Same method as `Reference Art/Backdrop prompt.txt`: attach a
STYLE reference and a LAYOUT template, describe only the part that changes. Files beside this one:

- `pack-template.png` (1024 x 1536): the pack's exact silhouette and where each part goes.
- `pack-style-reference.png`: the Common wrapper, as the finish to match.
- `shop-layout-template-16x9.png` (1920 x 1080): where the UI, the packs, the counter edge and the hand sit.

What the game needs from every pack image, so it drops in with no hand fixing:

- 1024 x 1536, transparent background, the pack filling the box x 43..981, y 75..1477 (939 x 1403).
- The dashed tear line straight across at y = 231 (one ninth of the way down the pack). The game cuts the image there.
- Flat, straight on, no perspective, no shadow, no glow outside the foil: the game adds its own light, tilt and gloss.

---

## 1. A card pack (the standard prompt)

```
ATTACH 2 IMAGES: (1) pack-style-reference.png  (2) pack-template.png

I am making a sealed foil card pack for my fantasy collectible card game, ASCENT. I have attached two images:

IMAGE 1 - STYLE REFERENCE: an existing pack from the game. Match its art style, finish and level of detail exactly.

IMAGE 2 - LAYOUT TEMPLATE: a diagram, not artwork. The grey shape is the exact silhouette and size the pack must have.
The labelled dashed boxes show where each part of the design goes.

Create ONE card pack wrapper, seen flat and straight on.

=== LAYOUT RULES (follow exactly) ===
- Output a portrait 2:3 image, 1024 x 1536, with a fully TRANSPARENT background.
- The pack must fill the same box as the grey shape in the template: same width, same height, same position, centred.
  Do not make it smaller, larger, tilted or rotated. The four edges are straight and vertical / horizontal.
- TOP: a crimped, heat-sealed foil strip with fine vertical ridges, exactly as tall as the pink band in the template.
  No key artwork in it: only a row of small ornaments (diamonds or stars).
- TEAR LINE: one straight dashed line running the full width of the pack, exactly where the template's dashed pink
  line is. Nothing important crosses it.
- EMBLEM: one large emblem centred in the blue ring, inside a heraldic frame, as in the reference.
- GAME LOGO: the word ASCENT in the same gold serif lettering as the reference, with "COLLECTIBLE CARD GAME" in small
  capitals under it, inside the green box.
- PACK NAME: the pack's name in the same style as the reference, centred inside the amber box.
- BOTTOM: a crimped foil edge with fine vertical ridges, as tall as the lower pink band.
- Behind the emblem and logo: one continuous painted scene filling the body of the pack from the tear line to the
  bottom crimp.

=== STYLE RULES ===
- Match Image 1: painted, slightly stylised, polished fantasy game art; clean shapes, soft painterly shading.
- One dominant colour family for the whole pack (given below), with lighter and darker tones of it, plus gold for the
  lettering and trim.
- Evenly lit and flat: NO glossy highlights, NO reflections, NO lens flares, NO drop shadow, NO glow around the pack,
  NO wrinkles or creases, NO perspective or 3D tilt. (The game adds light, gloss and movement itself.)
- Crisp, clean silhouette with nothing sticking out past the pack's edges.

=== DO NOT INCLUDE ===
A background, a table, hands, a second pack, loose cards, price tags, stickers, barcodes, watermarks, signatures, or any
marking from the template (no pink bands, coloured boxes, dashed guide lines or labels).

=== THE PACK (this is the part I change each time) ===
Pack name: [e.g. "Epic Card Pack", "Dragonfire Pack", "Frostbound Pack"]
Colour family: [e.g. royal purple and violet, ember orange and deep red, glacier teal and white]
Emblem: [e.g. an open spellbook with a flame, a dragon's head in profile, a snowflake crown]
Scene behind it: [e.g. floating castles among clouds, a volcano at dusk, a frozen citadel under aurora]
Mood: [e.g. regal and mystical, fierce and blazing, cold and serene]
Extra notes: [optional, e.g. "darker overall", "more gold trim", "simpler scene"]
```

Follow-up, in the same chat, for the foil shine mask (the game uses it to place the holo sheen):

```
Now make a second image for the SAME pack, same size and position: a black and white mask. White where the foil should
catch a rainbow sheen (the emblem's metal, the logo lettering, the trim, any gems), black everywhere else, soft grey
edges. No colour, no text other than the lettering's own shapes, same 1024 x 1536 frame, the pack in exactly the same
place.
```

## 2. A booster box (ten packs)

```
ATTACH 1 IMAGE: pack-style-reference.png

Create a sealed BOOSTER BOX for my fantasy card game ASCENT, in the same art style and finish as the attached pack.
- Portrait 2:3 image, 1024 x 1536, fully transparent background, the box centred and filling about 90% of the width.
- Seen straight on from the front, flat, no perspective: a rectangular card box, slightly wider than a single pack,
  with a visible lid seam across the upper third and a tear tab in the middle of that seam.
- Front: the same emblem and ASCENT logo as the matching pack, larger, with "BOOSTER BOX - 10 PACKS" in small gold
  capitals near the bottom.
- Evenly lit and flat: no gloss, no reflections, no drop shadow, no glow, no hands, no background, no loose packs.
Box for: [pack name]   Colour family: [same as the pack]
```

## 3. The shop background, in layers (for parallax)

Three images that stack. The game slides each one by a different amount as the pointer moves, which gives depth. Make the
far layer first, then ask for the others in the same chat so they match.

```
ATTACH 1 IMAGE: shop-layout-template-16x9.png  (and Backdrop style reference.png if you want the board's finish)

I am making the background of the card pack shop in my fantasy game ASCENT. The attached template is a diagram, not
artwork: it shows where the game's own interface will sit.

Create LAYER 1 of 3, THE BACK WALL: the far wall of a small, magical card shop, seen straight on at eye level.

=== LAYOUT RULES (follow exactly) ===
- Landscape 16:9, as large as possible, same framing as the template. Paint about 6% extra on every side beyond the
  frame (the game slides this layer), with nothing important in that margin.
- Inside the pink area (where the packs stand): plain, fairly dark and soft. A gentle pool of light is fine. No
  objects, no bright spots, no hard edges. It is hidden behind the packs.
- The blue band along the top: calm and darker, no detail (tabs and the wallet sit there).
- Left and right wings: this is where the detail goes. Tall shelves of sealed packs and boxes receding into shadow,
  hanging lanterns, a ladder, banners. Keep them roughly symmetrical and darker than the centre.
- Below the amber dashed line: leave it EMPTY and dark. The counter is a separate layer.
- Even, soft lighting from above the centre, falling off toward the edges. A soft vignette. No hard borders.

=== STYLE RULES ===
- Painted, slightly stylised, polished fantasy game art; clean shapes, soft painterly shading.
- Muted, mid-to-dark values: deep navy, indigo and warm brown wood, with small warm lantern lights. Avoid large areas
  of saturated gold or bright blue (the packs and the wallet must stand out against it).
- Slightly soft focus, as if a few metres away.

=== DO NOT INCLUDE ===
Readable text, logos, characters, people, creatures, hands, cards facing the viewer, a counter, or any marking from
the template.

=== THIS SHOP (the part I change each time) ===
Setting: [e.g. a cosy wizard's curio shop, a dwarven vault of treasures, a night-market stall under the stars]
Details on the wings: [e.g. shelves of glowing packs, hanging crystals, stacked crates, a sleeping cat on a shelf]
Colour mood: [e.g. midnight blue and candle amber]
Atmosphere: [e.g. warm, hushed and full of promise]
```

```
Now create LAYER 2 of 3, THE COUNTER, to sit in front of the image you just made. Same 16:9 frame and template.
- TRANSPARENT background. Only the counter and what stands on it.
- A shopkeeper's counter seen straight on: its top surface fills the area BELOW the amber dashed line, and its back
  edge is one straight horizontal edge exactly on that line, with a thin lighter lip.
- The green area (the player's hand) is plain counter top: wood or dark stone with a soft sheen, no objects.
- The counter's left and right corners may hold a few small props that stay BELOW the amber line and outside the
  green area: a brass till, a jar of quills, a stack of ledgers, a candle.
- Same painted style and lighting as Layer 1, slightly sharper (it is closer). Paint 6% extra left and right.
- Nothing above the amber line except the tops of those corner props.
```

```
Now create LAYER 3 of 3, THE FOREGROUND, to sit in front of everything. Same 16:9 frame.
- TRANSPARENT background, and at least 85% of the image left EMPTY.
- Only soft, out-of-focus shapes hugging the far left and right edges and the two top corners: a hanging lantern, a
  curtain's edge, a dangling chain of crystals, a shelf corner. Dark, blurred, close to the viewer.
- Nothing in the centre, nothing over the pink, green or blue areas of the template.
- Same palette and lighting. Paint 10% extra on every side (this layer slides the most).
```

## 4. Smaller pieces

```
A single paper price tag for my fantasy card game shop, same painted style: cream parchment with clipped top corners,
a brass eyelet hole at the top, a loop of twine through it, blank (no text, no numbers). Seen flat and straight on,
portrait, transparent background, evenly lit, no shadow.
```

```
A brass shop till for a fantasy card shop, same painted style, seen straight on from the front, transparent background,
evenly lit, no shadow, no text. About as wide as it is tall.
```
