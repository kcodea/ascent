# 2026-10-06 — Portrait frames batch 8: Cosmic Glass, Mike's first wire from his own art folder

Mike asked "i added a skin just to test to make sure this process works. lets wire it up". It was the first cosmetic
wired from Mike's machine, so the batch also tested the process end to end.

## What changed

- **One new frame:** Cosmic Glass (Epic, `frame_cosmic_glass`), master `Portraits/Epic/Cosmic Glass Frame.png`.
  `npm run art:frames -- --apply` measured a centred hole of 0.822, inside the normal range, so no by-name allowance
  was needed.
- **Frame masters may have spaces in their names.** The catalog test only accepted `[A-Za-z0-9]+.png`, but the tool
  reads the exact path, so a space is harmless. Skins already allowed spaces (`Midas and Melon.png`). Frames now match.
- **The art-folder tests tolerate a partial folder.** This came in as #1961 and is carried here. Mike's
  `C:/Game Assets/Ascent Art/Skins` started empty, because the shipped art lives in the repo as webp. The two disk
  checks used to fail every master missing from that folder. Now they skip a master that is not on the machine.
  A master that is present must still sit in exactly one rarity folder at its rarity, and every file there must be wired.
- **Counts:** 53 frames (10 Common, 8 Rare, 19 Epic, 9 Legendary, 7 Ancient). The crate pool is
  38 / 40 / 45 / 37 / 21, so each Epic item is 0.489%. The category shares are 11.5 / 36.6 / 16.4 / 7.6 / 27.9, and
  the Collection total is 218.
- **Also updated:** oracle R-PROG-FRAME-01 and -04 and R-PROG-SKINS-11 (the partial-folder note), GAME-RULES, the
  patch note, and the Edge catalog (`npm run progression:shared`).

## Deploy

After merge, deploy `progression-inventory` from an up-to-date `main`. The catalog sync adds Cosmic Glass. No SQL
needs to run:

```
npx supabase functions deploy progression-inventory --project-ref zcwhbejpqcdcfdpfxeza
```
