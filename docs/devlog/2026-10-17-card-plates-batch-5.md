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
