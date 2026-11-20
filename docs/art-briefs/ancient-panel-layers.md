# Art brief: layered Ancient portraits for the awakening panels

Three layers per Ancient, six Ancients, 18 files. Do Death first as the test; the other five only once Death looks
right in the game.

## Why start from the existing portraits

Each panel ends by shrinking onto its card, and the card shows today's painting. If the panel figure is a fresh
generation, the Ancient visibly changes face at that moment. So every figure below is made by **extending the current
512px painting** (image-to-image / outpaint), not by generating a new character. The source files are in
`packages/ui/src/art/ancients/` (`death.webp`, `war.webp`, `fortune.webp`, `time.webp`, `genesis.webp`, `bonds.webp`).

## The three layers

| Layer | File | Size | Transparency | What it is |
|---|---|---|---|---|
| Back | `<id>_back.png` | 1024 x 1536 | none (opaque) | The place behind the Ancient, with NO figure in it |
| Figure | `<id>_figure.png` | 1024 x 1536 | transparent background | The Ancient alone, cut out |
| Front | `<id>_front.png` | 1024 x 1536 | painted on pure black | Loose magic in front of the Ancient (smoke, embers, coins) |

`<id>` is one of `death`, `war`, `fortune`, `time`, `genesis`, `bonds`.

The Front layer needs no cut-out: paint it on flat black (#000000) and I turn the black into transparency.

## Composition rules (these matter more than the prompts)

The panel on screen is a tall slanted strip about a third as wide as the image, so only the middle shows at rest. The
sides exist so the layers can slide against each other without showing an edge.

1. **Everything that identifies the Ancient sits in the middle 40% of the width** (mask, hands, the held object).
2. **Mask in the upper third**, eyes about 30% down from the top.
3. **Head and shoulders must also read as a square crop**, because the panel ends as the card's square art.
4. **Figure runs off the bottom edge** (cut at the thigh or lower). No feet, no floor, no floating torso.
5. **Figure layer: nothing touches the left, right or top edge.** Horns, hair and halos need clear space around them.
6. **Back layer: no figure, no figure-shaped hole, no bright spot in the centre.** Darker and softer than the figure,
   lightest near the top.
7. **Front layer: keep the middle of the image mostly empty** so it never covers the mask. Put the shapes low and at
   the sides.
8. Same light direction on all three layers of one Ancient.

## Workflow per Ancient (ChatGPT)

ChatGPT makes portrait images at 1024 x 1536. That is fine: ask for that size and I crop to fit. Use **one chat per
Ancient** and keep all three layers in that chat, so it holds the same character and light. Attach the current
painting (convert the `.webp` to PNG first if the upload refuses it; ask me and I'll export all six).

Send these four messages in order, pasting the Ancient's own text from below where marked.

**Message 1 (attach the painting): the figure**

> This is a character from my game. Redraw this exact character, same mask, same costume, same colours, same pose and
> same painting style, as a tall portrait image, 1024 x 1536, transparent background. Show them from the thighs up,
> running off the bottom edge. Keep the mask in the upper third and keep the mask, hands and held objects inside the
> middle 40% of the width. Leave clear empty space at the left, right and top so nothing touches those edges. Only
> the character and the glow that belongs to their body: no scenery, no ground. Details to keep: [paste **Figure**]

**Message 2: check it before going on**

Compare against the painting. If the mask, eyes or held objects drifted, say exactly what ("the right eye must glow
green, the left candle is black and unlit") and ask it to fix only that. Do not go on until the face matches.

**Message 3: the back plate**

> Now paint the place this character stands in, as its own image with NO character in it and no empty silhouette
> where they stood. Same painting style and same light direction, 1024 x 1536, fully opaque. Slightly softer and
> darker than the character, lightest near the top, nothing bright in the centre. The scene: [paste **Back**]

**Message 4: the front layer**

> Now a separate effects layer in the same style, 1024 x 1536, on a flat pure black background (#000000), no
> character and no scenery. Keep the middle of the image empty; put the shapes low and at the sides. It shows:
> [paste **Front**]

Save them as `<id>_figure.png`, `<id>_back.png`, `<id>_front.png` in `C:\Game Assets\Ascent Art\Ancients\panels\`
and tell me. I crop, resize, convert and wire them.

Things ChatGPT tends to get wrong here:

- **It redesigns the character** instead of copying it. Message 2 is the guard; "exact same character" plus naming the
  drifted detail usually fixes it. Starting a fresh chat is faster than a fourth correction.
- **The transparent figure comes back on white or a checkerboard.** Ask again for "transparent background PNG". If it
  still won't, take it on flat white and I'll cut it out.
- **It writes text or adds a frame.** Add "no text, no border" to the message.
- **The black in the front layer is dark grey or textured.** Say "flat pure black, nothing in the dark areas".

## If the style drifts

The attached painting carries the style, so the messages above do not restate it. If a layer comes back looking
different (most likely the back plate), add this:

> Stylised hand-painted fantasy card art, bold chunky shapes, hard-edged cel shading with painterly gradients, thick
> confident brushwork, saturated colour, strong rim light. Not a photo, not a 3D render.

---

## Death (green)

**Figure:** A tall masked spirit of death, seen from the thighs up, facing the viewer. Angular gold mask with a
cracked right half and one glowing green eye, crown of dark antlers with a gold spike, long flowing spectral green
hair. Small gold bells hang on chains from the mask and chest. Tattered black, dark green and gold robes, a gold ring
clasp at the chest. Green clawed hands: the left holds a snuffed black candle trailing grey smoke, the right holds a
lit cream candle with a green flame. Green rim light.

**Back:** A drowned ruined gothic city at night, broken towers and a tall pointed arch, thick green fog, faint
translucent ghost figures standing in the mist, dim teal sky. No character.

**Front (on pure black):** Curling ribbons of green spectral smoke rising from the bottom corners, a few drifting
green embers and one small gold bell on a broken chain near the bottom edge. Centre empty.

## War (red)

**Figure:** A colossal stone warlord, seen from the thighs up, facing the viewer, low camera angle. Body of dark
cracked rock with glowing red molten seams. Gold crowned helm with a pointed face plate, blunt stone horns, one
burning red eye. Heavy red cape, thick gold bands on arms and chest, a spiked gold sun-shaped shoulder plate. Both
stone hands rest on the gold pommel of a great sword planted in front of him. Red flame and smoke rise behind his
head. Red rim light.

**Back:** A fortress wall and gate at dusk, tall battlements, long red war banners with a gold sun emblem, smoky
purple and orange sky. No character.

**Front (on pure black):** Red-orange embers and sparks blowing diagonally up from the bottom left, a torn red banner
edge at one side, thin black smoke low down. Centre empty.

## Fortune (gold)

**Figure:** A sly masked spirit of luck, seen from the thighs up, facing the viewer, head tilted. Smooth dark-gold
smiling mask with narrow glowing gold eyes and a tall pointed crest, dark charcoal skin. Layered robes in deep red,
teal and cream with gold trim, long gold tassels and round coin medallions on chains. The raised left hand holds a
single gold coin between finger and thumb, the right hand is open, palm up. A halo of large gold coins and a gold
crescent circles the head, joined by ribbons of golden light. Warm gold rim light.

**Back:** A lantern-lit city of arches and towers at night, deep teal sky, dark red drapes hanging in from the top
corners, small warm lights in the windows. No character.

**Front (on pure black):** A few large gold coins tumbling in the lower corners, bright ribbons of golden light
sweeping across the bottom third, small gold sparks. Centre empty.

## Time (indigo)

**Figure:** A calm masked spirit of time, seen from the thighs up, facing the viewer. Smooth slate-blue mask with a
gold centre ridge, one glowing gold eye and one glowing violet eye, hair of slow purple smoke. Thin broken gold rings
orbit the head like a tilted halo. Robes of navy, cream and violet with broad gold bands and round gold clasps.
Dark indigo hands, one raised and one cupped below; a stream of glittering pale-gold sand pours from the upper hand
and curls into the lower one. Cool violet rim light.

**Back:** Broken stone aqueducts and arches hanging in the air, pieces drifting apart, a deep blue starry sky turning
to a pale gold sunset at the horizon. No character.

**Front (on pure black):** A curling stream of glittering pale-gold sand across the bottom third, two thin arcs of a
broken gold ring at the sides, soft violet dust. Centre empty.

## Genesis (teal)

**Figure:** A serene masked spirit of creation, seen from the thighs up, facing the viewer. Ivory and gold mask with
a pointed chin and glowing teal eyes, a crown of curling gold vine horns with teal spirit leaves growing through
them. Robes of deep green and cream with gold trim and looping gold clasps. The lower hand cradles a glowing teal
seed, the other hand is raised with a dark glove; a small bird made of pale gold light flies up from it. Teal rim
light.

**Back:** Overgrown ancient ruins in bright daylight, mossy arches, thin waterfalls, giant carved stone heads half
sunk in turquoise water, hanging vines, blue sky. No character.

**Front (on pure black):** Drifting glowing teal leaves, soft swirls of teal light rising from the bottom, a few
small motes of pale gold. Centre empty.

## Bonds (violet)

**Figure:** A regal masked spirit of bonds, seen from the thighs up, facing the viewer. A mask split down the middle,
left half black and right half ivory, laced together with violet stitches, one violet eye and one pink eye, wide
sweeping gold horns with a violet crystal at the crown. Robes of deep purple, cream and gold with interlocked gold
ring clasps and a gold heart-shaped knot on the chest. Black clawed hands banded with gold rings, one reaching toward
the viewer, one raised. Violet crystals float around it, joined by thin threads of violet light. Violet rim light.

**Back:** Floating islands of ruined stone and broken arches in a purple dusk sky, soft clouds, distant drifting
rocks. No character.

**Front (on pure black):** Three or four sharp violet crystals in the lower corners and sides, joined by thin curved
threads of violet light, faint pink sparks. Centre empty.
