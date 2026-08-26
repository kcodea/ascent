# 2026-08-26 — Run-state carry-over: War Drum/Warm Embers combat carry + the Doc Bot carry-over scan

## The bug class (blind spot 1: the recruit→combat bridge)

Owner report: Rune of the War Drum's charge lived ONLY on RunState (`runeWarDrum` + the per-turn latch
`runeWarDrumUsedThisTurn`) and was consumed ONLY by the recruit-side Shout counter (`playedShoutRepeats`).
An UNSPENT charge simply evaporated at combat. Owner ruling (verbatim intent): *"rune of the war drum should
have a 1/1 use, and that use resets at start of turn, therefore if it is not used in shop, then the first
shout triggered in combat should work."* Warm Embers' legacy `shoutDoubleCharges` had the identical shape,
and the same logic extends: unspent charges apply to the first N combat-triggered Shouts.

## The behaviour fix

- `QuestCombatMods` (core/types.ts) gained `warDrumExtra` (present ONLY while the shop charge is unspent) and
  `shoutDoubleCharges` — both documented with the ruling.
- `questCombatMods()` (sim/reducer.ts) threads them: `warDrumExtra = runeWarDrum && !runeWarDrumUsedThisTurn`,
  `shoutDoubleCharges` passes through. Because SNAPSHOTS build their questMods through the same function, a
  served rival's unspent charges carry onto its own side for free — no snapshot-type change needed.
- `simulate()` keeps per-side spend trackers and exposes `ctx.shoutCarryExtras(side)`; `replayCombatBattlecry`
  consumes it once per combat-triggered Shout: first Shout gets the full War Drum multiplier, each of the next
  N gets one Warm Embers extra fire — they STACK on the first Shout, mirroring the recruit counter's
  semantics (War Drum is its own latch). Guarded on a real `onPlay` effect so a Shout-less re-fire never
  eats a charge. No RNG consumed; replays reproduce.
- Judgement call (flagged in the PR): a Warm Embers charge spent IN COMBAT does **not** decrement the run's
  charge pool — there is no carry-back channel for it, and War Drum's per-turn reset makes the question moot
  for the headline rune. If the owner reads that as double-dipping, a carry-back field is the follow-up.

## The instrument (Doc Bot carry-over scan)

`packages/sim/src/docbot/carryOverScan.ts` + `carryOver.test.ts`. The subject list is DERIVED, not
hand-curated: the reducer's turn-rollover reset block is fenced with `PER-TURN-RESET BEGIN/END` markers, the
test reads reducer.ts at run time and regexes every `s.<field> = …` clear between them — any new per-turn
field is auto-swept the day it lands (plus `EXTRA_CARRY_SUBJECTS` for charge pools like `shoutDoubleCharges`
that no rollover ever clears). Per field: resolve the SAME combat through the real bridge
(`faceOmen` → `questCombatMods` → `simulate`) armed vs unarmed, same seed, diff the full serialized
`lastCombat` (with `oddsInput` stripped — it echoes the built questMods, and comparing it would mark a
threaded-but-UNCONSUMED field as differing, making the scan vacuous). Identical ⇒ needs a verifiable excuse
in `CARRY_OVER_EXCUSED`; a stale excuse (field now differs) fails; needs-triage is ratcheted at 2.

War Drum's latch and `shoutDoubleCharges` show up as DIFFERING — the scan's own proof the bridge exists —
and a sabotage-guard test pins the armed/unarmed diff at the `simulate()` boundary itself, so removing the
threading is caught twice.

### Findings the scan surfaced on its first run

- **Rune of Spellhide's SoC re-cast lane is dead through the real bridge**: the consumer matches combat
  `m.uid` against the RUN uid, which the reducer carries on `sourceUid` (combat uids are minted fresh by
  `instantiate`). The rune was archived 2026-08-12, so no live impact — excused as needs-triage, spun off as
  its own task (fix the match Soulbind-style via `sourceUid ?? uid`, or retire the lane, owner's call).
- **`shoutExtraTurn` (GIFT — Demand an Encore)** is the other needs-triage: "your Shouts trigger an extra
  time THIS TURN" arguably should carry to combat-triggered Shouts exactly like the War Drum. Needs a ruling.

Not integrated into the docbot CLI/barrel here — another session owns that integration; the lane runs as
standalone Vitest files.
