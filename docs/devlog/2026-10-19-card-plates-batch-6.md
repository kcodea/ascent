# 2026-10-19 — Celestial, Runic, Verdant and Volcanic card plates

Owner (2026-10-19): *"added more frames. can you add them with the dark interior?"* Four Legendary plates (the folder
rule) on the Dark interior, no text darkening.

## OWNER RUNBOOK (after this PR merges)

1. **Deploy the function from `main`** and send it one request so the catalog syncs:
   `npx supabase functions deploy progression-inventory --project-ref zcwhbejpqcdcfdpfxeza`
2. A new web zip.

## What shipped

| Plate | frameX | Sx | Sy | Y | artScale |
|---|---|---|---|---|---|
| Celestial | 0.005 | 1.008 | 1.003 | -0.0066 | 1.042 |
| Runic | 0.007 | 0.98 | 1.001 | -0.0103 | 1.086 |
| Verdant | 0.007 | 0.987 | 0.996 | -0.0066 | 1.075 |
| Volcanic | 0.007 | 1.022 | 0.999 | -0.0094 | 1.032 |

- All four are drawn a little taller and narrower than the template (aspect 1.605 against 1.555), so each frame is the
  WHOLE art fitted to the plate (the owner's whole-art rule), and `artScale` grows it until its opening matches a standard
  plate's (Galaxy's 670px at 946). The fit is on the unscaled frame; the owner can fine-tune any of them in the Card
  Plate Editor.
