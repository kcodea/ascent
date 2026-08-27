# Triage round 2 — every open owner question on the Rulebook board (2026-08-27)

**What:** 24 hand-authored pending cards in a new registry tier, `packages/rules/src/registry/pendingManual.ts`
(`MANUAL_PENDING`), wired into `allRules()` so the DEV MENU → Rulebook Triage board shows them, decisions apply
to them, and — crucially — `npm run rules:seed` never touches them (verified: a reseed leaves the file
untouched; hygiene only rewrites `pending.generated.ts` / `retired.generated.ts`).

Owner ask: *"i need it to explain in simple terms/detail with examples what is wrong and then i can answer."*
Every card meets the 2026-08-26 format bar: verbatim printed text of every card/rune/gift/power involved,
one concrete play-by-play example, what the code does TODAY (each claim re-verified in source this session),
and explicit ✓/✎/✕ click semantics.

## The four groups

- **`q-runedup-*` (8)** — the per-family rune duplicate stacking proposal
  (`docs/rulebook/rune-duplicate-stacking-proposal.md`; the owner rejected "duplicates do nothing" on
  2026-08-26). One click rules a family: recurring/per-event (28 runes), threshold meters (8), repeat (+1 per
  copy, 7 dead + the classic repeat rewards), one-shot re-grants (8), boolean combat flags (fire once per
  copy — note only the `runeAvenge` dispatchers consume `flagCopies` today), the universal sweetener floor,
  the forge filter, and the unique-engine default (29 + Happy Birthday).
- **`q-copy/carry/snap-*` (8)** — gilded-copy badge asymmetry (`scSummonCopy` keeps gild,
  `echoSummonCopyNoEcho` pays gild in count), Demand an Encore's non-carry vs the War Drum precedent, Warm
  Embers' combat double-dip (#1226), and the snapshotRegistry needs-triage set: `impBank`, `rallySpreadAtk`,
  the dropped one-combat marks (Parting Cry / Reclaim / Closed Casket vs carried bloodlust), `grantedEffects`,
  `echoStripped`.
- **`q-order-*` (4)** — the four order ambiguities from `docs/rulebook/order-ambiguities.md`, enriched with
  the concrete fixtures from `orderGoldens.test.ts` (G2/G3/G4/G6).
- **`q-interact-*` (4)** — the trigger-family matrix's compositions: non-stacking best-of across different
  cards, combat Shout re-fires vs Drakko, Empty Graves' flat forced Echo, the first-Echo bonus on forced
  triggers.

## Claims that did NOT survive verification (fixed in the cards)

- `docs/rulebook/interaction-ambiguities.md` Q2 is **stale**: Ryme, Dawnclaw, Thunderous Sovereign and Chorus
  Drake all fold `drakkoRepeats` now; only Parting Cry and the arena `replayShout` consumers (Embercrest,
  Ancestral Roar, Shared Scripture, War Chorus) fire flat. The card states the split precisely.
- Sunmane Herald has **no live shop accrual to drop**: the effect is `combatOnly` at the data level, so
  `BoardCard.rallySpreadAtk` (docblocked "run-long") is write-dead. The card reframes the question as
  per-combat vs run-long.
- "The Reclaimer" is Soren's hero power **Reclaim** (no card of that name), and its capture drop is partially
  reconstructed by a Soren-snapshot heuristic that can mark a different minion.
- Found in passing: Empty Graves' player-facing reward line in `packages/ui/src/questText.ts` still describes
  the pre-2026-07-21 Gravebody design — stale text, flagged inside the card and worth its own small fix.

## Mechanics

- `rules.test.ts` extended: the integrity `all` set includes `MANUAL_PENDING`; manual ids checked against
  generated/approved/retired; every manual card asserted to carry cardText + example + literal '✓'/'✕' click
  semantics; board smoke (`undecided()` includes them); a REJECTED manual id must be hand-removed +
  hand-tombstoned (the seeder can't do it).
- Each card's `sourceQueue` names its Doc Bot lane (runeRewardDifferential, textOracleSummons, carryOver,
  snapshotFidelity, orderGoldens, interactionFamilyMatrix) so the enforcement mechanism can wire the eventual
  ruling.
