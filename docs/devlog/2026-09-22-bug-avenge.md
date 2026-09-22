# 2026-09-22 — Bug 8e0b4757: a summoned Avenge minion printed the side's death tally as its own progress

Owner report from a wave-7 Merrin lobby fight: *"the bull beast card summoned dunkey which summoned with 2/4
avenge stacks when it should be 0 since it is a fresh body on board."* Triaged from the capsule, not the
description: the serialized run's `lastCombat` (the sim's real `initial` + 45-event log) shows Bullseye (m0)
dying as the 2nd friendly death and its Echo summoning a 7/7 Dunkey (m14) at step 8.

## Where the wrong number came from

- **The sim was right on this path.** `placeSummon` (`packages/core/src/combat/simulate.ts`) stamps
  `avengeBaseline = deaths[side]` on every summon that goes through it (the 2026-08-24 fix, rule R-AVWIN-01
  "Late entry starts at zero"), and `avengeCountFor` subtracts it. Bullseye's Echo goes through `ctx.summon` →
  `summonMinion` → `placeSummon`, so Dunkey's own window opened at 0. The captured log agrees: Dunkey never
  paid (the only Avenge payoff is Kennelmaster's at the side's 4th death), and a `simulate()` reconstruction
  of the shape (Bullseye 2nd death → Dunkey) puts the Armadiyo at the side's 6th friendly death.
- **The readout was wrong.** `computeFrame` (`packages/ui/src/useCombatReplay.ts`) keeps a per-uid
  `avengeBase` map mirroring the sim's baseline, but stamped it only in the `reborn` branch (the Rise rule
  from 2026-08-08). The `summon` branch never stamped it, so `avengeSeen = deaths.player - 0` and the combat
  card printed 2/4 on arrival and 3/4 after the next death, exactly what the owner saw. A stale printed
  number is a defect under the live-text rule (CLAUDE.md).

## The fix

One line in the `summon` branch: `avengeBase.set(e.minion.uid, deaths[e.side])`. It reads the same tally at
the same moment the sim does: the death that summoned the body is counted before its Echo fires, and the
log carries `death` before `summon`; neither presentation reorder (`deferClashBuffs`,
`deferAvengeAfterSummons`) moves a summon ahead of a death. Deferred attack-on-summon tokens emit their
`summon` at the flush, which is also when the sim stamps them. No sim change, no event change, no new event.

## Tests

- `packages/ui/src/avengeSummonReadout.test.ts` + `avengeSummonReadout.capsule.json`: the captured fight
  (data only: `initial` + events, no player text or ids) folded through `computeFrame` as the arena does.
  Dunkey reads 0/4 on its summon beat and 1/4 after the next friendly death; Kennelmaster (start of fight)
  still reads 3/4 there. Plus a hand-built log walking a Dunkey summoned after 2 deaths from 0/4 to 4/4 over
  the next four deaths while a start-of-fight body wraps 2/4 → 4/4 → 2/4. Both failed before the fix (2/4 and
  3/4 observed).
- `packages/core/src/combat/avengeSummonBaseline.test.ts`: the sim half. Seed 1, Bullseye 1/1 second on a
  board of vanilla 1/1s vs a 1/400 wall, pool forced to Dunkey: Dunkey lands at the 2nd death, the Armadiyo at
  the 6th, and the `avengeCountFor` observer reads baseline 2 / seen 0 on arrival. Verified red with the
  baseline stamp reinjected to 0 (Armadiyo at the 4th death).

## Review follow-up: the one summon path that bypassed the stamp (Soren's Reclaim)

Review found that `flushResummons` (The Reclaimer's resummon) inserts the copy straight into `boards[side]` via
`instantiate` + `splice`, never touching `placeSummon`, so the reclaimed body kept baseline 0 and counted its
OWN Start-of-Combat destruction: a reclaimed Kennelmaster paid its Avenge (4) at the side's 4th death rather
than the 4th after its return, while the readout (which stamps on every `summon` event) printed 0/4 on return
and 3/4 on the beat the sim fired. `docs/GAME-RULES.md` says progress restarts "as any body placed mid-combat",
so the sim side was the one out of rule. Fixed by stamping `copy.avengeBaseline = deaths[side]` right after the
splice (the destruction was already tallied by `killOrReborn`, so the copy reads 0). This IS a gameplay change
on the Soren + Avenge interaction (one death later), noted as Balance in the patch note. Guarded both ways:
`avengeSummonBaseline.test.ts` (improve at the side's 5th death, observer baseline 1) and
`avengeSummonReadout.test.ts` (0/4 on return, 4/4 on the beat the improve fires) on the same seed-1 log.
Mossmemory Colossus's `resummonDeadBeasts` and Rise/Rebirth already go through the stamped chokepoints.

The capsule could not be re-simulated through the reducer in a hermetic test: the lobby pairs from the
session's seat boards, and a seed+actions replay serves the procedural threat instead, so the captured
`lastCombat` (the authoritative sim output) is the fixture rather than a `faceOmen` re-run.

Patch note: Systems (the readout) + Balance (the Reclaim path, one death later).
