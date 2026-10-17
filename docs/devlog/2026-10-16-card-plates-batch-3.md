# 2026-10-16 — Seven more card plates, two new interiors

Owner (2026-10-16): *"i added a bunch of new frames to the folder."* Seven frames and two interiors were new in
`Reference Art/Card Backplates`. No interior was named, so I suggested a pairing from the names and colours and the owner
picked it.

## OWNER RUNBOOK (after this PR merges)

1. **No SQL.** The `card_plate` slot already exists.
2. **Deploy the function from `main`** so the catalog syncs the seven plates:
   `npx supabase functions deploy progression-inventory --project-ref zcwhbejpqcdcfdpfxeza`

## What shipped

- **Interiors**: `darkbrown` (Dark Brown Interior.png) and `grey` (Grey Interior.png), in `frames/plates/interiors/`.
- **Plates** (all Legendary, all layered, no text darkening because every interior here is dark):

  | Plate | Interior | frameX | Sx | Sy | Y |
  |---|---|---|---|---|---|
  | Dark Arcane | Dark | 0.006 | 1.054 | 1.024 | -0.0037 (Galaxy's seat) |
  | Simple Glass | Grey | 0.004 | 1.21 | 1.122 | 0.03 |
  | Stonevines | Grey | 0.005 | 1.047 | 1.026 | -0.0066 |
  | Standard Black / Blue / Pink | Dark Brown | 0.006 | 1.051 | 1.027 | 0.0009 |
  | Standard Teal | Dark Brown | 0.006 | 1.051 | 1.03 | -0.0028 |

- **`--fit-alpha`** on `npm run plates:build`: the fit counts alpha > 200 as frame, but Simple Glass is see-through on
  its left edge, so the scan ran straight through it. `--fit-alpha 60` measured its opening (centred, like Simple
  Black's).
- Simple Glass is on the Simple template (pointed bottom) but sits on the standard-shaped Grey interior, so its fit
  stretches the interior further (1.21 x 1.122) to reach into the point.
- Stonevines' vines spill past the plate's edge, like Blossom's flowers: that is the art, not a stray background.

## Not checked

- Seen in the Collection composites only, not in game. The frameX values are measured from each opening, not tuned by
  eye like Blossom's.
