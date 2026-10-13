# 2026-10-13 · Vaultkeeper and Alchemist Brisbane reworked; Mountainbond T6; Mineral Master archived

Owner: "lets change vaultkeeper again, he just isn't fun", "also lets adjust brisbane", then "lets move mountainbond
to a t6 and archive mineral master".

## What changed

| Card | Before | After |
|---|---|---|
| Vaultkeeper | When this gains Attack, give adjacent Dragons +3/+4 | When you play a Dragon, gain +3/+3. Play 3 Dragons or Dwarves to improve this (+3/+3 per step; gilded doubles) |
| Rune of the Vaultkeeper | Your Vaultkeepers buff all Dragons | Your Vaultkeepers also give their stats to an adjacent Dragon (its pre-10-10 effect) |
| Alchemist Brisbane | Shout and Echo: Rubies +1/+1. End of Turn: a Ruby on each Kobold | Shout, Echo and Rally: Rubies +2/+2. Spend 30 Gold to improve this (+2/+2 per step; gilded doubles). No End of Turn. Gains the Rally keyword |
| Mountainbond | Tier 5 | Tier 6 (stats and effect unchanged; it is shared with Set 3, so it moves there too) |
| Mineral Master | Tier 6 7/9, set 2 | ARCHIVED (`cards/archive.ts`) |

## Owner answers (asked before building)

- Vaultkeeper's gain grows **+3/+3 per step**.
- Brisbane's grant grows **+2/+2 per step**.
- Brisbane's End of Turn Ruby cast is **removed**.
- Rune of the Vaultkeeper goes back to its **old effect**.

## How it is built

**Vaultkeeper** rides the played-from-hand trigger (`onTribePlayed`), so a summoned token is not a play.

- `fireOnTribePlayed` learned `tribes` (any-of) beside the single `tribe`. A dual-type or All-types body is ONE play.
- New recruit factory `tribePlayedGainSelfImproving { tribes, gainTribe, attack, health, every }`. Each matched play is
  one count on the copy's tribe-played tally (`spiritTally`, the field Aspect and Festival Keeper use). A `gainTribe`
  play pays `+attack/+health x (1 + floor(tally before / every))` first.
- Reusing `spiritTally` + an `every` param means the existing N/3 step counter draws itself with no UI change.
- The rune's adjacent-Dragon share is the pre-10-10 block, moved into the new factory (seeded pick when both
  neighbours are Dragons).
- Shop only by nature: nothing is played from hand in combat.

**Brisbane** keeps her three Ruby-strength factories and gains one fold.

- New `improvingGrant(params, accrued)` in `core/effects/arena.ts`: `attack + improveAttack x accrued` (same for
  health), un-gilded. Read by `rubyStatGain` (both phases), `deathrattleRubyStatGain` and `rallyRubyStatGain`. A
  card with no `improve*` params is unaffected whatever its accrual holds (pinned on Scrapper).
- New recruit factory `goldSpentImproveSelf { every: 30 }`: one improvement on the copy's `summonBonus` each time
  `applyGoldSpent`'s per-copy meter crosses 30 (the meter carries across turns), x Rune of Mastery like every other
  improve. `summonBonus` already travels into combat and back, so the Echo and every Rally read it.
- The existing Gold step counter (N/30) draws itself.

**Live text** (the hard rule): `vaultkeeperText` and `improvingRubyGrantText` in `cardText.ts`, plugged into the one
`liveCardText` chain the Shop and combat share. Both print the current number in green once it has stepped up.

## Judgement calls (owner to confirm)

- **Grant, then count.** The Dragon that completes a set of 3 still pays the old value; the NEXT Dragon pays the
  improved one. This is the Beardsley / Conductor order, not an owner ruling.
- **Vaultkeeper never counts its own arrival**, and a second Vaultkeeper played IS a Dragon for the first one.
- **Brisbane improves only on the board.** A copy in hand earns nothing (the Gold meter runs on board bodies).
- **Gilded** doubles the applied gain / grant, base and steps alike.
- **Rune of Mastery** doubles each Brisbane improvement, but does not speed Vaultkeeper's count (a tally, like Aspect).
- Mineral Master is dropped from the bundled "Combat Rubies" guide's enablers. The server copy of that guide (guides
  moved to the server on 2026-10-12) is not touched by this PR.

## Left dormant on purpose

- `onGainAttackBuffAdjacentTribe` (the 10-10 pulse) has no card. The factory, its Shop dispatch and loop guard stay,
  pinned through a probe def in `dragonBatch1010.test.ts`; R-VAULT-01 is amended to say it is dormant. Its policy row
  is removed (the no-ghost tripwire). The combat-side rune wiring (`QuestCombatMods.runeVaultkeeper` -> `all`) is still
  connected to that dormant factory: a cleanup candidate for whoever next touches `core/types.ts`.
- `endOfTurnPlayRuby` now has one card (Assembler, always `excludeSelf`). The tests that used Brisbane as its fixture
  moved to Assembler.

## Oracle

- R-VAULT-01 amended (dormant). New R-VAULT-02 (Vaultkeeper + rune) and R-BRISBANE-01, both citing the owner's words
  and `vaultBrisbane1013.test.ts`.

## Verification

- New `packages/sim/src/vaultBrisbane1013.test.ts` (23 tests) and `packages/ui/src/vaultBrisbaneText.test.ts` (7).
- Re-pinned: rubies, liveTelemetry, rubyPlayWatchers, koboldBalance1011, instView, docbotLiveText (RICH bag),
  dragonBatch1010 (probe), and whatever the census / roster tests reported for the tier move and the archive.
