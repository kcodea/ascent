# 2026-08-27 — Combat trigger-multiplier fixes (three owner rulings)

Three fixes from the 2026-08-27 triage board, all the same shape: a trigger fired through a non-native path
and skipped the multiplier fold the native path applies ("multipliers follow the trigger", owner principle
2026-08-20).

## 1. Combat Shout re-fires fold the Battlecry multipliers (`q-interact-combat-shout-multipliers`, APPROVE)

Ryme / Dawnclaw / Thunderous Sovereign / Chorus Drake already folded `drakkoRepeats`; **Parting Cry** and the
arena `replayShout` consumers (**Embercrest**, **Rune of Ancestral Roar**, **Rune of Shared Scripture**,
**Rune of the War Chorus**) fired flat. Fixes:

- `packages/core/src/effects/factories.ts` — the combat arena `replayShout` verb now folds `drakkoRepeats`
  **inside the verb**, mirroring the shop's `replayBattlecry` → `drummerRepeats` boundary, so every arena
  consumer inherits the fold and cannot drift flat again. `drakkoRepeats` is now exported.
- `packages/core/src/combat/simulate.ts` — the Parting Cry death branch and the three rune dispatch sites
  (Shared Scripture / Ancestral Roar / War Chorus) loop `drakkoRepeats` around their firing block. Once-per-
  combat latches (Scripture, War Chorus) are unchanged: one TRIGGER, N fires. The Scripture's free Rally is
  untouched (Drakko is a Battlecry multiplier).

## 2. Empty Graves' forced Echo multiplies (`q-interact-empty-graves-flat`, APPROVE)

The `emptyGravesRally` attack branch ran the left-most Echo exactly once per attack. It now fires
`(1 + playerEchoExtras) × the marked body's gild` procs — one `asEcho` wrap per proc, deaths deferred across
all procs — matching the Herald / `triggerEcho` conventions. The gild fold mirrors `triggerEcho`'s
"the FIRER's gild doubles the whole count" (the marked attacker is the firer); flagged as a judgement call in
the PR. Also rewrote the quest's stale player-facing reward line in `packages/ui/src/questText.ts` (it still
described the pre-2026-07-21 Gravebody design).

## 3. Gilded Exgalloper's copies are gilded (`q-copy-gilded-badge`, REVISE)

Owner: "gilded exgalloper's summons should be exact copies without the echo, so they would be gilded too."
`echoSummonCopyNoEcho` now passes `golden: arena.self.golden` to `summonToken` (both phase adapters set the
flag without re-doubling the explicit exact stats), matching `scSummonCopy` / Mirrorhide. Gild still also
doubles the copy COUNT, per the printed gilded text. No renames — the owner's upcoming "Rebirth" keyword is
their own work.

## Pins flipped / bookkeeping

- `interactionFamilyMatrix.test.ts` — coverage-table rows "battlecry × combat replay" and "Empty Graves"
  flipped AMBIGUOUS → PINNED; new fixtures P9 (Parting Cry × Drakko), P10 (Embercrest / arena `replayShout`
  × Drakko), P11 (Empty Graves × Sylus / gild).
- `runeBatch4T4.test.ts` (Ancestral Roar ×2, Shared Scripture ×2-Shout-1-Rally) and `runeBatch10.test.ts`
  (War Chorus ×2, latch intact) pin the rune paths.
- `set2Dwarves.test.ts` — gilded Exgalloper summons gilded exact copies; plain stays plain.
- `docs/rulebook/interaction-ambiguities.md` — Q2 and Q3 marked RESOLVED with the ruling ids.
- `textOracleSummons.ts` — the `dw_exgalloper` needs-triage excuse deleted (ruled + fixed); the test's
  triage ratchet tightened to 0.
- Patch notes prepended (Combat Trigger Fixes).
