# 2026-11-01 — Quests, forges, discounts and Ancients follow the held power (R-HERO-POWER-REPLACED-02)

**Owner ruling.** R-HERO-POWER-REPLACED-01 left four passives on the hero's own clock and listed them for a ruling. The
owner picked all four: they follow the HELD power too.

**What changed (all in `@game/sim`):**

- **Drakko's Drumline / Chronos' Timelapse** (`drakkoQuestBuy`, `chronosQuestBuy`) gate on `powerHolderId(run, kind)`
  (new in heroes.ts: the hero id whose power of that kind sits in slot 0 or Void's slot 1). No holder, no count.
  Progress (`drakkoBuys`, `eotMinionBuys`) is run-level and only moves while held, so a gainer starts at 0 and a power
  found again resumes where it stopped (same anti-farm shape as R-HERO-POWER-FRESH-01). Completion spends the holder's
  own latch (slot 1 for a Void holding it there). In practice only Void can gain Drumline (Mimic and Power Shifter
  exclude Drakko) and Chronos is WIP, but the code is generic.
- **Runesmith's turn-5 forge** already gated on `hasPower`; its spent check read slot 0 only. It now reads the
  holder's latch (`powerLatchSpent(s, runeforgeHolderId(s))`).
- **Guardian's turn-8 Epic forge** is still booked into `epicForgeWave` (createRun, or `seedAdoptedPower` on adoption),
  now with `heroEpicForgeBooked = true`. When the booking comes due and `epicRuneforge` is not held, that one visit is
  dropped from the count; a Rune of the Epic Forge booking for the same turn still opens. A save without the flag reads
  as booked for a native Guardian whose `epicForgeWave` is 8 and who is not past turn 8.
- **Forge discount** (`applyHeroForgeDiscount`) reads `hasPower` for either forge power, either slot.
- **Ancients**: `activeAncientPairing` keys on `ancientPairingHeroId(state)` (the slot-0 wielded power's hero), so every
  `effectOf` read follows the held power; `powerMaxUses` reads that power's base budget. `pickAncient` stamps
  `powerOverrideFor`, and `activePowers` applies the pairing's reshape to slot 0 only while that power holds it
  (including an adopted or Void slot-0 power; absent on old saves = the native hero). UI: the Ancient offer and
  Recruit's sell-text state use the pairing hero id.

**Replays / saves.** Replays are state replays (recorded frames, no re-simulation), so no revision gate was needed.
In-flight saves pick up the new rule; the two new optional fields fall back to the old native reading.

**Not changed.** Turn-1 identity setups (createRun grants, Disco Dan's lock, Mimic/Void scheduling). Second Calling
still skips adoption-time setup (`seedAdoptedPower`), so a Guardian power arriving that way books no forge (pre-existing).
An adopter's forge rune is a plain rune, not a hero-slot grant (`heroGrantArt` stays native-only).

Tests: `packages/sim/src/heroPowerHeldPassives.test.ts`.
