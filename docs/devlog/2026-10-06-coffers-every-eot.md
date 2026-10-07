# 2026-10-06: Rune of the Coffers triggers every End of Turn (max-Gold grants go above the cap)

Owner bug report (verbatim): "rune of the coffers only triggered once - it should trigger every end of turn"

Rune text: "**End of Turn:** increase your **maximum Gold** by **1**." (not once-only, not capped).

## Root cause

Not #1924. The End-of-Turn block did fire every turn and #1924's beat was emitted every turn. The bug is older: the
rune wrote its +1 into `maxEmbers`, the NATURAL Gold curve. Turn start grows that curve with
`max(maxEmbers, min(cap, maxEmbers + 1))`, so any raise that pushed `maxEmbers` into the cap (10) was swallowed: it
only pre-spent growth the player was getting anyway. Bought at 7 max Gold, the lead over a plain run stayed at +1 for
three turns (9 vs 8, 10 vs 9, 11 vs 10) before moving again, which reads exactly as "it triggered once". Same class as Nadja's
Goldspring (2026-07-22, #642) and the docbot retro entry `7af61a35-maxgold-cap`.

## Fix

- `recruit.ts` End of Turn: Coffers adds to `maxGoldBonus` (the above-the-cap channel Robin x Time, Gold Font, Nadja
  and Shop License already use) and tallies `runeCoffersGold`. Its `resourceChanged: maxGold` beat now carries
  `valueAfter = maxEmbers + maxGoldBonus` (the number the Gold pill shows).
- `runeTally.ts`: the Coffers badge prints `+N max Gold`, the running total (live-value rule).
- Siblings with the same root cause, fixed at their two chokepoints:
  - the Shop arena's `grantMaxGold` (Bone Taxer's Echo in the Shop);
  - `settleCombat`'s `playerMaxGoldGain` carry-back (Soulsman's Avenge, Bone Taxer in combat, Rune of Soul Taxes).
- No other End-of-Turn rune writes `maxEmbers`. Robin x Time's `eotMaxGold` already used `maxGoldBonus` and was
  correct (the comparison case). Rune of Shopkeep (upgrade cost) is a different number and unaffected.
- Save/restore: `runeCoffersGold` and `maxGoldBonus` are plain RunState fields (JSON round trip tested). Replays play
  the recorded End-of-Turn batch, which now has one Coffers beat per turn with the right total.

Not changed, noted: `withQuestRewardBeat` (reducer, quest/rune reward beats) diffs only `maxEmbers` for its `maxGold`
consequence, so a reward that grants `maxGoldBonus` (Rune of the Tip Jar's +4) shows the Gold burst but no max-Gold
consequence. Separate presentation follow-up.

Oracle **R-COFFERS-EVERY-EOT-01** (`packages/rules/src/registry/approved/runes.ts`); tests
`packages/sim/src/runeCoffersEveryEot.test.ts` (fail on the old code: 6 of 7) and
`packages/ui/src/runeCoffersTally.test.ts`.
