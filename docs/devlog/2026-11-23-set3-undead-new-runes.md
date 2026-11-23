# Set 3 Undead new-concept runes (2026-11-23)

The owner's Set 3 rune review board approved nine new Undead runes (builder A of three; Spirit and Hybrid runes are
built in parallel). All are Set 3 originals (`sets: ['set3']`, `tribes: ['undead']`); Set 3 is not live, so there is
no patch note.

| Rune | Pool | Cost | Phases |
| --- | --- | --- | --- |
| Shallow Graves | Basic | 3 | Shop (buy) |
| Grave Tithe | Basic | 2 | combat |
| Dead Weight | Basic | 3 | Shop + combat |
| Rank and File | Basic | 2 | Shop + combat |
| Bone Pile | Basic | 3 | combat SoC + Shop replay |
| Second Burial | Epic | 4 | Shop + combat |
| Night Watch | Epic | 3 | combat SoC + Shop replay |
| Requiem | Epic | 4 | Shop + combat (shared 5-a-turn cap) |
| Undying Legion | Epic | 4 | combat (Avenge) |

## Where it lives

- Numbers: `packages/core/src/set3UndeadRunes.ts` (`SET3_UNDEAD_RUNES`).
- Shop halves: `packages/sim/src/set3UndeadRunes.ts`, one call at each chokepoint in `recruit.ts` (`applyOnBuy`,
  `fireSummonOverflow`, `applyRuneGrafts`, the four Undead Aura writers, `socRuneReplaysOf`, `riseReturn`,
  `afterShopDestroy`) and the turn reset in `reducer.ts`.
- Combat halves: `simulate.ts`, the "SET 3 UNDEAD RUNES" block (onRise / avenge / summonOverflow listeners), Bone Pile
  and Night Watch in `runRuneStartOfCombat`, Undying Legion beside Goleming, Requiem in both ctx Aura verbs.
- Oracle: R-SET3-UNDEAD-1123-01..09. Tests: `core/src/combat/set3UndeadRunes.test.ts`, `sim/src/set3UndeadRunes.test.ts`
  (each verified to fail with its effect switched off).

## Judgement calls for the owner

- **Requiem's cap**: 5 Aura rises per turn, the Shop and that turn's combat sharing one budget (`requiemLeft` threads
  what the Shop left into the fight). Printed as "(5 times per turn.)", the badge shows what is left.
- **Requiem counts Health rises too** (Ending's +4 Health, a Lantern's spell-power Health). The Soul Furnace's derived
  Health term is never an "improvement".
- **Grave Tithe is combat only**, per the owner note's "in a combat". Shop Rises do not count.
- **Rank and File grafts every friendly Footman and Spear Warden**, bought ones included (a played card is summoned).
- **Second Burial in the Shop** remembers a body that came back by a Shop Rise; it does not remember a combat Rise
  (the board card is the original, R-RISE-06).
- **Undying Legion** reuses the Spirit hand-summon: the card stays in hand after its copy is summoned.
