# 2026-10-19 — Twenty more card plates (Dark and Dark Brown)

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

## The next drops (same day, same PR)

Owner: *"i added a bunch more use either dark brown interior or black interior"*. No black interior file exists; asked,
and the owner picked the **Dark** interior as "black" (the Simple Black interior is drawn for the pointed Simple
frames). Warm frames went on Dark Brown, cool frames on Dark. Then *"i added more - add those with dark interior as
well"*: Nano, Soulwitch, Spades and The Howl on Dark. All Legendary, no darkening, whole art + `artScale` as above.

| Plate | Interior | frameX | Sx | Sy | Y | artScale |
|---|---|---|---|---|---|---|
| Armored Knight | darkbrown | 0.004 | 1.008 | 1.006 | -0.0037 | 1.05 |
| Bordered Land | darkbrown | 0.006 | 0.969 | 0.995 | 0.0075 | 1.098 |
| Carved Aetherstone | dark | 0.005 | 1.018 | 1.016 | 0.0019 | 1.034 |
| Elegant | darkbrown | 0.005 | 1.015 | 1.001 | -0.0066 | 1.047 |
| Frozen Aurora | dark | 0.004 | 0.976 | 0.964 | 0.0263 | 1.081 |
| Hivemind | dark | 0.005 | 1.004 | 0.973 | -0.0159 | 1.06 |
| Ironwood | darkbrown | 0.009 | 0.997 | 1.014 | 0.0038 | 1.063 |
| Solar | darkbrown | 0.006 | 0.98 | 0.937 | 0.0169 | 1.081 |
| Static | dark | 0.004 | 0.99 | 0.963 | -0.0122 | 1.065 |
| Twisted Ether | dark | 0.005 | 1.004 | 0.966 | -0.0206 | 1.05 |
| White Magic | darkbrown | 0.006 | 1.033 | 1.018 | -0.0056 | 1.017 |
| Nano | dark | 0.005 | 0.973 | 0.978 | -0.0159 | 1.093 |
| Soulwitch | dark | 0.005 | 1.033 | 0.995 | -0.0225 | 1.018 |
| Spades | dark | 0.004 | 1 | 0.995 | -0.0056 | 1.057 |
| The Howl | dark | 0.006 | 0.95 | 0.965 | -0.0291 | 1.113 |

Then *"i added one more, can you add it with dark brown interior?"*: **Vintage Oak** on Dark Brown (frameX 0.007, Sx 1.007,
Sy 0.995, Y 0.015, artScale 1.052).
