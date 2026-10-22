# 2026-10-22: Counters are plain integers; Frack Attack's counter ticks in combat (R-KOBOLD-1022-06 / -07)

Two owner reports on the Set 3 Kobolds from #2226.

**1. Rosey's counter read "1 Refresh".** Owner: "change rosey to our typical x/3 setup. we dont want to show
'refreshes' etc in our counter text."

- Root cause: `stepProgress`'s refresh branch (`packages/ui/src/cardText.ts`, shared by Rosey, Hellrider and Indy)
  returned a worded countdown label (`N Refresh(es)`), and Card.tsx renders a `label` verbatim.
- Fix: the branch now returns the plain cyclic `N/every` that counts UP, like Avenge and the buy / gold meters
  (1/3, 2/3, 3/3 on the step, then 1/3). The shop's hide-at-0 gate hides the fresh 0/3.
- Sweep for other worded counters: the End-of-Turn cadence branch (Frontdrake, Money Maker, ...) printed "N Turns" and is
  now the same cyclic N/M. Rune tallies: Rune of Unity "3/5 types" is 3/5; Rune of the Deep, Happy Birthday, Merry
  Christmas and the cadenced grants (Clockwork Promotion, Muckbroker, Rare Goods) "x/N turns" are x/N. Left alone (not
  progress meters, they are value or status readouts): rune readouts like "+3 Health", "next card free", "N left",
  "N Shouts", the "g" Gold suffix, and the hero power pills ("2t", "Tier 3", "3 left", "now").
- Guard: `stepProgress.test.ts` sweeps every card in `CARD_INDEX` at several meter values and fails on any letter in
  a counter reading.

**2. Frack Attack's counter didn't work in combat.** Owner: "frack attack's counter isnt working in combat, please fix that."

- The mechanic was fine: `friendlyAttacksPlayRubiesSelf` ticks `attackSeen` on every friendly swing and casts the
  repeat on every 3rd, and the repeat already has its own beat (`factory:friendlyAttacksPlayRubiesSelf:onAttack` is
  `ownBeat` in `packages/core/src/presentation/policies.ts`).
- Root cause: the DISPLAY. The combat card reads `attackSeen` off the replay frame (`Unit.tsx` -> `stepProgress`), and
  `computeFrame` in `packages/ui/src/useCombatReplay.ts` only re-derived that field for Crypt Drake (from its
  self-sourced buff). Nothing crossed the event boundary for Frack, so its counter sat on 0/3 all fight.
- Fix: the `attack` branch of `computeFrame` now ticks `attackSeen` on every living Frack on the attacker's side
  (`countsFriendlyAttacks`, cached per cardId), and the `reborn` branch clears it (the sim's `resetPerCombatLimits`).
  The counter lands on 3/3 on the swing, and the Ruby repeat plays on its own beat right after.
- Tests: `frackCombatCounter.test.ts` folds real fights frame by frame (fails without the fix: stuck at 0/3), plus the
  Rise reset; `set3Kobolds1022.test.ts` pins the repeat on exactly the 3rd, 6th and 9th friendly attack with its
  ownBeat key.
