# 2026-10-03 — A triggered Shout is a Shout, across the board (R-SHOUT-TRIGGER-01)

Owner report: "auctioneer w/ rune of the choir does not work and it should. why doesn't it work? please fix it and
wire the logical fix and reasoning into the oracle for docbot". Follow-up ruling on PR #1933: "yes pulse or other
triggering options should absolutely trigger the extra shouts in this case. make sure all of this logic works
across the board. are the other runes fixed now too?"

## Root cause

There was no single answer to "how many times does this Shout fire, and who hears each fire". Each site counted for
itself:

- **Shop, played** (`playCard`, `applyBattlecryTarget`, Funeral on Loan): Drakko + the standing extras
  (`shoutExtraAlways`: Choir / Blasting Voices / Hoardwake / Resonant Path / Orivax; `shoutExtraTurn`: Encore) +
  the per-turn charges (Warm Embers / Opening Act, War Drum).
- **Shop, triggered** (`replayBattlecry`: the Auctioneer's Pulse, Echoing Roar, Resonance, Ryme in the Shop, Last
  Word, Crucible Choir, Moira): Drakko only. So Pulse with the Choir fired once.
- **Combat:** `questCombatMods` carried no Choir, no Warm Embers freebie and no Twin Sun / Drake Skull. A carried
  extra fire (War Drum, Encore) ran the effect but emitted no `battlecryTriggered`, so the Shout tally and every
  Shout watcher missed it.
- **Forced combat Shouts:** Rune of Shared Scripture, Rune of Ancestral Roar and Rune of the War Chorus looped the
  onPlay factories by hand: no extras, no `battlecryTriggered` (no tally, no Karwind / Bane / Embermouth), and only a
  narration line instead of a counted `shout` beat.

The Doc Bot interaction matrix had pinned the Shop gap as deliberate (P2, "a replay is not a play"), resting on a
code comment rather than an owner ruling.

## Fix

- **Shop:** `shoutFireCount(state, def)` in `recruit.ts` (was `playedShoutRepeats`) is the ONE fold for every played
  and triggered Shout: Drakko + standing extras + the per-turn charges, which a triggered Shout now SPENDS. It bumps
  `runeProcs.rune_choir` / `rune_war_drum`, so the badges pulse on a Pulse.
- **Combat:** `replayCombatBattlecry` is the ONE chokepoint (reached through `fireShout`). It folds
  `ctx.shoutCarryExtras` and emits `battlecryTriggered` once per fire, extra fires included, each extra with its own
  counted `shout` event. Callers no longer emit the notify themselves (Parting Cry did).
- The three forced rune Shouts now go through `fireShout`.
- New `QuestCombatMods`: `shoutExtraAlways` (the Choir family), `warmEmbersFirst` (each fight's own first-Shout
  double, per R-SHOUT-01), `shoutEdgeBuff` / `shoutEdgeTribeBuff` (Twin Sun Oath / Drake Skull in combat, a combat
  buff for that fight, badge via `questTrigger` `twinSunOath` / `runeDrakeSkull`). The Choir's combat badge rides
  `questTrigger` `runeChoir`.

## Doc Bot

New lane `shoutTriggerParity` (`packages/sim/src/docbot/shoutTriggerParity.ts` + test, printed by `npm run docbot`):

- SOURCE: every Shop scope that fires a Shout must read `shoutFireCount` (the settle replay is excused, with its
  reason); every combat `onPlay` dispatch must read `shoutCarryExtras` and notify per fire; only
  `replayCombatBattlecry` may emit `battlecryTriggered`.
- BEHAVIOUR: `shoutModifierMatrix()` drives 6 modifier sets × 8 entry paths (48 cells), checking fires, tally,
  watcher, edge buff and charge latch. On the pre-fix engine, 40 of 48 cells failed. All 48 pass now.

`interactionFamilyMatrix` P2 flipped; `firePaths` lost the three retired simulate.ts onPlay sites; `combatModScan`
stages the new mods. Oracle: `R-SHOUT-TRIGGER-01` (triggers.ts); R-SHOUT-01's current-behaviour note updated.

## Parliament of Flame × Chronos (owner: "does parliament work w/ chronos? if so that's fine")

It works: the live End of Turn path folds both into `endOfTurnRepeats` (1 + Chronos + Parliament, additive), pinned
in `auctioneerChoir.test.ts`. The Chronos HERO (`chronoshero`) is WIP and only grants the Chronos minion anyway. The
one path that skips Parliament, `replayEndOfTurn`, is reached only by Djinn's power, and Djinn is WIP. Left as is.

## Judgement calls

- Twin Sun Oath / Drake Skull in combat give a combat buff for that fight (like the Starsong), not a permanent one.
- Warm Embers in combat: each fight gets its own first-Shout double (R-SHOUT-01's "each shop or combat phase"),
  regardless of whether the Shop spent its charge. The War Drum keeps its 2026-08-26 ruling: only an UNSPENT Shop
  charge carries to combat.
