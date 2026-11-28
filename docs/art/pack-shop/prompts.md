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

---

## 5. The shop's interior, as seen through its own doorway (owner 2026-11-25)

The pack shop is the INSIDE of the little shop players already know from the board (the "Return to shop" building).
Attach `shop-exterior-reference.png` (beside this file; it is `apps/web/public/return-to-shop.webp`) so the inside
matches the outside: the same honey-coloured timber and grey stone, the arched doorway, amber lanterns, shelves of
blue and violet potion bottles, purple crystals, the purple bunting hung with teal crystals, and the gold compass-star
emblem with its teal gem.

These replace the three prompts in section 3 when you want that look. Same three layers, same template, same margins.

### 5a. Layer 1, the back wall

```
ATTACH 2 IMAGES: (1) shop-exterior-reference.png  (2) shop-layout-template-16x9.png

I am making the background of the card pack shop in my fantasy game ASCENT.

IMAGE 1 - STYLE AND WORLD REFERENCE: the outside of this shop, as it appears in the game. Look through its arched
doorway: I want the INSIDE of that same building. Match its art style, materials, colours and level of detail exactly.

IMAGE 2 - LAYOUT TEMPLATE: a diagram, not artwork. It shows where the game's own interface will sit.

Create LAYER 1 of 3, THE BACK WALL: the far wall of the shop's interior, seen straight on at eye level, as if I have
just stepped through the doorway and am standing at the counter.

=== LAYOUT RULES (follow exactly) ===
- Landscape 16:9, as large as possible, same framing as the template. Paint about 6% extra on every side beyond the
  frame (the game slides this layer), with nothing important in that margin.
- CENTRE (the pink area, where the packs stand): a large, shallow ARCHED ALCOVE in the back wall, built of the same
  carved timber as the doorway in Image 1, with the gold compass-star emblem and its teal gem set at the top of the
  arch. Inside the alcove: plain, dark, softly lit wood panelling and nothing else. No objects, no bright spots, no
  hard edges. The packs will cover it.
- TOP (the blue band): heavy ceiling beams in shadow, with the purple bunting and its hanging teal crystals strung
  along them. Calm and dark, low detail.
- LEFT AND RIGHT WINGS: this is where the detail goes. Floor-to-ceiling timber shelving, slightly out of focus,
  receding into shadow: rows of sealed card packs standing upright and stacked booster boxes (plain coloured
  wrappers, no readable print), mixed with the blue and violet potion bottles, purple crystals and rolled scrolls
  from Image 1. One hanging amber lantern on each side, like the ones by the doorway. A rolling ladder on one side.
  Keep the two wings roughly balanced and darker than the centre.
- BELOW THE AMBER DASHED LINE: leave it EMPTY and dark. The counter is a separate layer.
- Lighting: warm amber lantern light from the wings, a soft cooler glow in the alcove, everything falling off to
  shadow at the edges. A soft vignette. No hard borders.

=== STYLE RULES ===
- Match Image 1: painted, slightly stylised, polished fantasy game art; chunky hand-carved shapes, soft painterly
  shading, warm rim light on the wood.
- Palette from Image 1: honey and chestnut timber, grey stone, amber lantern light, with small accents of royal
  purple, teal and potion blue. Keep it MID-TO-DARK and less saturated than Image 1 (this is a dim interior at dusk,
  and the packs in front must be the brightest, most colourful things on screen).
- Slightly soft focus, as if a few metres away.

=== DO NOT INCLUDE ===
Readable text, logos, characters, a shopkeeper, creatures, hands, cards facing the viewer, a counter, a window onto
bright daylight, or any marking from the template.

=== VARIATION (the part I change each time) ===
Time of day: [e.g. dusk, lanterns lit / deep night, candlelight only / a rainy afternoon, grey light from one window]
Extra details on the wings: [e.g. a sleeping cat on a shelf, a brass telescope, jars of glowing dust, a cuckoo clock]
Extra notes: [optional, e.g. "darker overall", "more purple", "fewer bottles, more packs"]
```

### 5b. Layer 2, the counter

```
Now create LAYER 2 of 3, THE COUNTER, to sit in front of the image you just made. Same 16:9 frame and template.
- TRANSPARENT background. Only the counter and what stands on it.
- The shop's own counter, seen straight on, built from the same honey-coloured timber and iron studs as the display
  table outside the shop in Image 1. Its top surface fills everything BELOW the amber dashed line. Its back edge is
  one straight horizontal edge exactly on that line, with a thin worn brass strip along it.
- The green area (the player's hand) is plain counter top: polished, slightly worn wood with a soft sheen. No objects.
- In the far left and far right corners only, staying outside the green area: a few props from Image 1's world, such
  as a brass till, an open ledger with a quill, a small stack of scrolls, one potion bottle, a short candle. Only
  their tops may rise above the amber line.
- Same painted style and warm lantern lighting, a little sharper than Layer 1 (it is closer). Paint 6% extra left and
  right.
- Nothing above the amber line except the tops of those corner props. No text.
```

### 5c. Layer 3, the foreground

```
Now create LAYER 3 of 3, THE FOREGROUND, to sit in front of everything. Same 16:9 frame.
- TRANSPARENT background, and at least 85% of the image left EMPTY.
- I am standing just inside the doorway from Image 1, so the nearest things are the doorway itself: the dark inner
  edge of the arched timber frame down the far left and far right, one of the hanging lanterns from Image 1 in a top
  corner, and a strand of the purple bunting with a teal crystal in the other top corner. All of it dark, heavily
  blurred and close to the viewer.
- Nothing in the centre, nothing over the pink, green or blue areas of the template.
- Same palette and lighting. Paint 10% extra on every side (this layer slides the most).
```

