# 2026-10-03 — A triggered Shout is a Shout: Rune of the Choir now works with the Auctioneer (R-SHOUT-TRIGGER-01)

Owner report: "auctioneer w/ rune of the choir does not work and it should. why doesn't it work? please fix it and
wire the logical fix and reasoning into the oracle for docbot".

## Root cause

There was no single answer to "how many times does this Shout fire". Each fire site counted for itself:

- **Shop, played:** `playedShoutRepeats` = Drakko + `shoutExtraAlways` (Choir / Blasting Voices / Hoardwake /
  Resonant Path / Orivax's Chorus) + `shoutExtraTurn` (Encore) + the per-turn charges.
- **Shop, triggered:** `replayBattlecry` (the one shared re-trigger: the Auctioneer's Pulse, Echoing Roar, Resonance,
  Ryme in the Shop, Last Word, Crucible Choir, Moira) = Drakko only. So Pulse with the Choir fired once.
- **Combat:** `shoutCarryExtras` carried War Drum / Warm Embers / Encore, but `questCombatMods` had no field for the
  permanent extras, so the Choir did nothing in combat at all (Blasting Voices even says "in combat").
- **Forced combat Shouts:** Rune of Shared Scripture, Rune of Ancestral Roar and Rune of the War Chorus looped the
  onPlay factories by hand and read none of the Shout extras.

The Doc Bot interaction matrix had pinned the Shop gap as deliberate (P2, "a replay is not a play"), resting on a
code comment rather than an owner ruling.

## Fix

- `standingShoutExtras(state)` in `recruit.ts`: the one Shop fold for the standing extras, read by both
  `playedShoutRepeats` and `replayBattlecry`. It bumps `runeProcs.rune_choir`, so the Choir's badge pulses on a Pulse.
  The per-turn charges (Warm Embers, War Drum) stay play-only in the Shop.
- `questCombatMods.shoutExtraAlways` (new `QuestCombatMods` field) folded into `ctx.shoutCarryExtras`, which emits a
  `questTrigger` `runeChoir` (mapped to `rune_choir` in `questFlags.ts`) so the badge pulses in combat too.
- The three forced combat Shout loops now read `ctx.shoutCarryExtras` per fire, like `replayCombatBattlecry`.
  Side effect: an unspent War Drum / Warm Embers / Encore carry now also lands on these three runes' Shouts,
  which matches R-SHOUT-01 ("the first Shout triggered in combat").

## Doc Bot

- New lane `shoutTriggerParity` (`packages/sim/src/docbot/shoutTriggerParity.ts` + test): derives every Shop and
  combat site that fires a Shout from source, and fails any that does not read its phase's fold. On the pre-fix
  source it named exactly the four deaf sites above. Behaviourally, a standing +1 must double every entry path.
- `interactionFamilyMatrix` P2 flipped to the ruled behaviour; `combatModScan` stages the new mod.
- Oracle: `R-SHOUT-TRIGGER-01` in `packages/rules/src/registry/approved/triggers.ts`.

## Listed, not fixed (same shape, other family)

- Parliament of Flame's `endOfTurnExtra` is not read by `replayEndOfTurn` (Djinn's power). Djinn is WIP
  (withheld from every picker), so it is not live.
- Rune of the War Drum says "the first Shout you **trigger** each turn", but in the Shop its latch is only spent by a
  played Shout (combat already spends it on a triggered one). Left as is: moving it would let a Pulse use the charge
  before a played Shout, which is a design call.
