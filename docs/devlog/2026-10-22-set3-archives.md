# 2026-10-22: Stellar Chorus, Shredder and Jumpstart Jules leave Set 3

Owner asks: "archive stellar chorus from set 3", then "archive shredder and jumpstart jules".

- **Stellar Chorus** (`stellarchorus`, T4 spell): Set 3 only. New `SET3_SPELLS_IN_SET3` in `sets.ts` filters it out of
  Set 3's manifest (the shape of `SET3_DWARVES_IN_SET3` from the 2026-10-21 Dwarf rework). The def stays in
  `SET3_SPELLS` because Set 4 still shares it by reference (`SET4_SHARED_SPELL_IDS`), so it is still a Set 4 spell.
- **Shredder** (`n3_shredder`) and **Jumpstart Jules** (`n3_charger`): both were Set 3 only, so they moved verbatim to
  `cards/archive.ts` and belong to no set (the 2026-10-13 Yeti convention). Neither is an Equipment minion: Jules
  feeds the shared bonus-charge pool at Start of Turn, Shredder reads unused Equipment at End of Turn. Their factories
  (`startOfTurnEquipmentCharge`, `endOfTurnBuffEndsPerUnusedEquipment`), `shredderText` and the art stay so old saves
  resolve; no live card uses those factories now. `docs/GAME-RULES.md` notes Jules is archived.
- Every draw (shop roll, Spell Cart, Discovers, random grants) reads the run-pinned pool, so leaving the manifest
  removes them from all of them. No hero, quest, rune, bot or guide names any of the three.
- Old Set 3 saves, snapshots and replays resolve all three through `CARD_INDEX`: `set3Archives1022.test.ts`.
- Oracle: `R-ARCHIVE-SET3-1022-01` (foundation). Doc Bot regenerated with `npm run docbot:sync`.
- Left alone on purpose: the frozen Versus parity fixture and the historical `schema.sql` telemetry stamp list (both
  record what Set 3 held at the time), `wire-art.ts` master aliases, and older devlogs and patch notes.
