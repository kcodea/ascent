# Match History: the Buffs button shows every run-wide buff (2026-11-16)

Owner: "i dont want just shop buffs. i want gamewide buffs like gem buffs, shop buffs, spell buffs. everything that can
show in the run-wide buffs section of a game (where you click the hero portrait to toggle it on)".

- `gatherRunBuffs` (the in-game Buffs panel's row gatherer) moved from `packages/ui/src/runBuffs.ts` to
  `packages/sim/src/runBuffRows.ts`, so the board snapshot can call it. The UI file re-exports it; no caller changed.
- `BoardSnapshot.runBuffs` stamps those rows at capture, always (`[]` when none). One gatherer, so a row added to the
  panel later is recorded too. Display only; combat never reads it.
- Match History's button is `RunBuffsButton` ("Buffs"), fed by `finalBoardBuffs(snapshot)`. Older boards fall back to
  what they stored: the combat scalers (`gatherSnapshotBuffs`) plus `shopBuff` from 2026-11-08. They cannot show Clue
  power, Shop slot buffs, Veinstorm Stats, Max Gold, Den Mother or Guel.
- Rule R-MATCH-SHOPBUFF-01 widened (same id); its test is now `runBuffsButton.test.tsx`.
