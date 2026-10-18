# 2026-10-17 — Astral Relic, Blood Omen, Honey and Goop card plates

Owner (2026-10-17): *"i added more to the folder."* Three frames, no interiors. Asked which interiors; the owner took my
suggestion. All Legendary (the folder rule).

## OWNER RUNBOOK (after this PR merges)

1. **No SQL.**
2. **Deploy the function from `main`** and send it one request so the catalog syncs:
   `npx supabase functions deploy progression-inventory --project-ref zcwhbejpqcdcfdpfxeza`

## What shipped

| Plate | Interior | frameX | Sx | Sy | Y | Darkening |
|---|---|---|---|---|---|---|
| Astral Relic | dark | 0.005 | 1.033 | 1.01 | 0.0094 | no |
| Blood Omen | wartorn | 0.005 | 1.049 | 1.056 | 0.1894 | no |
| Honey | brown | 0.004 | 1.051 | 1.031 | 0.03 | yes |
| Goop ("added one more: goop"; no interior named, so Brown) | brown | 0.005 | 1.051 | 1.041 | -0.0112 | yes |

- All four were drawn off the template (1170x1561, 959x1493, 1005x1566, 1024x1536) and scaled onto it, opening matched to Galaxy's
  and bottom-aligned, like Battletorn.
- **`plates:build --fit` can now pull an interior IN.** It only ever grew the interior to cover the opening (`down` and
  `up` started at 0), so an interior that reached far past a LOW opening kept its top: Blood Omen's opening starts lower
  than most, and the Wartorn interior's top poked out above the frame as a dark wedge. Both now start at -Infinity, so
  the fit tucks exactly 8px under the opening at each end. Existing plates keep their stored numbers.

## Not checked

- Seen in the Collection composites only, not in game.

## Same day: whole art, Round Magic, Phoenix

- **Whole art** (owner: *"please undo the adjustments to the larger cards. let them be uncropped, we can work through
  adjusting them as we need"*): Battletorn, Ethereal, Emerald, Gilt Etched, Astral Relic, Blood Omen, Honey, Goop and
  Phoenix Plate are now the WHOLE image uniformly scaled to fit the plate, nothing cropped or stretched. Most were drawn
  at the card's proportions and fill it; Astral Relic (wider), Emerald (taller) and Goop (wider) sit with a margin. The
  interiors were refit on the new frames; `--fit` may now NARROW an interior (`fitSx` starts at 0, not 1), since a
  shrunk frame's opening can be narrower than the interior's default width.
- **Round Magic**: no text darkening (owner: *"remove the darkening from round magic"*).
- **Phoenix removed** (owner: *"remove the phoenix card"*, meaning Phoenix, not Phoenix Plate). It never reached the live
  catalog (PR #2144 merged but was not deployed), so it is deleted rather than retired.
- **Rarities** (owner 2026-10-17: "make stonevines, porcelain, beach, and magma epic rarity"): Stonevines, Porcelain, Beach and Magma move Legendary to Epic. Epic 65 items (22 / 65 =
  0.338% each), Legendary 65 (9 / 65 = 0.138%).
- **Aquarium Rocks to Epic** (owner: *"change aquarium rocks to epic rarity"*): Epic 66 (0.333% each), Legendary 64
  (0.141% each).
- **`artScale`** (owner: *"phoenix plate needs to be 30% larger"*, then the same for Astral Relic, Ethereal, Battletorn
  and Goop): a per-plate `--plate-art-s` draws the art bigger than the plate box about its centre, so whole art can
  spill past the box uncropped. It scales the single image, or a layered plate's frame and its hover glow
  (styles.css); the interior gets pre-scaled numbers from `scaledInterior` (cardPlateLook.ts), since it sits in a
  different box. Phoenix Plate 1.3 (owner's number); Battletorn 1.1, Ethereal 1.12, Goop 1.08, Astral Relic 1.19, the
  sizes at which their opening matches a standard plate's again. The Collection image shows the same size (the
  overflow past the tile is cut there only).
