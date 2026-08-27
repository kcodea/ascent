# Rune duplicate stacking — every second copy does something (owner rulings 2026-08-27)

The owner ruled on all eight `q-runedup-*` decision cards (triage round 2, decisions.json 2026-08-27). This
PR implements every ruling and drains the Doc Bot `runeSwallowScan` second-copy queue **80 → 0** (ratchet PIN
lowered 80 → 0 in `runeRewardDifferential.test.ts`).

## The rulings, as implemented

| Family | Ruling | Mechanism |
| --- | --- | --- |
| recurring (28) | APPROVE — second copy doubles the recurrence | consumers scale by `runeStacksOf` |
| threshold (8) | REVISE — same meter, doubled OUTPUT per trip | payout × copies at the trip; thresholds never accumulate |
| repeat (7 dead + classics) | APPROVE — +1 repetition per copy | rep counts read `runeStacksOf` |
| one-shot (8) | REVISE — re-grant; bank when immediate value impossible; Ornate Clock unique | rewards simply re-apply; Treasure Map became an array; Muster counts armed refreshes; a no-room Armory/Spare-Parts or empty-board Altar duplicate banks via `pendingQuestRewards`; Ornate Clock excused |
| boolean combat flags | APPROVE — fire once per copy where meaningful | `flagCopies` consumed by ~35 more dispatchers in simulate.ts (`flagCopiesOf`) |
| sweetener floor | APPROVE — Gold = ⌈cost/2⌉ + a free refresh | `RUNE_DUP_SWEETENER` in `runeDup.ts`, paid in `buyRune` |
| forge filter | APPROVE | `runeforgePool` drops owned sweetener-only/unique runes; Duplication unaffected |
| unique engines (29) | REVISE — double where sensible, else sweetener | per-engine doubling (see the PR table) |

## The mechanism

Rune ownership is now **counted**: `RunState.runeStacks[runeId]` ticks in `applyQuestReward` on every rune
application (buy, Duplication's copy, a granted rune). `runeStacksOf(s, id)` (min 1) is what consumers
multiply by, so single-copy runs — and every pre-counter save — are byte-identical. Combat boolean flags keep
the pre-existing `flagCopies` channel (the rune-Avenge precedent from 2026-08-06), consumed per copy by the
dispatchers that ignored it.

`RUNE_DUP_SWEETENER` / `RUNE_DUP_UNIQUE` / `forgeFilteredDuplicate` live in `packages/sim/src/runeDup.ts`.

## Held Strength rework (embedded owner order)

"rune of the held strength should not be a one-shot rune and should be a 'Start of Combat: give xyz' rune" —
it now arms `RunState.runeHeldStrength`; `questCombatMods` captures the left-most non-spell hand card's stats
live at combat build (`QuestCombatMods.runeHeldStrength`), and simulate's SoC section grants them to the left
and right-most minions, once per copy. The rune badge shows the live value (`runeTally`).

## Scan changes (Doc Bot)

- `runeSwallowScan` now buys **cost-neutrally** (full discount) and no longer strips `embers`, so Gold-paying
  rewards (Small Fortune's re-grant, the sweetener) are visible to the differential.
- The two threshold-amount flags (`runeReturningPack`, `runeGraveRefreshment`) are exempt from the amount-flag
  rule: their amount is a cadence, `flagCopies` is the sanctioned accumulation (accumulating the amount would
  make the rune WORSE).
- `RUNE_DIFF_EXCUSED` gains `rune_ornate_clock` (OWNER RULED 2026-08-27: unique, duplicate does nothing).
- `combatModLane`: `runeHeldStrength` staged with an object arm; `carryOverScan`: `runeTreasureMaps` excused
  (pure shop economy).

## Judgement calls (flagged in the PR)

- Empowerment + Wishbone now sum additively (reps 3 when both held; was 2) — the additive fold every other
  repeat source uses.
- Rune of Summoning's single-copy magnitude kept at the shipped +1/+1 per cast (printed text says +2/+2 — a
  pre-existing text/behaviour mismatch surfaced, not silently changed).
- Sweetener classification of the ~10 idempotent runes is documented per-rune in `runeDup.ts`.
