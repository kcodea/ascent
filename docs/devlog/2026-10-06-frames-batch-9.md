# 2026-10-06 — Portrait frames batch 9: Blossom, Neonpunk, Solar Flare, Color Doodle, Neon Ring

Mike said "wire them up" to the five frames he added after Cosmic Glass (batch 8). As always, the rarity folder sets the
rarity, and each name comes from its filename.

| id | name | rarity | master | hole |
| --- | --- | --- | --- | --- |
| `frame_blossom` | Blossom | Epic | `Epic/Blossom Frame.png` | 0.726, centre y 0.462 |
| `frame_neonpunk` | Neonpunk | Epic | `Epic/Neonpunk Frame.png` | 0.799 |
| `frame_solar_flare` | Solar Flare | Epic | `Epic/Solar Flare Frame.png` | 0.687 |
| `frame_color_doodle` | Color Doodle | Rare | `Rare/Color Doodle Frame.png` | 0.767 |
| `frame_neon_ring` | Neon Ring | Rare | `Rare/Neon Ring.png` | 0.755 |

- **Blossom vs Cherry Blossom.** Blossom is a wreath of twisted branches with pink flowers, a different ring from
  Cherry Blossom. Mike was told the two names are close and kept "Blossom".
- **Geometry.** Every hole is centred within the usual 0.05, so no frame needed a by-name allowance. Blossom sits
  highest, at y 0.462.
- **Counts.** There are 58 frames: 10 Common, 10 Rare, 22 Epic, 9 Legendary and 7 Ancient.
  - The crate pool is 38 / 42 / 48 / 37 / 21. One item is now 0.738% at Rare and 0.458% at Epic.
  - Category shares are 11.3 / 35.5 / 15.9 / 7.4 / 29.9, and the Collection total is 223.
- **Also updated:**
  - oracle rules R-PROG-FRAME-01 and -04, and GAME-RULES;
  - the Edge catalog, via `npm run progression:shared`;
  - the 2026-10-06 patch note, which now lists all six of today's frames in one line instead of adding a second line.

## Deploy

After merge, deploy `progression-inventory` from an up-to-date `main` (no SQL needed):

```
npx supabase functions deploy progression-inventory --project-ref zcwhbejpqcdcfdpfxeza
```