### 5d. One flat image instead (no layers)

Use this to try a look quickly before committing to three layers. It will not have depth in the game.

```
ATTACH 2 IMAGES: (1) shop-exterior-reference.png  (2) shop-layout-template-16x9.png

The INSIDE of the shop in Image 1, seen straight on at eye level from just inside its doorway, as the background of
my game's card pack shop. Landscape 16:9, framed like the template in Image 2 (a diagram, not artwork).
- Centre: a shallow arched timber alcove with the gold compass-star emblem at its top, its inside plain, dark and
  softly lit (the game's packs stand there).
- Wings: tall shelves of sealed card packs, booster boxes, potion bottles, crystals and scrolls, a hanging amber
  lantern each side, receding into shadow.
- Top: dark ceiling beams and purple bunting with teal crystals.
- Bottom third (below the template's amber dashed line): the shop's wooden counter top, plain and softly polished in
  the middle, its back edge a straight horizontal line, small props only in the far corners.
- Same painted style, materials and palette as Image 1, but a dim interior at dusk: mid-to-dark values, lower
  saturation, warm lantern light, soft vignette.
- No text, logos, characters, hands or template markings.
```

### 5e. Other rooms worth trying (swap into 5a's opening line and wings)

- **The loft above the shop:** up the stairs under the blue slate roof: sloping rafters, the round amber window from
  Image 1 glowing behind the alcove, crates of unopened stock.
- **The vault below it:** a stone cellar under the shop: iron-bound chests, a round vault door standing open behind
  the alcove, packs glowing faintly on stone ledges.
- **The market stall:** the open-air table outside the shop at night: the floating islands and stars from the game's
  sky behind the alcove, the bunting overhead, lanterns on poles.
- **The collector's back room:** velvet-lined display cases, framed rare cards (backs only) on the wall, one green
  banker's lamp.

---

## 6. Beyond the room: four pieces that lift the shop further (owner 2026-11-25)

Run section 5 first (the three layers). These come after, in this order. Only 6a drops in with no new code; 6b to 6d
each need wiring once the art exists.

### 6a. The Launch Pack (section 1's prompt, filled in)

Paste section 1's prompt and use this for its last block. Then ask for the foil shine mask in the same chat.

```
Pack name: "Launch Pack"
Colour family: deep rose and wine red, with warm gold
Emblem: a four-pointed compass star with a teal gem at its centre (the emblem above the shop's door)
Scene behind it: the first floating island at sunrise, a stone stair climbing from it into the clouds
Mood: a beginning; bright, hopeful, a little grand
Extra notes: as rich and detailed as the Legendary pack, so it does not look cheaper beside it
```

### 6b. The opening table (behind a pack while it is opened)

```
ATTACH 1 IMAGE: the finished back wall from section 5 (so the two rooms match)

The same shop as the attached image, a moment later: I have carried my pack to a quiet reading nook at the back of the
shop to open it. This is the background behind the pack while it is torn open and its five cards are revealed.
- Landscape 16:9, as large as possible. Paint about 6% extra on every side.
- CENTRE (the middle 60% of the width, full height): almost empty. Dark, soft, out-of-focus wood panelling with one
  gentle pool of warm light from above. No objects, no bright spots, no hard edges. The pack and the cards cover it.
- LEFT AND RIGHT EDGES: heavy velvet curtains in royal purple drawn back, a brass wall lamp each side, the dim edge of
  a bookshelf. Dark and blurred.
- BOTTOM 15%: the near edge of a dark felt-topped table, plain, with a thin brass rim.
- Same painted style, materials and palette as the attached image, but darker and quieter: this is the hush before a
  reveal. Strong vignette.
- No text, logos, characters, hands, cards or packs.
```

### 6c. The counter mat (where the player's packs rest)

```
A shopkeeper's velvet counter mat for my fantasy card shop, same painted style as the counter from section 5.
- Landscape, about 3:1, fully TRANSPARENT background, the mat filling the width.
- Seen from the same slightly raised front view as the counter: a long, low, rounded rectangle of deep midnight-blue
  velvet, a thin gold embroidered border, the gold compass-star emblem stitched small at each end, soft worn creases.
- The middle is plain velvet with no pattern (packs lie on it).
- Evenly lit, no drop shadow, no objects on it, no text.
```

### 6d. The shopkeeper (optional: gives the shop a face)

```
ATTACH 1 IMAGE: shop-exterior-reference.png

The keeper of the shop in the attached image, in the same painted style.
- Portrait 2:3, fully TRANSPARENT background, one character only, seen from the waist up, turned three-quarters toward
  the viewer's right, as if leaning on a counter that is not in the picture (crop cleanly at the waist).
- [Who they are, e.g. "an elderly kobold with brass spectacles and a patched purple waistcoat", "a broad, cheerful dwarf
  with a braided beard and a jeweller's loupe", "a tall hooded figure whose face is only two warm lights"]
- Friendly and a little sly, one hand raised as if presenting something to their side.
- Lit by warm lantern light from the right, matching the shop. Mid-to-dark values so they sit behind the packs.
- No text, no props held in front of the body, no background, no shadow on the ground.

Follow-up in the same chat: "The same character, same framing and size, with three more expressions: delighted
(someone just bought a pack), astonished (a Legendary was pulled), and idle (looking down at a ledger)."
```
