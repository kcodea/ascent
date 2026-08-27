# 2026-08-27 — The "THIS TURN" rule: shop through combat (R-TURN-01/02) + Demand an Encore carry

## The ruling (owner, 2026-08-27, deciding q-carry-demand-encore — verbatim, now LAW)

> "'This turn' terminology runs from shop through that turn's combat, and ends at the start of the next
> shop turn. so this effect should absolutely carry over into combat. use this language and logic moving
> forward and to retroactively fix issues."

Also ruled (q-carry-warm-embers-double-dip + chat confirmation): Warm Embers' current behaviour is
**correct** — a charge consumed by a combat-triggered Shout and the next turn's fresh charge are separate;
no double-dip fix wanted.

## What shipped

- **`R-TURN-01` + `R-TURN-02`** appended to `packages/rules/src/registry/approved.ts` with the owner's
  verbatim wording as evidence, both with scenario enforcement (`shoutCarryOver.test.ts`,
  `docbot/carryOver.test.ts`, `docbot/thisTurnRule.test.ts`).
- **Demand an Encore fixed** through the PR #1226 carry channel: `questCombatMods()` threads
  `s.shoutExtraTurn` as the new `QuestCombatMods.encoreExtra`; `simulate()`'s `shoutCarryExtras` adds it to
  **every** combat-triggered Shout. Deliberately a turn-long **buff**, not a charge — no latch, nothing
  consumed — because that is exactly how the shop counter treats it (`n += state.shoutExtraTurn` on every
  played Shout). It stacks with the War Drum latch and Warm Embers charges, mirroring `playedShoutRepeats`.
- **The retroactive sweep** (`packages/sim/src/docbot/thisTurnRegistry.ts` + `thisTurnRule.test.ts`): the
  subject list is **derived** — every content def (cards + golden texts, runes, quests, gifts, hero powers)
  whose printed text says "this turn" must carry a classification (`conforms` / `no-combat-meaning` /
  `violation-fixed` / `confirmed-violation`), ratcheted so a new "this turn" effect must classify itself and
  a confirmed violation can never be added silently. **Sweep verdict: Demand an Encore was the only
  violation.** Everything else either reads a tally that is threaded into the combat side
  (Drunken Oaf/Ales, Abhorrent Horror/Fodder, Runescale/spells, Sable's Soulbind), resolves at End of Turn
  or at cast while the tally is live, replays at **settle** before the rollover clears the field
  (Recaller, Baby Gastrid — settle is inside the turn, so the R-TURN-01 window holds), or has no combat
  consumer at all (shop costs/sells/buys/offer-enchants/plays-from-hand).
- `CARRY_OVER_EXCUSED` updated: the `shoutExtraTurn` needs-triage entry **deleted** (the scan now proves it
  differs through the real reducer bridge), and the shout/cost entries cite R-TURN-01/02.

## Gotcha for future carries

"Deferred to settle" **satisfies** R-TURN-01: `replayEconomyBattlecry` runs before the turn rollover, so an
economy Shout re-fired in combat still reads the turn's `goldSpentThisTurn` / `lastSpellThisTurnId` etc.
Don't re-classify those as violations — the window is intact even though the payout lands post-fight.
