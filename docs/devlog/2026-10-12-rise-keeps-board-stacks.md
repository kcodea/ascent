# 2026-10-12: A combat Rise no longer wipes the Shop card's stacks (R-RISE-06)

Owner report: "my kennelmaster just lost all of its stacks of the attack buff and i have no idea why". A gilded
Kennelmaster with a granted Rise died in combat and Rose. The Rise resets the body's per-instance accruals (R-RISE-01),
and since 2026-10-08 (old R-FLORIDA-01) `carryBacksFor` deliberately wrote the risen body's reset `summonBonus` (0
included) back to the board card, so the Shop card lost every stack.

Owner ruling (2026-10-12): "a minion rising in combat would rise with the reset values, yes, but then back in shop
phase it's still the original copy w/ the stack values from before. basically think of it like... rise rises a 'fresh
copy' of something, but that is a combat only thing. the recruit phase would still have the original copy with all
its stacks."

## What changed

- **`simulate.ts`**: a new `riseCarry` map freezes the ORIGINAL body's carry-back fields at its first Rise (before the
  reset): `summonBonus`, `hpGrantBonus`, `spellProgress`, Tara's buff count, `permaGain` / `permaRuby` /
  `permaLabel`, and the Engraved label flag. `carryBacksFor` reads every per-instance channel through a `view(m)` that
  prefers that snapshot, so the board card gets what the original had when it died. `risenUids` is gone. One path for
  both sides, so `enemyCarry` (lobby snapshots) matches.
- **Second Wind exception**: Rune of the Second Wind's "+2/+2 permanently" lands on the risen copy but is about the
  Rise itself (R-SET3RUNE-08), so `runeRiseRunes` also books it onto the snapshot.
- **Copied Echo**: `grantCopiedEcho` on a risen copy (Gravetwin's Shout re-fired after a Rise) no longer reaches the
  board card.
- **Combat readout**: `computeFrame` (`useCombatReplay.ts`) now mirrors the sim's Rise reset of `summonBonus`,
  `hpGrantBonus`, `eotBonus`, `sellBonus` and `overflowBonus`, so a risen Kennelmaster's combat text prints its reset
  value. It used to keep printing the original's stacks (a display-vs-sim divergence that predates this fix).
- Oracle: R-FLORIDA-01 amended; new R-RISE-06. GAME-RULES gains a short section.

## Per-channel, for a body that Rose in combat

| Channel | Before | After |
| --- | --- | --- |
| `summonBonus` (Kennelmaster, Flo Rida, Beardsley...) | risen body's value, 0 included (stacks wiped) | original's value at death |
| `hpGrantBonus` (Sergey) | reset to undefined; only post-Rise regrowth carried (lower than the card's), else card kept pre-fight value; pre-death growth lost | original's value at death |
| `spellProgress` (Guel, Spirit Pup) | not reset; pre + post-Rise casts carried | original's value at death |
| `damageMeters` (Pummel) | not reset; pre + post-Rise hits carried | UNCHANGED: R-PUMMEL-01 says the lifetime tally survives a Rise (goldvein + set3Dwarves tests pin it) |
| `ascendCount` (Tara) | not reset; pre + post-Rise grants carried | original's count at death |
| `permaBuffs` (Engraved gains, permanent gifts, Rubies) | not reset; pre + post-Rise gains carried | original's at death, plus Second Wind |
| `copiedEchoes` (Gravetwin) | a risen copy's graft carried | combat only |
| `eotBonus`, `sellBonus`, `overflowBonus`, `chefGrantedLast`, Avenge baseline | reset in combat, never carried back | unchanged |

Side-level carry-backs (quest tallies, rune meters, hand grants, auras) are not per instance and are untouched.

## Not changed (reported)

- **Rebirth** returns the full body with every counter, so it is the same copy and keeps carrying back as before. A
  Rebirth body that later Rises snapshots at that Rise.
- **The Reclaimer's resummon** copies the exact body (every per-instance field, same `sourceUid`): also the same copy,
  unchanged.
- **Shop-phase Rise** (`riseReturn` in `recruit.ts`) builds a fresh `BoardCard` with a new uid, and that card becomes
  the board card, so a Shop Rise still permanently drops the stacks. Out of scope for this ruling; flagged for the owner.
