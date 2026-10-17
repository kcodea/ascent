# 2026-10-17 — Thirteen more card plates and four new interiors

Owner (2026-10-17): *"ive added a lot of new card frames to the folder."* Five frames were new in
`Reference Art/Card Backplates` (no new interiors). No interior or rarity was named, so they take the standing defaults:
Legendary (the folder rule) on the Brown interior, keeping the standard text darkening like Topaz and Blossom.

## OWNER RUNBOOK (after this PR merges)

1. **No SQL.**
2. **Deploy the function from `main`**:
   `npx supabase functions deploy progression-inventory --project-ref zcwhbejpqcdcfdpfxeza`, then send it one request
   (any call) so the catalog syncs.

## What shipped

- **"Ascendant Carving" ships as Spirit Carving** (`plate_spirit_carving`): cosmetic names may not use ranked medal words
  (`cosmetics.test.ts`), and the owner picked Spirit Carving. The art file keeps its name.

| Plate | Interior | frameX | Sx | Sy | Y |
|---|---|---|---|---|---|
| Spirit Carving | Brown | 0.014 | 1.076 | 1.021 | -0.0047 |
| Iridescent | Brown | 0.006 | 1.051 | 1.031 | 0 |
| Mystic Obsidian | mystic (moved off Brown in the second round) | 0.004 | 1.021 | 1.154 | 0.0994 |
| Porcelain | Brown | 0.005 | 1.065 | 1.033 | 0.0075 |
| Smooth Iridescent | Brown | 0.005 | 1.04 | 1.038 | 0.0159 |
| Battletorn | wartorn | 0.006 | 1.073 | 1.134 | 0.1172 |
| Ethereal | mystic | 0.007 | 1.021 | 1.132 | 0.1172 |
| Phoenix | darkbrown | 0.004 | 1.044 | 1.012 | -0.0112 |
| Round Magic | roundmagic | 0.005 | 1.018 | 1.066 | 0.0609 |
| Verdant Magic | silvermagic | 0.006 | 1.059 | 1.089 | 0.0806 |
| Phoenix Plate | (single image) | | | | |

- **Openings measured from the frame body.** Spirit Carving's teal wisps, Mystic Obsidian's purple smoke and Porcelain's
  vines cross into the opening, so a scan from the centre stopped on them. The centres here use the median, over rows,
  of the first run of 12+ opaque pixels, which matched Galaxy's known seat (1px left).
- Spirit Carving's opening is 5px left of centre (130 to 806 at 946px, against Galaxy's 137 to 807), so it gets the
  largest nudge yet (0.014) and a wider interior stretch (1.076).
- The wisps, smoke and vines spill past the plate's edge on purpose, like Blossom's flowers.

## Second round (same day)

Owner: *"ive added another round of frames and interiors. match them based on the names. ask me any leftover questions you
have about matching with interiors"*.

- **New interiors**: `mystic`, `roundmagic` (Brown Round Magic), `silvermagic`, `wartorn`.
- **Matched by name**: Battletorn on Wartorn, Round Magic on Brown Round Magic, Silver Magic on Silver Magic, and Mystic
  Obsidian (first round) moved from Brown to Mystic. **Owner's picks**: Ethereal on Mystic, Phoenix on Dark Brown.
- **Names**: Silver Magic ships as **Verdant Magic** (no medal words). **Ascendant Rank** (and its interior) is held back:
  the owner wants it as a future reward for reaching Ascendant rank, not a crate plate. Not built.
- **Oversized canvases**: Battletorn (1080x1679) and Ethereal (1006x1563) were scaled onto the 946x1471 template with their
  opening matched to Galaxy's and bottom-aligned, cropping what spilled past the edge (Battletorn's banners lose their
  outer tips, like Mooncloud's clouds).
- **Phoenix Plate** is a shield with wings and its own painted middle on a 1236x1922 canvas. Owner: "Try it as one image".
  It is a single-image plate fitted inside the standard plate's outline, bottom-aligned, no darkening. Its middle narrows
  toward the bottom, so the last lines of rules text sit over the gold flourishes: check it in game.
- "Standard Empty - Ignore.png" ignored, as named.

## Third round (same day)

Owner: *"added more - add dark back to each and merge"*. Emerald and Gold Etched on the Dark interior, no darkening.
Gold Etched ships as **Gilt Etched** (no medal words in names; my pick, owner may rename). Both were drawn slightly off the
template (944x1510, 1005x1565) and were scaled onto it like Battletorn.

| Plate | Interior | frameX | Sx | Sy | Y |
|---|---|---|---|---|---|
| Emerald | dark | 0.006 | 1.054 | 1.036 | -0.0159 |
| Gilt Etched | dark | 0.005 | 1.06 | 1.011 | 0.0103 |

## Not checked

- Seen in the Collection composites only, not in game.
