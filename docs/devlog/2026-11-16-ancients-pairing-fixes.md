# Ancient pairing audit fixes (2026-11-16)

Fixes for the proved per-pairing bugs from the three Ancient pairing audits, plus the owner's rulings on them (relayed
by the lead the same day). Oracle rules R-ANCFIX-03..05 and 07..10 (`packages/rules/src/registry/approved/heroes.ts`).
Each has a test that fails without the fix.

Dropped on owner ruling, other builders own them: Priestess × Bonds refunds (the pass itself should wait for room),
Pete × Time with a frozen Shop (working as intended: a frozen Shop is not a refresh), Flash × War's final hit (an
engine-wide "the last kill still finishes its triggers" fix).

- **The look-back at the pick (R-ANCFIX-03, one shared rule).** Picking an Ancient accounts for what already happened
  this turn. The reducer's `heroPower` stamps `AncientsState.powerUsedWave` (slot 0, `ancientNotePowerUse`), and
  `pickAncient` runs `pickTurnPowerUse`: a `usesPerTurn` reshape counts the earlier use (Nadja / Merrin × Fortune,
  Cassen × Time), Xerox × Genesis marks its one use, Rascal × Bonds gives the discount. Counts already past a lowered
  need are clamped one short so the next action pays and the glow (`>= need - 1`) lights: Ayse × Bonds (R-ANCFIX-07),
  Juggler × Genesis. Frank × Time seeds its first-3 count from the minions already bought (Gorr's always-on buy
  tally). Hunch × Bonds' targeted-cast tally now runs on every Ancients run, so casts before the pick count. Quillen ×
  Genesis: the Archive payout moved to `payArchiveIfFull` (reducer), also called from the `pickAncient` case.
  Not changed: Flint × Genesis's "first Refresh each turn" (its docstring says a mid-turn pick makes the next Refresh
  the first; no per-turn Refresh tally exists) and Braum × Time (a different, once-per-game power).
- **Hunch × Bonds (R-ANCFIX-04).** `ancientTargetedCastMult` is the shared read: `rubyCastCount` and `giftCastCount`
  multiply by it, and the Ruby / Gift / Whisper cast sites spend through `ancientNoteTargetedCast`.
- **Indy × Time + Engraved (R-ANCFIX-05).** The Start of Combat gild pushes `gildKeptLog` like Cindy × War; settle keeps
  the flag and counts a gild.
- **Counters on every cap (R-ANCFIX-09).** `ANCIENT_CAP_SPENT_FLAG` (core) pulses when Rayse × War / Genesis or Lord of
  the Risen × Death / Genesis spends a per-combat budget; the replay tallies it (`combatQuestDelta.capSpent`) and the
  text prints `{capLeft}`. Capped Pummels (Albus, Gorr, Darah, Gildmaster × War) print `{pummelLeft}` from the live
  crossings, Flash's shape.
- **Hunch × Death counts Shop deaths (R-ANCFIX-10, supersedes R-ANCHUNCH-01).** `hunchDeaths` is one running count,
  carried in as `ancientAvengeSpells.tick`; `ancientHunchShopDeath` pays in the Shop.
- **Texts (R-ANCFIX-08).** End-of-Turn readouts fold `endOfTurnRepeats` (Xerox × Fortune, Ayse × Time, Flint × Time);
  every other End-of-Turn pairing appends "It triggers N times this turn." when it repeats. "Uses left: N", "1 time",
  "(N Gold so far)", Drumline done, Brackus × War's offer says left-most, "Shop tier" in place of "Tavern Tier" / a
  bare "your Tier", "Refresh" capitalised. Left for their owners: Drakko × Bonds ("warband"), Emerald Warden × Death,
  Cindy × Fortune ("hero power").
