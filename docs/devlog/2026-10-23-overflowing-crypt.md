# 2026-10-23: Overflowing Crypt, Picnic leaves Set 3, Undead Army art

Owner asks: "add this spell and wire its art: * Overflowing Crypt - T2 - 3g Start of Combat: Summon 2 Skeletons.",
"i changed a couple of spell arts, can you wire those new art pieces up?", "remove picnic from set 3".

- **Overflowing Crypt** (`sp_overflowingcrypt`, Set 3 own spell, T2, 3 Gold, neutral: the owner named no tribe). A
  next-combat bank in Weaken's shape. New factory `spellSkeletonsNextCombat` (schema whitelist, `EffectFactoryId`,
  beat policy `ownBeat`/`spellCast`) adds `count` (2) to `RunState.pendingSkeletons`. The reducer carries it as
  `questMods.bankedSkeletons` (`questCombatMods`), so `snapshotBoard` captures it and a served board summons its
  Skeletons too (classified in `nextCombatBanks.guard.test.ts`; `BANKED_SPELL_OF.bankedSkeletons` puts it in
  `NEXT_COMBAT_BANK_KEYS`, so a stale re-serve strips it). `simulate` resolves it in `runRuneStartOfCombat`, right
  after Weaken: a `bankedCast` marker, then `summonMinion(u3_skeleton)` per Skeleton. Real summons, so the board cap
  holds and an over-cap Skeleton Overflows (Ending, Bicycle Bob, Rune of Overflow). It runs every Start-of-Combat
  pass, so Rune of Twilight repeats it (the 2026-08-12 ruling that Twilight doubles the Start-of-Combat banks). Spent
  in `settleCombat` beside Weaken / Decoy Sigil.
- **Skeleton token**: `u3_skeleton` (Set 3 Undead 1/1 token, the one Rune of the Endless March summons). It is the only
  Skeleton in the game.
- Not an End of Turn replay under Rune of Combat Prowess (that replays rune/quest Start-of-Combat blocks; the banked
  spells, Fleeting Vigor included, are not replayed). A mid-fight cast fizzles like every next-combat spell
  (`combatCastable` is false for it).
- **Picnic** (`sp_picnic`) leaves Set 3: commented out of `SET3_SHARED_SPELL_IDS`. It stays a Set 2 spell and a Set 4
  shared spell (`SET4_SHARED_SPELL_IDS` now also resolves against the set 1 + set 2 spell lists for it).
- **Art**: `sp_overflowingcrypt.webp` from `Spells/OverflowingCrypt.png`; `undeadarmy.webp` re-wired from the updated
  `Spells/UndeadArmy.png`. `Spells/CrowdedCrypt.png` was NOT wired: no spell is named Crowded Crypt (it is the
  Undead rune `rune_crowded_crypt`, whose emblem comes from the Runes folder), so it is flagged for the owner.
- Oracle: `R-SPELL-CRYPT-01` (summoning), `R-ARCHIVE-SET3-1023-01` (foundation). Tests: `overflowingCrypt.test.ts`.
- Content change: redeploy versus-resolve after merge.
