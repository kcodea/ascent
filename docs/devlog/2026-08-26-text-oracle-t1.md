# Text as oracle, tranche 1 — printed stat buffs reconciled against measured deltas

**Doc Bot tripwire 14** (`packages/sim/src/docbot/textOracle.ts` + `textOracle.test.ts`). The differential
scans prove an effect does *something*; the magnitude oracles prove three hand-ruled families grant what
their *params* say. This lane closes the bigger gap for the largest effect family — stat buffs — by using
the owner's live-text hard rule (CLAUDE.md, 2026-07-02) as an executable oracle: **parse the first `+A/+H`
from the card's live text, run the effect through its real driver, and assert some recipient's measured
delta equals the printed pair** (goldenText's pair when gilded). A mismatch is a defect either way
(magnitude bug or stale text), so the alarm is always right.

## Shape

- **Subjects from the effect side:** the buff family is derived on every run by brace-scanning the two
  factory maps (`RECRUIT_FACTORIES`, `FACTORIES`) for bodies that reach the buff primitives
  (`ctx.buff`/`addBuff`/`cardBuff`/buff-named helpers) — 41 factories, 36 subject cards as of today.
- **Four lanes:** `cast` through the real reducer (target on a retribed clean token); `onPlay` with the
  two-step `pendingTarget → battlecryTarget` aim; `endOfTurn` through `applyEndOfTurn`; and the combat
  triggers (`onDeath`/`startOfCombat`/`onAttack`/`onKill`/`avenge`/`onDamaged`) reconciled against the
  `simulate()` **'buff' event log** filtered by source.
- **Run-wide channels count as recipients:** `spellBonus` / `rubyBonus` / `impBuff` movements are (ΔA, ΔH)
  candidates, so "your Shop spells gain +1/+1" reconciles like a board buff. Snapshot these **by value** —
  `grantSpellPower` mutates the object in place, which silently zeroed the first draft's EoT deltas.
- **LIVENESS lane:** arm +2/+3 spell power, re-read `spellDisplayText` (the same helper the UI reads),
  and demand the cast grant the re-parsed number — the live-text rule executed end to end (4 spells).
- **Arming, not excusing:** `alesLastTurn: 1` and `align: 'dawn'` are baked into the combat fixture;
  `ORACLE_ARM` stages per-card accruals (Pack Leader's `summonBonus`) at exactly the printed rate.
- **Excuses + two-sided ratchet:** `ORACLE_EXCUSED` (2 entries, both `aggregate-grant`: Blessing applies
  its pair *twice* to one target; Hungerling's Rally enchants the *shop*) with stale-entry checks, a
  subject-surface floor, a ceiling of 2, and `needs-triage` pinned at 0. A `confirmed-bug-pending-fix`
  kind exists for verified real bugs; **none were found** — all 64 lane runs reconcile.
- **Sabotage-proofed:** a +1-off printed value alarms in every lane class, unit and end-to-end.

## Fixture lessons (worth not re-deriving)

- Seven identical Pups **triple-combined mid-measurement** — fixture rows need distinct clean-token ids
  (retribed instances; shop `isTribe` reads instance tribe first).
- The shout/EoT row carries Fred (FD) and the Attachment token (M) so Fodder/Attachment grants have
  recipients; the combat board carries an Imp, an `RL`-keyword ally, and an Attachment for the watchers.

No gameplay changes; no patch-notes entry.
